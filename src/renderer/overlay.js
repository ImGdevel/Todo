// Overlay v0.3: one plate. Ring = remaining time (start/pause button), bar = task progress.
// Hovering opens control mode below (or above, in the lower half of the screen).
const { h, ICONS, progressText } = UI;
const M = Model;
const $ = (s) => document.querySelector(s);
const send = (type, payload) => api.dispatch(type, payload);
const plate = $('#plate');
const NS = 'http://www.w3.org/2000/svg';
const PILL_WIDTH = 280; // plate narrower than this → one-line pill

let S = null;
let hover = false;
let editing = false; // progress input open; keep control mode and do not rebuild under it
let leaveTimer = null;

// On Windows a click activates the overlay; main hands focus straight back to the app the user
// was in (main/winfocus.js). Only the progress input keeps the keyboard until it is done.
const release = () => setTimeout(() => api.releaseFocus(), 0);
document.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); }, true);
document.addEventListener('click', (e) => { if (!e.target.closest('input')) release(); });

// ---------- what to show ----------

function currentTask(items) {
  const t = S.timer.taskId && S.tasks.find((x) => x.id === S.timer.taskId);
  if (t) return t;
  const ui = S.ui.currentTaskId && items.find((x) => x.id === S.ui.currentTaskId && !M.taskDone(S, x, S.today));
  if (ui) return ui;
  return items.find((x) => !M.taskDone(S, x, S.today)) || null;
}

function plannedMs(cur) {
  const t = S.timer;
  if (t.status !== 'idle') return t.plannedMs;
  if (cur && cur.plannedMin && t.taskId !== cur.id) return cur.plannedMin * 60000;
  return t.plannedMs;
}

function stateOf(tv) {
  const st = S.timer.status;
  if (st === 'running' && tv.over > 0) return 'over';
  if (st === 'paused' && tv.over > 0) return 'paused';
  return st; // idle | running | paused
}

// ---------- ring ----------

function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function ring(state, size) {
  const c = size / 2, r = size === 20 ? 8 : 22;
  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' });
  if (state !== 'over') svg.append(svgEl('circle', { class: 'track', cx: c, cy: c, r }));
  if (state !== 'idle') {
    const len = 2 * Math.PI * r;
    svg.append(svgEl('circle', { class: 'arc', id: 'arc', cx: c, cy: c, r, 'stroke-dasharray': `${len} ${len}`, 'stroke-dashoffset': '0', 'data-len': len }));
  }
  const k = size / 52;
  if (state === 'idle') svg.append(svgEl('path', { class: 'glyph', d: `M${22 * k} ${18 * k} L${34 * k} ${26 * k} L${22 * k} ${34 * k} Z` }));
  const showPause = size === 52 && (state === 'paused' || (hover && (state === 'running' || state === 'over')));
  if (showPause) {
    svg.append(svgEl('rect', { class: 'glyph', x: 20, y: 18, width: 4, height: 16, rx: 1.5 }));
    svg.append(svgEl('rect', { class: 'glyph', x: 28, y: 18, width: 4, height: 16, rx: 1.5 }));
  }
  return svg;
}

function ringButton(state, cur, size) {
  const label = { idle: cur ? '집중 시작' : '할 일 없이 집중 시작', running: '일시정지', over: '일시정지', paused: '계속' }[state];
  const b = h('button.ring', { type: 'button', title: label, 'aria-label': label, onclick: () => {
    if (state === 'running' || state === 'over') send('timer/pause');
    else if (state === 'paused') send('timer/start');
    else send('timer/start', { taskId: cur ? cur.id : null });
  } });
  b.append(ring(state, size));
  return b;
}

// ---------- pieces ----------

function progressBits(cur) {
  if (!cur || (!(cur.target > 0) && !cur.unit)) return null;
  const text = progressText(S, cur, S.today);
  const pct = cur.target > 0 ? M.taskPercent(S, cur, S.today) : 0;
  return h('div.prog', cur.target > 0 ? h('span.bar', h('i', { style: { width: `${pct * 100}%` } })) : null, h('span', text));
}

function dueLines() {
  return S.alerts.map((a) => {
    const task = S.tasks.find((x) => x.id === a.taskId);
    if (!task) return null;
    const runningThis = S.timer.taskId === task.id && S.timer.status !== 'idle';
    return h('div.due',
      h('span', { icon: 'bell', style: { display: 'flex' } }),
      h('b', task.scheduledTime), h('span.t', task.title),
      hover && !runningThis ? h('button.ib', { type: 'button', icon: 'play', title: '이 일로 집중 시작', 'aria-label': '이 일로 집중 시작', onclick: () => send('timer/start', { taskId: task.id }) }) : null,
      hover ? h('button.ib', { type: 'button', icon: 'close', title: '닫기', 'aria-label': '닫기', onclick: () => send('alert/dismiss', { taskId: task.id }) }) : null,
    );
  });
}

function openProgressInput(row, cur) {
  editing = true;
  const input = h('input.pin', { type: 'number', min: '0', step: 'any', value: M.taskProgress(S, cur, S.today), 'aria-label': `진행량 (${cur.unit || '단위 없음'})` });
  const finish = (commit) => {
    if (!editing) return;
    editing = false;
    if (commit && input.value !== '') send('task/progress', { id: cur.id, set: Number(input.value) });
    api.overlayKeyboard(false);
    render();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  row.replaceChildren(input, h('button.btn', { type: 'button', style: { flex: '0 0 64px' }, onclick: () => finish(true) }, '확인'));
  api.overlayKeyboard(true);
  // Focus arrives asynchronously from the main process; only then listen for blur.
  setTimeout(() => { input.focus(); input.select(); input.addEventListener('blur', () => finish(true)); }, 80);
}

function controls(cur, state, items) {
  const parts = [];
  if (cur) {
    const done = M.taskDone(S, cur, S.today);
    const qty = cur.target > 0 || cur.unit;
    const row = h('div.ctrl',
      h('button.btn', { type: 'button', onclick: () => send('task/toggle', { id: cur.id }) }, done ? '완료 취소' : '완료'),
      qty ? h('button.btn', { type: 'button', onclick: () => send('task/progress', { id: cur.id, delta: 1 }) }, `+1${cur.unit}`) : null,
      qty ? h('button.btn', { type: 'button', onclick: () => openProgressInput(row, cur) }, '진행량') : null,
      state !== 'idle' ? h('button.btn', { type: 'button', title: '세션을 끝내고 기록', onclick: () => send('timer/stop') }, '끝내기') : null,
    );
    parts.push(row);
  } else if (state !== 'idle') {
    parts.push(h('div.ctrl', h('button.btn', { type: 'button', onclick: () => send('timer/stop') }, '세션 끝내기')));
  }

  const extra = [];
  const subs = (cur && cur.subtasks) || [];
  if (subs.length) {
    extra.push(h('span.cap', `서브 할 일 ${subs.filter((s) => M.subDone(S, cur, s, S.today)).length} / ${subs.length}`));
    for (const sub of subs) {
      const sd = M.subDone(S, cur, sub, S.today);
      extra.push(h('button.sub', { type: 'button', className: `sub${sd ? ' done' : ''}`, 'aria-pressed': String(sd), onclick: () => send('task/sub', { id: cur.id, subId: sub.id }) }, h('span', sub.title)));
    }
  }
  const next = items.find((x) => x !== cur && !M.taskDone(S, x, S.today));
  const s = S.settings;
  extra.push(h('div.foot',
    h('span.grow', h('span', { id: 'wt' }, ''), next ? ` · 다음 ${next.title}` : ''),
    s.overlayLocked ? h('span', { icon: 'lock', title: '위치·크기 잠김', style: { display: 'flex' } }) : null,
    h('button.ib', { type: 'button', icon: 'gear', title: '메인 화면 열기', 'aria-label': '메인 화면 열기', onclick: () => send('ui/openMain') }),
  ));
  parts.push(h('div.extra', extra));
  return parts;
}

// ---------- render ----------

function render() {
  if (!S || editing) return;
  const s = S.settings;
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.style.setProperty('--alpha', String(s.opacity));
  root.style.setProperty('--scale', String(s.fontScale));
  document.body.classList.toggle('through', s.clickThrough);
  document.body.classList.toggle('locked', s.overlayLocked);
  const scr = window.screen;
  document.body.classList.toggle('up', window.screenY + window.outerHeight / 2 > (scr.availTop || 0) + scr.availHeight / 2);

  const items = M.dayItems(S, S.today, S.today);
  const cur = currentTask(items);
  const tv = M.timerView(S.timer, Date.now());
  const state = stateOf(tv);
  const pill = plate.getBoundingClientRect().width / s.fontScale < PILL_WIDTH;
  const control = hover && !s.clickThrough && !pill;
  const done = cur && M.taskDone(S, cur, S.today);
  const title = cur ? cur.title : (items.length ? '오늘 할 일을 모두 끝냄' : '할 일 없음');
  const name = state === 'idle' && cur && !done ? `다음 · ${title}` : title;

  plate.className = `plate ${state}${pill ? ' pill' : ''}${control ? ' control' : ''}${!pill && S.alerts.length ? ' has-due' : ''}`;

  if (pill) {
    plate.replaceChildren(ringButton(state, cur, 20), h('span.name', name), h('span#clock.time', ''));
  } else {
    const third = state === 'over' && !progressBits(cur)
      ? h('span.meta', `계획 ${Math.round(plannedMs(cur) / 60000)}분 · 계속 기록 중`)
      : progressBits(cur) || (cur ? null : h('span.meta', 'Ctrl+Shift+Space로 추가'));
    plate.replaceChildren(
      ...dueLines(),
      h('div.main', ringButton(state, cur, 52),
        h('div.fig', h('span#clock.time', ''), h('span.name', { className: `name${done ? ' done' : ''}`, title }, name), third)),
      ...(control ? controls(cur, state, items) : []),
    );
  }
  live();
  fit();
}

function live() {
  if (!S) return;
  const tv = M.timerView(S.timer, Date.now());
  const items = M.dayItems(S, S.today, S.today);
  const cur = currentTask(items);
  const planned = plannedMs(cur);
  const clock = document.getElementById('clock');
  if (clock) {
    clock.textContent = S.timer.status === 'idle' ? M.fmtClock(planned) : tv.over > 0 ? `+${M.fmtClock(tv.over)}` : M.fmtClock(tv.remaining);
    if (S.timer.status !== 'idle' && (tv.over > 0) !== plate.classList.contains('over') && S.timer.status === 'running') render();
  }
  const arc = document.getElementById('arc');
  if (arc) {
    const len = Number(arc.dataset.len);
    const left = tv.over > 0 || !planned ? 1 : tv.remaining / planned;
    arc.setAttribute('stroke-dashoffset', String(len * (1 - Math.max(0, Math.min(1, left)))));
    if (tv.over > 0) arc.setAttribute('stroke-dashoffset', '0');
  }
  const wt = document.getElementById('wt');
  if (wt) wt.textContent = `오늘 집중 ${M.fmtDuration(M.workMs(S, S.today) + tv.live)}`;
}
setInterval(live, 500);

// Window height follows the plate; main keeps the edge nearest the screen edge fixed.
let lastFit = 0;
function fit() {
  const pad = 12;
  const height = Math.ceil(plate.getBoundingClientRect().height + 2 * pad);
  if (height !== lastFit) { lastFit = height; api.fitOverlay(height); }
}
new ResizeObserver(() => fit()).observe(plate);
window.addEventListener('resize', () => render());

// ---------- hover → control mode ----------

plate.addEventListener('mouseenter', () => {
  clearTimeout(leaveTimer);
  if (!hover) { hover = true; render(); }
});
plate.addEventListener('mouseleave', () => {
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => { if (editing) return; hover = false; render(); }, 400);
});
plate.addEventListener('dblclick', (e) => { if (!e.target.closest('button, input')) send('ui/openMain'); });

// ---------- move by dragging the plate ----------
// The OS drag region needs window activation, which the overlay avoids, so move it by hand.

let move = null;
plate.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('button, input') || !S || S.settings.overlayLocked) return;
  plate.setPointerCapture(e.pointerId);
  move = { x: e.screenX, y: e.screenY, wx: window.screenX, wy: window.screenY, moved: false };
});
plate.addEventListener('pointermove', (e) => {
  if (!move) return;
  const dx = e.screenX - move.x, dy = e.screenY - move.y;
  if (!move.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
  move.moved = true;
  api.moveOverlay({ x: move.wx + dx, y: move.wy + dy });
});
plate.addEventListener('pointerup', (e) => {
  if (!move) return;
  if (move.moved) api.moveOverlay({ x: move.wx + e.screenX - move.x, y: move.wy + e.screenY - move.y, done: true });
  move = null;
  release();
  render(); // the grow direction may have changed
});

// ---------- width handle ----------

const edge = $('#edge');
let drag = null;
edge.addEventListener('pointerdown', (e) => {
  if (S && S.settings.overlayLocked) return;
  edge.setPointerCapture(e.pointerId);
  drag = { x: e.screenX, w: window.outerWidth };
});
edge.addEventListener('pointermove', (e) => { if (drag) api.resizeOverlay({ width: drag.w + e.screenX - drag.x }); });
edge.addEventListener('pointerup', (e) => {
  if (!drag) return;
  api.resizeOverlay({ width: drag.w + e.screenX - drag.x, done: true });
  drag = null;
  release();
});

// ---------- sounds ----------

api.onChime(({ kind, sound }) => {
  if (sound) UI.chime(kind);
  plate.classList.remove('flash');
  void plate.offsetWidth;
  plate.classList.add('flash');
});

api.onState((next) => { S = next; render(); });
api.getState().then((first) => { S = first; render(); });
