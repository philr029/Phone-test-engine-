/**
 * api/call.js
 *
 * Core call-triggering module for the Phone Test Engine.
 *
 * Exports:
 *   startCalls(numbers, options) — initiates a batch of outbound calls
 *   resolveCall(callSid, status, duration) — called by the webhook handler
 *                                            to resolve a pending call promise
 *
 * Options:
 *   testMode  {boolean} — simulate calls without real Twilio API usage
 *   retries   {number}  — max retry attempts on failure (default: 1)
 *   baseUrl   {string}  — public server URL for Twilio status callbacks
 *   twimlUrl  {string}  — TwiML URL Twilio fetches when the call connects
 *   delayMs   {number}  — ms to wait between consecutive calls
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const twilio          = require('twilio');
const { upsertResult } = require('./results');

// ── Configuration ─────────────────────────────────────────────────────────────

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_SID;
const AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN  || process.env.TWILIO_AUTH;
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_NUMBER;

// How long to wait for a terminal webhook status before declaring timeout (ms)
const DEFAULT_WEBHOOK_TIMEOUT_MS   = 90_000;

// Default delay between consecutive calls (ms) — avoids spam/rate-limit flags
const DEFAULT_CALL_DELAY_MS    = 3_000;

// Terminal call statuses — no further webhook events are expected after these
const TERMINAL_STATUSES = new Set(['completed', 'no-answer', 'busy', 'failed', 'canceled']);

// Simulated test-mode outcomes (weighted toward realistic distribution)
const TEST_OUTCOMES = ['completed', 'completed', 'completed', 'no-answer', 'busy', 'failed'];

// Map of callSid → { resolve, reject, timer } for in-flight calls awaiting webhook
const pendingCalls = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns a promise that resolves after `ms` milliseconds. */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Returns the current UTC timestamp as an ISO-8601 string. */
function now() {
  return new Date().toISOString();
}

// ── Webhook resolver (called from api/webhook.js) ─────────────────────────────

/**
 * Resolves a pending call promise when a terminal webhook status arrives.
 *
 * @param {string} callSid   — Twilio CallSid
 * @param {string} status    — CallStatus from Twilio
 * @param {string} duration  — CallDuration (seconds, as string) from Twilio
 */
function resolveCall(callSid, status, duration) {
  const pending = pendingCalls.get(callSid);
  if (!pending) return; // unknown or already resolved

  if (TERMINAL_STATUSES.has(status)) {
    clearTimeout(pending.timer);
    pendingCalls.delete(callSid);
    pending.resolve({ status, duration: parseInt(duration, 10) || 0 });
  }
}

// ── Core call logic ───────────────────────────────────────────────────────────

/**
 * Places a single real Twilio call and waits for a terminal webhook status.
 *
 * @param {import('twilio').Twilio} client
 * @param {string}  to          — destination number (E.164)
 * @param {string}  webhookUrl  — public URL Twilio posts status callbacks to
 * @param {string}  twimlUrl    — TwiML instruction URL
 * @param {number}  timeoutMs   — how long to wait for webhook (ms)
 * @returns {Promise<{status: string, callSid: string, duration: number}>}
 */
async function placeTwilioCall(client, to, webhookUrl, twimlUrl, timeoutMs) {
  const call = await client.calls.create({
    url:                   twimlUrl,
    to,
    from:                  FROM_NUMBER,
    statusCallback:        webhookUrl,
    statusCallbackMethod:  'POST',
    statusCallbackEvent:   ['initiated', 'ringing', 'answered', 'completed'],
  });

  console.log(`  ↗  Initiated Twilio call ${call.sid} → ${to}`);

  return new Promise((resolve, reject) => {
    // Timeout guard — cancel the call and resolve as 'failed' if no webhook arrives
    const timer = setTimeout(async () => {
      pendingCalls.delete(call.sid);
      console.warn(`  ⚠  Webhook timeout for ${call.sid}; cancelling call.`);
      try {
        await client.calls(call.sid).update({ status: 'canceled' });
      } catch (_) { /* already ended */ }
      resolve({ status: 'failed', callSid: call.sid, duration: 0 });
    }, timeoutMs);

    pendingCalls.set(call.sid, {
      resolve: ({ status, duration }) => resolve({ status, callSid: call.sid, duration }),
      reject,
      timer,
    });
  });
}

/**
 * Simulates a call in test mode — no real API call is made.
 *
 * @param {string} to
 * @returns {Promise<{status: string, callSid: string, duration: number}>}
 */
async function placeTestCall(to) {
  // Random simulated delay (0.5–2 s) to mimic network latency
  await sleep(500 + Math.random() * 1500);

  const status   = TEST_OUTCOMES[Math.floor(Math.random() * TEST_OUTCOMES.length)];
  const callSid  = `TEST-${uuidv4()}`;
  const duration = status === 'completed' ? Math.floor(5 + Math.random() * 55) : 0;

  console.log(`  🧪  [TEST] ${to}  →  ${status}  (${duration}s)`);
  return { status, callSid, duration };
}

/**
 * Calls a single number, retrying on failure up to `maxRetries` times.
 *
 * @param {import('twilio').Twilio|null} client
 * @param {string}  to
 * @param {object}  opts
 * @param {boolean} opts.testMode
 * @param {number}  opts.maxRetries
 * @param {string}  opts.webhookUrl
 * @param {string}  opts.twimlUrl
 * @param {number}  opts.timeoutMs
 * @param {number}  opts.delayMs
 * @returns {Promise<{status:string, callSid:string, duration:number, attempts:number}>}
 */
async function callWithRetry(client, to, opts) {
  const { testMode, maxRetries, webhookUrl, twimlUrl, timeoutMs, delayMs } = opts;

  let status   = 'failed';
  let callSid  = '';
  let duration = 0;
  let attempts = 0;

  while (attempts <= maxRetries) {
    attempts += 1;

    try {
      const result = testMode
        ? await placeTestCall(to)
        : await placeTwilioCall(client, to, webhookUrl, twimlUrl, timeoutMs);

      status   = result.status;
      callSid  = result.callSid;
      duration = result.duration;
    } catch (err) {
      console.error(`  ✗  Error calling ${to} (attempt ${attempts}): ${err.message}`);
      status = 'failed';
    }

    if (status !== 'failed' || attempts > maxRetries) break;

    console.log(`  ↺  Retrying ${to} (attempt ${attempts + 1} of ${maxRetries + 1})…`);
    await sleep(delayMs);
  }

  return { status, callSid, duration, attempts };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Starts a batch of outbound calls and persists each result to results.json.
 *
 * @param {string[]} numbers         — E.164 phone numbers to call
 * @param {object}  [options]
 * @param {boolean} [options.testMode=false]
 * @param {number}  [options.retries=1]
 * @param {string}  [options.baseUrl='']   — public base URL for webhook callbacks
 * @param {string}  [options.twimlUrl]     — custom TwiML URL (defaults to Twilio demo)
 * @param {number}  [options.delayMs=3000]
 * @returns {Promise<object[]>}  — array of result records
 */
async function startCalls(numbers, options = {}) {
  const {
    testMode = process.env.TEST_MODE === 'true',
    retries  = 1,
    baseUrl  = process.env.BASE_URL || '',
    twimlUrl = process.env.TWIML_URL || 'http://demo.twilio.com/docs/voice.xml',
    delayMs  = DEFAULT_CALL_DELAY_MS,
  } = options;

  const webhookUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/api/webhook` : '';
  const timeoutMs  = DEFAULT_WEBHOOK_TIMEOUT_MS;

  // Validate Twilio credentials when not in test mode
  let client = null;
  if (!testMode) {
    if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
      throw new Error(
        'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER must be set ' +
        'when TEST_MODE is not enabled.'
      );
    }
    if (!webhookUrl) {
      throw new Error('BASE_URL must be set so Twilio can deliver webhook callbacks.');
    }
    client = twilio(ACCOUNT_SID, AUTH_TOKEN);
  }

  console.log(`\n📞  Starting call batch — ${numbers.length} number(s)` +
    (testMode ? ' [TEST MODE — no real calls]' : '') + '\n');

  const results = [];

  for (let i = 0; i < numbers.length; i++) {
    const to        = numbers[i];
    const startTime = now();
    const id        = uuidv4();

    console.log(`[${i + 1}/${numbers.length}] Calling ${to}…`);

    // Persist an "initiated" record immediately so the dashboard can show it
    upsertResult({ id, to, callSid: '', status: 'initiated', startTime, endTime: null,
      duration: 0, attempts: 0, testMode });

    const outcome = await callWithRetry(client, to, {
      testMode, maxRetries: retries, webhookUrl, twimlUrl, timeoutMs, delayMs,
    });

    const endTime = now();
    const record  = { id, to, callSid: outcome.callSid, status: outcome.status,
      startTime, endTime, duration: outcome.duration,
      attempts: outcome.attempts, testMode };

    upsertResult(record);
    results.push(record);

    const icon =
      outcome.status === 'completed' ? '✅' :
      outcome.status === 'no-answer' ? '📵' :
      outcome.status === 'busy'      ? '🔴' : '❌';

    console.log(`  ${icon}  ${to}  →  ${outcome.status}` +
      (outcome.attempts > 1 ? ` (${outcome.attempts} attempts)` : ''));

    if (i < numbers.length - 1) await sleep(delayMs);
  }

  // Summary
  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  console.log('\n── Batch summary ──────────────────────────────────────────');
  for (const [s, c] of Object.entries(counts)) console.log(`  ${s}: ${c}`);
  console.log(`  Total: ${results.length}\n`);

  return results;
}

module.exports = { startCalls, resolveCall };
