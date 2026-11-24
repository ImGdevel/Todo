const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, Notification,
} = require('electron');
const path = require('path');
const fs = require('fs');

// Smoke mode: isolated profile, sample data, screenshots of both windows, then quit.
const SMOKE_DIR = process.env.CORNER_TODO_SMOKE || null;
if (SMOKE_DIR) app.setPath('userData', path.join(SMOKE_DIR, 'profile'));

// The overlay never receives a user gesture (it is not focusable) but must play the finish chime.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const SHORTCUTS = {
  toggleOverlay: 'CommandOrControl+Shift+O',
  toggleClickThrough: 'CommandOrControl+Shift+L',
  toggleTimer: 'CommandOrControl+Shift+P',
};

const DEFAULT_SETTINGS = {
  overlayVisible: true,
  corner: 'top-right', // top-left | top-right | bottom-left | bottom-right
  displayId: null, // null = primary display
  marginX: 16,
  marginY: 16,
  width: 280,
  opacity: 0.88, // background only; text stays fully opaque
  fontScale: 1,
  theme: 'dark',
  clickThrough: false,
  showTimer: true,
  showCompleted: true,
  maxItems: 8,
  focusMin: 25,
  breakMin: 5,
  autoBreak: true,
  sound: true,
  launchAtLogin: false,
};

const LIMITS = {
  marginX: [0, 400], marginY: [0, 400], width: [200, 520], opacity: [0.15, 1],
  fontScale: [0.8, 1.5], maxItems: [1, 30], focusMin: [1, 180], breakMin: [1, 90],
};

let state = { todos: [], settings: { ...DEFAULT_SETTINGS }, timer: null };
let settingsWin = null;
let overlayWin = null;
let tray = null;
let overlayHeight = 160;
let quitting = false;
let saveTimer = null;

// ---------- persistence ----------

const stateFile = () => path.join(app.getPath('userData'), 'state.json');

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (Array.isArray(raw.todos)) {
      state.todos = raw.todos
        .filter((t) => t && typeof t.text === 'string')
        .map((t) => ({
          id: String(t.id || newId()),
          text: t.text,
          done: !!t.done,
          spentMs: Number(t.spentMs) || 0,
        }));
    }
    state.settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...(raw.settings || {}) });
  } catch {
    if (SMOKE_DIR) {
      state.todos = [
        { id: 'a', text: '분기 보고서 초안 작성', done: false, spentMs: 42 * 60000 },
        { id: 'b', text: '디자인 리뷰 피드백 반영', done: false, spentMs: 0 },
        { id: 'c', text: '주간 회의 안건 정리', done: true, spentMs: 15 * 60000 },
        { id: 'd', text: '운동 30분', done: false, spentMs: 0 },
      ];
    }
  }
  // A running timer is never restored: the app was closed, so the session ended.
  state.timer = idleTimer('focus', null);
  if (SMOKE_DIR) {
    state.timer.todoId = 'a';
    startTimer();
  }
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

function saveNow() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    const tmp = stateFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ todos: state.todos, settings: state.settings }, null, 2));
    fs.renameSync(tmp, stateFile());
  } catch (err) {
    console.error('state save failed:', err.message);
  }
}

function sanitizeSettings(s) {
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const def = DEFAULT_SETTINGS[key];
    let v = s[key];
    if (key === 'displayId') {
      out[key] = Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null;
    } else if (typeof def === 'boolean') {
      out[key] = typeof v === 'boolean' ? v : def;
    } else if (typeof def === 'number') {
      v = Number(v);
      if (!Number.isFinite(v)) v = def;
      const [lo, hi] = LIMITS[key] || [-Infinity, Infinity];
      out[key] = Math.min(hi, Math.max(lo, v));
    } else if (key === 'corner') {
      out[key] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(v) ? v : def;
    } else if (key === 'theme') {
      out[key] = v === 'light' ? 'light' : 'dark';
    }
  }
  return out;
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- timer (main process is the single source of truth) ----------

function modeMs(mode) {
  return (mode === 'focus' ? state.settings.focusMin : state.settings.breakMin) * 60000;
}

function idleTimer(mode, todoId) {
  const d = modeMs(mode);
  return { mode, status: 'idle', durationMs: d, remainingMs: d, endAt: null, segmentStart: null, todoId: todoId || null };
}

// Credit focus time since the last checkpoint to the linked todo.
function accrue(now = Date.now()) {
  const t = state.timer;
  if (t.status === 'running' && t.mode === 'focus' && t.todoId && t.segmentStart) {
    const todo = state.todos.find((x) => x.id === t.todoId);
    if (todo) todo.spentMs += Math.max(0, Math.min(now, t.endAt) - t.segmentStart);
  }
  t.segmentStart = now;
}

function startTimer(todoId) {
  const now = Date.now();
  if (todoId !== undefined) {
    if (state.timer.mode !== 'focus') {
      state.timer = idleTimer('focus', todoId);
    } else {
      accrue(now);
      state.timer.todoId = todoId;
    }
  }
  const t = state.timer;
  if (t.status === 'running') return;
  if (t.remainingMs <= 0) Object.assign(t, idleTimer(t.mode, t.todoId));
  t.status = 'running';
  t.endAt = now + t.remainingMs;
  t.segmentStart = now;
}

function pauseTimer() {
  const t = state.timer;
  if (t.status !== 'running') return;
  const now = Date.now();
  accrue(now);
  t.remainingMs = Math.max(0, t.endAt - now);
  t.status = 'paused';
  t.endAt = null;
  t.segmentStart = null;
}

function resetTimer(mode = state.timer.mode) {
  accrue();
  state.timer = idleTimer(mode, state.timer.todoId);
}

function finishTimer() {
  const t = state.timer;
  accrue(t.endAt);
  const finished = t.mode;
  const todo = state.todos.find((x) => x.id === t.todoId);
  state.timer = idleTimer(finished === 'focus' ? 'break' : 'focus', t.todoId);
  if (finished === 'focus' && state.settings.autoBreak) startTimer();

  if (Notification.isSupported()) {
    new Notification({
      title: finished === 'focus' ? '집중 시간 종료' : '휴식 종료',
      body: finished === 'focus'
        ? (todo ? `"${todo.text}" — 잠깐 쉬어 가세요.` : '잠깐 쉬어 가세요.')
        : '다시 집중할 시간입니다.',
      silent: true,
    }).show();
  }
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send('timer:finished', { mode: finished, sound: state.settings.sound });
  }
  commit();
}

setInterval(() => {
  const t = state.timer;
  if (t && t.status === 'running' && Date.now() >= t.endAt) finishTimer();
}, 250);

// ---------- actions ----------

function dispatch({ type, payload = {} }) {
  switch (type) {
    case 'todo/add': {
      const text = String(payload.text || '').trim();
      if (text) state.todos.push({ id: newId(), text: text.slice(0, 300), done: false, spentMs: 0 });
      break;
    }
    case 'todo/toggle': {
      const todo = state.todos.find((t) => t.id === payload.id);
      if (!todo) break;
      todo.done = !todo.done;
      // Finishing the task you are timing ends that focus session's link, not the timer.
      if (todo.done && state.timer.todoId === todo.id) {
        accrue();
        state.timer.todoId = null;
      }
      break;
    }
    case 'todo/edit': {
      const todo = state.todos.find((t) => t.id === payload.id);
      const text = String(payload.text || '').trim();
      if (todo && text) todo.text = text.slice(0, 300);
      break;
    }
    case 'todo/remove': {
      if (state.timer.todoId === payload.id) state.timer.todoId = null;
      state.todos = state.todos.filter((t) => t.id !== payload.id);
      break;
    }
    case 'todo/move': {
      const from = state.todos.findIndex((t) => t.id === payload.id);
      const to = state.todos.findIndex((t) => t.id === payload.toId);
      if (from < 0 || to < 0 || from === to) break;
      const [item] = state.todos.splice(from, 1);
      state.todos.splice(to, 0, item);
      break;
    }
    case 'todo/clearDone':
      state.todos = state.todos.filter((t) => !t.done);
      break;
    case 'settings/set': {
      state.settings = sanitizeSettings({ ...state.settings, ...payload });
      if (state.timer.status === 'idle') state.timer = idleTimer(state.timer.mode, state.timer.todoId);
      break;
    }
    case 'timer/start':
      startTimer('todoId' in payload ? payload.todoId : undefined);
      break;
    case 'timer/pause':
      pauseTimer();
      break;
    case 'timer/toggle':
      if (state.timer.status === 'running') pauseTimer(); else startTimer();
      break;
    case 'timer/reset':
      resetTimer();
      break;
    case 'timer/mode':
      resetTimer(payload.mode === 'break' ? 'break' : 'focus');
      break;
    case 'timer/unlink':
      accrue();
      state.timer.todoId = null;
      break;
    case 'ui/openSettings':
      showSettings();
      return;
    default:
      return;
  }
  commit();
}

function snapshot() {
  const primary = screen.getPrimaryDisplay().id;
  return {
    todos: state.todos,
    settings: state.settings,
    timer: state.timer,
    now: Date.now(),
    platform: process.platform,
    shortcuts: SHORTCUTS,
    displays: screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: `디스플레이 ${i + 1} (${d.size.width}×${d.size.height})${d.id === primary ? ' · 주 모니터' : ''}`,
    })),
  };
}

function commit() {
  applyOverlay();
  const snap = snapshot();
  for (const win of [settingsWin, overlayWin]) {
    if (win && !win.isDestroyed()) win.webContents.send('state', snap);
  }
  buildTrayMenu();
  saveSoon();
}

// ---------- windows ----------

function targetDisplay() {
  return screen.getAllDisplays().find((d) => d.id === state.settings.displayId) || screen.getPrimaryDisplay();
}

function layoutOverlay() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const s = state.settings;
  const wa = targetDisplay().workArea;
  const width = Math.round(Math.min(s.width, wa.width - 2 * s.marginX));
  const height = Math.round(Math.max(36, Math.min(overlayHeight, wa.height - 2 * s.marginY)));
  const x = s.corner.endsWith('left') ? wa.x + s.marginX : wa.x + wa.width - width - s.marginX;
  const y = s.corner.startsWith('top') ? wa.y + s.marginY : wa.y + wa.height - height - s.marginY;
  overlayWin.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
}

function applyOverlay() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const s = state.settings;
  overlayWin.setIgnoreMouseEvents(s.clickThrough, { forward: true });
  layoutOverlay();
  if (s.overlayVisible && !overlayWin.isVisible()) {
    overlayWin.showInactive();
    pinOnTop();
  } else if (!s.overlayVisible && overlayWin.isVisible()) {
    overlayWin.hide();
  }
  if (app.isPackaged) {
    const current = app.getLoginItemSettings().openAtLogin;
    if (current !== s.launchAtLogin) app.setLoginItemSettings({ openAtLogin: s.launchAtLogin });
  }
}

function pinOnTop() {
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') {
    overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
}

function createOverlay() {
  overlayWin = new BrowserWindow({
    width: state.settings.width,
    height: overlayHeight,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // On Windows a non-focusable window silently drops real mouse clicks, so it must be
    // focusable there. macOS delivers clicks to non-focusable panels and keeps your app focused.
    focusable: process.platform === 'darwin' ? false : true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  overlayWin.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWin.webContents.once('did-finish-load', () => applyOverlay());
  // Taking focus can drop a window out of the top-most band on Windows; re-pin it.
  overlayWin.on('focus', pinOnTop);
  overlayWin.on('blur', pinOnTop);
  overlayWin.on('closed', () => { overlayWin = null; });
}

function createSettings() {
  settingsWin = new BrowserWindow({
    width: 940,
    height: 700,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'Corner Todo',
    icon: makeIcon(64),
    autoHideMenuBar: true,
    backgroundColor: '#15181a',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  // Closing the settings window keeps the overlay alive; quit from the tray.
  settingsWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      settingsWin.hide();
    }
  });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function showSettings() {
  if (!settingsWin || settingsWin.isDestroyed()) createSettings();
  else {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
  }
}

// ---------- tray ----------

// Icon is drawn at runtime so the project needs no binary assets.
function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const k = size / 32;
  const r = 8 * k;
  const segs = [[9, 16.5, 14, 21.5], [14, 21.5, 23.5, 11]].map((s) => s.map((v) => v * k));
  const distSeg = (px, py, [x1, y1, x2, y2]) => {
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      const cx = Math.max(r, Math.min(size - r, px)), cy = Math.max(r, Math.min(size - r, py));
      const a = Math.max(0, Math.min(1, r - Math.hypot(px - cx, py - cy) + 0.5));
      const m = Math.max(0, Math.min(1, 2 * k - Math.min(distSeg(px, py, segs[0]), distSeg(px, py, segs[1])) + 0.5));
      const i = (y * size + x) * 4;
      // BGRA, premultiplied. Base #1fa971, check white.
      buf[i] = Math.round((0x71 + (255 - 0x71) * m) * a);
      buf[i + 1] = Math.round((0xa9 + (255 - 0xa9) * m) * a);
      buf[i + 2] = Math.round((0x1f + (255 - 0x1f) * m) * a);
      buf[i + 3] = Math.round(255 * a);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: size / 16 >= 2 ? 2 : 1 });
}

function buildTrayMenu() {
  if (!tray) return;
  const s = state.settings;
  const set = (patch) => dispatch({ type: 'settings/set', payload: patch });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '설정 열기', click: showSettings },
    { type: 'separator' },
    { label: '오버레이 표시', type: 'checkbox', checked: s.overlayVisible, accelerator: SHORTCUTS.toggleOverlay, click: () => set({ overlayVisible: !s.overlayVisible }) },
    { label: '클릭 통과 (잠금)', type: 'checkbox', checked: s.clickThrough, accelerator: SHORTCUTS.toggleClickThrough, click: () => set({ clickThrough: !s.clickThrough }) },
    { label: state.timer.status === 'running' ? '타이머 일시정지' : '타이머 시작', accelerator: SHORTCUTS.toggleTimer, click: () => dispatch({ type: 'timer/toggle' }) },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---------- app lifecycle ----------

if (!SMOKE_DIR && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showSettings);

  app.whenReady().then(() => {
    loadState();

    ipcMain.handle('state:get', () => snapshot());
    ipcMain.on('dispatch', (_e, action) => {
      if (action && typeof action.type === 'string') dispatch(action);
    });
    ipcMain.on('overlay:height', (_e, h) => {
      const next = Math.ceil(Number(h));
      if (!Number.isFinite(next) || next === overlayHeight) return;
      overlayHeight = next;
      layoutOverlay();
    });

    createOverlay();
    createSettings();

    tray = new Tray(makeIcon(32));
    tray.setToolTip('Corner Todo');
    tray.on('click', showSettings);
    buildTrayMenu();

    const toggle = (key) => () => dispatch({ type: 'settings/set', payload: { [key]: !state.settings[key] } });
    globalShortcut.register(SHORTCUTS.toggleOverlay, toggle('overlayVisible'));
    globalShortcut.register(SHORTCUTS.toggleClickThrough, toggle('clickThrough'));
    globalShortcut.register(SHORTCUTS.toggleTimer, () => dispatch({ type: 'timer/toggle' }));

    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(ev, () => commit());
    }

    if (SMOKE_DIR) runSmoke();
  });

  app.on('activate', showSettings);
  app.on('window-all-closed', () => { /* stay alive in the tray */ });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    accrue();
    saveNow();
  });
}

async function runSmoke() {
  const loaded = (win) => new Promise((res) => {
    if (!win.webContents.isLoading()) res(); else win.webContents.once('did-finish-load', res);
  });
  await Promise.all([loaded(overlayWin), loaded(settingsWin)]);
  await new Promise((res) => setTimeout(res, 1500));
  if (process.env.CORNER_TODO_CLICKTEST) {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const log = async (label) => {
      const s = await settingsWin.webContents.executeJavaScript('document.querySelector("#clock").textContent');
      const o = await overlayWin.webContents.executeJavaScript('document.querySelector("#time").textContent');
      console.log('CLICKTEST', label, JSON.stringify({ status: state.timer.status, mode: state.timer.mode, settingsClock: s, overlayClock: o }));
    };
    dispatch({ type: 'timer/reset' });
    dispatch({ type: 'timer/pause' });
    await wait(300); await log('initial');
    await settingsWin.webContents.executeJavaScript('document.querySelector("#play").click()');
    await wait(2200); await log('after settings play +2.2s');
    await settingsWin.webContents.executeJavaScript('document.querySelector("#play").click()');
    await wait(300); await log('after settings pause');
    await overlayWin.webContents.executeJavaScript('document.querySelector("#play").click()');
    await wait(2200); await log('after overlay play +2.2s');
    await settingsWin.webContents.executeJavaScript('document.querySelector(".item .go").click()');
    await wait(2200); await log('after row play +2.2s');
    dispatch({ type: 'timer/start' });
    state.timer.endAt = Date.now() + 500; // force the focus session to end
    await wait(1500); await log('after focus finished');
    state.timer.endAt = Date.now() + 500; // force the break to end
    await wait(1500); await log('after break finished');
    quitting = true; app.quit(); return;
  }
  const corner = state.settings.corner;
  console.log('SMOKE overlay bounds', JSON.stringify(overlayWin.getBounds()), 'workArea', JSON.stringify(targetDisplay().workArea), corner);
  fs.writeFileSync(path.join(SMOKE_DIR, 'overlay.png'), (await overlayWin.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(SMOKE_DIR, 'settings.png'), (await settingsWin.webContents.capturePage()).toPNG());
  dispatch({ type: 'settings/set', payload: { corner: 'bottom-left', clickThrough: true, theme: 'light', opacity: 0.6 } });
  dispatch({ type: 'timer/pause' });
  await new Promise((res) => setTimeout(res, 700));
  console.log('SMOKE overlay bounds 2', JSON.stringify(overlayWin.getBounds()));
  fs.writeFileSync(path.join(SMOKE_DIR, 'overlay-locked.png'), (await overlayWin.webContents.capturePage()).toPNG());
  quitting = true;
  app.quit();
}
