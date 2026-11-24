const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, Notification, shell,
} = require('electron');
const path = require('path');
const M = require('../shared/model');
const store = require('./store');
const timer = require('./timer');
const logger = require('./logger');
const winfocus = require('./winfocus');

const SMOKE_DIR = process.env.CORNER_TODO_SMOKE || null;
if (SMOKE_DIR) app.setPath('userData', path.join(SMOKE_DIR, 'profile'));

// Windows shows this id's app name on notifications instead of "Electron".
if (process.platform === 'win32') app.setAppUserModelId('app.cornertodo.desktop');

// The overlay plays chimes without ever receiving a user gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const IS_MAC = process.platform === 'darwin';
const RENDERER = path.join(__dirname, '..', 'renderer');
const OVERLAY_DEFAULT = { width: 300, height: 400 };
const OVERLAY_MIN = { width: 240, height: 140 };

const SHORTCUTS = [
  { id: 'quickAdd', label: '빠른 할 일 추가', accel: 'CommandOrControl+Shift+Space' },
  { id: 'toggleOverlay', label: '오버레이 표시 / 숨김', accel: 'CommandOrControl+Shift+O' },
  { id: 'toggleClickThrough', label: '조작 모드 / 클릭 통과 전환', accel: 'CommandOrControl+Shift+L' },
  { id: 'toggleTimer', label: '타이머 시작 / 일시정지', accel: 'CommandOrControl+Shift+P' },
];
const shortcutOk = {};

let mainWin = null;
let overlayWin = null;
let quickWin = null;
let tray = null;
let quitting = false;
let currentDay = M.dateKey();
let boundsTimer = null;
let keyboardBorrowed = false;

// ---------- state broadcast ----------

function snapshot() {
  const primary = screen.getPrimaryDisplay().id;
  return {
    ...store.state,
    timer: timer.timer,
    alerts: timer.alerts,
    now: Date.now(),
    today: M.dateKey(),
    platform: process.platform,
    shortcuts: SHORTCUTS.map((s) => ({ ...s, ok: shortcutOk[s.id] !== false })),
    displays: screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: `디스플레이 ${i + 1} (${d.size.width}×${d.size.height})${d.id === primary ? ' · 주 모니터' : ''}`,
    })),
    overlayDisplayId: overlayWin && !overlayWin.isDestroyed() ? screen.getDisplayMatching(overlayWin.getBounds()).id : null,
    logDir: logger.logDir(),
    isPackaged: app.isPackaged,
  };
}

function commit() {
  applyOverlaySettings();
  const snap = snapshot();
  for (const win of [mainWin, overlayWin, quickWin]) {
    if (win && !win.isDestroyed()) win.webContents.send('state', snap);
  }
  buildTrayMenu();
  store.saveSoon();
}

function dispatch({ type, payload = {} }) {
  if (typeof type !== 'string') return;
  if (type.startsWith('timer/') || type.startsWith('alert/')) {
    if (timer.apply(type, payload)) commit();
    return;
  }
  switch (type) {
    case 'ui/openMain': showMain(payload.tab); return;
    case 'ui/openQuick': showQuick(); return;
    case 'ui/closeQuick': if (quickWin && !quickWin.isDestroyed()) quickWin.hide(); return;
    case 'ui/openLogs': shell.openPath(logger.logDir()); return;
    case 'overlay/snap': snapOverlay(payload.corner); commit(); return;
    case 'overlay/toDisplay': moveOverlayToDisplay(Number(payload.id)); commit(); return;
    case 'overlay/reset': store.apply('settings/set', { overlayBounds: null }); placeOverlay(); commit(); return;
    default:
      if (type === 'task/archive' && timer.timer.taskId === payload.id) timer.stop();
      if (store.apply(type, payload)) commit();
  }
}

// ---------- overlay geometry ----------

function workAreaFor(bounds) {
  return screen.getDisplayMatching(bounds).workArea;
}

function cornerBounds(display, corner = 'top-right', size = OVERLAY_DEFAULT) {
  const wa = display.workArea;
  const m = 16;
  const width = Math.min(size.width, wa.width - 2 * m);
  const height = Math.min(size.height, wa.height - 2 * m);
  return {
    x: corner.endsWith('left') ? wa.x + m : wa.x + wa.width - width - m,
    y: corner.startsWith('top') ? wa.y + m : wa.y + wa.height - height - m,
    width, height,
  };
}

function visibleEnough(b) {
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    const w = Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x);
    const h = Math.min(b.y + b.height, wa.y + wa.height) - Math.max(b.y, wa.y);
    return w >= 80 && h >= 40;
  });
}

function placeOverlay() {
  if (!overlayWin) return;
  const saved = store.state.settings.overlayBounds;
  if (saved && visibleEnough(saved)) {
    overlayWin.setBounds(saved);
  } else {
    const display = screen.getAllDisplays().find((d) => d.id === store.state.settings.displayId) || screen.getPrimaryDisplay();
    overlayWin.setBounds(cornerBounds(display));
  }
}

function snapOverlay(corner) {
  if (!overlayWin) return;
  const b = overlayWin.getBounds();
  overlayWin.setBounds(cornerBounds(screen.getDisplayMatching(b), corner, b));
  saveOverlayBounds();
}

function moveOverlayToDisplay(id) {
  const display = screen.getAllDisplays().find((d) => d.id === id);
  if (!display || !overlayWin) return;
  overlayWin.setBounds(cornerBounds(display, 'top-right', overlayWin.getBounds()));
  store.apply('settings/set', { displayId: id });
  saveOverlayBounds();
}

function saveOverlayBounds() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const b = overlayWin.getBounds();
  store.apply('settings/set', { overlayBounds: b, displayId: screen.getDisplayMatching(b).id });
  store.saveSoon();
}

function applyOverlaySettings() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const s = store.state.settings;
  overlayWin.setIgnoreMouseEvents(s.clickThrough, { forward: true });
  overlayWin.setMovable(!s.overlayLocked);
  if (s.overlayVisible && !overlayWin.isVisible()) {
    overlayWin.showInactive();
    pinOnTop();
  } else if (!s.overlayVisible && overlayWin.isVisible()) {
    overlayWin.hide();
  }
  if (app.isPackaged && app.getLoginItemSettings().openAtLogin !== s.launchAtLogin) {
    app.setLoginItemSettings({ openAtLogin: s.launchAtLogin });
  }
}

function pinOnTop() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  if (IS_MAC) overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

// ---------- windows ----------

const prefs = () => ({ preload: path.join(__dirname, 'preload.js') });

function createOverlay() {
  overlayWin = new BrowserWindow({
    ...OVERLAY_DEFAULT,
    minWidth: OVERLAY_MIN.width,
    minHeight: OVERLAY_MIN.height,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    // Transparent windows cannot be edge-resized reliably; the renderer has a resize grip.
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // macOS: non-focusable panels still get clicks. Windows: `focusable: false` makes clicks
    // vanish while another app is active, so the window stays focusable and winfocus hands
    // focus back to the user's app right after each click.
    focusable: !IS_MAC,
    webPreferences: { ...prefs(), backgroundThrottling: false },
  });
  placeOverlay();
  winfocus.track(overlayWin);
  overlayWin.loadFile(path.join(RENDERER, 'overlay.html'));
  overlayWin.webContents.once('did-finish-load', () => applyOverlaySettings());
  overlayWin.on('focus', pinOnTop);
  overlayWin.on('blur', pinOnTop);
  const later = () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(() => { saveOverlayBounds(); commit(); }, 400); };
  overlayWin.on('moved', later);
  overlayWin.on('resized', later);
  overlayWin.on('closed', () => { overlayWin = null; });
}

function createMain(tab) {
  mainWin = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Corner Todo',
    icon: makeIcon(64),
    autoHideMenuBar: true,
    backgroundColor: '#15181a',
    webPreferences: prefs(),
  });
  mainWin.loadFile(path.join(RENDERER, 'app.html'), tab ? { hash: tab } : undefined);
  mainWin.once('ready-to-show', () => { if (!SMOKE_DIR || process.env.CORNER_TODO_DEMO) mainWin.show(); });
  // Closing the main window keeps the app (and the overlay) alive in the tray.
  mainWin.on('close', (e) => {
    if (!quitting) { e.preventDefault(); mainWin.hide(); }
  });
  mainWin.on('closed', () => { mainWin = null; });
}

function showMain(tab) {
  if (!mainWin || mainWin.isDestroyed()) { createMain(tab); return; }
  if (tab) mainWin.webContents.send('nav', tab);
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function createQuick() {
  quickWin = new BrowserWindow({
    width: 560,
    height: 108,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: prefs(),
  });
  quickWin.loadFile(path.join(RENDERER, 'quick.html'));
  quickWin.on('blur', () => { if (quickWin && !quickWin.isDestroyed()) quickWin.hide(); });
  quickWin.on('closed', () => { quickWin = null; });
}

function showQuick() {
  if (!quickWin || quickWin.isDestroyed()) createQuick();
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [w, h] = quickWin.getSize();
  quickWin.setPosition(Math.round(wa.x + (wa.width - w) / 2), Math.round(wa.y + wa.height * 0.28));
  quickWin.setAlwaysOnTop(true, 'screen-saver');
  quickWin.show();
  quickWin.focus();
  quickWin.webContents.send('quick:open');
}

// ---------- tray ----------

// Drawn at runtime so the project ships no binary assets.
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
  const s = store.state.settings;
  const set = (patch) => dispatch({ type: 'settings/set', payload: patch });
  const accel = (id) => SHORTCUTS.find((x) => x.id === id).accel;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '메인 화면 열기', click: () => showMain() },
    { label: '빠른 할 일 추가', accelerator: accel('quickAdd'), click: showQuick },
    { type: 'separator' },
    { label: '오버레이 표시', type: 'checkbox', checked: s.overlayVisible, accelerator: accel('toggleOverlay'), click: () => set({ overlayVisible: !s.overlayVisible }) },
    { label: '클릭 통과', type: 'checkbox', checked: s.clickThrough, accelerator: accel('toggleClickThrough'), click: () => set({ clickThrough: !s.clickThrough }) },
    { label: '위치·크기 잠금', type: 'checkbox', checked: s.overlayLocked, click: () => set({ overlayLocked: !s.overlayLocked }) },
    { label: timer.timer.status === 'running' ? '타이머 일시정지' : '타이머 시작', accelerator: accel('toggleTimer'), click: () => dispatch({ type: 'timer/toggle' }) },
    { type: 'separator' },
    { label: '완전 종료', click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---------- notifications ----------

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

function chime(kind) {
  const s = store.state.settings;
  const enabled = kind === 'schedule' ? s.soundSchedule : s.soundTimer;
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('chime', { kind, sound: enabled });
}

timer.setHooks({
  onPlanReached(task) {
    notify('계획한 집중 시간 도달', `${task ? `"${task.title}" ` : ''}— 계속하면 초과 시간으로 기록됩니다. 끝나면 직접 체크하세요.`);
    chime('timer');
  },
  onScheduleDue(task, autoStarted) {
    notify(`${task.scheduledTime} 일정`, autoStarted ? `"${task.title}" — 집중 타이머를 시작했습니다.` : `"${task.title}" 할 시간입니다.`);
    chime('schedule');
  },
});

// ---------- lifecycle ----------

if (!SMOKE_DIR && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());

  app.whenReady().then(() => {
    const base = app.getPath('userData');
    winfocus.init();
    logger.init(base);
    store.load(base);
    timer.reset();
    if (SMOKE_DIR) require('../../tools/smoke').seed(store);
    if (store.summarizePending()) store.saveSoon();
    logger.log('app.start', { version: app.getVersion() });

    ipcMain.handle('state:get', () => snapshot());
    ipcMain.on('dispatch', (_e, action) => { if (action) dispatch(action); });
    ipcMain.on('overlay:resize', (_e, size) => {
      if (!overlayWin || overlayWin.isDestroyed() || store.state.settings.overlayLocked || !size) return;
      const b = overlayWin.getBounds();
      const wa = workAreaFor(b);
      const width = Math.round(Math.max(OVERLAY_MIN.width, Math.min(Number(size.width) || b.width, wa.x + wa.width - b.x)));
      const height = Math.round(Math.max(OVERLAY_MIN.height, Math.min(Number(size.height) || b.height, wa.y + wa.height - b.y)));
      overlayWin.setBounds({ ...b, width, height });
      if (size.done) { saveOverlayBounds(); commit(); }
    });
    ipcMain.on('overlay:move', (_e, pos) => {
      if (!overlayWin || overlayWin.isDestroyed() || store.state.settings.overlayLocked || !pos) return;
      const x = Math.round(Number(pos.x)), y = Math.round(Number(pos.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const b = overlayWin.getBounds();
      overlayWin.setBounds({ ...b, x, y });
      if (pos.done) { saveOverlayBounds(); commit(); }
    });
    // The overlay normally never takes focus; a number input borrows it and hands it back.
    ipcMain.on('overlay:keyboard', (_e, on) => {
      if (!overlayWin || overlayWin.isDestroyed()) return;
      keyboardBorrowed = !!on;
      if (IS_MAC) { overlayWin.setFocusable(!!on); if (on) overlayWin.focus(); return; }
      if (on) overlayWin.focus(); else winfocus.restore();
    });
    // After a click on the overlay, hand focus back to the app the user was in.
    ipcMain.on('overlay:release', () => { if (!keyboardBorrowed) winfocus.restore(); });

    createOverlay();
    createMain();
    createQuick();

    tray = new Tray(makeIcon(32));
    tray.setToolTip('Corner Todo');
    tray.on('click', () => showMain());
    buildTrayMenu();

    const actions = {
      quickAdd: showQuick,
      toggleOverlay: () => dispatch({ type: 'settings/set', payload: { overlayVisible: !store.state.settings.overlayVisible } }),
      toggleClickThrough: () => dispatch({ type: 'settings/set', payload: { clickThrough: !store.state.settings.clickThrough, overlayVisible: true } }),
      toggleTimer: () => dispatch({ type: 'timer/toggle' }),
    };
    for (const s of SHORTCUTS) {
      try { shortcutOk[s.id] = globalShortcut.register(s.accel, actions[s.id]); } catch { shortcutOk[s.id] = false; }
    }

    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(ev, () => {
        if (overlayWin && !visibleEnough(overlayWin.getBounds())) { store.apply('settings/set', { overlayBounds: null }); placeOverlay(); }
        commit();
      });
    }

    setInterval(() => {
      const now = Date.now();
      let changed = timer.tick(now);
      const key = M.dateKey(new Date(now));
      if (key !== currentDay) {
        currentDay = key;
        store.summarizePending();
        changed = true;
      }
      if (changed) commit();
    }, 1000);

    if (SMOKE_DIR && !process.env.CORNER_TODO_DEMO) require('../../tools/smoke').run({ store, timer, dispatch, snapshot, getWins: () => ({ mainWin, overlayWin, quickWin }), showQuick, quit: () => { quitting = true; app.quit(); } });
  });

  app.on('activate', () => showMain());
  app.on('window-all-closed', () => { /* stay alive in the tray */ });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    timer.stop();
    logger.log('app.quit');
    store.saveNow();
  });
}
