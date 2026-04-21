/**
 * src/services/twilioService.js
 *
 * Single-call Twilio service with TEST_MODE simulation.
 *
 * Exports:
 *   makeCall(to, options) — places one outbound call and returns { status, callSid }
 */

'use strict';

const twilio        = require('twilio');
const { v4: uuidv4 } = require('uuid');

const ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_SID;
const AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN  || process.env.TWILIO_AUTH;
const FROM_NUMBER  = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_NUMBER;

// Simulated outcomes (weighted toward realistic distribution)
const TEST_OUTCOMES = ['completed', 'completed', 'completed', 'no-answer', 'busy', 'failed'];

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Place a single outbound call (real or simulated).
 *
 * @param {string} to — destination number in E.164 format
 * @param {object} [options]
 * @param {boolean} [options.testMode]  — override TEST_MODE env var
 * @param {string}  [options.twimlUrl] — TwiML URL for the call
 * @returns {Promise<{status: string, callSid: string, duration: number}>}
 */
async function makeCall(to, options = {}) {
  const {
    testMode = process.env.TEST_MODE === 'true',
    twimlUrl = process.env.TWIML_URL || 'http://demo.twilio.com/docs/voice.xml',
  } = options;

  if (testMode) {
    // Simulate a short network delay
    await sleep(300 + Math.random() * 700);
    const status   = TEST_OUTCOMES[Math.floor(Math.random() * TEST_OUTCOMES.length)];
    const callSid  = `TEST-${uuidv4()}`;
    const duration = status === 'completed' ? Math.floor(5 + Math.random() * 55) : 0;
    return { status, callSid, duration };
  }

  // Live mode — validate credentials
  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
    throw new Error(
      'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER must be set for live calls.'
    );
  }

  const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

  const call = await client.calls.create({
    url:  twimlUrl,
    to,
    from: FROM_NUMBER,
  });

  return { status: call.status, callSid: call.sid, duration: 0 };
}

/**
 * Build an authenticated Twilio client (for use in validation lookups etc.).
 * Returns null if credentials are missing.
 *
 * @returns {import('twilio').Twilio|null}
 */
function getTwilioClient() {
  if (!ACCOUNT_SID || !AUTH_TOKEN) return null;
  try {
    return twilio(ACCOUNT_SID, AUTH_TOKEN);
  } catch (_) {
    return null;
  }
}

module.exports = { makeCall, getTwilioClient };
