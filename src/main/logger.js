// Append-only JSONL activity log, one file per month, meant to be handed to an AI later.
// Each line: { ts, date, type, ...data }. Lines are never rewritten.
const fs = require('fs');
const path = require('path');
const M = require('../shared/model');

let dir = null;

function init(baseDir) {
  dir = path.join(baseDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
}

function log(type, data = {}, when = new Date()) {
  if (!dir) return;
  const line = JSON.stringify({ ts: when.toISOString(), date: M.dateKey(when), type, ...data });
  try {
    fs.appendFileSync(path.join(dir, `${M.dateKey(when).slice(0, 7)}.jsonl`), line + '\n');
  } catch (err) {
    console.error('log write failed:', err.message);
  }
}

const logDir = () => dir;

module.exports = { init, log, logDir };
