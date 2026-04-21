/**
 * server.js
 *
 * Phone Test Engine — Express server
 *
 * Endpoints:
 *   POST /start-test       — trigger a batch of outbound calls
 *   GET  /results          — return all call results as JSON
 *   GET  /results/export   — download results as CSV
 *   POST /api/webhook      — Twilio status-callback receiver
 *   GET  /                 — serve the dashboard (frontend/index.html)
 *
 * Environment variables (see .env.example):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 *   BASE_URL   — publicly accessible URL of this server (required for webhooks)
 *   PORT       — listening port (default: 3000)
 *   TEST_MODE  — set to "true" to simulate calls without real Twilio API usage
 *   TWIML_URL  — custom TwiML URL (optional)
 */

'use strict';

require('dotenv').config();

const express    = require('express');
const path       = require('path');
const fs         = require('fs');

const { startCalls }               = require('./api/call');
const webhookRouter                = require('./api/webhook');
const { readResults, exportCsv }   = require('./api/results');
const rateLimit                    = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Rate limiter ──────────────────────────────────────────────────────────────

// Limits /start-test to 10 requests per minute per IP to prevent abuse.
const startTestLimiter = rateLimit({
  windowMs:          60_000, // 1 minute
  max:               10,
  standardHeaders:   true,
  legacyHeaders:     false,
  message:           { error: 'Too many requests. Please retry after 60 seconds.' },
});

// ── Middleware ────────────────────────────────────────────────────────────────

// Parse JSON request bodies (used by /start-test)
app.use(express.json());

// Parse URL-encoded bodies (used by Twilio webhook POSTs)
app.use(express.urlencoded({ extended: false }));

// Serve static frontend files from /frontend
app.use(express.static(path.join(__dirname, 'frontend')));

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /start-test
 *
 * Body (JSON):
 *   numbers    {string[]}  — optional list of E.164 numbers to call
 *                           (falls back to numbers.json if omitted)
 *   testMode   {boolean}   — override TEST_MODE env var (optional)
 *   retries    {number}    — max retry attempts per number (optional, default 1)
 *   scheduledAt {string}   — ISO-8601 timestamp to delay the run (optional)
 *
 * Response: { message, count, scheduledAt? }
 */
app.post('/start-test', startTestLimiter, async (req, res) => {
  try {
    let { numbers, testMode, retries, scheduledAt } = req.body || {};

    // Resolve phone number list
    if (!Array.isArray(numbers) || numbers.length === 0) {
      const numbersFile = path.join(__dirname, 'numbers.json');
      if (!fs.existsSync(numbersFile)) {
        return res.status(400).json({ error: 'No numbers provided and numbers.json not found.' });
      }
      numbers = JSON.parse(fs.readFileSync(numbersFile, 'utf8'));
    }

    if (!Array.isArray(numbers) || numbers.length === 0) {
      return res.status(400).json({ error: 'Phone number list is empty.' });
    }

    const opts = {
      testMode: testMode !== undefined ? Boolean(testMode) : undefined,
      retries:  retries  !== undefined ? Number(retries)   : undefined,
      baseUrl:  process.env.BASE_URL,
    };

    // If a future schedule time is given, delay the run
    if (scheduledAt) {
      const runAt = new Date(scheduledAt).getTime();
      const delay = runAt - Date.now();

      if (delay < 0) {
        return res.status(400).json({ error: 'scheduledAt must be a future timestamp.' });
      }

      // Respond immediately and fire calls after the delay
      setTimeout(() => startCalls(numbers, opts).catch(err =>
        console.error('Scheduled run error:', err.message)
      ), delay);

      return res.json({
        message:     `Test run scheduled for ${new Date(scheduledAt).toISOString()}`,
        count:       numbers.length,
        scheduledAt: new Date(scheduledAt).toISOString(),
      });
    }

    // Fire immediately — respond with 202 and run in background so the
    // HTTP connection isn't held open for the entire call batch.
    res.status(202).json({ message: 'Test run started', count: numbers.length });

    startCalls(numbers, opts).catch(err =>
      console.error('Call batch error:', err.message)
    );

  } catch (err) {
    console.error('/start-test error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /results
 *
 * Returns all call log entries as JSON.
 * Query params:
 *   limit  {number} — max number of results to return (most recent first)
 *   status {string} — filter by call status
 */
app.get('/results', (req, res) => {
  let results = readResults();

  // Optional status filter
  if (req.query.status) {
    results = results.filter(r => r.status === req.query.status);
  }

  // Sort most-recent first
  results = results.slice().sort((a, b) =>
    new Date(b.startTime) - new Date(a.startTime)
  );

  // Optional limit
  if (req.query.limit) {
    const limit = parseInt(req.query.limit, 10);
    if (!isNaN(limit) && limit > 0) {
      results = results.slice(0, limit);
    }
  }

  res.json(results);
});

/**
 * GET /results/export
 *
 * Returns all results as a downloadable CSV file.
 */
app.get('/results/export', (req, res) => {
  const results = readResults().slice().sort((a, b) =>
    new Date(b.startTime) - new Date(a.startTime)
  );
  const csv = exportCsv(results);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="call-results.csv"');
  res.send(csv);
});

/**
 * POST /api/webhook
 * Handled by the Twilio webhook router.
 */
app.use('/api/webhook', webhookRouter);

// ── Start server ──────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n📞  Phone Test Engine server running on port ${PORT}`);
  console.log(`    Dashboard:   http://localhost:${PORT}`);
  console.log(`    Results API: http://localhost:${PORT}/results`);
  console.log(`    Webhook URL: ${process.env.BASE_URL || '(set BASE_URL env var)'}/api/webhook`);
  console.log(`    Test Mode:   ${process.env.TEST_MODE === 'true' ? '✅ enabled' : '❌ disabled'}\n`);
});

module.exports = app; // exported for testing
