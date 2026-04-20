/**
 * Phone Test Engine — call.js
 *
 * Reads phone numbers from numbers.json, calls each one via Twilio,
 * captures the call status, and saves results to logs.json.
 *
 * Environment variables required:
 *   TWILIO_SID      — Twilio Account SID
 *   TWILIO_AUTH     — Twilio Auth Token
 *   TWILIO_NUMBER   — Twilio phone number to call from (E.164 format)
 *
 * Usage:
 *   npm install
 *   node call.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const twilio = require('twilio');

// ── Configuration ────────────────────────────────────────────────────────────

const ACCOUNT_SID  = process.env.TWILIO_SID;
const AUTH_TOKEN   = process.env.TWILIO_AUTH;
const FROM_NUMBER  = process.env.TWILIO_NUMBER;

// Delay between calls in milliseconds (avoids Twilio rate limits)
const CALL_DELAY_MS = 3000;

// How long to wait for Twilio to return a terminal call status (ms)
const POLL_TIMEOUT_MS = 60000;

// How frequently to poll for call status (ms)
const POLL_INTERVAL_MS = 2000;

// Maximum retry attempts for a failed call
const MAX_RETRIES = 1;

// File paths
const NUMBERS_FILE = path.join(__dirname, 'numbers.json');
const LOGS_FILE    = path.join(__dirname, 'logs.json');

// TwiML that plays a short message then hangs up
const TWIML_URL = 'http://demo.twilio.com/docs/voice.xml';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Reads and parses a JSON file.
 * @param {string} filePath
 * @returns {any}
 */
function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Writes data as formatted JSON to a file.
 * @param {string} filePath
 * @param {any} data
 */
function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Returns the current UTC timestamp as an ISO-8601 string.
 * @returns {string}
 */
function timestamp() {
  return new Date().toISOString();
}

// ── Core logic ───────────────────────────────────────────────────────────────

/**
 * Places a single outbound call and polls until a terminal status is reached.
 *
 * Terminal statuses: completed, no-answer, busy, failed, canceled
 *
 * @param {import('twilio').Twilio} client
 * @param {string} to  — E.164 phone number to call
 * @returns {Promise<string>} — final call status
 */
async function placeCall(client, to) {
  // Initiate the call
  const call = await client.calls.create({
    url:  TWIML_URL,
    to,
    from: FROM_NUMBER,
  });

  console.log(`  ↗  Initiated call ${call.sid} to ${to}`);

  const terminalStatuses = new Set(['completed', 'no-answer', 'busy', 'failed', 'canceled']);
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  // Poll until a terminal status is reached or the timeout expires
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const updated = await client.calls(call.sid).fetch();
    const status  = updated.status;

    if (terminalStatuses.has(status)) {
      return status;
    }
  }

  // If we time out before a terminal status, cancel the call and mark failed
  console.warn(`  ⚠  Timeout waiting for status on ${call.sid}; cancelling.`);
  try {
    await client.calls(call.sid).update({ status: 'canceled' });
  } catch (_) {
    // Ignore cancel errors — call may have already ended
  }
  return 'failed';
}

/**
 * Calls a number with up to MAX_RETRIES retries on failure.
 *
 * @param {import('twilio').Twilio} client
 * @param {string} to
 * @returns {Promise<{to: string, status: string, timestamp: string, attempts: number}>}
 */
async function callWithRetry(client, to) {
  let status   = 'failed';
  let attempts = 0;

  while (attempts <= MAX_RETRIES) {
    attempts += 1;

    try {
      status = await placeCall(client, to);
    } catch (err) {
      console.error(`  ✗  Error calling ${to} (attempt ${attempts}): ${err.message}`);
      status = 'failed';
    }

    // Retry only on failure/error, and only if we have retries left
    if (status !== 'failed' || attempts > MAX_RETRIES) {
      break;
    }

    console.log(`  ↺  Retrying ${to} (attempt ${attempts + 1})…`);
    await sleep(CALL_DELAY_MS);
  }

  return { to, status, timestamp: timestamp(), attempts };
}

// ── Main entry point ─────────────────────────────────────────────────────────

async function main() {
  // Validate required environment variables
  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
    console.error(
      'Error: TWILIO_SID, TWILIO_AUTH, and TWILIO_NUMBER environment variables must be set.'
    );
    process.exit(1);
  }

  // Load phone numbers
  let numbers;
  try {
    numbers = readJson(NUMBERS_FILE);
  } catch (err) {
    console.error(`Error reading ${NUMBERS_FILE}: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(numbers) || numbers.length === 0) {
    console.error('No phone numbers found in numbers.json');
    process.exit(1);
  }

  // Load existing logs (so we append rather than overwrite)
  let logs = [];
  try {
    logs = readJson(LOGS_FILE);
    if (!Array.isArray(logs)) logs = [];
  } catch (_) {
    logs = [];
  }

  const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

  console.log(`\n📞  Phone Test Engine — starting run at ${timestamp()}`);
  console.log(`    Numbers to call: ${numbers.length}\n`);

  const results = [];

  for (let i = 0; i < numbers.length; i++) {
    const to = numbers[i];
    console.log(`[${i + 1}/${numbers.length}] Calling ${to}…`);

    const result = await callWithRetry(client, to);
    results.push(result);

    // Pretty-print result with colour coding
    const icon =
      result.status === 'completed' ? '✅' :
      result.status === 'no-answer' ? '📵' :
      result.status === 'busy'      ? '🔴' : '❌';

    console.log(
      `  ${icon}  ${to}  →  ${result.status}` +
      (result.attempts > 1 ? ` (${result.attempts} attempts)` : '')
    );

    // Add a delay between calls (skip after last number)
    if (i < numbers.length - 1) {
      await sleep(CALL_DELAY_MS);
    }
  }

  // Append new results to the log and persist
  const updatedLogs = logs.concat(results);
  writeJson(LOGS_FILE, updatedLogs);

  // Summary
  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  console.log('\n── Summary ────────────────────────────────────────────');
  for (const [status, count] of Object.entries(counts)) {
    console.log(`  ${status}: ${count}`);
  }
  console.log(`  Total: ${results.length}`);
  console.log(`  Logs saved to ${LOGS_FILE}`);
  console.log('───────────────────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
