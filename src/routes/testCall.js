/**
 * src/routes/testCall.js
 *
 * POST /test-call
 *
 * Body (JSON):
 *   phoneNumber {string}  — E.164 number to call
 *   testMode    {boolean} — override TEST_MODE env var (optional)
 *   twimlUrl    {string}  — custom TwiML URL (optional)
 *
 * Response (200):
 *   { status, callSid, duration, testMode }
 *
 * Response (400):
 *   { error: "phoneNumber is required" }
 */

'use strict';

const express           = require('express');
const { makeCall }      = require('../services/twilioService');
const { appendLog }     = require('../services/logService');

const router = express.Router();

router.post('/', async (req, res) => {
  const { phoneNumber, testMode, twimlUrl } = req.body || {};

  if (!phoneNumber) {
    return res.status(400).json({ error: 'phoneNumber is required' });
  }

  const isTestMode = testMode !== undefined
    ? Boolean(testMode)
    : process.env.TEST_MODE === 'true';

  try {
    const result = await makeCall(String(phoneNumber), {
      testMode: isTestMode,
      twimlUrl,
    });

    const record = {
      action:   'test-call',
      number:   phoneNumber,
      testMode: isTestMode,
      result,
    };

    appendLog(record);

    return res.json({
      status:   result.status,
      callSid:  result.callSid,
      duration: result.duration,
      testMode: isTestMode,
    });
  } catch (err) {
    console.error('/test-call error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
