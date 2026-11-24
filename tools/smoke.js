// Smoke harness used only when CORNER_TODO_SMOKE is set (see tools/run-smoke.js).
const fs = require('fs');
const path = require('path');
const M = require('../src/shared/model');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function seed(store) {
  const s = store.state;
  if (s.tasks.length) return;
  const today = M.dateKey();
  const yest = M.addDays(today, -1);
  const add = (type, p) => store.apply(type, p);

  add('goal/add', { title: '토익 RC 끝내기', period: 'month', start: today, target: 600, unit: '쪽' });
  const month = s.goals[0];
  add('goal/add', { title: 'RC 이번 주 분량', period: 'week', start: today, target: 140, unit: '쪽', parentId: month.id });
  const week = s.goals[1];
  add('goal/add', { title: '운동 습관', period: 'month', start: today });

  add('task/add', { title: 'RC 문제집 풀기', kind: 'routine', startDate: M.addDays(today, -6), target: 20, unit: '쪽', goalId: week.id, plannedMin: 50 });
  add('task/add', { title: '분기 보고서 초안', kind: 'once', date: yest, plannedMin: 90, subtasks: ['목차 잡기', '데이터 정리', '요약 쓰기'] });
  add('task/add', { title: '스트레칭', kind: 'routine', startDate: M.addDays(today, -6), target: 15, unit: '분', goalId: s.goals[2].id });
  const soon = new Date(Date.now() + 2 * 60000);
  add('task/add', { title: '팀 회의', kind: 'once', date: today, scheduledTime: `${M.pad(soon.getHours())}:${M.pad(soon.getMinutes())}` });

  const [rc, report, stretch] = s.tasks;
  add('task/progress', { id: rc.id, date: yest, delta: 20 });
  add('task/toggle', { id: rc.id, date: yest });
  add('task/progress', { id: rc.id, date: today, delta: 8 });
  add('task/progress', { id: stretch.id, date: yest, delta: 15 });
  add('task/sub', { id: report.id, subId: report.subtasks[0].id, date: today });
  M.ensureRec(s, yest, rc).focusMs = 62 * 60000;
  s.sessions.push({ id: 'seed', date: yest, taskId: rc.id, title: rc.title, plannedMs: 50 * 60000, actualMs: 62 * 60000, overMs: 12 * 60000, startedAt: Date.now() - 86400000, endedAt: Date.now() - 86400000 + 62 * 60000 });
}

async function run({ store, timer, dispatch, getWins, showQuick, quit }) {
  const out = process.env.CORNER_TODO_SMOKE;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const { mainWin, overlayWin } = getWins();
  const loaded = (w) => new Promise((r) => (w.webContents.isLoading() ? w.webContents.once('did-finish-load', r) : r()));
  await Promise.all([loaded(mainWin), loaded(overlayWin)]);
  mainWin.setSize(1180, 800);
  mainWin.showInactive();
  await wait(1200);
  const shot = async (w, name) => fs.writeFileSync(path.join(out, `${name}.png`), (await w.webContents.capturePage()).toPNG());
  const js = (w, code) => w.webContents.executeJavaScript(code);
  const s = store.state;
  const today = M.dateKey();
  const [rc, report] = s.tasks;

  try {
    // Renderer errors would leave the view empty.
    check('main window renders today list', await js(mainWin, 'document.querySelectorAll(".task-row").length') >= 3);
    check('overlay renders current task', !!(await js(overlayWin, 'document.querySelector(".now-title")?.textContent')));

    // Click flows through the real DOM.
    await js(mainWin, `document.querySelector('.task-row .check').click()`);
    await wait(300);
    const firstId = M.dayItems(s, today, today)[0].id;
    check('check toggles completion', M.taskDone(s, store.findTask(firstId), today));
    await js(mainWin, `document.querySelector('.task-row .check').click()`);
    await wait(300);

    // Main window keeps updating while the add field has focus (and keeps what was typed).
    await js(mainWin, `const q = document.getElementById('quick'); q.focus(); q.value = '입력 중';`);
    dispatch({ type: 'task/toggle', payload: { id: report.id, date: today } });
    await wait(300);
    check('main re-renders while typing in add field',
      await js(mainWin, `document.querySelectorAll('.task-row.done').length === 1 && document.getElementById('quick').value === '입력 중' && document.activeElement.id === 'quick'`));
    dispatch({ type: 'task/toggle', payload: { id: report.id, date: today } });
    await js(mainWin, `document.getElementById('quick').value = ''; document.activeElement.blur();`);

    dispatch({ type: 'ui/current', payload: { id: rc.id } });
    await wait(300);
    await js(overlayWin, `document.querySelector('.prog .ib').click()`);
    await wait(300);
    check('overlay +1 adds progress to current task', M.taskProgress(s, rc, today) === 9, `rc=${M.taskProgress(s, rc, today)}`);

    // Goal rollup: week goal sums RC pages over this week.
    const week = s.goals[1];
    const wp = M.goalProgress(s, week);
    check('week goal sums linked routine pages', wp.mode === 'sum' && wp.amount >= 28, JSON.stringify(wp));
    const mp = M.goalProgress(s, s.goals[0]);
    check('month goal rolls up from week goal', mp.mode === 'sum' && mp.amount === wp.amount, JSON.stringify(mp));

    // Timer: start on RC with a 1-minute plan, force overtime, stop, check the session.
    dispatch({ type: 'timer/start', payload: { taskId: rc.id, plannedMin: 1 } });
    timer.timer.runStart -= 75000; timer.timer.checkpoint -= 75000; // pretend 75 s passed
    await wait(1300);
    check('timer reports plan reached', timer.timer.planNotified === true);
    await shot(overlayWin, 'overlay-overtime');
    dispatch({ type: 'timer/stop' });
    const last = s.sessions[s.sessions.length - 1];
    check('session records planned/actual/over', last && last.taskId === rc.id && last.plannedMs === 60000 && last.overMs >= 15000, last && `actual=${last.actualMs} over=${last.overMs}`);
    check('focus credited to task today', (M.rec(s, today, rc.id) || {}).focusMs >= 75000);
    check('timer did not complete the task', !M.taskDone(s, rc, today));

    // Schedule: move the meeting to now and let the scheduler fire.
    const meeting = s.tasks.find((t) => t.title === '팀 회의');
    const now = new Date();
    meeting.scheduledTime = `${M.pad(now.getHours())}:${M.pad(now.getMinutes())}`;
    delete s.days[today].alerted[meeting.id];
    await wait(1500);
    check('schedule alert appears', timer.alerts.some((a) => a.taskId === meeting.id));
    await wait(400);
    check('overlay shows schedule alert', await js(overlayWin, '!!document.querySelector(".alert")'));

    // Routine resets tomorrow while today stays recorded.
    check('routine starts fresh tomorrow', M.taskProgress(s, rc, M.addDays(today, 1)) === 0 && M.taskProgress(s, rc, today) > 0);

    await shot(overlayWin, 'overlay');
    await shot(mainWin, 'main-today');
    for (const tab of ['goals', 'tasks', 'history', 'settings']) {
      await js(mainWin, `view.tab='${tab}'; render();`);
      await wait(350);
      await shot(mainWin, `main-${tab}`);
    }
    await js(mainWin, `view.tab='today'; render(); openTaskDialog(S.tasks[1]);`);
    await wait(350);
    await shot(mainWin, 'main-dialog');

    showQuick();
    await wait(500);
    const { quickWin } = getWins();
    await js(quickWin, `document.getElementById('text').value='단어장 복습 /30개 @21:00'; document.getElementById('text').dispatchEvent(new Event('input'));`);
    await wait(200);
    await shot(quickWin, 'quick');
    await js(quickWin, `document.getElementById('form').requestSubmit()`);
    await wait(300);
    const added = s.tasks.find((t) => t.title === '단어장 복습');
    check('quick add parses target and time', added && added.target === 30 && added.unit === '개' && added.scheduledTime === '21:00');

    // Log file.
    const logFile = path.join(out, 'profile', 'logs', `${today.slice(0, 7)}.jsonl`);
    const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
    const types = new Set(lines.map((l) => l.type));
    check('log has task/progress/focus/schedule events', ['task.created', 'progress', 'focus.session', 'schedule.due'].every((t) => types.has(t)), [...types].join(','));
    store.summarizeDay(M.addDays(today, -1));
    const summary = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.type === 'day.summary').pop();
    check('day summary has planned vs actual', summary && summary.tasks.some((t) => t.plannedMs && t.focusMs && t.overMs !== null), summary && `workMs=${summary.workMs}`);
  } catch (err) {
    check('smoke run threw', false, err.stack);
  }

  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`SMOKE ${failed ? 'FAILED' : 'OK'}: ${results.length - failed}/${results.length}`);
  quit();
}

module.exports = { seed, run };
