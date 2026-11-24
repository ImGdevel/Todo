// Focus timer (counts down the plan, then keeps counting overtime until stopped)
// and the time-of-day scheduler for scheduled tasks.
const M = require('../shared/model');
const store = require('./store');
const logger = require('./logger');

const ALERT_WINDOW_MS = 10 * 60000; // a schedule fires only if the app sees it within 10 min
const ALERT_SHOW_MS = 30 * 60000; // and stays on the overlay for at most 30 min

let timer = idle();
let alerts = []; // [{ taskId, at }]
let hooks = { onPlanReached: () => {}, onScheduleDue: () => {} };

function idle(taskId = null, plannedMs = null) {
  return {
    status: 'idle', taskId,
    plannedMs: plannedMs ?? ((store.state.settings && store.state.settings.defaultPlannedMin) || 25) * 60000,
    accMs: 0, runStart: null, checkpoint: null, startedAt: null, planNotified: false,
  };
}

const plannedFor = (task) => (task && task.plannedMin ? task.plannedMin : store.state.settings.defaultPlannedMin) * 60000;

// Credit focus time from the last checkpoint to `now`, split at midnight.
function accrue(now = Date.now()) {
  if (timer.status !== 'running') return;
  let from = timer.checkpoint;
  const s = store.state;
  const task = timer.taskId ? store.findTask(timer.taskId) : null;
  while (from < now) {
    const key = M.dateKey(new Date(from));
    const midnight = M.parseKey(M.addDays(key, 1)).getTime();
    const to = Math.min(now, midnight);
    const ms = to - from;
    if (task) M.ensureRec(s, key, task).focusMs += ms;
    else {
      s.days[key] ||= { tasks: {}, freeFocusMs: 0, alerted: {} };
      s.days[key].freeFocusMs = (s.days[key].freeFocusMs || 0) + ms;
    }
    from = to;
  }
  timer.checkpoint = now;
}

function start(taskId, plannedMin) {
  const now = Date.now();
  const sameTask = taskId === undefined || taskId === timer.taskId;
  if (timer.status !== 'idle' && !sameTask) stop(); // switching tasks closes the session
  if (timer.status === 'running') return;
  if (timer.status === 'paused') {
    timer.status = 'running';
    timer.runStart = now;
    timer.checkpoint = now;
    logger.log('focus.resume', { taskId: timer.taskId });
    return;
  }
  const id = taskId === undefined ? timer.taskId : taskId;
  const task = id ? store.findTask(id) : null;
  const plannedMs = plannedMin ? plannedMin * 60000 : (taskId === undefined && timer.plannedMs) || plannedFor(task);
  timer = { ...idle(task ? task.id : null, plannedMs), status: 'running', runStart: now, checkpoint: now, startedAt: now };
  if (task) store.state.ui.currentTaskId = task.id;
  logger.log('focus.start', { taskId: timer.taskId, title: task ? task.title : null, plannedMs });
}

function pause() {
  if (timer.status !== 'running') return;
  const now = Date.now();
  accrue(now);
  timer.accMs += now - timer.runStart;
  timer.status = 'paused';
  timer.runStart = null;
  logger.log('focus.pause', { taskId: timer.taskId, elapsedMs: timer.accMs });
}

function stop() {
  if (timer.status === 'idle') return;
  const now = Date.now();
  accrue(now);
  const actualMs = timer.accMs + (timer.status === 'running' ? now - timer.runStart : 0);
  const task = timer.taskId ? store.findTask(timer.taskId) : null;
  const session = {
    id: store.newId(), date: M.dateKey(new Date(timer.startedAt)), taskId: timer.taskId,
    title: task ? task.title : null, plannedMs: timer.plannedMs, actualMs,
    overMs: Math.max(0, actualMs - timer.plannedMs), startedAt: timer.startedAt, endedAt: now,
  };
  if (actualMs >= 1000) {
    store.state.sessions.push(session);
    logger.log('focus.session', session);
  }
  timer = idle(timer.taskId, timer.plannedMs);
}

function setup(taskId, plannedMin) {
  if (timer.status !== 'idle') return;
  const task = taskId ? store.findTask(taskId) : null;
  if (taskId !== undefined) {
    timer.taskId = task ? task.id : null;
    timer.plannedMs = plannedFor(task);
  }
  if (plannedMin) timer.plannedMs = plannedMin * 60000;
}

function apply(type, p = {}) {
  switch (type) {
    case 'timer/start': start('taskId' in p ? p.taskId || null : undefined, Number(p.plannedMin) || null); return true;
    case 'timer/pause': pause(); return true;
    case 'timer/toggle': if (timer.status === 'running') pause(); else start(); return true;
    case 'timer/stop': stop(); return true;
    case 'timer/setup': setup('taskId' in p ? p.taskId || null : undefined, Number(p.plannedMin) || null); return true;
    case 'alert/dismiss': alerts = alerts.filter((a) => a.taskId !== p.taskId); return true;
    default: return false;
  }
}

// Called every second. Returns true when something visible changed.
let lastAccrue = 0;
function tick(now = Date.now()) {
  let changed = false;

  if (timer.status === 'running') {
    if (now - lastAccrue > 15000) { accrue(now); lastAccrue = now; store.saveSoon(); }
    if (!timer.planNotified && M.timerView(timer, now).remaining <= 0) {
      timer.planNotified = true;
      const task = timer.taskId ? store.findTask(timer.taskId) : null;
      logger.log('focus.planReached', { taskId: timer.taskId, plannedMs: timer.plannedMs });
      hooks.onPlanReached(task);
      changed = true;
    }
  }

  // Scheduled tasks.
  const s = store.state;
  const key = M.dateKey(new Date(now));
  const day = (s.days[key] ||= { tasks: {}, freeFocusMs: 0, alerted: {} });
  day.alerted ||= {};
  for (const task of M.dayItems(s, key, key)) {
    if (!task.scheduledTime || day.alerted[task.id] || M.taskDone(s, task, key)) continue;
    const [h, m] = task.scheduledTime.split(':').map(Number);
    const at = new Date(now); at.setHours(h, m, 0, 0);
    const late = now - at.getTime();
    if (late < 0) continue;
    day.alerted[task.id] = true;
    changed = true;
    if (late > ALERT_WINDOW_MS) continue; // missed while the app was closed: do not nag
    alerts.push({ taskId: task.id, at: at.getTime() });
    logger.log('schedule.due', { taskId: task.id, title: task.title, scheduledTime: task.scheduledTime, autoStart: task.autoStart });
    let autoStarted = false;
    if (task.autoStart && timer.status === 'idle') {
      start(task.id, task.plannedMin || null);
      autoStarted = true;
    }
    hooks.onScheduleDue(task, autoStarted);
  }
  const before = alerts.length;
  alerts = alerts.filter((a) => {
    const t = store.findTask(a.taskId);
    return t && now - a.at < ALERT_SHOW_MS && !M.taskDone(s, t, key) && !t.archivedAt;
  });
  if (alerts.length !== before) changed = true;
  return changed;
}

module.exports = {
  apply, tick, stop, accrue,
  setHooks: (h) => { hooks = { ...hooks, ...h }; },
  reset: () => { timer = idle(); },
  get timer() { return timer; },
  get alerts() { return alerts; },
};
