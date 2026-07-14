const { contextBridge, ipcRenderer, webFrame } = require('electron');

// 在 DOM 解析前, 通过 Chromium 引擎底层注入样式
webFrame.insertCSS(`
  @font-face {
    font-family: 'OPPO Sans 4.0';
    src: url('local-font://OPPO%20Sans%204.0.ttf') format('truetype');
    font-weight: 1 999;
    font-style: normal;
    font-display: swap;
  }
  
  *, *:before, *:after, body, html, button, input, select, textarea, 
  .task-card, .title, .content, .flatpickr-calendar, .subject-item {
    font-family: 'OPPO Sans 4.0', -apple-system, BlinkMacSystemFont, sans-serif !important;
  }

  /* 修复由于通知抢夺焦点后，iframe或body残留的 Chromium 原生灰色焦点框 */
  :focus, :focus-visible { outline: none !important; }
  iframe { outline: none !important; border: none !important; }
`);

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

  onStartExit: (callback) => {
    ipcRenderer.removeAllListeners('splash-start-exit');
    ipcRenderer.once('splash-start-exit', callback);
  },

  showAlarmNotification: (data) => ipcRenderer.send('show-alarm-notification', data),
  onStopAlarm: (callback) => ipcRenderer.on('stop-alarm', callback)
});