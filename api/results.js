/**
 * api/results.js
 *
 * Utilities for reading/writing call results to data/results.json
 * and exporting them as CSV.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const RESULTS_FILE = path.join(__dirname, '..', 'data', 'results.json');

/**
 * Read all call results from disk.
 * Returns an empty array if the file is missing or corrupt.
 * @returns {object[]}
 */
function readResults() {
  try {
    const raw = fs.readFileSync(RESULTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * Persist the full results array to disk.
 * @param {object[]} results
 */
function writeResults(results) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf8');
}

/**
 * Append a single result entry (or overwrite an existing one by id).
 * @param {object} entry
 */
function upsertResult(entry) {
  const results = readResults();
  const idx = results.findIndex(r => r.id === entry.id);
  if (idx >= 0) {
    results[idx] = { ...results[idx], ...entry };
  } else {
    results.push(entry);
  }
  writeResults(results);
}

/**
 * Find a result by Twilio CallSid.
 * @param {string} callSid
 * @returns {object|undefined}
 */
function findByCallSid(callSid) {
  return readResults().find(r => r.callSid === callSid);
}

// CSV header columns
const CSV_HEADERS = ['id', 'to', 'callSid', 'status', 'startTime', 'endTime', 'duration', 'attempts', 'testMode'];

/**
 * Escape a value for use in a CSV cell.
 * @param {any} val
 * @returns {string}
 */
function csvCell(val) {
  const str = val === null || val === undefined ? '' : String(val);
  // Wrap in quotes if value contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Convert results array to a CSV string.
 * @param {object[]} results
 * @returns {string}
 */
function exportCsv(results) {
  const rows = [CSV_HEADERS.join(',')];
  for (const r of results) {
    rows.push(CSV_HEADERS.map(col => csvCell(r[col])).join(','));
  }
  return rows.join('\r\n');
}

module.exports = { readResults, writeResults, upsertResult, findByCallSid, exportCsv };
