/**
 * src/services/validationService.js
 *
 * Phone number validation using libphonenumber-js.
 * Optionally enriches with Twilio Lookup for carrier / line-type data.
 *
 * Exports:
 *   validateNumber(phoneNumber) — returns { valid, region, carrier, lineType, e164, formatted }
 */

'use strict';

const {
  parsePhoneNumber,
  isValidPhoneNumber,
  getCountryCallingCode,
} = require('libphonenumber-js');

/**
 * Validate a phone number and return structured metadata.
 *
 * @param {string} phoneNumber — raw phone number string (E.164 preferred)
 * @param {object} [twilioClient] — optional Twilio client for carrier lookup
 * @returns {Promise<{valid: boolean, e164: string|null, formatted: string|null,
 *                    region: string|null, carrier: string, lineType: string}>}
 */
async function validateNumber(phoneNumber, twilioClient = null) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return { valid: false, e164: null, formatted: null, region: null, carrier: 'unknown', lineType: 'unknown' };
  }

  let parsed;
  try {
    // Try parsing with no default country first (works for E.164 like +1...)
    parsed = parsePhoneNumber(phoneNumber);
  } catch (_) {
    return { valid: false, e164: null, formatted: null, region: null, carrier: 'unknown', lineType: 'unknown' };
  }

  const valid = parsed ? isValidPhoneNumber(phoneNumber) : false;

  if (!valid || !parsed) {
    return { valid: false, e164: null, formatted: null, region: null, carrier: 'unknown', lineType: 'unknown' };
  }

  const e164      = parsed.format('E.164');
  const formatted = parsed.formatInternational();
  const region    = parsed.country || null;

  let carrier  = 'unknown';
  let lineType = 'unknown';

  // Optional: Twilio Lookup API enrichment for carrier / line type
  if (twilioClient && e164) {
    try {
      const lookup = await twilioClient.lookups.v1
        .phoneNumbers(e164)
        .fetch({ type: ['carrier'] });

      if (lookup.carrier) {
        carrier  = lookup.carrier.name         || 'unknown';
        lineType = lookup.carrier.type         || 'unknown';
      }
    } catch (_) {
      // Lookup failed — return defaults
    }
  }

  return { valid, e164, formatted, region, carrier, lineType };
}

module.exports = { validateNumber };
