const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/shared/model');

const base = () => ({ tasks: [], goals: [], days: {}, sessions: [] });
const task = (over) => ({ id: 't', title: 'T', kind: 'once', date: '2026-11-24', subtasks: [], ...over });

test('period helpers: week starts Monday, month range', () => {
  assert.equal(M.periodStart('week', '2026-11-24'), '2026-11-23'); // Tue -> Mon
  assert.equal(M.periodStart('week', '2026-11-29'), '2026-11-23'); // Sun -> Mon
  assert.deepEqual(M.periodRange('month', '2026-02-01'), ['2026-02-01', '2026-02-28']);
  assert.equal(M.shiftPeriod('month', '2026-12-01', 1), '2027-01-01');
});

test('one-off task rolls forward until done, then stays on its done day', () => {
  const t = task({ date: '2026-11-20' });
  assert.equal(M.occursOn(t, '2026-11-20', '2026-11-24'), true);
  assert.equal(M.occursOn(t, '2026-11-22', '2026-11-24'), false);
  assert.equal(M.occursOn(t, '2026-11-24', '2026-11-24'), true);
  t.done = true; t.doneDate = '2026-11-24';
  assert.equal(M.occursOn(t, '2026-11-20', '2026-11-25'), false);
  assert.equal(M.occursOn(t, '2026-11-24', '2026-11-25'), true);
  assert.equal(M.occursOn(t, '2026-11-25', '2026-11-25'), false);
});

test('routine on selected weekdays; each day starts fresh, history kept', () => {
  const s = base();
  const r = task({ kind: 'routine', startDate: '2026-11-01', repeatDays: [1, 3], target: 10, unit: '쪽' });
  s.tasks.push(r);
  assert.equal(M.occursOn(r, '2026-11-23', '2026-11-24'), true); // Mon
  assert.equal(M.occursOn(r, '2026-11-24', '2026-11-24'), false); // Tue
  M.ensureRec(s, '2026-11-23', r).progress = 6;
  assert.equal(M.taskProgress(s, r, '2026-11-23'), 6);
  assert.equal(M.taskProgress(s, r, '2026-11-25'), 0);
  assert.equal(M.taskPercent(s, r, '2026-11-23'), 0.6);
});

test('archived routine disappears from later days only', () => {
  const r = task({ kind: 'routine', startDate: '2026-11-01', archivedAt: new Date(2026, 10, 24, 9).getTime() });
  assert.equal(M.occursOn(r, '2026-11-23', '2026-11-24'), true);
  assert.equal(M.occursOn(r, '2026-11-24', '2026-11-24'), false);
});

test('one-off progress accumulates across days', () => {
  const s = base();
  const t = task({ target: 100, unit: '쪽' });
  s.tasks.push(t);
  M.ensureRec(s, '2026-11-23', t).progress = 30;
  M.ensureRec(s, '2026-11-24', t).progress = 20;
  assert.equal(M.taskProgress(s, t, '2026-11-24'), 50);
  assert.equal(M.taskPercent(s, t, '2026-11-24'), 0.5);
});

test('goal rollup: same unit sums, mixed units average ratios', () => {
  const s = base();
  const month = { id: 'm', period: 'month', start: '2026-11-01', target: 200, unit: '쪽' };
  const week = { id: 'w', period: 'week', start: '2026-11-23', parentId: 'm', target: 70, unit: '쪽' };
  s.goals.push(month, week);
  const r = task({ id: 'r', kind: 'routine', startDate: '2026-11-23', target: 10, unit: '쪽', goalId: 'w' });
  s.tasks.push(r);
  M.ensureRec(s, '2026-11-23', r).progress = 10;
  M.ensureRec(s, '2026-11-24', r).progress = 5;
  const w = M.goalProgress(s, week);
  assert.equal(w.mode, 'sum');
  assert.equal(w.amount, 15);
  const m = M.goalProgress(s, month);
  assert.equal(m.mode, 'sum');
  assert.equal(m.amount, 15);
  assert.equal(m.percent, 15 / 200);

  // A child in another unit switches the parent to ratio mode.
  const o = task({ id: 'o', target: 2, unit: '회', goalId: 'm' });
  s.tasks.push(o);
  M.ensureRec(s, '2026-11-24', o).progress = 1;
  const m2 = M.goalProgress(s, month);
  assert.equal(m2.mode, 'ratio');
  assert.ok(Math.abs(m2.percent - (w.percent + 0.5) / 2) < 1e-9);
});

test('goal without children uses manual progress', () => {
  const s = base();
  const g = { id: 'g', period: 'day', start: '2026-11-24', target: 3, unit: '회', progress: 1 };
  s.goals.push(g);
  const p = M.goalProgress(s, g);
  assert.equal(p.mode, 'manual');
  assert.ok(Math.abs(p.percent - 1 / 3) < 1e-9);
});

test('canParent only allows a larger period that contains the child', () => {
  const month = { id: 'm', period: 'month', start: '2026-11-01' };
  assert.equal(M.canParent(month, { id: 'w', period: 'week', start: '2026-11-23' }), true);
  assert.equal(M.canParent(month, { id: 'w', period: 'week', start: '2026-12-07' }), false);
  assert.equal(M.canParent({ id: 'w', period: 'week', start: '2026-11-23' }, month), false);
});

test('timerView counts overtime past the plan', () => {
  const t = { status: 'running', plannedMs: 60000, accMs: 50000, runStart: 1000, checkpoint: 1000 };
  const v = M.timerView(t, 1000 + 30000);
  assert.equal(v.elapsed, 80000);
  assert.equal(v.remaining, 0);
  assert.equal(v.over, 20000);
});

test('parseQuick extracts target and time', () => {
  assert.deepEqual(M.parseQuick('영단어 외우기 /50개 @14:30'),
    { title: '영단어 외우기', target: 50, unit: '개', scheduledTime: '14:30', invalidTime: null });
  assert.deepEqual(M.parseQuick('운동 30분'), { title: '운동 30분', target: null, unit: '', scheduledTime: null, invalidTime: null });
  assert.equal(M.parseQuick('회의 @930').scheduledTime, '09:30');
});

test('parseQuick keeps an unreadable time in the title', () => {
  const p = M.parseQuick('회의 준비 @25:00');
  assert.equal(p.title, '회의 준비 @25:00');
  assert.equal(p.scheduledTime, null);
  assert.equal(p.invalidTime, '@25:00');
});

test('dayItems puts timed items first in time order', () => {
  const s = base();
  s.tasks.push(task({ id: 'a', order: 1 }), task({ id: 'b', scheduledTime: '15:00' }), task({ id: 'c', scheduledTime: '09:00' }));
  assert.deepEqual(M.dayItems(s, '2026-11-24', '2026-11-24').map((t) => t.id), ['c', 'b', 'a']);
});
