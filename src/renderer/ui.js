// Small helpers shared by every window. Loaded after shared/model.js.
(() => {
  const svg = (d, extra = '') =>
    `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;

  const ICONS = {
    play: svg('<path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke-width="1"/>'),
    pause: svg('<path d="M5.5 3.5v9M10.5 3.5v9" stroke-width="2"/>'),
    stop: svg('<rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke-width="1"/>'),
    gear: svg('<circle cx="8" cy="8" r="2.1"/><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2"/>'),
    check: svg('<path d="M3.5 8.4l3 3 6-6.6" stroke-width="2"/>'),
    trash: svg('<path d="M3 4.5h10M6.2 4.5V3h3.6v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>'),
    edit: svg('<path d="M10.5 2.8l2.7 2.7L6 12.7l-3.3.6.6-3.3z"/>'),
    plus: svg('<path d="M8 3v10M3 8h10"/>'),
    minus: svg('<path d="M3 8h10"/>'),
    left: svg('<path d="M10 3.5L5.5 8 10 12.5"/>'),
    right: svg('<path d="M6 3.5L10.5 8 6 12.5"/>'),
    repeat: svg('<path d="M3 7V6a2 2 0 0 1 2-2h7.5M10.5 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H3.5M5.5 14l-2-2 2-2"/>'),
    clock: svg('<circle cx="8" cy="8" r="5.8"/><path d="M8 4.8V8l2.2 1.4"/>'),
    flag: svg('<path d="M3.5 14V2.5M3.5 3h8l-1.6 2.6L11.5 8h-8"/>'),
    lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
    pointer: svg('<path d="M4 2.5l8 5-3.6.9 2 3.8-1.6.8-2-3.8L4 11.5z"/>'),
    close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
    bell: svg('<path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3zM6.5 14h3"/>'),
    folder: svg('<path d="M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3a1 1 0 0 0-1 1z"/>'),
    chart: svg('<path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5"/>'),
    grip: svg('<path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" stroke-width="2.2"/>'),
  };

  // h('div.cls', { onclick, title, ... }, child, 'text', [children]) — no innerHTML for data.
  function h(spec, attrs, ...children) {
    const [tagId, ...classes] = spec.split('.');
    const [tag, id] = tagId.split('#');
    const el = document.createElement(tag || 'div');
    if (id) el.id = id;
    if (classes.length) el.className = classes.join(' ');
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
      children.unshift(attrs);
      attrs = null;
    }
    let value;
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'value') { value = v; continue; } // set after children so <select> can pick an option
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'className') el.className = v;
      else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
      else if (k === 'icon') el.insertAdjacentHTML('afterbegin', ICONS[v] || ''); // static markup only
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    if (value !== undefined && value !== null) el.value = String(value);
    return el;
  }

  const iconBtn = (icon, title, onclick, cls = '') =>
    h(`button.icon-btn${cls ? '.' + cls : ''}`, { type: 'button', title, 'aria-label': title, icon, onclick });

  function chime(kind) {
    try {
      const ctx = new AudioContext();
      const at = ctx.currentTime;
      const notes = kind === 'schedule' ? [[660, 0], [880, 0.16]] : [[784, 0], [988, 0.18], [1175, 0.36]];
      for (const [freq, delay] of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, at + delay);
        gain.gain.exponentialRampToValueAtTime(0.22, at + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + delay + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at + delay);
        osc.stop(at + delay + 0.55);
      }
      setTimeout(() => ctx.close(), 1500);
    } catch { /* no audio device */ }
  }

  // "3 / 10쪽", "3쪽", or "" when the task tracks no quantity.
  function progressText(state, task, key) {
    if (!(task.target > 0) && !task.unit) return '';
    const cur = Model.fmtNum(Model.taskProgress(state, task, key));
    return task.target > 0 ? `${cur} / ${Model.fmtNum(task.target)}${task.unit}` : `${cur}${task.unit}`;
  }

  const repeatText = (task) => {
    const d = task.repeatDays || [];
    if (!d.length || d.length === 7) return '매일';
    if (d.join() === '1,2,3,4,5') return '평일';
    if (d.join() === '0,6') return '주말';
    return d.map((i) => Model.WEEKDAYS[i]).join('·');
  };

  window.UI = { ICONS, h, iconBtn, chime, progressText, repeatText };
})();
