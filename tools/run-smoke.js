// Runs the app against a throwaway profile with sample data, drives the main flows,
// writes screenshots + a report to the given folder, then quits.
// Usage: npm run smoke -- <outDir>
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const out = path.resolve(process.argv[2] || path.join(require('os').tmpdir(), 'corner-todo-smoke'));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const electron = require('electron');
const r = spawnSync(electron, ['.'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, CORNER_TODO_SMOKE: out },
  stdio: 'inherit',
  timeout: 120000,
});
console.log(`smoke output: ${out}`);
process.exit(r.status ?? 1);
