/**
 * api/webhook.js
 *
 * Express router that handles Twilio status-callback webhooks.
 *
 * Twilio POSTs to /api/webhook after each call-state change.
 * Terminal events (completed, no-answer, busy, failed, canceled) resolve
 * the in-flight promise held in api/call.js and update results.json.
 *
 * Twilio sends form-encoded bodies, so express.urlencoded() must be
 * mounted on the parent app before this router.
 */

'use strict';

const express              = require('express');
const { resolveCall }      = require('./call');
const { findByCallSid, upsertResult } = require('./results');

const router = express.Router();

// Terminal statuses that warrant a results.json update
const TERMINAL_STATUSES = new Set(['completed', 'no-answer', 'busy', 'failed', 'canceled']);

/**
 * POST /api/webhook
 *
 * Twilio posts the following fields (among others):
 *   CallSid, CallStatus, CallDuration, To, From, Direction
 */
router.post('/', (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body || {};

  if (!CallSid || !CallStatus) {
    // Malformed request — still return 200 so Twilio doesn't retry endlessly
    return res.status(200).send('<Response></Response>');
  }

  console.log(`  🔔  Webhook: ${CallSid}  →  ${CallStatus}` +
    (CallDuration ? ` (${CallDuration}s)` : ''));

  // Notify the in-flight call promise (if still waiting)
  resolveCall(CallSid, CallStatus, CallDuration);

  // Persist any intermediate or terminal status update to results.json
  if (TERMINAL_STATUSES.has(CallStatus)) {
    const existing = findByCallSid(CallSid);
    if (existing) {
      upsertResult({
        ...existing,
        callSid:  CallSid,
        status:   CallStatus,
        endTime:  new Date().toISOString(),
        duration: parseInt(CallDuration, 10) || existing.duration,
      });
    }
  }

  // Twilio expects a TwiML response (empty <Response> is valid)
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send('<Response></Response>');
});

module.exports = router;
