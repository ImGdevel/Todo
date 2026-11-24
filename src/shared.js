// Helpers shared by the settings window and the overlay.
(() => {
  const svg = (d, extra = '') =>
    `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

  window.ICONS = {
    play: svg('<path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke-width="1"/>'),
    pause: svg('<path d="M5.5 3.5v9M10.5 3.5v9" stroke-width="2"/>'),
    reset: svg('<path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3 2.8v2.6h2.6"/>'),
    gear: svg('<circle cx="8" cy="8" r="2.1"/><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2"/>'),
    check: svg('<path d="M3.5 8.4l3 3 6-6.6" stroke-width="2"/>'),
    trash: svg('<path d="M3 4.5h10M6.2 4.5V3h3.6v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>'),
    grip: svg('<path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" stroke-width="2.2"/>'),
    lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
    close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  };

  window.fmtClock = (ms) => {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };

  window.fmtSpent = (ms) => {
    const min = Math.floor(ms / 60000);
    if (min < 1) return '';
    const h = Math.floor(min / 60);
    return h > 0 ? `${h}시간 ${min % 60}분` : `${min}분`;
  };

  // Main sends its clock with each snapshot; all timer math below uses the local clock,
  // which is the same machine, so no offset correction is needed.
  window.timerView = (state) => {
    const t = state.timer;
    const now = Date.now();
    const remaining = t.status === 'running' ? Math.max(0, t.endAt - now) : t.remainingMs;
    const live = t.status === 'running' && t.mode === 'focus' && t.segmentStart
      ? Math.max(0, Math.min(now, t.endAt) - t.segmentStart) : 0;
    return {
      remaining,
      progress: t.durationMs > 0 ? 1 - remaining / t.durationMs : 0,
      liveSpent: live, // focus time not yet credited to the linked todo
      todo: state.todos.find((x) => x.id === t.todoId) || null,
    };
  };
})();
