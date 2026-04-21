/**
 * src/services/logService.js
 *
 * Append-only JSON log stored at /logs/results.json.
 *
 * Exports:
 *   appendLog(entry)   — append a single log entry (adds timestamp if missing)
 *   readLogs()         — return all log entries as an array
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', '..', 'logs', 'results.json');

/**
 * Ensure the log file and its parent directory exist.
 */
function ensureLogFile() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '[]', 'utf8');
  }
}

/**
 * Read all log entries from disk.
 * Returns an empty array if the file is missing or corrupt.
 *
 * @returns {object[]}
 */
function readLogs() {
  try {
    ensureLogFile();
    const raw    = fs.readFileSync(LOG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * Append a single entry to the log.
 * Automatically adds a `timestamp` field if not present.
 *
 * @param {object} entry
 * @returns {object} the stored entry
 */
function appendLog(entry) {
  ensureLogFile();

  const stored = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  const logs = readLogs();
  logs.push(stored);
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf8');

  return stored;
}

module.exports = { appendLog, readLogs };
