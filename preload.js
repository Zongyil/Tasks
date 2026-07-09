const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  splashReady: () => ipcRenderer.send('splash-ready'),
  bringMainToFront: () => ipcRenderer.send('bring-main-to-front'),
  movePipWindow: (x, y) => ipcRenderer.send('move-pip-window', x, y),
  startPipDrag: () => ipcRenderer.send('start-pip-drag'),
  stopPipDrag: () => ipcRenderer.send('stop-pip-drag'),
  splashExitDone: () => ipcRenderer.send('splash-exit-done'),

  // 优化: 使用 once 并清理旧监听，避免内存泄漏和重复执行
  onStartExit: (callback) => {
    ipcRenderer.removeAllListeners('splash-start-exit');
    ipcRenderer.once('splash-start-exit', callback);
  }
});