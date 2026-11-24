// Windows-only: keep the user's app focused while they click the overlay.
//
// Chromium either activates a focusable window on click or, when the window is not
// focusable, swallows the click whenever another app is active — WS_EX_NOACTIVATE does not
// change that. So the overlay stays focusable, we remember which window was active before
// it, and hand focus straight back after each click. A number input borrows focus for
// typing and returns it the same way.
let u32 = null;
let overlayHwnd = null;
let lastExternal = null; // most recent foreground window that is not the overlay
let poll = null;

function init() {
  if (process.platform !== 'win32') return false;
  try {
    const koffi = require('koffi');
    const lib = koffi.load('user32.dll');
    u32 = {
      getForeground: lib.func('intptr_t __stdcall GetForegroundWindow()'),
      setForeground: lib.func('bool __stdcall SetForegroundWindow(intptr_t hwnd)'),
      isWindow: lib.func('bool __stdcall IsWindow(intptr_t hwnd)'),
    };
    return true;
  } catch (err) {
    console.error('winfocus unavailable:', err.message);
    u32 = null;
    return false;
  }
}

const available = () => !!u32;
const fg = () => BigInt(u32.getForeground());

function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
}

function track(win) {
  if (!u32) return;
  overlayHwnd = hwndOf(win);
  clearInterval(poll);
  const sample = () => {
    const h = fg();
    if (h && h !== overlayHwnd) lastExternal = h;
  };
  sample();
  poll = setInterval(sample, 200);
  win.on('focus', sample); // nothing new, but keeps lastExternal fresh at the edge
  win.on('closed', () => clearInterval(poll));
}

// Give focus back to whatever the user was in, if the overlay has it.
function restore() {
  if (!u32 || !lastExternal || fg() !== overlayHwnd) return false;
  if (!u32.isWindow(lastExternal)) return false;
  return u32.setForeground(lastExternal);
}

module.exports = { init, available, track, restore, lastExternal: () => lastExternal };
