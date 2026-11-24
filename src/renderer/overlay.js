const { h, ICONS, progressText } = UI;
const M = Model;
const $ = (s) => document.querySelector(s);
const send = (type, payload) => api.dispatch(type, payload);
let S = null;
let editing = false; // a progress input is open; do not rebuild under it

$('#gear').innerHTML = ICONS.gear;
$('#gear').addEventListener('click', () => send('ui/openMain'));

// On Windows a click activates the overlay; main hands focus straight back to the app the user
// was in (main/winfocus.js). Only the progress input keeps the keyboard until it is done.
const release = () => setTimeout(() => api.releaseFocus(), 0);
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('input')) e.preventDefault(); // no focus rings, no text selection
}, true);
document.addEventListener('click', (e) => { if (!e.target.closest('input')) release(); });

// ---------- what to show ----------

function currentTask(items) {
  const t = S.timer.taskId && S.tasks.find((x) => x.id === S.timer.taskId);
  if (t) return t;
  const ui = S.ui.currentTaskId && items.find((x) => x.id === S.ui.currentTaskId && !M.taskDone(S, x, S.today));
  if (ui) return ui;
  return items.find((x) => !M.taskDone(S, x, S.today)) || null;
}

function nextSchedule(items) {
  const now = new Date();
  const hm = `${M.pad(now.getHours())}:${M.pad(now.getMinutes())}`;
  return items.find((x) => x.scheduledTime && x.scheduledTime > hm && !M.taskDone(S, x, S.today)) || null;
}

const btn = (icon, title, onclick, cls = '') =>
  h(`button.ib${cls ? '.' + cls : ''}`, { type: 'button', title, 'aria-label': title, icon, onclick });

function progressBlock(task) {
  const text = progressText(S, task, S.today);
  if (!text) return null;
  const pct = M.taskPercent(S, task, S.today);
  const value = h('button.pv', { type: 'button', title: '눌러서 진행량 입력' }, text);
  value.addEventListener('click', () => {
    editing = true;
    const input = h('input.pi', { type: 'number', min: '0', step: 'any', value: M.taskProgress(S, task, S.today) });
    const finish = (commit) => {
      if (!editing) return;
      editing = false;
      if (commit && input.value !== '') send('task/progress', { id: task.id, set: Number(input.value) });
      api.overlayKeyboard(false);
      render();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    value.replaceWith(input);
    api.overlayKeyboard(true);
    // Focus arrives asynchronously from the main process; only then listen for blur.
    setTimeout(() => {
      input.focus();
      input.select();
      input.addEventListener('blur', () => finish(true));
    }, 80);
  });
  return h('div.prog',
    h('div.prog-top', value, btn('plus', '1 늘리기', () => send('task/progress', { id: task.id, delta: 1 }), 'sm')),
    task.target > 0 ? h('div.bar', h('i', { style: { width: `${pct * 100}%` } })) : null,
  );
}

function render() {
  if (!S || editing) return;
  const s = S.settings;
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.style.setProperty('--alpha', String(s.opacity));
  root.style.setProperty('--scale', String(s.fontScale));
  document.body.classList.toggle('through', s.clickThrough);
  document.body.classList.toggle('locked', s.overlayLocked);
  $('#mode').replaceChildren();
  if (s.clickThrough) $('#mode').insertAdjacentHTML('afterbegin', ICONS.pointer);
  else if (s.overlayLocked) $('#mode').insertAdjacentHTML('afterbegin', ICONS.lock);
  $('#mode').title = s.clickThrough ? '클릭 통과 중 — 단축키로 조작 모드 전환' : s.overlayLocked ? '위치·크기 잠김' : '';

  const items = M.dayItems(S, S.today, S.today);
  const cur = currentTask(items);
  const t = S.timer;
  const parts = [];

  // Schedules that are due now.
  for (const a of S.alerts) {
    const task = S.tasks.find((x) => x.id === a.taskId);
    if (!task) continue;
    const runningThis = t.taskId === task.id && t.status !== 'idle';
    parts.push(h('div.alert',
      h('span.al-icon', { icon: 'bell' }),
      h('div.al-text', h('b', task.scheduledTime), ' ', task.title),
      runningThis ? null : btn('play', '이 일로 집중 시작', () => send('timer/start', { taskId: task.id }), 'sm'),
      btn('close', '닫기', () => send('alert/dismiss', { taskId: task.id }), 'sm'),
    ));
  }

  // Current task.
  if (cur) {
    const done = M.taskDone(S, cur, S.today);
    const subs = cur.subtasks || [];
    parts.push(h('section.now',
      h('div.now-head',
        h('button.ck', { type: 'button', className: `ck${done ? ' on' : ''}`, icon: 'check', title: done ? '완료 취소' : '완료', onclick: () => send('task/toggle', { id: cur.id }) }),
        h('div.now-title', { className: `now-title${done ? ' done' : ''}` }, cur.title),
      ),
      subs.length ? h('ul.subs', subs.map((sub) => {
        const sd = M.subDone(S, cur, sub, S.today);
        return h('li', { className: sd ? 'done' : '' },
          h('button.ck.sm', { type: 'button', className: `ck sm${sd ? ' on' : ''}`, icon: 'check', title: sd ? '완료 취소' : '완료', onclick: () => send('task/sub', { id: cur.id, subId: sub.id }) }),
          h('span', sub.title));
      })) : null,
      progressBlock(cur),
    ));
  } else {
    parts.push(h('p.empty', items.length ? '오늘 할 일을 모두 끝냈습니다.' : '할 일이 없습니다. Ctrl+Shift+Space로 추가하세요.'));
  }

  // Timer.
  const running = t.status === 'running';
  parts.push(h('section.timer', { className: `timer ${t.status}` },
    h('div.t-row',
      h('span.t-clock', { id: 'clock' }, '--:--'),
      h('span.t-plan', { id: 'plan' }, ''),
      h('span.spacer'),
      btn(running ? 'pause' : 'play', running ? '일시정지' : (t.status === 'paused' ? '계속' : `${cur ? '이 일로 ' : ''}집중 시작`),
        () => (running ? send('timer/pause') : t.status === 'paused' ? send('timer/start') : send('timer/start', { taskId: cur ? cur.id : null })), 'main'),
      t.status === 'idle' ? null : btn('stop', '종료하고 기록', () => send('timer/stop')),
    ),
    h('div.bar', h('i', { id: 'tbar' })),
  ));

  // Up next.
  const rest = items.filter((x) => x !== cur && !M.taskDone(S, x, S.today));
  if (rest.length) {
    parts.push(h('ul.next', rest.slice(0, 5).map((x) => h('li',
      h('button.ck.sm', { type: 'button', icon: 'check', title: '완료', onclick: () => send('task/toggle', { id: x.id }) }),
      h('button.nx', { type: 'button', title: '지금 할 일로 지정', onclick: () => send('ui/current', { id: x.id }) }, x.title),
      x.scheduledTime ? h('span.tm', x.scheduledTime) : null,
    )), rest.length > 5 ? h('li.more', `+ ${rest.length - 5}개 더`) : null));
  }

  const ns = nextSchedule(items);
  if (ns && !S.alerts.some((a) => a.taskId === ns.id)) {
    parts.push(h('div.upcoming', { icon: 'clock' }, h('span', `${ns.scheduledTime} ${ns.title}`)));
  }

  $('#content').replaceChildren(...parts);
  live();
}

function live() {
  if (!S) return;
  const tv = M.timerView(S.timer, Date.now());
  $('#wt').textContent = M.fmtDuration(M.workMs(S, S.today) + tv.live);
  const clock = document.getElementById('clock');
  if (!clock) return;
  const over = tv.over > 0;
  clock.textContent = over ? `+${M.fmtClock(tv.over)}` : M.fmtClock(tv.remaining);
  clock.classList.toggle('over', over);
  document.getElementById('plan').textContent = over ? '초과' : `/ ${Math.round(S.timer.plannedMs / 60000)}분`;
  document.getElementById('tbar').style.setProperty('width', `${Math.min(100, S.timer.plannedMs ? (tv.elapsed / S.timer.plannedMs) * 100 : 0)}%`);
}
setInterval(live, 500);

// ---------- move by dragging the header ----------
// The OS drag region needs window activation, which the overlay avoids, so move it by hand.

const head = $('#head');
let move = null;
head.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('button') || !S || S.settings.overlayLocked) return;
  head.setPointerCapture(e.pointerId);
  move = { x: e.screenX, y: e.screenY, wx: window.screenX, wy: window.screenY };
});
head.addEventListener('pointermove', (e) => {
  if (!move) return;
  api.moveOverlay({ x: move.wx + e.screenX - move.x, y: move.wy + e.screenY - move.y });
});
head.addEventListener('pointerup', (e) => {
  if (!move) return;
  api.moveOverlay({ x: move.wx + e.screenX - move.x, y: move.wy + e.screenY - move.y, done: true });
  move = null;
  release();
});

// ---------- resize grip ----------

const grip = $('#grip');
let drag = null;
grip.addEventListener('pointerdown', (e) => {
  if (S && S.settings.overlayLocked) return;
  grip.setPointerCapture(e.pointerId);
  drag = { x: e.screenX, y: e.screenY, w: window.outerWidth, h: window.outerHeight };
});
grip.addEventListener('pointermove', (e) => {
  if (!drag) return;
  api.resizeOverlay({ width: drag.w + e.screenX - drag.x, height: drag.h + e.screenY - drag.y });
});
grip.addEventListener('pointerup', (e) => {
  if (!drag) return;
  api.resizeOverlay({ width: drag.w + e.screenX - drag.x, height: drag.h + e.screenY - drag.y, done: true });
  drag = null;
  release();
});

// ---------- sounds ----------

api.onChime(({ kind, sound }) => {
  if (sound) UI.chime(kind);
  const card = $('#card');
  card.classList.remove('flash');
  void card.offsetWidth;
  card.classList.add('flash');
});

api.onState((next) => { S = next; render(); });
api.getState().then((first) => { S = first; render(); });
