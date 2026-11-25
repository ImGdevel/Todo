const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  dispatch: (type, payload) => ipcRenderer.send('dispatch', { type, payload }),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onChime: (cb) => ipcRenderer.on('chime', (_e, d) => cb(d)),
  onNav: (cb) => ipcRenderer.on('nav', (_e, tab) => cb(tab)),
  onQuickOpen: (cb) => ipcRenderer.on('quick:open', () => cb()),
  overlayKeyboard: (on) => ipcRenderer.send('overlay:keyboard', !!on),
  releaseFocus: () => ipcRenderer.send('overlay:release'),
  resizeOverlay: (size) => ipcRenderer.send('overlay:resize', size),
  fitOverlay: (height) => ipcRenderer.send('overlay:fit', height),
  fitQuick: (height) => ipcRenderer.send('quick:fit', height),
  moveOverlay: (pos) => ipcRenderer.send('overlay:move', pos),
});
