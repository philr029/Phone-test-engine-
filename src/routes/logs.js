/**
 * src/routes/logs.js
 *
 * GET /logs
 *
 * Returns all log entries from /logs/results.json as a JSON array.
 * Entries are sorted most-recent first.
 *
 * Query params:
 *   action {string} — filter by action type (e.g. "validate", "test-call")
 *   limit  {number} — max number of entries to return
 */

'use strict';

const express        = require('express');
const { readLogs }   = require('../services/logService');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    let logs = readLogs();

    // Sort most-recent first
    logs = logs.slice().sort((a, b) =>
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    // Optional action filter
    if (req.query.action) {
      logs = logs.filter(l => l.action === req.query.action);
    }

    // Optional limit
    if (req.query.limit) {
      const limit = parseInt(req.query.limit, 10);
      if (!isNaN(limit) && limit > 0) {
        logs = logs.slice(0, limit);
      }
    }

    return res.json(logs);
  } catch (err) {
    console.error('/logs error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
