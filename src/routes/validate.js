/**
 * src/routes/validate.js
 *
 * POST /validate
 *
 * Body (JSON):
 *   phoneNumber {string} — phone number to validate (E.164 preferred, e.g. +15005550006)
 *
 * Response (200):
 *   { valid, e164, formatted, region, carrier, lineType }
 *
 * Response (400):
 *   { error: "phoneNumber is required" }
 */

'use strict';

const express              = require('express');
const { validateNumber }   = require('../services/validationService');
const { getTwilioClient }  = require('../services/twilioService');
const { appendLog }        = require('../services/logService');

const router = express.Router();

router.post('/', async (req, res) => {
  const { phoneNumber } = req.body || {};

  if (!phoneNumber) {
    return res.status(400).json({ error: 'phoneNumber is required' });
  }

  try {
    const client = getTwilioClient();
    const result = await validateNumber(String(phoneNumber), client);

    // Log the validation action
    appendLog({
      action:      'validate',
      number:      phoneNumber,
      result,
    });

    return res.json(result);
  } catch (err) {
    console.error('/validate error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
