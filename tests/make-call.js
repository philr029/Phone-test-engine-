/**
 * tests/make-call.js
 *
 * Triggers an outbound Twilio call to notify you that the test run has finished.
 * Twilio will read the message aloud when the call is answered.
 *
 * Required environment variables (set as GitHub Actions secrets):
 *   TWILIO_ACCOUNT_SID  — Twilio Account SID  (starts with "AC…")
 *   TWILIO_AUTH_TOKEN   — Twilio Auth Token
 *   TWILIO_PHONE_NUMBER — Your Twilio "from" number in E.164 format, e.g. +15550001111
 *   MY_PHONE_NUMBER     — The number to call in E.164 format, e.g. +15559998888
 *
 * Usage:
 *   node tests/make-call.js
 *
 * Exit codes:
 *   0 — call initiated successfully
 *   1 — configuration error or Twilio API failure
 */

'use strict';

const twilio = require('twilio');

// ── Configuration ─────────────────────────────────────────────────────────────

const ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER   = process.env.TWILIO_PHONE_NUMBER;
const TO_NUMBER     = process.env.MY_PHONE_NUMBER;

// The message Twilio reads when the call is answered.
// Adjust the text to suit your workflow.
const MESSAGE =
  'Hello! Your automated test run has finished. ' +
  'Please check GitHub Actions for the full results. Goodbye.';

// Twilio text-to-speech voice. See https://www.twilio.com/docs/voice/twiml/say
const TTS_VOICE = 'alice';

// ── Validate env vars ─────────────────────────────────────────────────────────

const missing = [
  ['TWILIO_ACCOUNT_SID',  ACCOUNT_SID],
  ['TWILIO_AUTH_TOKEN',   AUTH_TOKEN],
  ['TWILIO_PHONE_NUMBER', FROM_NUMBER],
  ['MY_PHONE_NUMBER',     TO_NUMBER],
].filter(([, value]) => !value).map(([name]) => name);

if (missing.length > 0) {
  console.error(
    `Error: the following environment variable(s) must be set:\n  ${missing.join('\n  ')}`
  );
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Escapes special XML characters so the message is safe to embed in TwiML.
 * @param {string} text
 * @returns {string}
 */
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Returns a redacted version of a phone number showing only the last 4 digits.
 * @param {string} number
 * @returns {string}
 */
function redactNumber(number) {
  return number.length > 4 ? `***${number.slice(-4)}` : '****';
}

// ── Make the call ─────────────────────────────────────────────────────────────

const twiml = `<Response><Say voice="${TTS_VOICE}">${escapeXml(MESSAGE)}</Say></Response>`;

(async () => {
  const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

  try {
    const call = await client.calls.create({
      twiml,
      to:   TO_NUMBER,
      from: FROM_NUMBER,
    });

    console.log(`✅  Call initiated successfully.`);
    console.log(`    SID  : ${call.sid}`);
    console.log(`    To   : ${redactNumber(TO_NUMBER)}`);
    console.log(`    From : ${redactNumber(FROM_NUMBER)}`);
    console.log(`    Status: ${call.status}`);
  } catch (err) {
    const code = err.code ? ` (Twilio error code: ${err.code})` : '';
    console.error(`❌  Failed to initiate call: ${err.message}${code}`);
    process.exit(1);
  }
})();
