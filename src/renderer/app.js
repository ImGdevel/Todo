const { h, iconBtn, progressText, repeatText } = UI;
const M = Model;
const $ = (sel, root = document) => root.querySelector(sel);

let S = null; // latest snapshot from main
const view = { tab: 'today', date: null, period: 'week', periodStart: null, histDay: null };
let dirty = false;

const send = (type, payload) => api.dispatch(type, payload);
const dayKey = () => view.date || S.today;
const activeTasks = () => S.tasks.filter((t) => !t.archivedAt);
const activeGoals = () => S.goals.filter((g) => !g.archivedAt);
const goalById = (id) => S.goals.find((g) => g.id === id);
const taskById = (id) => S.tasks.find((t) => t.id === id);
const UNITS = ['쪽', '회', '분', '개', '문제', '장', 'km', '세트'];
const PERIOD_NAME = { month: '월간', week: '주간', day: '일일' };

// ---------- rendering ----------

function render() {
  if (!S) return;
  // Fields with an id survive a rebuild (value, caret and focus are carried over).
  // Inline editors without an id would be destroyed, so wait until they lose focus.
  const a = document.activeElement;
  const editing = a && $('#view').contains(a) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName);
  if (editing && !a.id) { dirty = true; return; }
  const keep = editing ? { id: a.id, value: a.value, start: a.selectionStart, end: a.selectionEnd } : null;
  dirty = false;
  for (const b of $('#tabs').children) b.classList.toggle('on', b.dataset.tab === view.tab);
  $('#top-overlay').checked = S.settings.overlayVisible;
  const scroller = $('#view').querySelector('.scroll');
  const scrollTop = scroller ? scroller.scrollTop : 0;
  const builders = { today: renderToday, goals: renderGoals, tasks: renderTasks, history: renderHistory, settings: renderSettings };
  $('#view').replaceChildren(builders[view.tab]());
  const next = $('#view').querySelector('.scroll');
  if (next) next.scrollTop = scrollTop;
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      el.value = keep.value;
      el.focus();
      try { if (keep.start !== null) el.setSelectionRange(keep.start, keep.end); } catch { /* not a text field */ }
    }
  }
  live();
}

document.addEventListener('focusout', () => setTimeout(() => { if (dirty) render(); }, 0));

$('#tabs').addEventListener('click', (e) => {
  const tab = e.target.dataset.tab;
  if (tab) { view.tab = tab; render(); }
});
$('#top-overlay').addEventListener('change', (e) => send('settings/set', { overlayVisible: e.target.checked }));

// ---------- live values (timer, work time) ----------

function live() {
  if (!S) return;
  const now = Date.now();
  const tv = M.timerView(S.timer, now);
  const work = M.workMs(S, S.today) + tv.live;
  $('#top-work').textContent = M.fmtDuration(work);
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('live-work', M.fmtDuration(work));
  const over = tv.over > 0;
  set('live-clock', over ? `+${M.fmtClock(tv.over)}` : M.fmtClock(tv.remaining));
  set('live-elapsed', `경과 ${M.fmtClock(tv.elapsed)}`);
  const clock = document.getElementById('live-clock');
  if (clock) clock.classList.toggle('over', over);
  const bar = document.getElementById('live-bar');
  if (bar) bar.style.setProperty('width', `${Math.min(100, S.timer.plannedMs ? (tv.elapsed / S.timer.plannedMs) * 100 : 0)}%`);
  if (S.timer.taskId) set(`live-focus-${S.timer.taskId}`, M.fmtDuration(M.taskFocusMs(S, taskById(S.timer.taskId) || { id: '' }, S.today) + tv.live));
}
setInterval(live, 500);

// ---------- shared pieces ----------

function badge(icon, text, cls = '') {
  return h(`span.badge${cls ? '.' + cls : ''}`, { icon }, h('span', text));
}

function progressControl(task, key, compact = false) {
  if (!(task.target > 0) && !task.unit) return null;
  const pct = M.taskPercent(S, task, key);
  const wrap = h('div.prog', { title: '진행량 — 숫자를 눌러 직접 입력' });
  const text = h('button.prog-text', { type: 'button' }, progressText(S, task, key));
  text.addEventListener('click', () => {
    const input = h('input.prog-input', { type: 'number', min: '0', step: 'any', value: M.taskProgress(S, task, key) });
    const done = (commit) => {
      if (commit && input.value !== '') send('task/progress', { id: task.id, date: key, set: Number(input.value) });
      render();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true));
    text.replaceWith(input);
    input.select();
  });
  wrap.append(
    compact ? null : iconBtn('minus', '1 줄이기', () => send('task/progress', { id: task.id, date: key, delta: -1 }), 'sm'),
    h('div.prog-mid', text, task.target > 0 ? h('div.mini-bar', h('i', { style: { width: `${pct * 100}%` } })) : null),
    iconBtn('plus', '1 늘리기', () => send('task/progress', { id: task.id, date: key, delta: 1 }), 'sm'),
  );
  return wrap;
}

function taskRow(task, key) {
  const done = M.taskDone(S, task, key);
  const isCurrent = S.ui.currentTaskId === task.id || S.timer.taskId === task.id;
  const running = S.timer.taskId === task.id && S.timer.status === 'running';
  const overdue = !M.isRoutine(task) && !done && task.date < key;
  const goal = task.goalId && goalById(task.goalId);
  const focus = M.taskFocusMs(S, task, key);
  const subs = task.subtasks || [];

  return h('li.task-row', { className: `task-row${done ? ' done' : ''}${isCurrent ? ' current' : ''}` },
    h('button.check', { type: 'button', title: done ? '완료 취소' : '완료', icon: 'check', onclick: () => send('task/toggle', { id: task.id, date: key }) }),
    h('div.body',
      h('div.title-line',
        h('span.title', task.title),
        task.scheduledTime ? badge('clock', task.scheduledTime, task.autoStart ? 'accent' : '') : null,
        M.isRoutine(task) ? badge('repeat', repeatText(task)) : null,
        overdue ? badge('flag', `${M.daysBetween(task.date, key)}일 밀림`, 'warn') : null,
        goal ? badge('flag', goal.title, 'goal') : null,
      ),
      subs.length ? h('ul.subs', subs.map((sub) => {
        const sd = M.subDone(S, task, sub, key);
        return h('li', { className: sd ? 'done' : '' },
          h('button.subcheck', { type: 'button', icon: 'check', title: sd ? '완료 취소' : '완료', onclick: () => send('task/sub', { id: task.id, subId: sub.id, date: key }) }),
          h('span', sub.title));
      })) : null,
    ),
    progressControl(task, key),
    h('span.focus', { id: `live-focus-${task.id}`, title: '이 날 집중한 시간' }, focus || running ? M.fmtDuration(focus) : ''),
    h('div.row-actions',
      done ? null : iconBtn(running ? 'pause' : 'play', running ? '일시정지' : '이 할 일로 집중 시작', () => {
        if (running) send('timer/pause');
        else send('timer/start', { taskId: task.id });
      }, running ? 'on' : ''),
      iconBtn('edit', '편집', () => openTaskDialog(task)),
    ),
  );
}

function emptyNote(text) {
  return h('p.empty', text);
}

// ---------- today ----------

function renderToday() {
  const key = dayKey();
  const isToday = key === S.today;
  const items = M.dayItems(S, key, S.today);
  const doneCount = items.filter((t) => M.taskDone(S, t, key)).length;

  const input = h('input#quick', { type: 'text', placeholder: '할 일 추가 · /10쪽 목표량 · @14:00 일정 · Enter', autocomplete: 'off', maxlength: '300' });
  const kind = h('select#quick-kind', { title: '종류' }, h('option', { value: 'once' }, '할 일'), h('option', { value: 'routine' }, '매일 루틴'));
  const add = (e) => {
    e.preventDefault();
    const parsed = M.parseQuick(input.value);
    if (!parsed.title) return;
    send('task/add', { ...parsed, kind: kind.value, date: key, startDate: key });
    input.value = '';
  };

  const left = h('section.panel.grow',
    h('div.panel-head',
      h('div.date-nav',
        iconBtn('left', '이전 날', () => { view.date = M.addDays(key, -1); render(); }),
        h('h2.date-title', M.periodLabel('day', key)),
        iconBtn('right', '다음 날', () => { view.date = M.addDays(key, 1); render(); }),
        isToday ? null : h('button.btn.ghost.sm', { type: 'button', onclick: () => { view.date = null; render(); } }, '오늘로'),
      ),
      h('span.muted', items.length ? `완료 ${doneCount} / ${items.length}` : ''),
    ),
    isToday ? null : h('p.note', key < S.today ? '지난 날짜 기록입니다. 체크와 진행량을 고치면 그 날짜 기록이 바뀝니다.' : '앞으로의 날짜입니다. 이 날로 할 일을 미리 넣을 수 있습니다.'),
    h('form.add-bar', { onsubmit: add },
      input, kind,
      h('button.btn.primary', { type: 'submit' }, '추가'),
      h('button.btn', { type: 'button', onclick: () => openTaskDialog(null, { date: key }) }, '상세 추가'),
    ),
    items.length
      ? h('ul.task-list.scroll', items.map((t) => taskRow(t, key)))
      : emptyNote(isToday ? '오늘 할 일이 없습니다. 위에서 추가하거나 Ctrl+Shift+Space로 어디서든 추가하세요.' : '이 날짜에는 할 일이 없습니다.'),
  );

  return h('div.today', left, h('div.side.scroll', timerPanel(key), workPanel()));
}

function timerPanel() {
  const t = S.timer;
  const idle = t.status === 'idle';
  const todayItems = M.dayItems(S, S.today, S.today).filter((x) => !M.taskDone(S, x, S.today) || x.id === t.taskId);
  const current = t.taskId && taskById(t.taskId);
  const options = [h('option', { value: '' }, '할 일 없이 집중'), ...todayItems.map((x) => h('option', { value: x.id }, x.title))];
  if (current && !todayItems.includes(current)) options.push(h('option', { value: current.id }, current.title));

  const plannedMin = Math.round(t.plannedMs / 60000);
  const minutes = h('input#timer-min', { type: 'number', min: '1', max: '600', value: plannedMin, disabled: !idle, title: '계획 집중 시간(분)' });
  minutes.addEventListener('change', () => { if (Number(minutes.value) > 0) send('timer/setup', { plannedMin: Number(minutes.value) }); });

  return h('section.panel.timer',
    h('div.panel-head', h('h2', '집중 타이머'), h('span.status', { className: `status ${t.status}` }, { idle: '대기', running: '집중 중', paused: '일시정지' }[t.status])),
    h('label.field', h('span', '집중할 할 일'),
      h('select#timer-task', { disabled: !idle, value: t.taskId || '', onchange: (e) => send('timer/setup', { taskId: e.target.value || null }) }, options)),
    h('div.field', h('span', '계획 시간 (분)'),
      h('div.inline', minutes, ...[25, 50, 90].map((m) => h('button.btn.sm', { type: 'button', disabled: !idle, onclick: () => send('timer/setup', { plannedMin: m }) }, `${m}`)))),
    h('div.clock-row',
      h('div.clock', { id: 'live-clock' }, '--:--'),
      h('div.clock-btns',
        h('button.btn.primary.wide', { type: 'button', icon: t.status === 'running' ? 'pause' : 'play', onclick: () => send(t.status === 'running' ? 'timer/pause' : 'timer/start') },
          t.status === 'running' ? '일시정지' : t.status === 'paused' ? '계속' : '시작'),
        h('button.btn', { type: 'button', icon: 'stop', disabled: idle, onclick: () => send('timer/stop'), title: '세션을 끝내고 기록' }, '종료'),
      ),
    ),
    h('div.progress', h('i', { id: 'live-bar' })),
    h('div.timer-meta', h('span', { id: 'live-elapsed' }), h('span', `계획 ${plannedMin}분`)),
    h('p.note', '계획 시간이 지나도 멈추지 않고 초과 시간으로 기록합니다. 할 일 완료는 직접 체크하세요.'),
  );
}

function workPanel() {
  const sessions = M.sessionsOn(S, S.today).slice().reverse();
  const hm = (ms) => { const d = new Date(ms); return `${M.pad(d.getHours())}:${M.pad(d.getMinutes())}`; };
  return h('section.panel',
    h('div.panel-head', h('h2', '오늘 Work Time'), h('b.big', { id: 'live-work' }, '0분')),
    sessions.length ? h('ul.sessions', sessions.map((s) => h('li',
      h('span.muted', `${hm(s.startedAt)}–${hm(s.endedAt)}`),
      h('span.s-title', s.title || '할 일 없이'),
      h('span', `${M.fmtDuration(s.actualMs)} / ${M.fmtDuration(s.plannedMs)}`),
      s.overMs > 0 ? h('span.over', `+${M.fmtDuration(s.overMs)}`) : h('span'),
    ))) : emptyNote('아직 끝난 집중 세션이 없습니다.'),
  );
}

// ---------- goals ----------

function renderGoals() {
  view.periodStart = view.periodStart ? M.periodStart(view.period, view.periodStart) : M.periodStart(view.period, S.today);
  const start = view.periodStart;
  const goals = activeGoals().filter((g) => g.period === view.period && g.start === start);
  const current = M.periodStart(view.period, S.today);

  return h('section.panel.grow.goals',
    h('div.panel-head',
      h('div.inline',
        h('div.seg', M.PERIODS.map((p) => h('button', { type: 'button', className: p === view.period ? 'on' : '', onclick: () => { view.period = p; view.periodStart = M.periodStart(p, start); render(); } }, PERIOD_NAME[p]))),
        h('div.date-nav',
          iconBtn('left', '이전 기간', () => { view.periodStart = M.shiftPeriod(view.period, start, -1); render(); }),
          h('h2.date-title', M.periodLabel(view.period, start)),
          iconBtn('right', '다음 기간', () => { view.periodStart = M.shiftPeriod(view.period, start, 1); render(); }),
          start === current ? null : h('button.btn.ghost.sm', { type: 'button', onclick: () => { view.periodStart = current; render(); } }, '이번 기간'),
        ),
      ),
      h('button.btn.primary', { type: 'button', icon: 'plus', onclick: () => openGoalDialog(null, { period: view.period, start }) }, '목표 추가'),
    ),
    goals.length
      ? h('div.goal-grid.scroll', goals.map(goalCard))
      : emptyNote(`${M.periodLabel(view.period, start)}에 정한 ${PERIOD_NAME[view.period]} 목표가 없습니다.`),
  );
}

function goalCard(goal) {
  const p = M.goalProgress(S, goal);
  const kids = M.goalChildren(S, goal);
  const parent = goal.parentId && goalById(goal.parentId);
  const range = M.periodRange(goal.period, goal.start);
  const value = p.mode === 'sum' || (p.mode === 'manual' && p.target)
    ? `${M.fmtNum(p.amount)} / ${M.fmtNum(p.target)}${p.unit}` : `${Math.round(p.percent * 100)}%`;
  const modeNote = { sum: '하위 진행량 합산', ratio: '하위 달성률 평균', manual: '직접 입력' }[p.mode];

  return h('article.goal-card', { className: `goal-card${p.percent >= 1 ? ' complete' : ''}` },
    h('div.goal-head',
      h('div',
        h('h3', goal.title),
        parent ? h('span.muted.small', `상위: ${parent.title}`) : null,
      ),
      iconBtn('edit', '편집', () => openGoalDialog(goal)),
    ),
    h('div.goal-value', h('b', value), h('span.muted.small', modeNote)),
    h('div.progress', h('i', { style: { width: `${p.percent * 100}%` } })),
    p.mode === 'manual' ? h('div.inline',
      p.target
        ? [iconBtn('minus', '1 줄이기', () => send('goal/progress', { id: goal.id, delta: -1 }), 'sm'), iconBtn('plus', '1 늘리기', () => send('goal/progress', { id: goal.id, delta: 1 }), 'sm')]
        : h('label.toggle-row.compact', h('span', '달성'), h('input.switch', { type: 'checkbox', checked: !!goal.done, onchange: (e) => send('goal/progress', { id: goal.id, done: e.target.checked }) })),
      h('span.muted.small', '하위 목표나 할 일을 연결하면 자동으로 계산됩니다.'),
    ) : null,
    kids.goals.length || kids.tasks.length ? h('ul.goal-kids',
      kids.goals.map((g) => {
        const gp = M.goalProgress(S, g);
        return h('li', h('span.kind', PERIOD_NAME[g.period]), h('span.k-title', g.title), h('span.muted', `${Math.round(gp.percent * 100)}%`));
      }),
      kids.tasks.map((t) => {
        const c = M.taskContribution(S, t, range);
        const label = c.unit ? `${M.fmtNum(c.amount)}${c.unit}` : `${Math.round(c.percent * 100)}%`;
        return h('li', { className: t.archivedAt ? 'archived' : '' }, h('span.kind', M.isRoutine(t) ? '루틴' : '할 일'), h('span.k-title', t.title), h('span.muted', label));
      }),
    ) : null,
  );
}

// ---------- tasks & routines ----------

function renderTasks() {
  const tasks = activeTasks();
  const routines = tasks.filter(M.isRoutine);
  const open = tasks.filter((t) => !M.isRoutine(t) && !t.done).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.order || 0) - (b.order || 0)));
  const done = tasks.filter((t) => !M.isRoutine(t) && t.done).sort((a, b) => (a.doneDate < b.doneDate ? 1 : -1)).slice(0, 30);

  const row = (t, meta) => h('li.list-row',
    h('span.title', t.title),
    h('span.meta', meta.filter(Boolean).join(' · ')),
    iconBtn('edit', '편집', () => openTaskDialog(t)),
  );
  const common = (t) => [
    t.target > 0 ? `목표 ${M.fmtNum(t.target)}${t.unit}` : null,
    t.scheduledTime ? `${t.scheduledTime}${t.autoStart ? ' 자동 시작' : ''}` : null,
    t.plannedMin ? `계획 ${t.plannedMin}분` : null,
    t.goalId && goalById(t.goalId) ? `목표: ${goalById(t.goalId).title}` : null,
  ];

  return h('div.tasks-view.scroll',
    h('section.panel',
      h('div.panel-head', h('h2', `반복 루틴 ${routines.length}`), h('button.btn.primary', { type: 'button', icon: 'plus', onclick: () => openTaskDialog(null, { kind: 'routine' }) }, '루틴 추가')),
      routines.length ? h('ul.plain-list', routines.map((t) => row(t, [repeatText(t), ...common(t)]))) : emptyNote('반복 루틴이 없습니다.'),
    ),
    h('section.panel',
      h('div.panel-head', h('h2', `남은 할 일 ${open.length}`), h('button.btn', { type: 'button', icon: 'plus', onclick: () => openTaskDialog(null) }, '할 일 추가')),
      open.length ? h('ul.plain-list', open.map((t) => row(t, [t.date === S.today ? '오늘' : t.date < S.today ? `${t.date} (밀림)` : t.date, ...common(t)]))) : emptyNote('남은 할 일이 없습니다.'),
    ),
    done.length ? h('section.panel',
      h('div.panel-head', h('h2', '최근 완료')),
      h('ul.plain-list.dim', done.map((t) => row(t, [`${t.doneDate} 완료`, ...common(t)]))),
    ) : null,
  );
}

// ---------- history ----------

function dayStats(key) {
  const day = M.dayOf(S, key);
  const tasks = S.tasks.filter((t) => M.occursOn(t, key, S.today) || (day && day.tasks && day.tasks[t.id]));
  let planned = 0, plannedActual = 0, over = 0;
  const rows = tasks.map((t) => {
    const r = M.rec(S, key, t.id) || {};
    const focus = r.focusMs || 0;
    const plan = t.plannedMin ? t.plannedMin * 60000 : null;
    if (plan) { planned += plan; plannedActual += focus; over += Math.max(0, focus - plan); }
    return { t, r, focus, plan, done: M.isRoutine(t) ? !!r.done : (!!t.done && t.doneDate === key) || !!r.done };
  });
  return { rows, done: rows.filter((x) => x.done).length, total: rows.length, work: M.workMs(S, key), planned, plannedActual, over };
}

function renderHistory() {
  const days = [];
  for (let i = 0; i < 30; i++) days.push(M.addDays(S.today, -i));
  const selected = view.histDay || S.today;
  const st = dayStats(selected);
  const sessions = M.sessionsOn(S, selected);

  return h('div.history',
    h('section.panel.grow',
      h('div.panel-head', h('h2', '최근 30일'), h('button.btn', { type: 'button', icon: 'folder', onclick: () => send('ui/openLogs') }, '로그 폴더 열기')),
      h('table.hist.scroll',
        h('thead', h('tr', ['날짜', '완료', 'Work Time', '계획 / 실제', '초과'].map((x) => h('th', x)))),
        h('tbody', days.map((k) => {
          const d = dayStats(k);
          return h('tr', { className: k === selected ? 'on' : '', onclick: () => { view.histDay = k; render(); } },
            h('td', M.periodLabel('day', k)),
            h('td', d.total ? `${d.done} / ${d.total}` : '—'),
            h('td', d.work ? M.fmtDuration(d.work) : '—'),
            h('td', d.planned ? `${M.fmtDuration(d.planned)} / ${M.fmtDuration(d.plannedActual)}` : '—'),
            h('td', { className: d.over ? 'over' : '' }, d.over ? `+${M.fmtDuration(d.over)}` : '—'),
          );
        })),
      ),
    ),
    h('section.panel.grow.scroll',
      h('div.panel-head', h('h2', M.periodLabel('day', selected)),
        h('button.btn.sm', { type: 'button', onclick: () => { view.tab = 'today'; view.date = selected === S.today ? null : selected; render(); } }, '이 날짜 열기')),
      st.rows.length ? h('ul.plain-list', st.rows.map(({ t, r, focus, plan, done }) => h('li.list-row',
        h('span.title', { className: done ? 'title done-text' : 'title' }, `${done ? '✓ ' : ''}${r.title || t.title}`),
        h('span.meta', [
          (r.target || t.target) ? `진행 ${M.fmtNum(r.progress || 0)}${r.unit || t.unit}${M.isRoutine(t) ? ` / ${M.fmtNum(r.target ?? t.target)}` : ''}` : (r.progress ? `진행 ${M.fmtNum(r.progress)}${r.unit || ''}` : null),
          focus ? `집중 ${M.fmtDuration(focus)}` : null,
          plan ? `계획 ${M.fmtDuration(plan)}${focus > plan ? ` (+${M.fmtDuration(focus - plan)})` : ''}` : null,
        ].filter(Boolean).join(' · ')),
      ))) : emptyNote('기록이 없습니다.'),
      sessions.length ? h('div',
        h('h3.sub-head', '집중 세션'),
        h('ul.sessions', sessions.map((s) => h('li',
          h('span.s-title', s.title || '할 일 없이'),
          h('span', `${M.fmtDuration(s.actualMs)} / ${M.fmtDuration(s.plannedMs)}`),
          s.overMs > 0 ? h('span.over', `+${M.fmtDuration(s.overMs)}`) : h('span'),
        ))),
      ) : null,
      h('p.note', '모든 변경과 하루 요약이 월별 JSONL 로그로 저장됩니다. 나중에 AI 분석에 그대로 넘길 수 있는 형식입니다.'),
    ),
  );
}

// ---------- settings ----------

function renderSettings() {
  const s = S.settings;
  const set = (k) => (e) => send('settings/set', { [k]: e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value) || e.target.value });
  const toggle = (k, label, note) => h('label.toggle-row', h('span', label, note ? h('small', note) : null), h('input.switch', { type: 'checkbox', checked: !!s[k], onchange: set(k) }));
  const slider = (k, label, min, max, step, fmt) => {
    const out = h('output', fmt(s[k]));
    return h('label.slider', h('span', label),
      h('input', { type: 'range', min, max, step, value: s[k], oninput: (e) => { out.textContent = fmt(Number(e.target.value)); send('settings/set', { [k]: Number(e.target.value) }); } }),
      out);
  };
  const pct = (v) => `${Math.round(v * 100)}%`;
  const mac = S.platform === 'darwin';
  const pretty = (a) => a.replace('CommandOrControl', mac ? '⌘' : 'Ctrl').replace('Shift', mac ? '⇧' : 'Shift').split('+').join(mac ? ' ' : ' + ');

  return h('div.settings.scroll',
    h('section.panel',
      h('div.panel-head', h('h2', '오버레이')),
      toggle('overlayVisible', '오버레이 표시'),
      toggle('clickThrough', '클릭 통과', '오버레이가 마우스를 전혀 받지 않습니다. 단축키로 조작 모드와 오가세요.'),
      toggle('overlayLocked', '위치·크기 잠금', '끄면 오버레이 윗줄을 끌어 옮기고, 오른쪽 아래 모서리를 끌어 크기를 바꿀 수 있습니다.'),
      h('label.field', h('span', '모니터'),
        h('select', { value: S.overlayDisplayId ?? '', onchange: (e) => send('overlay/toDisplay', { id: Number(e.target.value) }) },
          S.displays.map((d) => h('option', { value: d.id }, d.label)))),
      h('div.field', h('span', '구석으로 보내기'),
        h('div.inline',
          [['top-left', '왼쪽 위'], ['top-right', '오른쪽 위'], ['bottom-left', '왼쪽 아래'], ['bottom-right', '오른쪽 아래']]
            .map(([c, l]) => h('button.btn.sm', { type: 'button', onclick: () => send('overlay/snap', { corner: c }) }, l)),
          h('button.btn.ghost.sm', { type: 'button', onclick: () => send('overlay/reset') }, '위치·크기 초기화'))),
      slider('opacity', '배경 불투명도', 0.15, 1, 0.01, pct),
      slider('fontScale', '글자 크기', 0.8, 1.5, 0.05, pct),
      h('label.field', h('span', '테마'),
        h('select', { value: s.theme, onchange: (e) => send('settings/set', { theme: e.target.value }) },
          h('option', { value: 'dark' }, '어둡게'), h('option', { value: 'light' }, '밝게'))),
    ),
    h('section.panel',
      h('div.panel-head', h('h2', '타이머·알림')),
      h('label.field', h('span', '기본 계획 시간 (분)'),
        h('input#default-min', { type: 'number', min: '1', max: '600', value: s.defaultPlannedMin, onchange: set('defaultPlannedMin') })),
      toggle('soundTimer', '계획 시간 도달 알림음'),
      toggle('soundSchedule', '일정 시각 알림음'),
    ),
    h('section.panel',
      h('div.panel-head', h('h2', '일반')),
      toggle('launchAtLogin', 'PC 시작 시 자동 실행', S.isPackaged ? null : '설치된 앱에서만 적용됩니다 (개발 실행 중).'),
      h('dl.keys', S.shortcuts.map((k) => [
        h('dt', k.label),
        h('dd', h('kbd', pretty(k.accel)), k.ok ? null : h('span.warn-text', ' 다른 앱이 사용 중')),
      ])),
      h('p.note', '메인 창을 닫아도 트레이에서 계속 실행됩니다. 완전 종료는 트레이 아이콘 메뉴에서.'),
    ),
  );
}

// ---------- dialogs ----------

const dlg = $('#dlg');
dlg.addEventListener('close', () => { dlg.replaceChildren(); if (dirty) render(); });

function field(label, control, note) {
  return h('label.field', h('span', label), control, note ? h('small.muted', note) : null);
}

function openTaskDialog(task, defaults = {}) {
  const t = task || { kind: 'once', date: defaults.date || S.today, startDate: defaults.date || S.today, repeatDays: [], subtasks: [], ...defaults };
  let kind = t.kind;
  const subs = (t.subtasks || []).map((s) => ({ ...s }));

  const title = h('input', { type: 'text', value: t.title || '', maxlength: '300', required: true, placeholder: '예: 영단어 외우기' });
  const kindSeg = h('div.seg');
  const date = h('input', { type: 'date', value: t.date || S.today });
  const startDate = h('input', { type: 'date', value: t.startDate || S.today });
  const days = new Set(t.repeatDays && t.repeatDays.length ? t.repeatDays : [0, 1, 2, 3, 4, 5, 6]);
  const dayChips = h('div.day-chips', M.WEEKDAYS.map((w, i) => {
    const b = h('button', { type: 'button', className: days.has(i) ? 'on' : '' }, w);
    b.addEventListener('click', () => { if (days.has(i)) days.delete(i); else days.add(i); b.classList.toggle('on', days.has(i)); });
    return b;
  }));
  const target = h('input', { type: 'number', min: '0', step: 'any', value: t.target ?? '', placeholder: '없음' });
  const unit = h('input', { type: 'text', list: 'units', maxlength: '12', value: t.unit || '', placeholder: '쪽, 회, 분…' });
  const time = h('input', { type: 'time', value: t.scheduledTime || '' });
  const autoStart = h('input.switch', { type: 'checkbox', checked: !!t.autoStart });
  const planned = h('input', { type: 'number', min: '1', max: '600', value: t.plannedMin ?? '', placeholder: `기본 ${S.settings.defaultPlannedMin}` });
  const goals = activeGoals().slice().sort((a, b) => M.PERIOD_RANK[a.period] - M.PERIOD_RANK[b.period] || (a.start < b.start ? 1 : -1));
  const goal = h('select', { value: t.goalId || '' }, h('option', { value: '' }, '연결 안 함'),
    goals.map((g) => h('option', { value: g.id }, `[${PERIOD_NAME[g.period]} ${M.periodLabel(g.period, g.start)}] ${g.title}`)));
  const subList = h('ul.sub-edit');
  const drawSubs = () => subList.replaceChildren(...subs.map((s, i) => h('li',
    h('input', { type: 'text', value: s.title, maxlength: '300', oninput: (e) => { subs[i].title = e.target.value; } }),
    iconBtn('close', '삭제', () => { subs.splice(i, 1); drawSubs(); }, 'sm'),
  )));
  drawSubs();
  const newSub = h('input', { type: 'text', placeholder: '서브 할 일 입력 후 Enter', maxlength: '300' });
  newSub.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (newSub.value.trim()) { subs.push({ title: newSub.value.trim() }); newSub.value = ''; drawSubs(); } }
  });

  const onceFields = h('div.grid2', field('날짜', date));
  const routineFields = h('div', field('시작일', startDate), field('반복 요일', dayChips));
  const drawKind = () => {
    kindSeg.replaceChildren(...[['once', '할 일'], ['routine', '반복 루틴']].map(([k, l]) =>
      h('button', { type: 'button', className: kind === k ? 'on' : '', onclick: () => { kind = k; drawKind(); } }, l)));
    onceFields.hidden = kind !== 'once';
    routineFields.hidden = kind !== 'routine';
  };
  drawKind();

  const save = (e) => {
    e.preventDefault();
    if (!title.value.trim()) { title.focus(); return; }
    if (newSub.value.trim()) subs.push({ title: newSub.value.trim() });
    const data = {
      title: title.value, kind, date: date.value, startDate: startDate.value,
      repeatDays: days.size === 7 ? [] : [...days],
      target: target.value, unit: unit.value, scheduledTime: time.value || null, autoStart: autoStart.checked,
      plannedMin: planned.value, goalId: goal.value || null, subtasks: subs,
    };
    if (task) send('task/update', { id: task.id, patch: data });
    else send('task/add', data);
    dlg.close();
  };

  dlg.replaceChildren(h('form.dialog', { onsubmit: save },
    h('h2', task ? '할 일 편집' : '할 일 추가'),
    field('제목', title),
    field('종류', kindSeg),
    onceFields, routineFields,
    h('div.grid2', field('목표량', target, '비우면 체크만으로 완료'), field('단위', unit)),
    h('div.grid2', field('일정 시각', time, '이 시각에 오버레이와 알림으로 알려줍니다'), field('계획 집중 시간 (분)', planned)),
    h('label.toggle-row', h('span', '일정 시각에 집중 타이머 자동 시작'), autoStart),
    field('목표 연결', goal, '연결하면 진행량이 목표에 반영됩니다'),
    h('div.field', h('span', '서브 할 일'), subList, newSub),
    h('datalist#units', UNITS.map((u) => h('option', { value: u }))),
    h('div.dialog-actions',
      task ? h('button.btn.danger', { type: 'button', icon: 'trash', onclick: () => { send('task/archive', { id: task.id }); dlg.close(); } }, '삭제') : null,
      h('span.spacer'),
      h('button.btn', { type: 'button', onclick: () => dlg.close() }, '취소'),
      h('button.btn.primary', { type: 'submit' }, '저장'),
    ),
  ));
  dlg.showModal();
  title.focus();
}

function openGoalDialog(goal, defaults = {}) {
  const g = goal || { period: 'week', start: M.periodStart('week', S.today), ...defaults };
  const title = h('input', { type: 'text', value: g.title || '', maxlength: '300', required: true, placeholder: '예: 토익 RC 끝내기' });
  const period = h('select', { value: g.period }, M.PERIODS.map((p) => h('option', { value: p }, PERIOD_NAME[p])));
  const start = h('input', { type: 'date', value: g.start });
  const target = h('input', { type: 'number', min: '0', step: 'any', value: g.target ?? '', placeholder: '없음' });
  const unit = h('input', { type: 'text', list: 'units', maxlength: '12', value: g.unit || '' });
  const parent = h('select');
  const label = h('small.muted');
  const drawParents = () => {
    const probe = { id: g.id || '__new', period: period.value, start: M.periodStart(period.value, start.value || S.today) };
    label.textContent = M.periodLabel(probe.period, probe.start);
    const options = activeGoals().filter((p) => M.canParent(p, probe));
    const keep = parent.value || g.parentId || '';
    parent.replaceChildren(h('option', { value: '' }, '없음 (독립 목표)'),
      ...options.map((p) => h('option', { value: p.id }, `[${PERIOD_NAME[p.period]}] ${p.title}`)));
    parent.value = options.some((p) => p.id === keep) ? keep : '';
  };
  period.addEventListener('change', drawParents);
  start.addEventListener('change', drawParents);
  drawParents();

  const save = (e) => {
    e.preventDefault();
    if (!title.value.trim()) { title.focus(); return; }
    const data = { title: title.value, period: period.value, start: start.value || S.today, target: target.value, unit: unit.value, parentId: parent.value || null };
    if (goal) send('goal/update', { id: goal.id, patch: data });
    else send('goal/add', data);
    view.period = data.period;
    view.periodStart = M.periodStart(data.period, data.start);
    dlg.close();
  };

  dlg.replaceChildren(h('form.dialog', { onsubmit: save },
    h('h2', goal ? '목표 편집' : '목표 추가'),
    field('제목', title),
    h('div.grid2', field('기간', period), h('label.field', h('span', '기간 안의 아무 날짜'), start, label)),
    h('div.grid2', field('목표량', target, '하위 항목이 같은 단위면 합산, 아니면 달성률 평균'), field('단위', unit)),
    field('상위 목표', parent, '더 긴 기간의 목표 중 이 기간을 포함하는 것만 고를 수 있습니다'),
    h('datalist#units', UNITS.map((u) => h('option', { value: u }))),
    h('div.dialog-actions',
      goal ? h('button.btn.danger', { type: 'button', icon: 'trash', onclick: () => { send('goal/archive', { id: goal.id }); dlg.close(); } }, '삭제') : null,
      h('span.spacer'),
      h('button.btn', { type: 'button', onclick: () => dlg.close() }, '취소'),
      h('button.btn.primary', { type: 'submit' }, '저장'),
    ),
  ));
  dlg.showModal();
  title.focus();
}

// ---------- boot ----------

api.onState((next) => { S = next; render(); });
api.onNav((tab) => { view.tab = tab; render(); });
api.getState().then((first) => {
  S = first;
  const hash = location.hash.slice(1);
  if (hash) view.tab = hash;
  render();
  const q = document.getElementById('quick');
  if (q) q.focus();
});
