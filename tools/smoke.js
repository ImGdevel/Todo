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

async function run({ store, timer, dispatch, getWins, quit }) {
  const out = process.env.CORNER_TODO_SMOKE;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const { mainWin, overlayWin } = getWins();
  const loaded = (w) => new Promise((r) => (w.webContents.isLoading() ? w.webContents.once('did-finish-load', r) : r()));
  await Promise.all([loaded(mainWin), loaded(overlayWin)]);
  // Off screen and inactive: the user may be working on this PC while the smoke runs.
  for (const w of [mainWin, overlayWin]) w.webContents.setAudioMuted(true);
  mainWin.setBounds({ x: -10000, y: 0, width: 1180, height: 800 });
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
    check('overlay renders current task', !!(await js(overlayWin, 'document.querySelector(".plate .name")?.textContent')));
    check('overlay window fits the plate', Math.abs(overlayWin.getBounds().height - (await js(overlayWin, 'Math.ceil(document.getElementById("plate").getBoundingClientRect().height + 24)'))) <= 2, JSON.stringify(overlayWin.getBounds()));

    // Click flows through the real DOM.
    const firstId = M.dayItems(s, today, today)[0].id;
    const clickCheck = () => js(mainWin, `document.querySelector('.task-row[data-id="${firstId}"] .check').click()`);
    await clickCheck();
    await wait(300);
    check('check toggles completion', M.taskDone(s, store.findTask(firstId), today));
    await clickCheck();
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
    // Hover opens control mode; +1 lives there.
    await js(overlayWin, `document.getElementById('plate').dispatchEvent(new MouseEvent('mouseenter'))`);
    await wait(300);
    await shot(overlayWin, 'overlay-control');
    await js(overlayWin, `[...document.querySelectorAll('.ctrl .btn')].find((b) => b.textContent.startsWith('+1')).click()`);
    await wait(300);
    await js(overlayWin, `document.getElementById('plate').dispatchEvent(new MouseEvent('mouseleave'))`);
    check('overlay +1 adds progress to current task', M.taskProgress(s, rc, today) === 9, `rc=${M.taskProgress(s, rc, today)}`);

    // Goal rollup: week goal sums RC pages over this week.
    const week = s.goals[1];
    const wp = M.goalProgress(s, week);
    check('week goal sums linked routine pages', wp.mode === 'sum' && wp.amount >= 28, JSON.stringify(wp));
    const mp = M.goalProgress(s, s.goals[0]);
    check('month goal rolls up from week goal', mp.mode === 'sum' && mp.amount === wp.amount, JSON.stringify(mp));

    // Timer: start on RC with a 1-minute plan, force overtime, stop, check the session.
    dispatch({ type: 'timer/start', payload: { taskId: rc.id, plannedMin: 1 } });
    await wait(700);
    await shot(overlayWin, 'overlay-running');
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
    check('overlay shows schedule alert', await js(overlayWin, '!!document.querySelector(".due")'));

    // Routine resets tomorrow while today stays recorded.
    check('routine starts fresh tomorrow', M.taskProgress(s, rc, M.addDays(today, 1)) === 0 && M.taskProgress(s, rc, today) > 0);

    await shot(overlayWin, 'overlay');
    dispatch({ type: 'settings/set', payload: { theme: 'light' } });
    await wait(400);
    await shot(overlayWin, 'overlay-light');
    dispatch({ type: 'settings/set', payload: { theme: 'dark' } });
    const ob = overlayWin.getBounds();
    overlayWin.setBounds({ ...ob, width: 260 });
    await wait(600);
    check('narrow overlay becomes a pill', await js(overlayWin, `document.getElementById('plate').classList.contains('pill')`));
    await shot(overlayWin, 'overlay-pill');
    overlayWin.setBounds({ ...overlayWin.getBounds(), width: ob.width });
    await wait(300);
    await shot(mainWin, 'main-today');
    const { nativeTheme } = require('electron');
    const prevTheme = nativeTheme.themeSource;
    nativeTheme.themeSource = nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
    await wait(400);
    await shot(mainWin, 'main-today-alt-theme');
    nativeTheme.themeSource = prevTheme;
    await wait(300);
    for (const tab of ['goals', 'tasks', 'history', 'settings']) {
      await js(mainWin, `view.tab='${tab}'; render();`);
      await wait(350);
      await shot(mainWin, `main-${tab}`);
    }
    await js(mainWin, `view.tab='today'; view.edit=S.tasks[0].id; render();`);
    await wait(350);
    await shot(mainWin, 'main-edit');
    await js(mainWin, `const i=document.getElementById('edit-plan'); i.value='45'; i.dispatchEvent(new Event('change'));`);
    await wait(300);
    check('edit panel saves on change', store.findTask(s.tasks[0].id).plannedMin === 45);
    await js(mainWin, `view.edit=null; render();`);

    // Same as showQuick() but off screen and without taking focus.
    const { quickWin } = getWins();
    quickWin.webContents.setAudioMuted(true);
    quickWin.setPosition(-10000, 0);
    quickWin.showInactive();
    quickWin.webContents.send('quick:open');
    await wait(500);
    await js(quickWin, `document.getElementById('text').value='단어장 복습 /30개 @21:00'; document.getElementById('text').dispatchEvent(new Event('input'));`);
    await wait(200);
    await shot(quickWin, 'quick');
    await js(quickWin, `document.getElementById('text').value='회의 준비 @25:00'; document.getElementById('text').dispatchEvent(new Event('input'));`);
    await wait(200);
    check('quick add flags an unreadable time', (await js(quickWin, `document.getElementById('p-meta').textContent`)).includes('@25:00'));
    await shot(quickWin, 'quick-invalid');
    await js(quickWin, `document.getElementById('text').value='단어장 복습 /30개 @21:00'; document.getElementById('text').dispatchEvent(new Event('input'));`);
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
