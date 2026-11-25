// Pure domain logic shared by the main process (require) and renderers (<script>).
// Nothing here touches Electron, the DOM or the clock unless a function says so.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Model = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  const DAY_MS = 86400000;
  const PERIODS = ['month', 'week', 'day'];
  const PERIOD_RANK = { month: 0, week: 1, day: 2 };

  // ---------- dates (local calendar, keys are YYYY-MM-DD) ----------

  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (key, n) => {
    const d = parseKey(key);
    d.setDate(d.getDate() + n);
    return dateKey(d);
  };
  const weekday = (key) => parseKey(key).getDay(); // 0 = Sunday
  const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / DAY_MS);

  function periodStart(period, key) {
    if (period === 'day') return key;
    if (period === 'week') return addDays(key, -((weekday(key) + 6) % 7)); // weeks start Monday
    return `${key.slice(0, 7)}-01`;
  }

  function periodRange(period, start) {
    if (period === 'day') return [start, start];
    if (period === 'week') return [start, addDays(start, 6)];
    const d = parseKey(start);
    return [start, dateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  }

  function shiftPeriod(period, start, n) {
    if (period === 'day') return addDays(start, n);
    if (period === 'week') return addDays(start, 7 * n);
    const d = parseKey(start);
    return dateKey(new Date(d.getFullYear(), d.getMonth() + n, 1));
  }

  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  function periodLabel(period, start) {
    const d = parseKey(start);
    if (period === 'month') return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
    if (period === 'week') {
      const [, end] = periodRange('week', start);
      const e = parseKey(end);
      return `${d.getMonth() + 1}/${d.getDate()} – ${e.getMonth() + 1}/${e.getDate()} 주`;
    }
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  }

  const inRange = (key, [a, b]) => key >= a && key <= b;

  // ---------- records ----------

  // state.days[key].tasks[taskId] = { done, progress, focusMs, subDone, target, unit }
  // `progress` is the amount added on that day. For a one-off task the total is the sum
  // over all days; for a routine each day stands alone.
  const dayOf = (state, key) => (state.days && state.days[key]) || null;
  const rec = (state, key, id) => {
    const day = dayOf(state, key);
    return (day && day.tasks && day.tasks[id]) || null;
  };

  function ensureRec(state, key, task) {
    state.days ||= {};
    const day = (state.days[key] ||= { tasks: {}, freeFocusMs: 0, alerted: {} });
    day.tasks ||= {};
    const r = (day.tasks[task.id] ||= { done: false, progress: 0, focusMs: 0, subDone: {} });
    // Snapshot what the goal looked like that day, so later edits do not rewrite history.
    r.target = task.target ?? null;
    r.unit = task.unit || '';
    r.title = task.title;
    return r;
  }

  const recordKeys = (state) => Object.keys(state.days || {}).sort();

  // ---------- tasks ----------

  const isRoutine = (task) => task.kind === 'routine';
  const archivedFrom = (task) => (task.archivedAt ? dateKey(new Date(task.archivedAt)) : null);

  function occursOn(task, key, today) {
    const archived = archivedFrom(task);
    if (archived && key >= archived) return false;
    if (isRoutine(task)) {
      if (task.startDate && key < task.startDate) return false;
      const days = task.repeatDays && task.repeatDays.length ? task.repeatDays : [0, 1, 2, 3, 4, 5, 6];
      return days.includes(weekday(key));
    }
    if (task.done) return key === (task.doneDate || task.date);
    // Unfinished one-off work rolls forward onto today until it is done.
    return key === task.date || (key === today && task.date < today);
  }

  function taskProgress(state, task, key) {
    if (isRoutine(task)) return (rec(state, key, task.id) || {}).progress || 0;
    let sum = 0;
    for (const k of recordKeys(state)) sum += (rec(state, k, task.id) || {}).progress || 0;
    return sum;
  }

  const taskDone = (state, task, key) =>
    isRoutine(task) ? !!(rec(state, key, task.id) || {}).done : !!task.done;

  function subDone(state, task, sub, key) {
    if (!isRoutine(task)) return !!sub.done;
    const r = rec(state, key, task.id);
    return !!(r && r.subDone && r.subDone[sub.id]);
  }

  function taskPercent(state, task, key) {
    if (taskDone(state, task, key)) return 1;
    if (task.target > 0) return Math.min(1, taskProgress(state, task, key) / task.target);
    const subs = task.subtasks || [];
    if (subs.length) return subs.filter((s) => subDone(state, task, s, key)).length / subs.length;
    return 0;
  }

  function taskFocusMs(state, task, key) {
    if (key) return (rec(state, key, task.id) || {}).focusMs || 0;
    let sum = task.legacyFocusMs || 0;
    for (const k of recordKeys(state)) sum += (rec(state, k, task.id) || {}).focusMs || 0;
    return sum;
  }

  const timeOf = (task) => task.scheduledTime || null;

  function dayItems(state, key, today) {
    return state.tasks
      .filter((t) => occursOn(t, key, today))
      .sort((a, b) => {
        const ta = timeOf(a), tb = timeOf(b);
        if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
        if (ta && !tb) return -1;
        if (!ta && tb) return 1;
        return (a.order || 0) - (b.order || 0);
      });
  }

  // ---------- goals ----------

  function canParent(parent, child) {
    if (!parent || parent.id === child.id || parent.archivedAt) return false;
    if (PERIOD_RANK[parent.period] >= PERIOD_RANK[child.period]) return false;
    const range = periodRange(parent.period, parent.start);
    return inRange(child.start, range);
  }

  function goalChildren(state, goal) {
    return {
      goals: state.goals.filter((g) => g.parentId === goal.id && !g.archivedAt),
      tasks: state.tasks.filter((t) => t.goalId === goal.id),
    };
  }

  // Scheduled days of a routine inside a range (inclusive).
  function routineDays(task, [a, b]) {
    const out = [];
    for (let k = a; k <= b; k = addDays(k, 1)) if (occursOn(task, k, '9999-12-31')) out.push(k);
    return out;
  }

  // A task's contribution to a goal whose period is `range`.
  function taskContribution(state, task, range) {
    const unit = task.target > 0 ? (task.unit || '') : '';
    if (isRoutine(task)) {
      const days = routineDays(task, range);
      const amount = days.reduce((s, k) => s + ((rec(state, k, task.id) || {}).progress || 0), 0);
      if (!days.length) return { amount, unit, percent: 0 };
      const percent = task.target > 0
        ? Math.min(1, amount / (task.target * days.length))
        : days.filter((k) => taskDone(state, task, k)).length / days.length;
      return { amount, unit, percent };
    }
    const amount = taskProgress(state, task, null);
    return { amount, unit, percent: taskPercent(state, task, null) };
  }

  function goalProgress(state, goal, seen = new Set()) {
    const target = goal.target > 0 ? goal.target : null;
    const unit = target ? (goal.unit || '') : '';
    if (seen.has(goal.id)) return { mode: 'manual', amount: 0, target, unit, percent: 0 };
    seen.add(goal.id);

    const range = periodRange(goal.period, goal.start);
    const kids = goalChildren(state, goal);
    const parts = [
      ...kids.goals.map((g) => goalProgress(state, g, seen)),
      ...kids.tasks.map((t) => taskContribution(state, t, range)),
    ];

    if (!parts.length) {
      const amount = goal.progress || 0;
      const percent = goal.done ? 1 : target ? Math.min(1, amount / target) : 0;
      return { mode: 'manual', amount, target, unit, percent };
    }
    if (target && parts.every((p) => p.unit === unit && p.unit !== '')) {
      const amount = parts.reduce((s, p) => s + p.amount, 0);
      return { mode: 'sum', amount, target, unit, percent: Math.min(1, amount / target) };
    }
    const percent = parts.reduce((s, p) => s + p.percent, 0) / parts.length;
    return { mode: 'ratio', amount: null, target, unit, percent };
  }

  // ---------- time ----------

  function workMs(state, key) {
    const day = dayOf(state, key);
    if (!day) return 0;
    let sum = day.freeFocusMs || 0;
    for (const r of Object.values(day.tasks || {})) sum += r.focusMs || 0;
    return sum;
  }

  const sessionsOn = (state, key) => (state.sessions || []).filter((s) => s.date === key);

  // Live view of the focus timer at `now`.
  function timerView(timer, now) {
    if (!timer || timer.status === 'idle') {
      return { elapsed: 0, remaining: timer ? timer.plannedMs : 0, over: 0, live: 0 };
    }
    const elapsed = timer.accMs + (timer.status === 'running' ? now - timer.runStart : 0);
    const remaining = timer.plannedMs - elapsed;
    return {
      elapsed,
      remaining: Math.max(0, remaining),
      over: Math.max(0, -remaining),
      // Focus not yet credited to the day records.
      live: timer.status === 'running' ? Math.max(0, now - timer.checkpoint) : 0,
    };
  }

  // ---------- quick add ----------

  // "영단어 외우기 /50개 @14:30" → title, target 50 개, scheduled 14:30.
  function parseQuick(text) {
    let rest = ` ${String(text || '')} `;
    const out = { title: '', target: null, unit: '', scheduledTime: null, invalidTime: null };
    // A time that cannot be read (@25:00) stays in the title so nothing typed is lost.
    rest = rest.replace(/\s@(\d{1,2}):?(\d{2})(?=\s)/, (match, h, m) => {
      if (Number(h) < 24 && Number(m) < 60) { out.scheduledTime = `${pad(Number(h))}:${m}`; return ' '; }
      out.invalidTime = match.trim();
      return match;
    });
    rest = rest.replace(/\s\/(\d+(?:\.\d+)?)\s*([^\s\d@/][^\s@/]*)?(?=\s)/, (_, n, u) => {
      out.target = Number(n);
      out.unit = u || '';
      return ' ';
    });
    out.title = rest.replace(/\s+/g, ' ').trim();
    return out;
  }

  // ---------- formatting ----------

  function fmtClock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function fmtDuration(ms) {
    const min = Math.floor(ms / 60000);
    if (min < 1) return ms > 0 ? '1분 미만' : '0분';
    const h = Math.floor(min / 60);
    return h > 0 ? `${h}시간 ${min % 60}분` : `${min}분`;
  }

  const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

  return {
    DAY_MS, PERIODS, PERIOD_RANK, WEEKDAYS,
    dateKey, parseKey, addDays, weekday, daysBetween,
    periodStart, periodRange, shiftPeriod, periodLabel, inRange,
    rec, ensureRec, recordKeys, dayOf,
    isRoutine, occursOn, taskProgress, taskDone, subDone, taskPercent, taskFocusMs, dayItems,
    canParent, goalChildren, goalProgress, taskContribution, routineDays,
    workMs, sessionsOn, timerView, parseQuick,
    fmtClock, fmtDuration, fmtNum, pad,
  };
});
