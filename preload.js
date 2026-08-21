const { contextBridge, ipcRenderer, webFrame } = require('electron');

try {
  const href = typeof window !== 'undefined' ? (window.location.href || '') : '';
  if (!href.includes('lite/') && !href.includes('lite\\')) {
    require('./assets/scroll-bounce.js');
  }
} catch (_) {}

// 在 DOM 解析前, 通过 Chromium 引擎底层注入样式
webFrame.insertCSS(`
  @font-face {
    font-family: 'OPPO Sans 4.0';
    src: url('local-font://OPPO%20Sans%204.0.ttf') format('truetype');
    font-weight: 1 999;
    font-style: normal;
    font-display: swap;
  }
  
  html, body, button, input, select, textarea, 
  .task-card, .title, .content, .flatpickr-calendar, .subject-item {
    font-family: 'OPPO Sans 4.0', -apple-system, BlinkMacSystemFont, sans-serif !important;
  }

  /* 修复由于通知抢夺焦点后，iframe或body残留的 Chromium 原生灰色焦点框 */
  :focus, :focus-visible { outline: none !important; }
  iframe { outline: none !important; border: none !important; }

  /* 全局默认禁止文本随意选中，文本输入框与可编辑区域开放选中 */
  html, body {
    -webkit-user-select: none;
    user-select: none;
  }
  input, textarea, select, [contenteditable="true"], [contenteditable] {
    -webkit-user-select: text !important;
    user-select: text !important;
  }
`);

// 禁止通过 F11 快捷键进入或切换全屏
window.addEventListener('keydown', (e) => {
  if (e.key === 'F11' || e.keyCode === 122 || e.code === 'F11') {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('is-window-maximized'),
  onMaximizeChanged: (callback) => {
    ipcRenderer.removeAllListeners('window-maximize-changed');
    ipcRenderer.on('window-maximize-changed', (event, isMaximized) => callback(isMaximized));
  },
  setBackgroundMaterial: (material) => ipcRenderer.send('set-background-material', material),
  setTitleBarOverlay: (options) => ipcRenderer.send('set-title-bar-overlay', options),
  isDarkMode: () => ipcRenderer.invoke('is-dark-mode'),
  onNativeThemeUpdated: (callback) => {
    ipcRenderer.removeAllListeners('native-theme-updated');
    ipcRenderer.on('native-theme-updated', (event, data) => callback(data));
  },
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
  onStopAlarm: (callback) => ipcRenderer.on('stop-alarm', callback),

  readVersionJson: () => ipcRenderer.invoke('read-version-json'),

  // ======= 自动更新 IPC 绑定 =======
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  startDownloadUpdate: () => ipcRenderer.invoke('start-download-update'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('quit-and-install-update'),
  onUpdaterStatus: (callback) => {
    ipcRenderer.removeAllListeners('updater-status');
    ipcRenderer.on('updater-status', (event, data) => callback(data));
  },
  onUpdaterProgress: (callback) => {
    ipcRenderer.removeAllListeners('updater-progress');
    ipcRenderer.on('updater-progress', (event, data) => callback(data));
  },

  // ======= 单实例 / 协议唤醒 IPC 绑定 =======
  onSecondInstance: (callback) => {
    ipcRenderer.removeAllListeners('second-instance-data');
    ipcRenderer.on('second-instance-data', (event, data) => callback(data));
  },
  getInitialInstanceData: () => ipcRenderer.invoke('get-initial-instance-data'),

  // ======= 启动设置与托盘 IPC 绑定 =======
  setAutoStart: (enable) => ipcRenderer.send('set-auto-start', enable),
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  onAutoStartChanged: (callback) => {
    ipcRenderer.removeAllListeners('auto-start-changed');
    ipcRenderer.on('auto-start-changed', (event, data) => callback(data));
  },
  setCloseToTray: (enable) => ipcRenderer.send('set-close-to-tray', enable),
  quitApp: () => ipcRenderer.send('app-quit'),

  // ======= 轻量独立无边框小窗 IPC 绑定 =======
  openTaskHubSm: () => ipcRenderer.send('open-taskhub-sm'),
  openTaskFlowSm: () => ipcRenderer.send('open-taskflow-sm'),
  openTaskTimerSm: (data) => ipcRenderer.send('open-tasktimer-sm', data),
  onInitTimerParams: (callback) => {
    ipcRenderer.removeAllListeners('init-timer-params');
    ipcRenderer.on('init-timer-params', (event, data) => callback(data));
  },
  openTimerPip: (data) => ipcRenderer.send('open-timer-pip', data),
  setPipAspectRatio: (ratio) => ipcRenderer.send('set-pip-aspect-ratio', ratio),

  // ======= 托盘右键菜单控制 IPC 绑定 =======
  hideContextMenu: () => ipcRenderer.send('hide-context-menu-window'),
  onShowContextMenu: (callback) => {
    ipcRenderer.removeAllListeners('show-context-menu');
    ipcRenderer.on('show-context-menu', callback);
  },
  onHideContextMenu: (callback) => {
    ipcRenderer.removeAllListeners('hide-context-menu');
    ipcRenderer.on('hide-context-menu', callback);
  },

  // ======= TDA 文件读取 IPC 绑定 =======
  readTdaFile: (filePath) => ipcRenderer.invoke('read-tda-file', filePath),

  // ======= 性能与节能降载 IPC 绑定 =======
  onPerformanceThrottleChanged: (callback) => {
    ipcRenderer.removeAllListeners('performance-throttle-changed');
    ipcRenderer.on('performance-throttle-changed', (event, data) => callback(data));
  },
  getPerformanceThrottleState: () => ipcRenderer.invoke('get-performance-throttle-state')
});
