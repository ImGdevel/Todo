const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../src/main/store');
const M = require('../src/shared/model');

function profileWith(state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-store-'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
  return dir;
}

test('v0.1 state migrates: todos become one-off tasks, settings carried over', () => {
  const dir = profileWith({
    todos: [{ id: 'a', text: '보고서', done: false, spentMs: 120000 }, { id: 'b', text: '운동', done: true, spentMs: 0 }],
    settings: { width: 320, opacity: 0.79, fontScale: 1.15, theme: 'light', sound: false, focusMin: 30 },
  });
  const s = store.load(dir);
  assert.equal(s.schema, 2);
  assert.equal(s.tasks.length, 2);
  assert.equal(s.tasks[0].title, '보고서');
  assert.equal(s.tasks[0].kind, 'once');
  assert.equal(s.tasks[0].legacyFocusMs, 120000);
  assert.equal(s.tasks[1].done, true);
  assert.equal(s.settings.opacity, 0.79);
  assert.equal(s.settings.theme, 'light');
  assert.equal(s.settings.soundTimer, false);
  assert.equal(s.settings.defaultPlannedMin, 30);
  assert.equal(M.taskFocusMs(s, s.tasks[0]), 120000);
});

test('empty v0.1 state (no todos) loads cleanly', () => {
  const s = store.load(profileWith({ todos: [], settings: { opacity: 0.5 } }));
  assert.equal(s.tasks.length, 0);
  assert.equal(s.settings.opacity, 0.5);
});

test('actions: progress never drops below zero; completion stays manual at target', () => {
  store.load(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-store-')));
  store.apply('task/add', { title: '읽기', target: 10, unit: '쪽' });
  const t = store.state.tasks[0];
  const today = M.dateKey();
  store.apply('task/progress', { id: t.id, delta: 12 });
  assert.equal(M.taskProgress(store.state, t, today), 12);
  assert.equal(M.taskDone(store.state, t, today), false);
  store.apply('task/progress', { id: t.id, delta: -50 });
  assert.equal(M.taskProgress(store.state, t, today), 0);
  store.apply('task/progress', { id: t.id, set: 4 });
  assert.equal(M.taskProgress(store.state, t, today), 4);
});

test('goal parent must be a larger period containing the child', () => {
  store.load(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-store-')));
  store.apply('goal/add', { title: '월', period: 'month', start: '2026-11-10' });
  const month = store.state.goals[0];
  assert.equal(month.start, '2026-11-01');
  store.apply('goal/add', { title: '12월 주', period: 'week', start: '2026-12-08', parentId: month.id });
  assert.equal(store.state.goals[1].parentId, null);
  store.apply('goal/add', { title: '11월 주', period: 'week', start: '2026-11-18', parentId: month.id });
  assert.equal(store.state.goals[2].parentId, month.id);
  assert.equal(store.state.goals[2].start, '2026-11-16');
});
