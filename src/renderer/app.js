const { h, iconBtn, progressText, repeatText, ICONS } = UI;
const M = Model;
const $ = (sel, root = document) => root.querySelector(sel);

let S = null; // latest snapshot from main
// edit: task id being edited in the side panel, or a draft object for a new task.
const view = { tab: 'today', date: null, period: 'week', periodStart: null, histDay: null, edit: null };
let dirty = false;

const send = (type, payload) => api.dispatch(type, payload);
const dayKey = () => view.date || S.today;
const activeTasks = () => S.tasks.filter((t) => !t.archivedAt);
const activeGoals = () => S.goals.filter((g) => !g.archivedAt);
const goalById = (id) => S.goals.find((g) => g.id === id);
const taskById = (id) => S.tasks.find((t) => t.id === id);
const UNITS = ['쪽', '회', '분', '개', '문제', '장', 'km', '세트'];
const PERIOD_NAME = { month: '월간', week: '주간', day: '일일' };
const PLAN_CHIPS = [25, 50, 90];

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = ICONS[el.dataset.icon] || '';

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
  if (view.edit && typeof view.edit === 'string' && !taskById(view.edit)) view.edit = null;
  for (const b of document.querySelectorAll('.side-nav [data-tab]')) b.classList.toggle('on', b.dataset.tab === view.tab);
  $('#top-overlay').checked = S.settings.overlayVisible;
  const left = M.dayItems(S, S.today, S.today).filter((t) => !M.taskDone(S, t, S.today)).length;
  $('#nav-count').textContent = left || '';
  const scroller = $('#view').firstElementChild;
  const scrollTop = scroller ? scroller.scrollTop : 0;
  const builders = { today: renderToday, goals: renderGoals, tasks: renderTasks, history: renderHistory, settings: renderSettings };
  $('#view').replaceChildren(builders[view.tab]());
  const next = $('#view').firstElementChild;
  if (next) next.scrollTop = scrollTop;
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      if (el.value !== keep.value && el.type !== 'checkbox') el.value = keep.value;
      el.focus();
      try { if (keep.start !== null) el.setSelectionRange(keep.start, keep.end); } catch { /* not a text field */ }
    }
  }
  live();
}

document.addEventListener('focusout', () => setTimeout(() => { if (dirty) render(); }, 0));

document.querySelector('.side-nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) { view.tab = b.dataset.tab; view.edit = null; render(); }
});
$('#top-overlay').addEventListener('change', (e) => send('settings/set', { overlayVisible: e.target.checked }));

// ---------- live values (timer, work time) ----------

function live() {
  if (!S) return;
  const now = Date.now();
  const tv = M.timerView(S.timer, now);
  const work = M.workMs(S, S.today) + tv.live;
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('live-work', M.fmtDuration(work));
  set('live-work-2', M.fmtDuration(work));
  const t = S.timer;
  if (t.status === 'idle') set('live-clock', M.fmtClock(t.plannedMs));
  else set('live-clock', tv.over > 0 ? `+${M.fmtClock(tv.over)}` : M.fmtClock(tv.remaining));
  set('live-sub', t.status === 'idle' ? `계획 ${Math.round(t.plannedMs / 60000)}분`
    : tv.over > 0 ? `계획 ${Math.round(t.plannedMs / 60000)}분 · 계속 기록 중` : `계획 ${Math.round(t.plannedMs / 60000)}분 중 ${Math.floor(tv.elapsed / 60000)}분`);
  for (const arc of document.querySelectorAll('[data-live-arc]')) {
    const len = Number(arc.dataset.len);
    const left = tv.over > 0 || !t.plannedMs ? 1 : tv.remaining / t.plannedMs;
    arc.setAttribute('stroke-dashoffset', String(tv.over > 0 ? 0 : len * (1 - Math.max(0, Math.min(1, left)))));
  }
  if (t.taskId) set(`live-focus-${t.taskId}`, `집중 ${M.fmtDuration(M.taskFocusMs(S, taskById(t.taskId) || { id: '' }, S.today) + tv.live)}`);
}
setInterval(live, 500);

// ---------- shared pieces ----------

// Ring markup is static (numbers only), so it can go through innerHTML.
function ringSvg(size, stroke, status, withGlyph) {
  const c = size / 2, r = c - stroke / 2 - (size > 20 ? 2 : 0.5);
  const len = 2 * Math.PI * r;
  const k = size / 52;
  let s = `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true">`;
  if (status !== 'over') s += `<circle class="track" cx="${c}" cy="${c}" r="${r}" stroke-width="${stroke}"/>`;
  if (status !== 'idle') s += `<circle class="arc${status === 'paused' ? ' paused' : ''}" data-live-arc data-len="${len}" cx="${c}" cy="${c}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${len} ${len}" stroke-dashoffset="0" transform="rotate(-90 ${c} ${c})"/>`;
  if (withGlyph && status === 'idle') s += `<path class="glyph" d="M${22 * k} ${18 * k} L${34 * k} ${26 * k} L${22 * k} ${34 * k} Z"/>`;
  if (withGlyph && status === 'paused') s += `<rect class="glyph" x="${20 * k}" y="${18 * k}" width="${4 * k}" height="${16 * k}" rx="${1.5 * k}"/><rect class="glyph" x="${28 * k}" y="${18 * k}" width="${4 * k}" height="${16 * k}" rx="${1.5 * k}"/>`;
  return `${s}</svg>`;
}

function timerStatus() {
  const t = S.timer;
  if (t.status === 'running' && M.timerView(t, Date.now()).over > 0) return 'over';
  return t.status;
}

function qtyControl(task, key) {
  if (!(task.target > 0) && !task.unit) return null;
  const pct = M.taskPercent(S, task, key);
  const text = h('button.qty-text', { type: 'button', title: '눌러서 진행량 입력' }, progressText(S, task, key));
  text.addEventListener('click', (e) => {
    e.stopPropagation();
    const input = h('input.qty-input', { type: 'number', min: '0', step: 'any', value: M.taskProgress(S, task, key), 'aria-label': '진행량' });
    const done = (commit) => {
      if (commit && input.value !== '') send('task/progress', { id: task.id, date: key, set: Number(input.value) });
      render();
    };
    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true));
    text.replaceWith(input);
    input.select();
  });
  return h('div.qty', text, task.target > 0 ? h('span.bar', h('i', { style: { width: `${pct * 100}%` } })) : null);
}

function untilText(hm) {
  const [hh, mm] = hm.split(':').map(Number);
  const now = new Date();
  const diff = hh * 60 + mm - (now.getHours() * 60 + now.getMinutes());
  if (diff <= 0) return diff > -60 ? '지금' : '지남';
  const hr = Math.floor(diff / 60), mi = diff % 60;
  return `${hr ? `${hr}시간 ` : ''}${mi ? `${mi}분 ` : ''}뒤`.replace(/\s뒤$/, ' 뒤');
}

function taskMeta(task, key, inSchedule) {
  const done = M.taskDone(S, task, key);
  const goal = task.goalId && goalById(task.goalId);
  const subs = task.subtasks || [];
  const focus = M.taskFocusMs(S, task, key);
  const isTimerTask = S.timer.taskId === task.id && S.timer.status !== 'idle';
  const bits = [];
  if (inSchedule && key === S.today && !done) bits.push(untilText(task.scheduledTime));
  if (!inSchedule && task.scheduledTime) bits.push(task.scheduledTime);
  if (M.isRoutine(task)) bits.push(repeatText(task));
  else if (!done && task.date < key) bits.push(M.daysBetween(task.date, key) === 1 ? '어제부터' : `${M.daysBetween(task.date, key)}일 밀림`);
  if (goal) bits.push(goal.title);
  if (subs.length) bits.push(`서브 ${subs.filter((s) => M.subDone(S, task, s, key)).length} / ${subs.length}`);
  const parts = [bits.join(' · ')];
  if (focus || isTimerTask) parts.push(h('span', { id: `live-focus-${task.id}` }, `집중 ${M.fmtDuration(focus)}`));
  else if (task.plannedMin) parts.push(`계획 ${task.plannedMin}분`);
  const out = [];
  for (const p of parts) { if (!p) continue; if (out.length) out.push(' · '); out.push(p); }
  return out.length ? h('div.meta', out) : null;
}

function taskRow(task, key, inSchedule = false) {
  const done = M.taskDone(S, task, key);
  const isTimer = S.timer.taskId === task.id && S.timer.status !== 'idle';
  const isCurrent = isTimer || (S.timer.status === 'idle' && S.ui.currentTaskId === task.id);
  const selected = view.edit === task.id;
  const status = isTimer ? timerStatus() : null;
  const mini = isTimer ? h('span.mini-ring', { role: 'img', 'aria-label': status === 'paused' ? '일시정지' : '집중 중' }) : null;
  if (mini) mini.innerHTML = ringSvg(14, 2, status, false);
  const running = isTimer && S.timer.status === 'running';

  return h('li.task-row', {
    className: `task-row${done ? ' done' : ''}${isCurrent ? ' current' : ''}${selected ? ' selected' : ''}`,
    dataset: { id: task.id },
    onclick: () => { view.edit = selected ? null : task.id; render(); },
  },
    h('button.check', { type: 'button', 'aria-label': done ? '완료 취소' : '완료', title: done ? '완료 취소' : '완료', icon: 'check', onclick: (e) => { e.stopPropagation(); send('task/toggle', { id: task.id, date: key }); } }),
    inSchedule ? h('span.when', task.scheduledTime) : null,
    h('div.body', h('div.title', h('span', task.title), mini), taskMeta(task, key, inSchedule)),
    done ? null : qtyControl(task, key),
    done || key !== S.today ? null : h('span.row-play',
      iconBtn(running ? 'pause' : 'play', running ? '일시정지' : '이 할 일로 집중 시작', (e) => {
        e.stopPropagation();
        if (running) send('timer/pause');
        else send('timer/start', { taskId: task.id });
      })),
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
  const open = items.filter((t) => !M.taskDone(S, t, key));
  const doneItems = items.filter((t) => M.taskDone(S, t, key));
  const scheduled = open.filter((t) => t.scheduledTime).sort((a, b) => (a.scheduledTime < b.scheduledTime ? -1 : 1));
  const rest = open.filter((t) => !t.scheduledTime);

  const input = h('input#quick', { type: 'text', placeholder: '할 일 추가', 'aria-label': '할 일 추가', autocomplete: 'off', maxlength: '300' });
  const add = (e) => {
    e.preventDefault();
    const parsed = M.parseQuick(input.value);
    if (!parsed.title) return;
    send('task/add', { title: parsed.title, target: parsed.target, unit: parsed.unit, scheduledTime: parsed.scheduledTime, kind: 'once', date: key, startDate: key });
    input.value = '';
  };

  const list = h('section.today-list', { 'aria-label': '할 일 목록' },
    h('header.page-head',
      h('div.page-title',
        h('h1', M.periodLabel('day', key)),
        iconBtn('left', '이전 날', () => { view.date = M.addDays(key, -1); render(); }),
        iconBtn('right', '다음 날', () => { view.date = M.addDays(key, 1); render(); }),
        isToday ? null : h('button.btn.ghost.sm', { type: 'button', onclick: () => { view.date = null; render(); } }, '오늘로'),
      ),
      h('p.page-sub', isToday
        ? [`남은 일 ${open.length} · 오늘 집중 `, h('span', { id: 'live-work' }, '')]
        : key < S.today ? '지난 날짜 기록 · 체크와 진행량을 고치면 그 날짜 기록이 바뀜' : '앞으로의 날짜 · 이 날로 할 일을 미리 넣을 수 있음'),
    ),
    h('form.add', { onsubmit: add },
      h('span', { icon: 'plus', style: { display: 'flex' } }),
      input,
      h('span.hint', h('span.tok', '/10쪽'), ' 목표량 · ', h('span.tok', '@14:00'), ' 일정'),
      iconBtn('edit', '자세히 추가', () => { view.edit = { kind: 'once', date: key, startDate: key, title: input.value, repeatDays: [], subtasks: [] }; render(); }, 'sm'),
    ),
    scheduled.length ? h('div.group', h('h2', '일정'), h('ul', scheduled.map((t) => taskRow(t, key, true)))) : null,
    h('div.group', h('h2', '할 일'),
      rest.length ? h('ul', rest.map((t) => taskRow(t, key))) : emptyNote(items.length ? '남은 할 일 없음' : isToday ? '오늘 할 일이 없음. 위에서 추가하거나 Ctrl+Shift+Space로 어디서든 추가' : '이 날짜에는 할 일이 없음')),
    doneItems.length ? h('div.group', h('h2', `완료 ${doneItems.length}`), h('ul', doneItems.map((t) => taskRow(t, key)))) : null,
  );

  return h('div.today', list, h('aside.side-col', view.edit ? editPanel(key) : nowColumn()));
}

function nowColumn() {
  const t = S.timer;
  const status = timerStatus();
  const idle = t.status === 'idle';
  const current = t.taskId && taskById(t.taskId);
  const items = M.dayItems(S, S.today, S.today);
  const ringBtn = h('button.big-ring', {
    type: 'button',
    'aria-label': idle ? '집중 시작' : t.status === 'running' ? '일시정지' : '계속',
    title: idle ? '집중 시작' : t.status === 'running' ? '일시정지' : '계속',
    onclick: () => send(t.status === 'running' ? 'timer/pause' : 'timer/start'),
  });
  ringBtn.innerHTML = ringSvg(64, 6, status, true);

  const card = h('div.card', { className: `card ${status}` },
    h('div.now-top', ringBtn, h('div', h('div.clock', { id: 'live-clock' }, ''), h('div.now-sub', { id: 'live-sub' }, ''))),
  );

  if (idle) {
    const options = [h('option', { value: '' }, '할 일 없이 집중'),
      ...items.filter((x) => !M.taskDone(S, x, S.today) || x.id === t.taskId).map((x) => h('option', { value: x.id }, x.title))];
    if (current && !items.includes(current)) options.push(h('option', { value: current.id }, current.title));
    const plannedMin = Math.round(t.plannedMs / 60000);
    const minutes = h('input#timer-min', { type: 'number', min: '1', max: '600', value: plannedMin, 'aria-label': '계획 집중 시간(분)' });
    minutes.addEventListener('change', () => { if (Number(minutes.value) > 0) send('timer/setup', { plannedMin: Number(minutes.value) }); });
    card.append(h('div.setup',
      h('select#timer-task', { 'aria-label': '집중할 할 일', value: t.taskId || '', onchange: (e) => send('timer/setup', { taskId: e.target.value || null }) }, options),
      h('div.chips', PLAN_CHIPS.map((m) => h('button.chip', { type: 'button', className: `chip${m === plannedMin ? ' on' : ''}`, onclick: () => send('timer/setup', { plannedMin: m }) }, `${m}분`)),
        h('span.spacer'), minutes, h('span.muted.small', '분')),
    ));
  } else {
    if (current) {
      const qty = current.target > 0 || current.unit;
      card.append(h('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '4px' } },
        h('span.now-title', current.title),
        qty ? h('span.now-prog', current.target > 0 ? h('span.bar', h('i', { style: { width: `${M.taskPercent(S, current, S.today) * 100}%` } })) : null, progressText(S, current, S.today)) : null,
      ));
    } else card.append(h('span.now-title', '할 일 없이 집중'));
    card.append(h('div.now-btns',
      current ? h('button.btn', { type: 'button', onclick: () => send('task/toggle', { id: current.id }) }, M.taskDone(S, current, S.today) ? '완료 취소' : '완료') : null,
      current && (current.target > 0 || current.unit) ? h('button.btn', { type: 'button', onclick: () => send('task/progress', { id: current.id, delta: 1 }) }, `+1${current.unit}`) : null,
      h('button.btn.ghost', { type: 'button', title: '세션을 끝내고 기록', onclick: () => send('timer/stop') }, '세션 끝내기'),
    ));
  }

  const sessions = M.sessionsOn(S, S.today);
  const diff = sessions.reduce((n, s) => n + (s.actualMs - s.plannedMs), 0);
  const hm = (ms) => { const d = new Date(ms); return `${M.pad(d.getHours())}:${M.pad(d.getMinutes())}`; };
  return [
    h('h2', '지금'),
    card,
    h('div.stats',
      h('div', h('span', '오늘 집중'), h('span', { id: 'live-work-2' }, '')),
      h('div', h('span', '끝난 세션'), h('span', String(sessions.length))),
      sessions.length ? h('div', h('span', '계획 대비'), h('span', `${diff >= 0 ? '+' : '−'}${M.fmtDuration(Math.abs(diff))}`)) : null,
    ),
    sessions.length ? h('ul.sessions', sessions.slice().reverse().map((s) => h('li',
      h('span.muted', `${hm(s.startedAt)}–${hm(s.endedAt)}`),
      h('span.s-title', s.title || '할 일 없이'),
      h('span', `${M.fmtDuration(s.actualMs)}${s.overMs > 0 ? ` (+${M.fmtDuration(s.overMs)})` : ''}`),
    ))) : null,
  ];
}

// ---------- edit panel (auto-save; a new task is a local draft until 추가) ----------

function editPanel(key) {
  const isNew = typeof view.edit === 'object';
  const t = isNew ? view.edit : taskById(view.edit);
  const save = (patch) => {
    if (isNew) { Object.assign(view.edit, patch); render(); } else send('task/update', { id: t.id, patch });
  };
  const close = () => { view.edit = null; render(); };
  const routine = t.kind === 'routine';
  const days = new Set(t.repeatDays && t.repeatDays.length ? t.repeatDays : [0, 1, 2, 3, 4, 5, 6]);

  const title = h('input#edit-title.edit-title', { type: 'text', value: t.title || '', maxlength: '300', placeholder: '제목', 'aria-label': '제목' });
  title.addEventListener(isNew ? 'input' : 'change', () => { if (isNew) view.edit.title = title.value; else if (title.value.trim()) save({ title: title.value }); });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (isNew) addDraft(); else title.blur(); } if (e.key === 'Escape') close(); });

  const goals = activeGoals().slice().sort((a, b) => M.PERIOD_RANK[a.period] - M.PERIOD_RANK[b.period] || (a.start < b.start ? 1 : -1));
  const goal = t.goalId && goalById(t.goalId);
  let goalNote = null;
  if (goal) {
    const p = M.goalProgress(S, goal);
    const v = p.mode === 'sum' || (p.mode === 'manual' && p.target) ? `${M.fmtNum(p.amount)} / ${M.fmtNum(p.target)}${p.unit}` : `${Math.round(p.percent * 100)}%`;
    goalNote = h('span.note', `${PERIOD_NAME[goal.period]} · ${v}${t.unit && p.mode === 'sum' && p.unit === t.unit ? ` · ${t.unit} 수가 목표에 더해짐` : ''}`);
  }

  const subs = (t.subtasks || []).map((s) => ({ ...s }));
  const saveSubs = () => save({ subtasks: subs.filter((s) => s.title.trim()) });
  const subRows = subs.map((s, i) => {
    const sd = !isNew && s.id && M.subDone(S, t, s, key);
    const inp = h(`input#edit-sub-${i}`, { type: 'text', value: s.title, maxlength: '300', 'aria-label': `서브 할 일 ${i + 1}` });
    inp.addEventListener('change', () => { subs[i].title = inp.value; saveSubs(); });
    return h('div.sub-row', { className: `sub-row${sd ? ' done' : ''}` },
      h('button.sub-dot', { type: 'button', className: `sub-dot${sd ? ' on' : ''}`, disabled: isNew, 'aria-label': sd ? '완료 취소' : '완료', onclick: () => send('task/sub', { id: t.id, subId: s.id, date: key }) }),
      inp,
      iconBtn('close', '서브 할 일 삭제', () => { subs.splice(i, 1); saveSubs(); }, 'sm'),
    );
  });
  const newSub = h('input#edit-sub-new', { type: 'text', placeholder: '서브 할 일 추가', maxlength: '300', 'aria-label': '서브 할 일 추가' });
  newSub.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && newSub.value.trim()) { e.preventDefault(); subs.push({ title: newSub.value.trim() }); newSub.value = ''; saveSubs(); }
  });

  const focus = isNew ? 0 : M.taskFocusMs(S, t, key);
  const addDraft = () => {
    const d = view.edit;
    if (!d.title || !d.title.trim()) { title.focus(); return; }
    if (newSub.value.trim()) d.subtasks = [...(d.subtasks || []), { title: newSub.value.trim() }];
    send('task/add', { ...d, repeatDays: d.repeatDays && d.repeatDays.length === 7 ? [] : d.repeatDays });
    view.edit = null;
    render();
  };

  return h('div.card.edit', { role: 'region', 'aria-label': isNew ? '할 일 추가' : '할 일 편집' },
    h('div.edit-head', h('span', isNew ? '새 할 일' : '할 일'), iconBtn('close', '닫기', close, 'sm')),
    title,
    h('div.rows',
      h('div.erow', h('span.lab', '반복'),
        h('div.seg', { role: 'radiogroup', 'aria-label': '반복' }, [['once', '한 번'], ['routine', '루틴']].map(([k, l]) =>
          h('button', { type: 'button', role: 'radio', 'aria-checked': String(t.kind === k), className: t.kind === k ? 'on' : '', onclick: () => save({ kind: k }) }, l)))),
      routine
        ? h('div.days', M.WEEKDAYS.map((w, i) => h('button.day', {
          type: 'button', className: `day${days.has(i) ? ' on' : ''}`, 'aria-pressed': String(days.has(i)), 'aria-label': `${w}요일`,
          onclick: () => { if (days.has(i)) { if (days.size > 1) days.delete(i); } else days.add(i); save({ repeatDays: days.size === 7 ? [] : [...days] }); },
        }, w)))
        : h('div.erow', h('span.lab', '날짜'), h('input#edit-date', { type: 'date', value: t.date || key, onchange: (e) => e.target.value && save({ date: e.target.value }) })),
      h('div.erow', h('span.lab', '일정'),
        h('input#edit-time', { type: 'time', value: t.scheduledTime || '', 'aria-label': '일정 시각', onchange: (e) => save({ scheduledTime: e.target.value || null }) }),
        t.scheduledTime ? h('label.check-label', h('input#edit-auto.switch', { type: 'checkbox', checked: !!t.autoStart, onchange: (e) => save({ autoStart: e.target.checked }) }), '시각에 자동 시작') : null),
      h('div.erow', h('span.lab', '목표량'),
        h('input#edit-target', { type: 'number', min: '0', step: 'any', value: t.target ?? '', placeholder: '없음', 'aria-label': '목표량', onchange: (e) => save({ target: e.target.value }) }),
        h('input#edit-unit.unit', { type: 'text', list: 'units', maxlength: '12', value: t.unit || '', placeholder: '단위', 'aria-label': '단위', onchange: (e) => save({ unit: e.target.value }) })),
      h('div.erow', h('span.lab', '계획'),
        h('input#edit-plan', { type: 'number', min: '1', max: '600', value: t.plannedMin ?? '', placeholder: String(S.settings.defaultPlannedMin), 'aria-label': '계획 집중 시간(분)', onchange: (e) => save({ plannedMin: e.target.value }) }),
        h('span.muted', '분 집중')),
      h('div.erow.top', h('span.lab', '목표'),
        h('div.grow',
          h('select#edit-goal', { value: t.goalId || '', 'aria-label': '목표 연결', onchange: (e) => save({ goalId: e.target.value || null }) },
            h('option', { value: '' }, '연결 안 함'),
            goals.map((g) => h('option', { value: g.id }, `${g.title} · ${PERIOD_NAME[g.period]} ${M.periodLabel(g.period, g.start)}`))),
          goalNote)),
    ),
    h('div.subs-edit',
      h('span.cap', subs.length ? `서브 할 일 ${isNew ? subs.length : `${subs.filter((s) => M.subDone(S, t, s, key)).length} / ${subs.length}`}` : '서브 할 일'),
      subRows,
      h('label.sub-add', h('span', { icon: 'plus', style: { display: 'flex' } }), newSub),
    ),
    isNew ? null : h('div.record',
      h('span.cap', key === S.today ? '오늘 기록' : `${M.periodLabel('day', key)} 기록`),
      h('div', h('span', '집중'), h('span', `${M.fmtDuration(focus)}${t.plannedMin ? ` / 계획 ${t.plannedMin}분` : ''}`)),
      t.target > 0 || t.unit ? h('div', h('span', '진행량'), h('span', progressText(S, t, key))) : null,
    ),
    h('datalist#units', UNITS.map((u) => h('option', { value: u }))),
    isNew
      ? h('div.edit-foot', h('button.btn.ghost', { type: 'button', onclick: close }, '취소'), h('button.btn.primary', { type: 'button', onclick: addDraft }, '추가'))
      : h('div.edit-foot', h('span.note', '바꾸면 바로 저장'),
        h('button.btn.danger.sm', { type: 'button', onclick: () => { send('task/archive', { id: t.id }); view.edit = null; } }, '삭제')),
  );
}

// ---------- goals ----------

function renderGoals() {
  view.periodStart = view.periodStart ? M.periodStart(view.period, view.periodStart) : M.periodStart(view.period, S.today);
  const start = view.periodStart;
  const goals = activeGoals().filter((g) => g.period === view.period && g.start === start);
  const current = M.periodStart(view.period, S.today);

  return h('div.page',
    h('header.page-head',
      h('div.page-title',
        h('h1', M.periodLabel(view.period, start)),
        iconBtn('left', '이전 기간', () => { view.periodStart = M.shiftPeriod(view.period, start, -1); render(); }),
        iconBtn('right', '다음 기간', () => { view.periodStart = M.shiftPeriod(view.period, start, 1); render(); }),
        start === current ? null : h('button.btn.ghost.sm', { type: 'button', onclick: () => { view.periodStart = current; render(); } }, '이번 기간'),
      ),
    ),
    h('div.panel-head',
      h('div.seg', M.PERIODS.map((p) => h('button', { type: 'button', className: p === view.period ? 'on' : '', onclick: () => { view.period = p; view.periodStart = M.periodStart(p, start); render(); } }, PERIOD_NAME[p]))),
      h('button.btn', { type: 'button', icon: 'plus', onclick: () => openGoalDialog(null, { period: view.period, start }) }, '목표 추가'),
    ),
    goals.length
      ? h('div.goal-grid', goals.map(goalCard))
      : emptyNote(`${M.periodLabel(view.period, start)}에 정한 ${PERIOD_NAME[view.period]} 목표가 없음`),
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

  return h('article.goal-card',
    h('div.goal-head',
      h('div', h('h3', goal.title), parent ? h('span.muted.small', `상위 · ${parent.title}`) : null),
      iconBtn('edit', '편집', () => openGoalDialog(goal)),
    ),
    h('div.goal-value', h('b', value), h('span.muted.small', modeNote)),
    h('div.progress', h('i', { style: { width: `${p.percent * 100}%` } })),
    p.mode === 'manual' ? h('div.inline',
      p.target
        ? [iconBtn('minus', '1 줄이기', () => send('goal/progress', { id: goal.id, delta: -1 }), 'sm'), iconBtn('plus', '1 늘리기', () => send('goal/progress', { id: goal.id, delta: 1 }), 'sm')]
        : h('label.toggle-row', h('span', '달성'), h('input.switch', { type: 'checkbox', checked: !!goal.done, onchange: (e) => send('goal/progress', { id: goal.id, done: e.target.checked }) })),
      h('span.muted.small', '하위 목표나 할 일을 연결하면 자동으로 계산됨'),
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

  const row = (t, meta) => h('li.list-row', {
    className: `list-row${view.edit === t.id ? ' selected' : ''}`,
    onclick: () => { view.edit = view.edit === t.id ? null : t.id; render(); },
  }, h('div.body', h('span.title', t.title), h('span.meta', meta.filter(Boolean).join(' · '))));
  const common = (t) => [
    t.target > 0 ? `목표량 ${M.fmtNum(t.target)}${t.unit}` : null,
    t.scheduledTime ? `${t.scheduledTime}${t.autoStart ? ' 자동 시작' : ''}` : null,
    t.plannedMin ? `계획 ${t.plannedMin}분` : null,
    t.goalId && goalById(t.goalId) ? goalById(t.goalId).title : null,
  ];
  const newDraft = (kind) => () => { view.edit = { kind, date: S.today, startDate: S.today, title: '', repeatDays: [], subtasks: [] }; render(); };

  return h('div.split',
    h('div.col',
      h('header.page-head', h('div.page-title', h('h1', '할 일·루틴'))),
      h('section.panel',
        h('div.panel-head', h('h2', `반복 루틴 ${routines.length}`), h('button.btn.sm', { type: 'button', icon: 'plus', onclick: newDraft('routine') }, '루틴 추가')),
        routines.length ? h('ul.plain-list', routines.map((t) => row(t, [repeatText(t), ...common(t)]))) : emptyNote('반복 루틴이 없음'),
      ),
      h('section.panel',
        h('div.panel-head', h('h2', `남은 할 일 ${open.length}`), h('button.btn.sm', { type: 'button', icon: 'plus', onclick: newDraft('once') }, '할 일 추가')),
        open.length ? h('ul.plain-list', open.map((t) => row(t, [t.date === S.today ? '오늘' : t.date < S.today ? `${t.date} (밀림)` : t.date, ...common(t)]))) : emptyNote('남은 할 일이 없음'),
      ),
      done.length ? h('section.panel',
        h('div.panel-head', h('h2', '최근 완료')),
        h('ul.plain-list.dim', done.map((t) => row(t, [`${t.doneDate} 완료`, ...common(t)]))),
      ) : null,
    ),
    view.edit ? h('aside.side-col', { style: { 'padding-top': '0' } }, editPanel(S.today)) : null,
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
    h('section.panel',
      h('header.page-head', h('div.page-title', h('h1', '기록'))),
      h('div.panel-head', h('h2', '최근 30일'), h('button.btn.sm', { type: 'button', icon: 'folder', onclick: () => send('ui/openLogs') }, '로그 폴더 열기')),
      h('table.hist',
        h('thead', h('tr', ['날짜', '완료', '집중', '계획 / 실제', '계획 대비'].map((x) => h('th', x)))),
        h('tbody', days.map((k) => {
          const d = dayStats(k);
          return h('tr', { className: k === selected ? 'on' : '', onclick: () => { view.histDay = k; render(); } },
            h('td', M.periodLabel('day', k)),
            h('td', d.total ? `${d.done} / ${d.total}` : '—'),
            h('td', d.work ? M.fmtDuration(d.work) : '—'),
            h('td', d.planned ? `${M.fmtDuration(d.planned)} / ${M.fmtDuration(d.plannedActual)}` : '—'),
            h('td', d.over ? `+${M.fmtDuration(d.over)}` : '—'),
          );
        })),
      ),
    ),
    h('section.panel', { style: { 'padding-top': '68px' } },
      h('div.panel-head', h('h2', M.periodLabel('day', selected)),
        h('button.btn.sm', { type: 'button', onclick: () => { view.tab = 'today'; view.date = selected === S.today ? null : selected; render(); } }, '이 날짜 열기')),
      st.rows.length ? h('ul.plain-list', st.rows.map(({ t, r, focus, plan, done }) => h('li.list-row', { style: { cursor: 'default' } },
        h('div.body',
          h('span.title', { className: done ? 'title done-text' : 'title' }, `${r.title || t.title}${done ? ' · 완료' : ''}`),
          h('span.meta', [
            (r.target || t.target) ? `진행 ${M.fmtNum(r.progress || 0)}${r.unit || t.unit}${M.isRoutine(t) ? ` / ${M.fmtNum(r.target ?? t.target)}` : ''}` : (r.progress ? `진행 ${M.fmtNum(r.progress)}${r.unit || ''}` : null),
            focus ? `집중 ${M.fmtDuration(focus)}` : null,
            plan ? `계획 ${M.fmtDuration(plan)}${focus > plan ? ` (+${M.fmtDuration(focus - plan)})` : ''}` : null,
          ].filter(Boolean).join(' · ')),
        ),
      ))) : emptyNote('기록이 없음'),
      sessions.length ? h('div',
        h('h3.sub-head', '집중 세션'),
        h('ul.sessions', sessions.map((s) => h('li',
          h('span.muted', M.fmtDuration(s.plannedMs)),
          h('span.s-title', s.title || '할 일 없이'),
          h('span', `${M.fmtDuration(s.actualMs)}${s.overMs > 0 ? ` (+${M.fmtDuration(s.overMs)})` : ''}`),
        ))),
      ) : null,
      h('p.note', '모든 변경과 하루 요약이 월별 JSONL 로그로 저장됨. AI 분석에 그대로 넘길 수 있는 형식'),
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
  const keycaps = (a) => a.replace('CommandOrControl', mac ? '⌘' : 'Ctrl').replace('Shift', mac ? '⇧' : 'Shift').split('+').map((k) => h('kbd', k));

  return h('div.settings', h('div',
    h('header.page-head', h('div.page-title', h('h1', '설정'))),
    h('section.panel',
      h('div.panel-head', h('h2', '오버레이')),
      toggle('overlayVisible', '오버레이 표시'),
      toggle('clickThrough', '클릭 통과', '오버레이가 마우스를 받지 않음. 단축키로 조작 모드와 오감'),
      toggle('overlayLocked', '위치·폭 잠금', '끄면 오버레이를 끌어 옮기고, 오른쪽 가장자리를 끌어 폭을 바꿀 수 있음. 좁히면 한 줄 알약이 됨'),
      h('label.field', h('span', '모니터'),
        h('select', { value: S.overlayDisplayId ?? '', onchange: (e) => send('overlay/toDisplay', { id: Number(e.target.value) }) },
          S.displays.map((d) => h('option', { value: d.id }, d.label)))),
      h('div.field', h('span', '구석으로 보내기'),
        h('div.inline',
          [['top-left', '왼쪽 위'], ['top-right', '오른쪽 위'], ['bottom-left', '왼쪽 아래'], ['bottom-right', '오른쪽 아래']]
            .map(([c, l]) => h('button.btn.sm', { type: 'button', onclick: () => send('overlay/snap', { corner: c }) }, l)),
          h('button.btn.ghost.sm', { type: 'button', onclick: () => send('overlay/reset') }, '위치·폭 초기화'))),
      slider('opacity', '판 불투명도', 0.15, 1, 0.01, pct),
      slider('fontScale', '크기', 0.8, 1.5, 0.05, pct),
      h('label.field', h('span', '오버레이 테마'),
        h('select', { value: s.theme, onchange: (e) => send('settings/set', { theme: e.target.value }) },
          h('option', { value: 'dark' }, '어둡게'), h('option', { value: 'light' }, '밝게'))),
      h('p.note', '메인 창은 시스템 테마를 따름'),
    ),
    h('section.panel',
      h('div.panel-head', h('h2', '타이머·알림')),
      h('label.toggle-row', h('span', '기본 계획 시간 (분)'),
        h('input#default-min', { type: 'number', min: '1', max: '600', value: s.defaultPlannedMin, onchange: set('defaultPlannedMin') })),
      toggle('soundTimer', '계획 시간 도달 알림음'),
      toggle('soundSchedule', '일정 시각 알림음'),
    ),
    h('section.panel',
      h('div.panel-head', h('h2', '일반')),
      toggle('launchAtLogin', 'PC 시작 시 자동 실행', S.isPackaged ? null : '설치된 앱에서만 적용됨 (개발 실행 중)'),
      h('dl.keys', S.shortcuts.map((k) => [
        h('dt', k.label),
        h('dd.inline', { style: { gap: '4px' } }, keycaps(k.accel), k.ok ? null : h('span.warn-text', '다른 앱이 사용 중')),
      ])),
      h('p.note', '메인 창을 닫아도 트레이에서 계속 실행됨. 완전 종료는 트레이 아이콘 메뉴에서'),
    ),
  ));
}

// ---------- goal dialog ----------

const dlg = $('#dlg');
dlg.addEventListener('close', () => { dlg.replaceChildren(); if (dirty) render(); });

function field(label, control, note) {
  return h('label.field', h('span', label), control, note ? h('small', note) : null);
}

function openGoalDialog(goal, defaults = {}) {
  const g = goal || { period: 'week', start: M.periodStart('week', S.today), ...defaults };
  const title = h('input', { type: 'text', value: g.title || '', maxlength: '300', required: true, placeholder: '예: 토익 RC 끝내기' });
  const period = h('select', { value: g.period }, M.PERIODS.map((p) => h('option', { value: p }, PERIOD_NAME[p])));
  const start = h('input', { type: 'date', value: g.start });
  const target = h('input', { type: 'number', min: '0', step: 'any', value: g.target ?? '', placeholder: '없음' });
  const unit = h('input', { type: 'text', list: 'units', maxlength: '12', value: g.unit || '' });
  const parent = h('select');
  const label = h('small');
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
    field('상위 목표', parent, '더 긴 기간의 목표 중 이 기간을 포함하는 것만'),
    h('datalist#units', UNITS.map((u) => h('option', { value: u }))),
    h('div.dialog-actions',
      goal ? h('button.btn.danger', { type: 'button', onclick: () => { send('goal/archive', { id: goal.id }); dlg.close(); } }, '삭제') : null,
      h('span.spacer'),
      h('button.btn.ghost', { type: 'button', onclick: () => dlg.close() }, '취소'),
      h('button.btn.primary', { type: 'submit' }, '저장'),
    ),
  ));
  dlg.showModal();
  title.focus();
}

// ---------- boot ----------

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && view.edit && !dlg.open) { view.edit = null; render(); } });
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
