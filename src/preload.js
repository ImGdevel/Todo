const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  dispatch: (type, payload) => ipcRenderer.send('dispatch', { type, payload }),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onTimerFinished: (cb) => ipcRenderer.on('timer:finished', (_e, d) => cb(d)),
  reportHeight: (h) => ipcRenderer.send('overlay:height', h),
});
