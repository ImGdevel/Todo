// Persistent app state, migrations and every state-changing action.
const fs = require('fs');
const path = require('path');
const M = require('../shared/model');
const logger = require('./logger');

const SCHEMA = 2;

const DEFAULT_SETTINGS = {
  overlayVisible: true,
  overlayBounds: null, // { x, y, width, height } — null = place in a corner on first run
  displayId: null,
  overlayLocked: false,
  clickThrough: false,
  opacity: 0.88,
  fontScale: 1,
  theme: 'dark',
  defaultPlannedMin: 25,
  soundTimer: true,
  soundSchedule: true,
  launchAtLogin: false,
};

const LIMITS = { opacity: [0.15, 1], fontScale: [0.8, 1.5], defaultPlannedMin: [1, 600] };

const emptyState = () => ({
  schema: SCHEMA,
  tasks: [],
  goals: [],
  days: {},
  sessions: [],
  settings: { ...DEFAULT_SETTINGS },
  ui: { currentTaskId: null },
  meta: { lastSummarized: null },
});

let state = emptyState();
let file = null;
let saveTimer = null;

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => M.dateKey();
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const posNum = (v) => { const n = num(v); return n !== null && n > 0 ? n : null; };
const timeStr = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : null);

// ---------- persistence ----------

function load(baseDir) {
  file = path.join(baseDir, 'state.json');
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  state = raw ? migrate(raw) : emptyState();
  return state;
}

function migrate(raw) {
  const s = emptyState();
  if (raw.schema === SCHEMA) {
    Object.assign(s, raw);
  } else if (Array.isArray(raw.todos)) {
    // v0.1: flat todo list → one-off tasks for today, focus time kept as legacy total.
    const d = today();
    s.tasks = raw.todos.filter((t) => t && t.text).map((t, i) => ({
      ...blankTask(), id: String(t.id || newId()), title: String(t.text), date: d, order: i,
      done: !!t.done, doneDate: t.done ? d : null, legacyFocusMs: Number(t.spentMs) || 0,
    }));
    const old = raw.settings || {};
    for (const k of ['overlayVisible', 'displayId', 'opacity', 'fontScale', 'theme', 'clickThrough', 'launchAtLogin']) {
      if (k in old) s.settings[k] = old[k];
    }
    if (typeof old.sound === 'boolean') s.settings.soundTimer = s.settings.soundSchedule = old.sound;
    if (old.focusMin) s.settings.defaultPlannedMin = old.focusMin;
  }
  s.settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...s.settings });
  s.ui ||= { currentTaskId: null };
  s.meta ||= { lastSummarized: null };
  return s;
}

function saveSoon() {
  if (saveTimer) return; // throttle, not debounce: a running timer changes state constantly
  saveTimer = setTimeout(saveNow, 1000);
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!file) return;
  try {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('state save failed:', err.message);
  }
}

function sanitizeSettings(s) {
  const out = { ...DEFAULT_SETTINGS };
  for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
    const v = s[key];
    if (key === 'overlayBounds') {
      out[key] = v && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(v[k]))
        ? { x: Math.round(v.x), y: Math.round(v.y), width: Math.round(v.width), height: Math.round(v.height) } : null;
    } else if (key === 'displayId') {
      out[key] = Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null;
    } else if (typeof def === 'boolean') {
      out[key] = typeof v === 'boolean' ? v : def;
    } else if (typeof def === 'number') {
      const n = Number(v);
      const [lo, hi] = LIMITS[key];
      out[key] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
    } else if (key === 'theme') {
      out[key] = v === 'light' ? 'light' : 'dark';
    }
  }
  return out;
}

// ---------- entities ----------

function blankTask() {
  return {
    id: newId(), title: '', kind: 'once', date: today(), startDate: today(), repeatDays: [],
    target: null, unit: '', goalId: null, scheduledTime: null, plannedMin: null, autoStart: false,
    subtasks: [], order: Date.now(), done: false, doneDate: null, createdAt: Date.now(), archivedAt: null,
  };
}

function taskFields(p, existing) {
  const out = {};
  if ('title' in p) out.title = str(p.title);
  if ('kind' in p) out.kind = p.kind === 'routine' ? 'routine' : 'once';
  if ('date' in p && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) out.date = p.date;
  if ('startDate' in p && /^\d{4}-\d{2}-\d{2}$/.test(p.startDate)) out.startDate = p.startDate;
  if ('repeatDays' in p) out.repeatDays = [...new Set((p.repeatDays || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
  if ('target' in p) out.target = posNum(p.target);
  if ('unit' in p) out.unit = str(p.unit, 12);
  if ('goalId' in p) out.goalId = state.goals.some((g) => g.id === p.goalId) ? p.goalId : null;
  if ('scheduledTime' in p) out.scheduledTime = timeStr(p.scheduledTime);
  if ('plannedMin' in p) out.plannedMin = posNum(p.plannedMin);
  if ('autoStart' in p) out.autoStart = !!p.autoStart;
  if ('subtasks' in p) {
    const prev = new Map(((existing && existing.subtasks) || []).map((s) => [s.id, s]));
    out.subtasks = (p.subtasks || [])
      .map((s) => (typeof s === 'string' ? { title: s } : s))
      .filter((s) => str(s.title))
      .map((s) => ({ id: s.id && prev.has(s.id) ? s.id : newId(), title: str(s.title), done: !!(prev.get(s.id) || {}).done }));
  }
  return out;
}

function goalFields(p) {
  const out = {};
  if ('title' in p) out.title = str(p.title);
  if ('period' in p && M.PERIODS.includes(p.period)) out.period = p.period;
  if ('start' in p && /^\d{4}-\d{2}-\d{2}$/.test(p.start)) out.start = p.start;
  if ('target' in p) out.target = posNum(p.target);
  if ('unit' in p) out.unit = str(p.unit, 12);
  if ('parentId' in p) out.parentId = p.parentId || null;
  if ('note' in p) out.note = str(p.note, 500);
  return out;
}

const findTask = (id) => state.tasks.find((t) => t.id === id);
const findGoal = (id) => state.goals.find((g) => g.id === id);
const taskLog = (t) => ({ taskId: t.id, title: t.title, kind: t.kind, target: t.target, unit: t.unit, goalId: t.goalId });

// ---------- actions ----------

function setDone(task, key, done) {
  if (M.isRoutine(task)) {
    M.ensureRec(state, key, task).done = done;
  } else {
    task.done = done;
    task.doneDate = done ? key : null;
    M.ensureRec(state, key, task).done = done;
  }
  logger.log(done ? 'task.done' : 'task.undone', { ...taskLog(task), forDate: key, progress: M.taskProgress(state, task, key) });
}

function addProgress(task, key, delta) {
  if (!Number.isFinite(delta) || delta === 0) return;
  const current = M.taskProgress(state, task, key);
  delta = Math.max(-current, delta); // never below zero in total
  if (delta === 0) return;
  const r = M.ensureRec(state, key, task);
  r.progress = Math.round((r.progress + delta) * 1000) / 1000;
  const total = M.taskProgress(state, task, key);
  logger.log('progress', { ...taskLog(task), forDate: key, delta, total });
  // Reaching the target is shown, but completion stays a deliberate check.
}

/** Returns true when the action changed state. */
function apply(type, p = {}) {
  const key = p.date || today();
  switch (type) {
    case 'task/add': {
      const t = { ...blankTask(), ...taskFields(p) };
      if (!t.title) return false;
      if (t.kind === 'routine' && !p.startDate) t.startDate = key;
      if (t.kind === 'once' && !p.date) t.date = key;
      state.tasks.push(t);
      logger.log('task.created', { ...taskLog(t), scheduledTime: t.scheduledTime, plannedMin: t.plannedMin, repeatDays: t.repeatDays });
      return true;
    }
    case 'task/update': {
      const t = findTask(p.id);
      if (!t) return false;
      const patch = taskFields(p.patch || {}, t);
      if ('title' in patch && !patch.title) delete patch.title;
      Object.assign(t, patch);
      logger.log('task.updated', { ...taskLog(t), fields: Object.keys(patch) });
      return true;
    }
    case 'task/archive': {
      const t = findTask(p.id);
      if (!t) return false;
      t.archivedAt = Date.now();
      if (state.ui.currentTaskId === t.id) state.ui.currentTaskId = null;
      logger.log('task.archived', taskLog(t));
      return true;
    }
    case 'task/toggle': {
      const t = findTask(p.id);
      if (!t) return false;
      setDone(t, key, !M.taskDone(state, t, key));
      return true;
    }
    case 'task/progress': {
      const t = findTask(p.id);
      if (!t) return false;
      const delta = 'set' in p ? num(p.set) - M.taskProgress(state, t, key) : num(p.delta);
      addProgress(t, key, delta);
      return true;
    }
    case 'task/sub': {
      const t = findTask(p.id);
      const sub = t && t.subtasks.find((s) => s.id === p.subId);
      if (!sub) return false;
      let done;
      if (M.isRoutine(t)) {
        const r = M.ensureRec(state, key, t);
        done = r.subDone[sub.id] = !r.subDone[sub.id];
      } else {
        done = sub.done = !sub.done;
        M.ensureRec(state, key, t);
      }
      logger.log('subtask', { ...taskLog(t), forDate: key, subId: sub.id, subTitle: sub.title, done });
      return true;
    }
    case 'task/move': {
      const list = state.tasks.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
      const from = list.findIndex((t) => t.id === p.id);
      const to = list.findIndex((t) => t.id === p.toId);
      if (from < 0 || to < 0 || from === to) return false;
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      list.forEach((t, i) => { t.order = i; });
      return true;
    }
    case 'goal/add': {
      const g = { id: newId(), title: '', period: 'week', start: M.periodStart('week', today()), target: null, unit: '', parentId: null, progress: 0, done: false, createdAt: Date.now(), archivedAt: null, ...goalFields(p) };
      if (!g.title) return false;
      g.start = M.periodStart(g.period, g.start);
      if (g.parentId && !M.canParent(findGoal(g.parentId), g)) g.parentId = null;
      state.goals.push(g);
      logger.log('goal.created', { goalId: g.id, title: g.title, period: g.period, start: g.start, target: g.target, unit: g.unit, parentId: g.parentId });
      return true;
    }
    case 'goal/update': {
      const g = findGoal(p.id);
      if (!g) return false;
      const patch = goalFields(p.patch || {});
      if ('title' in patch && !patch.title) delete patch.title;
      Object.assign(g, patch);
      g.start = M.periodStart(g.period, g.start);
      if (g.parentId && !M.canParent(findGoal(g.parentId), g)) g.parentId = null;
      logger.log('goal.updated', { goalId: g.id, title: g.title, fields: Object.keys(patch) });
      return true;
    }
    case 'goal/archive': {
      const g = findGoal(p.id);
      if (!g) return false;
      g.archivedAt = Date.now();
      for (const c of state.goals) if (c.parentId === g.id) c.parentId = null;
      for (const t of state.tasks) if (t.goalId === g.id) t.goalId = null;
      logger.log('goal.archived', { goalId: g.id, title: g.title });
      return true;
    }
    case 'goal/progress': {
      const g = findGoal(p.id);
      if (!g) return false;
      if ('done' in p) g.done = !!p.done;
      else g.progress = Math.max(0, (g.progress || 0) + (num(p.delta) || 0));
      logger.log('goal.progress', { goalId: g.id, title: g.title, progress: g.progress, done: g.done });
      return true;
    }
    case 'ui/current':
      state.ui.currentTaskId = findTask(p.id) ? p.id : null;
      return true;
    case 'settings/set':
      state.settings = sanitizeSettings({ ...state.settings, ...p });
      return true;
    default:
      return false;
  }
}

// ---------- daily summaries for the AI log ----------

function summarizeDay(key) {
  const day = M.dayOf(state, key);
  const tasks = state.tasks.filter((t) => M.occursOn(t, key, key) || (day && day.tasks && day.tasks[t.id]));
  const items = tasks.map((t) => {
    const r = M.rec(state, key, t.id) || {};
    const focusMs = r.focusMs || 0;
    const plannedMs = t.plannedMin ? t.plannedMin * 60000 : null;
    return {
      taskId: t.id, title: r.title || t.title, kind: t.kind, goalId: t.goalId,
      done: M.isRoutine(t) ? !!r.done : !!(t.done && t.doneDate === key) || !!r.done,
      progressToday: r.progress || 0,
      progressTotal: M.taskProgress(state, t, key),
      target: r.target ?? t.target ?? null, unit: r.unit || t.unit || '',
      scheduledTime: t.scheduledTime, plannedMs, focusMs,
      overMs: plannedMs !== null ? Math.max(0, focusMs - plannedMs) : null,
    };
  });
  const sessions = M.sessionsOn(state, key);
  logger.log('day.summary', {
    forDate: key,
    workMs: M.workMs(state, key),
    freeFocusMs: (day && day.freeFocusMs) || 0,
    tasks: items,
    sessions: sessions.map(({ taskId, title, plannedMs, actualMs, overMs, startedAt, endedAt }) => ({ taskId, title, plannedMs, actualMs, overMs, startedAt, endedAt })),
    goals: state.goals.filter((g) => !g.archivedAt && M.inRange(key, M.periodRange(g.period, g.start))).map((g) => {
      const p = M.goalProgress(state, g);
      return { goalId: g.id, title: g.title, period: g.period, start: g.start, parentId: g.parentId, ...p };
    }),
  }, new Date(M.parseKey(key).getTime() + M.DAY_MS - 1));
}

// Write a summary for every finished day that has not been summarized yet.
function summarizePending() {
  const t = today();
  const last = state.meta.lastSummarized;
  const pending = M.recordKeys(state).filter((k) => k < t && (!last || k > last));
  for (const k of pending) summarizeDay(k);
  if (pending.length) state.meta.lastSummarized = pending[pending.length - 1];
  return pending.length > 0;
}

module.exports = {
  load, saveSoon, saveNow, apply, summarizePending, summarizeDay,
  get state() { return state; },
  newId, findTask, today,
};
