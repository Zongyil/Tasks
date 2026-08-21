// ======= V8 Code Caching / Compile Cache Engine =======
try {
  const { enableCompileCache } = require('node:module');
  if (typeof enableCompileCache === 'function') {
    enableCompileCache();
  } else {
    require('v8-compile-cache');
  }
} catch (_) {
  try { require('v8-compile-cache'); } catch (_) {}
}

const { app, BrowserWindow, ipcMain, protocol, net, Notification, Tray, powerMonitor, screen, nativeTheme } = require('electron')
const path = require('path')
const os = require('os')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-font',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true
    }
  }
]);

app.commandLine.appendSwitch('disable-features', 'OverlayScrollbar');
app.commandLine.appendSwitch('enable-features', 'ElasticOverscrollWin,VaapiVideoDecoder,CanvasOopRasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-gpu-compositing');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');
const { pathToFileURL } = require('url') 
const fs = require('fs')
let globalCloseToTray = false // 默认根据设置中的“关闭应用后退出”生效 (默认开启退出)
let tray = null
let mainWindow = null
let pipWindow = null           // 缓存画中画窗口引用, 避免重复遍历
let taskHubSmWindow = null
let taskFlowSmWindow = null
let taskTimerSmWindow = null
let contextMenuWindow = null

let initialDomX = null
let initialDomY = null
let initialPhysicalX = 0
let initialPhysicalY = 0
let pendingPipPosition = null
let pipMoveTimer = null

let bringToFrontTimer = null    // 主窗口置顶延时定时器

// ======= 性能与节能自适应降载引擎 (Power & CPU Adaptive Throttler) =======
let isWindowFocused = false;
let isWindowMinimized = false;
let isWindowVisible = false;
let isSystemSuspended = false;
let isSystemLocked = false;
let cpuClockBreathPaused = false; // CPU >= 40% 触发, < 10% 恢复
let cpuBgMotionPaused = false;    // CPU >= 25% 触发, < 10% 恢复
let currentCpuUsage = 0;
let cpuCheckTimer = null;
let cpuMonitorStartTimer = null;
let cpuMonitorStarted = false;
let prevCpus = null;
let lastBroadcastThrottle = null;

const CPU_MONITOR_ACTIVE_MS = 5000;
const CPU_MONITOR_IDLE_MS = 30000;
const CPU_MONITOR_SUSPENDED_MS = 60000;

function getOverallCpuUsage() {
  const cpus = os.cpus();
  if (!prevCpus || !Array.isArray(cpus) || cpus.length === 0) {
    prevCpus = cpus;
    return 0;
  }
  if (prevCpus.length !== cpus.length) {
    prevCpus = cpus;
    return currentCpuUsage;
  }

  let idleDiff = 0;
  let totalDiff = 0;

  for (let i = 0; i < cpus.length; i++) {
    const prev = prevCpus[i] ? prevCpus[i].times : null;
    const curr = cpus[i] ? cpus[i].times : null;

    if (!prev || !curr) continue;
    const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq;
    const currTotal = curr.user + curr.nice + curr.sys + curr.idle + curr.irq;
    totalDiff += currTotal - prevTotal;
    idleDiff += curr.idle - prev.idle;
  }
  prevCpus = cpus;

  if (totalDiff > 0) {
    const usage = (1 - idleDiff / totalDiff) * 100;
    return Math.max(0, Math.min(100, Math.round(usage * 10) / 10));
  }
  return currentCpuUsage;
}

function getPerformanceThrottleState() {
  const isWindowActive = isWindowFocused && isWindowVisible && !isWindowMinimized && !isSystemSuspended && !isSystemLocked;
  const pauseClockBreath = (!isWindowActive) || cpuClockBreathPaused;
  const pauseBgMotion = (!isWindowActive) || cpuBgMotionPaused;

  return {
    isWindowActive,
    cpuUsage: currentCpuUsage,
    pauseClockBreath,
    pauseBgMotion
  };
}

function evaluatePerformanceThrottle() {
  // 迟滞回差判定
  if (currentCpuUsage >= 40) {
    cpuClockBreathPaused = true;
  } else if (currentCpuUsage < 10) {
    cpuClockBreathPaused = false;
  }

  if (currentCpuUsage >= 25) {
    cpuBgMotionPaused = true;
  } else if (currentCpuUsage < 10) {
    cpuBgMotionPaused = false;
  }

  const currentState = getPerformanceThrottleState();

  if (!lastBroadcastThrottle ||
      lastBroadcastThrottle.pauseClockBreath !== currentState.pauseClockBreath ||
      lastBroadcastThrottle.pauseBgMotion !== currentState.pauseBgMotion ||
      lastBroadcastThrottle.isWindowActive !== currentState.isWindowActive) {
    lastBroadcastThrottle = currentState;
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('performance-throttle-changed', currentState);
    }
  }
}

function getCpuMonitorDelay() {
  if (isSystemSuspended || isSystemLocked) return CPU_MONITOR_SUSPENDED_MS;
  return getPerformanceThrottleState().isWindowActive
    ? CPU_MONITOR_ACTIVE_MS
    : CPU_MONITOR_IDLE_MS;
}

function scheduleCpuCheck(delay = getCpuMonitorDelay()) {
  if (!cpuMonitorStarted) return;
  if (cpuCheckTimer) clearTimeout(cpuCheckTimer);
  cpuCheckTimer = setTimeout(() => {
    cpuCheckTimer = null;
    if (!isSystemSuspended) {
      currentCpuUsage = getOverallCpuUsage();
      evaluatePerformanceThrottle();
    } else {
      prevCpus = null;
    }
    scheduleCpuCheck();
  }, delay);
  cpuCheckTimer.unref?.();
}

function rescheduleCpuMonitor(immediate = false) {
  if (cpuMonitorStarted) scheduleCpuCheck(immediate ? 0 : getCpuMonitorDelay());
}

function startCpuMonitor() {
  if (cpuMonitorStarted) return;
  cpuMonitorStarted = true;
  try {
    prevCpus = os.cpus();
  } catch (_) {}
  scheduleCpuCheck(CPU_MONITOR_ACTIVE_MS);
}

function stopCpuMonitor() {
  cpuMonitorStarted = false;
  if (cpuMonitorStartTimer) {
    clearTimeout(cpuMonitorStartTimer);
    cpuMonitorStartTimer = null;
  }
  if (cpuCheckTimer) {
    clearTimeout(cpuCheckTimer);
    cpuCheckTimer = null;
  }
  prevCpus = null;
}

function createWindow() {
  let state = {}
  const windowStateFile = path.join(app.getPath('userData'), 'window-state.json')
  try {
    if (fs.existsSync(windowStateFile)) {
      state = JSON.parse(fs.readFileSync(windowStateFile, 'utf8'))
    }
  } catch (e) {
    console.error('Failed to load window state:', e)
  }

  mainWindow = new BrowserWindow({
    width: state.width || 1350,
    height: state.height || 720,
    x: state.x,
    y: state.y,
    minWidth: 700,
    minHeight: 440,
    frame: false,
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin' && {
      titleBarOverlay: {
        color: 'rgba(0, 0, 0, 0)',
        symbolColor: nativeTheme.shouldUseDarkColors ? '#f3f3f3' : '#0f172a',
        height: 44
      }
    }),
    backgroundMaterial: 'tabbed',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.frameName === 'alpha-pip') {
      const isMac = process.platform === 'darwin'
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          frame: false,
          transparent: isMac,
          backgroundColor: '#00000000',
          vibrancy: isMac ? 'fullscreen-ui' : undefined,
          backgroundMaterial: isMac ? undefined : 'mica',
          hasShadow: true,
          roundedCorners: true,
          resizable: true,
          alwaysOnTop: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
          }
        }
      }
    }
    if (details.url && (details.url.startsWith('blob:') || details.url.startsWith('data:'))) {
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  mainWindow.webContents.on('did-create-window', (window, details) => {
    if (details.frameName === 'alpha-pip') {
      // 缓存画中画窗口引用, 避免每次遍历所有窗口
      pipWindow = window

      const lockAspectRatio = () => {
        if (window && !window.isDestroyed()) {
          const bounds = window.getBounds()
          if (bounds.width && bounds.height) {
            try { window.setAspectRatio(bounds.width / bounds.height) } catch (_) {}
          }
        }
      }
      lockAspectRatio()
      window.once('ready-to-show', lockAspectRatio)

      window.on('closed', () => {
        if (pipWindow === window) {
          pipWindow = null
        }
      })
    }
  })

  mainWindow.loadFile('wrapper.html')
  // 首屏准备完成后再显示，避免白屏。
  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) {
      mainWindow.show()
    }
  })

  mainWindow.on('maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('window-maximize-changed', true)
    }
  })

  mainWindow.on('unmaximize', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('window-maximize-changed', false)
    }
  })

  mainWindow.on('focus', () => {
    isWindowFocused = true;
    evaluatePerformanceThrottle();
    rescheduleCpuMonitor(true);
  });

  mainWindow.on('blur', () => {
    isWindowFocused = false;
    evaluatePerformanceThrottle();
    rescheduleCpuMonitor();
  });

  mainWindow.on('minimize', () => {
    isWindowMinimized = true;
    evaluatePerformanceThrottle();
    rescheduleCpuMonitor();
  });

  mainWindow.on('restore', () => {
    isWindowMinimized = false;
    evaluatePerformanceThrottle();
    rescheduleCpuMonitor(true);
  });

  mainWindow.on('show', () => {
    isWindowVisible = true;
    isWindowFocused = mainWindow.isFocused();
    isWindowMinimized = mainWindow.isMinimized();
    evaluatePerformanceThrottle();
    rescheduleCpuMonitor(true);
  });

  mainWindow.on('hide', () => {
    isWindowVisible = false;
    isWindowFocused = false;
    evaluatePerformanceThrottle();
    rescheduleCpuMonitor();
  });

  mainWindow.on('close', (e) => {
    if (globalCloseToTray && !app.isQuiting) {
      e.preventDefault()
      mainWindow.hide()
      return
    }
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized() && !mainWindow.isFullScreen()) {
      try {
        const windowStateFile = path.join(app.getPath('userData'), 'window-state.json')
        const bounds = mainWindow.getBounds()
        fs.writeFileSync(windowStateFile, JSON.stringify(bounds))
      } catch (e) {
        console.error('Failed to save window state:', e)
      }
    }
    // 当“关闭应用后退出”生效时，关闭主窗口应彻底退出应用程序
    app.isQuiting = true
    app.quit()
  })
}

// ======= 小窗拖拽逻辑 =======
ipcMain.on('start-pip-drag', () => {
  if (pipWindow && !pipWindow.isDestroyed()) {
    initialDomX = null
    initialDomY = null
    pendingPipPosition = null
  }
})

function flushPipMove() {
  pipMoveTimer = null
  const position = pendingPipPosition
  pendingPipPosition = null
  if (!position || !pipWindow || pipWindow.isDestroyed()) return
  try {
    pipWindow.setPosition(position.x, position.y, false)
  } catch (_) {
    // 忽略拖拽过程中的异常
  }
}

ipcMain.on('move-pip-window', (event, x, y) => {
  if (!pipWindow || pipWindow.isDestroyed()) return
  if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) return
  if (pipWindow.isMaximized() || pipWindow.isFullScreen()) return

  if (initialDomX === null || initialDomY === null) {
    initialDomX = x
    initialDomY = y
    const bounds = pipWindow.getBounds()
    initialPhysicalX = bounds.x
    initialPhysicalY = bounds.y
  }

  // 合并同一帧内的高频 IPC，只把最新位置提交给原生窗口。
  pendingPipPosition = {
    x: Math.round(initialPhysicalX + (x - initialDomX)),
    y: Math.round(initialPhysicalY + (y - initialDomY))
  }
  if (!pipMoveTimer) {
    pipMoveTimer = setTimeout(flushPipMove, 16)
  }
})

ipcMain.on('set-pip-aspect-ratio', (event, ratio) => {
  if (pipWindow && !pipWindow.isDestroyed() && typeof ratio === 'number' && ratio > 0) {
    try { pipWindow.setAspectRatio(ratio) } catch (_) {}
  }
})

ipcMain.on('stop-pip-drag', () => {
  if (pipMoveTimer) {
    clearTimeout(pipMoveTimer)
    pipMoveTimer = null
  }
  flushPipMove()
  initialDomX = null
  initialDomY = null
})

// 处理窗口控制
ipcMain.handle('is-window-maximized', () => {
  return (mainWindow && !mainWindow.isDestroyed()) ? mainWindow.isMaximized() : false
})
ipcMain.on('window-minimize', () => mainWindow?.minimize())
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window-close', () => mainWindow?.close())
ipcMain.on('set-background-material', (event, material) => {
  if (mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.setBackgroundMaterial === 'function') {
    try {
      mainWindow.setBackgroundMaterial(material)
    } catch (e) {
      console.error('Failed to set background material:', e)
    }
  }
})

function updateSmTitleBarOverlay(win, isDark) {
  if (process.platform !== 'darwin' && win && !win.isDestroyed() && typeof win.setTitleBarOverlay === 'function') {
    try {
      win.setTitleBarOverlay({
        color: 'rgba(0, 0, 0, 0)',
        symbolColor: isDark ? '#d1d5db' : '#2F354F',
        height: 32
      });
    } catch (e) {
      console.error('Failed to update sm titleBarOverlay:', e);
    }
  }
}

// ======= 标题栏原生控件深浅色自适应适配引擎 =======
function updateTitleBarOverlay(isDark = nativeTheme.shouldUseDarkColors) {
  if (process.platform !== 'darwin' && mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.setTitleBarOverlay === 'function') {
    try {
      mainWindow.setTitleBarOverlay({
        color: 'rgba(0, 0, 0, 0)',
        symbolColor: isDark ? '#f3f3f3' : '#0f172a',
        height: 44
      });
    } catch (e) {
      console.error('Failed to update titleBarOverlay:', e);
    }
  }
  updateSmTitleBarOverlay(taskHubSmWindow, isDark);
  updateSmTitleBarOverlay(taskFlowSmWindow, isDark);
  updateSmTitleBarOverlay(taskTimerSmWindow, isDark);
}

nativeTheme.on('updated', () => {
  const isDark = nativeTheme.shouldUseDarkColors;
  updateTitleBarOverlay(isDark);
  const activeWindows = [mainWindow, taskHubSmWindow, taskFlowSmWindow, taskTimerSmWindow, pipWindow, contextMenuWindow];
  activeWindows.forEach(win => {
    if (win && !win.isDestroyed() && win.webContents) {
      try {
        win.webContents.send('native-theme-updated', { shouldUseDarkColors: isDark });
      } catch (_) {}
    }
  });
});

ipcMain.handle('is-dark-mode', () => {
  return nativeTheme.shouldUseDarkColors;
});

ipcMain.on('set-title-bar-overlay', (event, options) => {
  if (process.platform !== 'darwin' && mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.setTitleBarOverlay === 'function') {
    try {
      mainWindow.setTitleBarOverlay(options);
    } catch (e) {
      console.error('Failed to set title bar overlay via IPC:', e);
    }
  }
});

function bringWindowToFront(window = mainWindow) {
  if (!window || window.isDestroyed()) return
  // 防止短时间内多次调用导致 alwaysOnTop 状态异常
  if (bringToFrontTimer) clearTimeout(bringToFrontTimer)

  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.setAlwaysOnTop(true)
  window.focus()

  bringToFrontTimer = setTimeout(() => {
    if (!window.isDestroyed()) {
      window.setAlwaysOnTop(false)
    }
    bringToFrontTimer = null
  }, 200)
}

ipcMain.on('bring-main-to-front', () => bringWindowToFront())

// ======= 自动更新懒加载管理器 (Lazy Auto-Updater) =======
let autoUpdater = null;
let isUpdaterInitialized = false;

function getAutoUpdater() {
  if (!autoUpdater) {
    try {
      autoUpdater = require('electron-updater').autoUpdater;
      setupAutoUpdater();
    } catch (e) {
      console.warn('electron-updater 模块未加载 (可能处于纯本地开发/无 node_modules 环境):', e.message);
    }
  }
  return autoUpdater;
}

let isUpdateDownloaded = false;
let updateDownloadedInfo = null;
let pendingUpdateProgress = null;
let updateProgressTimer = null;

function clearPendingUpdateProgress() {
  pendingUpdateProgress = null;
  if (updateProgressTimer) {
    clearTimeout(updateProgressTimer);
    updateProgressTimer = null;
  }
}

function flushUpdateProgress() {
  updateProgressTimer = null;
  const progressObj = pendingUpdateProgress;
  pendingUpdateProgress = null;
  if (!progressObj) return;

  if (mainWindow && !mainWindow.isDestroyed()) {
    const progressRatio = Math.min(Math.max((progressObj.percent || 0) / 100, 0), 1);
    mainWindow.setProgressBar(progressRatio);
    mainWindow.webContents.send('updater-progress', {
      percent: progressObj.percent || 0,
      bytesPerSecond: progressObj.bytesPerSecond || 0,
      transferred: progressObj.transferred || 0,
      total: progressObj.total || 0
    });
  }
}

function setupAutoUpdater() {
  if (isUpdaterInitialized || !autoUpdater) return;
  isUpdaterInitialized = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('updater-status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('updater-status', {
      status: 'available',
      info: info,
      alreadyDownloaded: isUpdateDownloaded
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    mainWindow?.webContents.send('updater-status', { status: 'not-available', info });
  });

  autoUpdater.on('error', (err) => {
    clearPendingUpdateProgress();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }
    mainWindow?.webContents.send('updater-status', {
      status: 'error',
      error: err ? (err.message || String(err)) : '未知错误'
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    // 下载器可能高频回调；按 100ms 合并任务栏与渲染进程更新。
    pendingUpdateProgress = progressObj;
    if (!updateProgressTimer) {
      updateProgressTimer = setTimeout(flushUpdateProgress, 100);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    clearPendingUpdateProgress();
    isUpdateDownloaded = true;
    updateDownloadedInfo = info;

    // 清除任务栏进度条
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }

    // 接入系统原生 Notification 提示用户重启
    if (Notification.isSupported()) {
      const notif = new Notification({
        title: 'Tasks 更新已准备就绪',
        body: `新版本 ${info && info.version ? 'v' + info.version : ''} 已下载完成，点击或在设置中重启应用即可完成更新。`,
        urgency: 'normal'
      });
      notif.on('click', () => {
        try {
          if (autoUpdater) autoUpdater.quitAndInstall();
        } catch (e) {
          app.relaunch();
          app.exit(0);
        }
      });
      notif.show();
    }

    // 推送 update-downloaded 事件到渲染进程
    mainWindow?.webContents.send('updater-status', { status: 'downloaded', info });
  });
}

// ======= 版本信息读取 & 自动更新 IPC =======
let versionInfoPromise = null;

ipcMain.handle('read-version-json', async () => {
  if (!versionInfoPromise) {
    const versionPath = path.join(__dirname, 'version.json');
    versionInfoPromise = fs.promises.readFile(versionPath, 'utf8')
      .then((content) => JSON.parse(content))
      .catch((err) => {
        versionInfoPromise = null;
        console.error('读取 version.json 失败:', err);
        return null;
      });
  }
  return versionInfoPromise;
});


ipcMain.handle('check-for-update', async () => {
  if (isUpdateDownloaded) {
    return { status: 'downloaded', info: updateDownloadedInfo };
  }
  const updater = getAutoUpdater();
  if (!updater) {
    return { status: 'unavailable', message: 'electron-updater 未就绪' };
  }
  try {
    const result = await updater.checkForUpdates();
    return { status: 'checking', updateInfo: result?.updateInfo };
  } catch (e) {
    console.error('检查更新失败:', e);
    return { status: 'error', error: e.message };
  }
});

ipcMain.handle('start-download-update', async () => {
  if (isUpdateDownloaded) {
    return { status: 'downloaded', info: updateDownloadedInfo };
  }
  const updater = getAutoUpdater();
  if (!updater) {
    return { status: 'unavailable', message: 'electron-updater 未就绪' };
  }
  try {
    await updater.downloadUpdate();
    return { status: 'downloading' };
  } catch (e) {
    console.error('触发下载更新失败:', e);
    return { status: 'error', error: e.message };
  }
});

ipcMain.handle('quit-and-install-update', () => {
  const updater = getAutoUpdater();
  if (updater && isUpdateDownloaded) {
    updater.quitAndInstall();
  } else {
    app.relaunch();
    app.exit(0);
  }
});

// ======= 单实例运行 & 自定义协议 handle 逻辑 =======
function extractProtocolUrl(args) {
  if (!Array.isArray(args)) return null;
  for (const arg of args) {
    if (typeof arg === 'string' && arg.startsWith('tasks://')) {
      return arg;
    }
  }
  return null;
}

function extractTdaFilePath(args) {
  if (!Array.isArray(args)) return null;
  for (const arg of args) {
    if (typeof arg === 'string' && arg.toLowerCase().endsWith('.tda')) {
      return arg;
    }
  }
  return null;
}

function parseInstancePayload(commandLine, workingDirectory, additionalData) {
  const url = extractProtocolUrl(commandLine);
  const tdaFile = extractTdaFilePath(commandLine);
  return {
    commandLine: commandLine || [],
    workingDirectory: workingDirectory || '',
    additionalData: additionalData || null,
    url: url,
    tdaFile: tdaFile,
    timestamp: Date.now()
  };
}

let initialPayload = null;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 第二个实例启动时，直接退出自身
  app.quit();
} else {
  // 当第二个实例启动或用户点击自定义协议链接时触发
  app.on('second-instance', (event, commandLine, workingDirectory, additionalData) => {
    // 唤醒并聚焦主窗口
    if (mainWindow && !mainWindow.isDestroyed()) {
      bringWindowToFront(mainWindow);
    }

    // 解析传递的数据/协议URL，并发送给渲染进程
    const payload = parseInstancePayload(commandLine, workingDirectory, additionalData);
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('second-instance-data', payload);
    }
  });

  // 注册 tasks:// 自定义协议客户端
  function setupProtocolClient() {
    try {
      if (process.defaultApp) {
        if (process.argv.length >= 2) {
          app.setAsDefaultProtocolClient('tasks', process.execPath, [path.resolve(process.argv[1])]);
        }
      } else {
        app.setAsDefaultProtocolClient('tasks');
      }
    } catch (e) {
      console.warn('注册 tasks 自定义协议失败:', e);
    }
  }

  // macOS 协议唤醒支持
  app.on('open-url', (event, url) => {
    event.preventDefault();
    const payload = parseInstancePayload([url], '', null);
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('second-instance-data', payload);
    } else {
      initialPayload = payload;
    }
  });

  // 解析冷启动参数
  initialPayload = parseInstancePayload(process.argv, process.cwd(), null);

  ipcMain.handle('get-initial-instance-data', () => {
    return initialPayload;
  });

  // ======= 性能与节能降载状态 IPC =======
  ipcMain.handle('get-performance-throttle-state', () => {
    return getPerformanceThrottleState();
  });

  // ======= TDA 文件读取 IPC =======
  ipcMain.handle('read-tda-file', async (event, filePath) => {
    try {
      if (!filePath || typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.tda')) {
        return { success: false, error: '无效的文件路径' };
      }
      const content = await fs.promises.readFile(filePath, 'utf8');
      return { success: true, content };
    } catch (e) {
      console.error('读取 TDA 文件失败:', e);
      return { success: false, error: e.message };
    }
  });

  // ======= 托盘、自启与无边框小窗管理引擎 =======
  let contextMenuReadyPromise = null;
  let contextMenuHideTimer = null;

  function showMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    bringWindowToFront(mainWindow);
  }

  function createContextMenuWindow() {
    if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
      return contextMenuReadyPromise || Promise.resolve();
    }

    contextMenuWindow = new BrowserWindow({
      width: 220,
      height: 208,
      frame: false,
      transparent: process.platform === 'darwin',
      backgroundColor: '#00000000',
      backgroundMaterial: 'mica',
      roundedCorners: true,
      hasShadow: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    contextMenuReadyPromise = contextMenuWindow
      .loadFile(path.join(__dirname, 'lite', 'Context_Menu.html'))
      .catch((error) => {
        console.error('Failed to load context menu:', error);
      });

    contextMenuWindow.on('blur', () => {
      hideContextMenuWithAnim();
    });

    contextMenuWindow.on('closed', () => {
      contextMenuWindow = null;
      contextMenuReadyPromise = null;
    });

    return contextMenuReadyPromise;
  }

  let contextMenuFocusTimer = null;

  function startContextMenuFocusWatcher() {
    if (contextMenuFocusTimer) clearTimeout(contextMenuFocusTimer);
    // blur 事件负责持续监听；这里只在显示后做一次兜底检查。
    contextMenuFocusTimer = setTimeout(() => {
      contextMenuFocusTimer = null;
      if (contextMenuWindow &&
          !contextMenuWindow.isDestroyed() &&
          contextMenuWindow.isVisible() &&
          !contextMenuWindow.isFocused()) {
        hideContextMenuWithAnim();
      }
    }, 250);
  }

  function hideContextMenuWithAnim() {
    if (!contextMenuWindow || contextMenuWindow.isDestroyed() || !contextMenuWindow.isVisible()) return;
    if (contextMenuFocusTimer) {
      clearTimeout(contextMenuFocusTimer);
      contextMenuFocusTimer = null;
    }
    try {
      contextMenuWindow.webContents.send('hide-context-menu');
    } catch (_) {}
    if (contextMenuHideTimer) clearTimeout(contextMenuHideTimer);
    contextMenuHideTimer = setTimeout(() => {
      if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
        contextMenuWindow.hide();
      }
      contextMenuHideTimer = null;
    }, 95);
  }

  async function toggleContextMenu(bounds) {
    await createContextMenuWindow();

    if (!contextMenuWindow || contextMenuWindow.isDestroyed()) return;

    if (contextMenuWindow.isVisible()) {
      hideContextMenuWithAnim();
      return;
    }

    if (contextMenuHideTimer) {
      clearTimeout(contextMenuHideTimer);
      contextMenuHideTimer = null;
    }

    const pt = bounds && typeof bounds.x === 'number' ? { x: bounds.x, y: bounds.y } : screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(pt);
    const workArea = display.workArea;
    const [winW, winH] = contextMenuWindow.getSize();

    let x = bounds && typeof bounds.x === 'number' ? Math.round(bounds.x + (bounds.width || 0) / 2 - winW / 2) : pt.x - winW / 2;
    let y = bounds && typeof bounds.y === 'number' ? (bounds.y - winH - 8) : (pt.y - winH - 8);
    const isTopTaskbar = (bounds && typeof bounds.y === 'number' && bounds.y < workArea.y + 60);

    if (bounds && typeof bounds.y === 'number') {
      if (isTopTaskbar) {
        y = bounds.y + (bounds.height || 0) + 8;
      } else {
        y = bounds.y - winH - 8;
      }
    }

    x = Math.max(workArea.x + 8, Math.min(x, workArea.x + workArea.width - winW - 8));
    y = Math.max(workArea.y + 8, Math.min(y, workArea.y + workArea.height - winH - 8));

    contextMenuWindow.setPosition(x, y, false);
    try {
      contextMenuWindow.webContents.send('show-context-menu', { isTop: isTopTaskbar });
    } catch (_) {}
    contextMenuWindow.show();
    contextMenuWindow.focus();
    startContextMenuFocusWatcher();
  }

  function getBottomRightPosition(width, height) {
    const pt = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(pt);
    const workArea = display.workArea;
    const marginX = 16;
    const marginY = 116; // 向上移动 85px (31 + 85)
    const x = Math.round(workArea.x + workArea.width - width - marginX);
    const y = Math.round(workArea.y + workArea.height - height - marginY);
    return { x, y };
  }

  function openTaskHubSmWindow() {
    const winW = 380;
    const winH = 118;
    const { x, y } = getBottomRightPosition(winW, winH);

    if (taskHubSmWindow && !taskHubSmWindow.isDestroyed()) {
      if (taskHubSmWindow.isMinimized()) taskHubSmWindow.restore();
      taskHubSmWindow.setPosition(x, y, false);
      if (typeof taskHubSmWindow.setBackgroundMaterial === 'function') {
        try { taskHubSmWindow.setBackgroundMaterial('mica'); } catch (_) {}
      }
      taskHubSmWindow.show();
      taskHubSmWindow.focus();
      return;
    }
    taskHubSmWindow = new BrowserWindow({
      title: 'TaskHub',
      width: winW,
      height: winH,
      useContentSize: true,
      x: x,
      y: y,
      show: false,
      titleBarStyle: 'hidden',
      ...(process.platform !== 'darwin' && {
        titleBarOverlay: {
          color: 'rgba(0, 0, 0, 0)',
          symbolColor: nativeTheme.shouldUseDarkColors ? '#d1d5db' : '#2F354F',
          height: 32
        }
      }),
      transparent: false,
      backgroundColor: '#00000000',
      backgroundMaterial: 'mica',
      roundedCorners: true,
      hasShadow: true,
      alwaysOnTop: true,
      resizable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });
    if (typeof taskHubSmWindow.setBackgroundMaterial === 'function') {
      try {
        taskHubSmWindow.setBackgroundMaterial('mica');
      } catch (_) {}
    }
    taskHubSmWindow.loadFile(path.join(__dirname, 'lite', 'TaskHub_sm.html'));
    taskHubSmWindow.once('ready-to-show', () => {
      if (taskHubSmWindow && !taskHubSmWindow.isDestroyed()) {
        taskHubSmWindow.show();
        taskHubSmWindow.focus();
      }
    });
    taskHubSmWindow.on('closed', () => { taskHubSmWindow = null; });
  }

  function openTaskFlowSmWindow() {
    const winW = 380;
    const winH = 280;
    const { x, y } = getBottomRightPosition(winW, winH);

    if (taskFlowSmWindow && !taskFlowSmWindow.isDestroyed()) {
      if (taskFlowSmWindow.isMinimized()) taskFlowSmWindow.restore();
      taskFlowSmWindow.setPosition(x, y, false);
      if (typeof taskFlowSmWindow.setBackgroundMaterial === 'function') {
        try { taskFlowSmWindow.setBackgroundMaterial('mica'); } catch (_) {}
      }
      taskFlowSmWindow.show();
      taskFlowSmWindow.focus();
      return;
    }
    taskFlowSmWindow = new BrowserWindow({
      title: 'TaskFlow',
      width: winW,
      height: winH,
      useContentSize: true,
      x: x,
      y: y,
      show: false,
      titleBarStyle: 'hidden',
      ...(process.platform !== 'darwin' && {
        titleBarOverlay: {
          color: 'rgba(0, 0, 0, 0)',
          symbolColor: nativeTheme.shouldUseDarkColors ? '#d1d5db' : '#2F354F',
          height: 32
        }
      }),
      transparent: false,
      backgroundColor: '#00000000',
      backgroundMaterial: 'mica',
      roundedCorners: true,
      hasShadow: true,
      alwaysOnTop: true,
      resizable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });
    if (typeof taskFlowSmWindow.setBackgroundMaterial === 'function') {
      try {
        taskFlowSmWindow.setBackgroundMaterial('mica');
      } catch (_) {}
    }
    taskFlowSmWindow.loadFile(path.join(__dirname, 'lite', 'TaskFlow_sm.html'));
    taskFlowSmWindow.once('ready-to-show', () => {
      if (taskFlowSmWindow && !taskFlowSmWindow.isDestroyed()) {
        taskFlowSmWindow.show();
        taskFlowSmWindow.focus();
      }
    });
    taskFlowSmWindow.on('closed', () => { taskFlowSmWindow = null; });
  }

  function openTaskTimerSmWindow(data = {}) {
    const taskName = (data && data.name) || '';
    const mode = (data && data.mode) || 'up';
    const duration = (data && data.duration) || 25;
    const taskId = (data && data.taskId) || '';

    const winW = 380;
    const winH = 360;
    const { x, y } = getBottomRightPosition(winW, winH);

    const query = `?name=${encodeURIComponent(taskName)}&mode=${encodeURIComponent(mode)}&duration=${encodeURIComponent(duration)}&taskId=${encodeURIComponent(taskId)}`;

    if (taskTimerSmWindow && !taskTimerSmWindow.isDestroyed()) {
      if (taskTimerSmWindow.isMinimized()) taskTimerSmWindow.restore();
      taskTimerSmWindow.setPosition(x, y, false);
      if (typeof taskTimerSmWindow.setBackgroundMaterial === 'function') {
        try { taskTimerSmWindow.setBackgroundMaterial('mica'); } catch (_) {}
      }
      taskTimerSmWindow.show();
      taskTimerSmWindow.focus();
      try {
        taskTimerSmWindow.webContents.send('init-timer-params', { name: taskName, mode, duration, taskId });
      } catch (_) {}
      return;
    }

    taskTimerSmWindow = new BrowserWindow({
      title: 'TaskTimer',
      width: winW,
      height: winH,
      useContentSize: true,
      x: x,
      y: y,
      show: false,
      titleBarStyle: 'hidden',
      ...(process.platform !== 'darwin' && {
        titleBarOverlay: {
          color: 'rgba(0, 0, 0, 0)',
          symbolColor: nativeTheme.shouldUseDarkColors ? '#d1d5db' : '#2F354F',
          height: 32
        }
      }),
      transparent: false,
      backgroundColor: '#00000000',
      backgroundMaterial: 'mica',
      roundedCorners: true,
      hasShadow: true,
      alwaysOnTop: true,
      resizable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    if (typeof taskTimerSmWindow.setBackgroundMaterial === 'function') {
      try {
        taskTimerSmWindow.setBackgroundMaterial('mica');
      } catch (_) {}
    }

    taskTimerSmWindow.loadFile(path.join(__dirname, 'lite', 'TaskTimer_sm.html'), { search: query.slice(1) });
    taskTimerSmWindow.once('ready-to-show', () => {
      if (taskTimerSmWindow && !taskTimerSmWindow.isDestroyed()) {
        taskTimerSmWindow.show();
        taskTimerSmWindow.focus();
      }
    });
    taskTimerSmWindow.on('closed', () => { taskTimerSmWindow = null; });
  }

  function openTimerPipWindow(data = {}) {
    const taskName = (data && data.name) || '新任务';
    const mode = (data && data.mode) || 'up';
    const autoStart = (data && data.autostart !== undefined) ? data.autostart : true;

    if (pipWindow && !pipWindow.isDestroyed()) {
      if (pipWindow.isMinimized()) pipWindow.restore();
      pipWindow.show();
      pipWindow.focus();
      return;
    }

    pipWindow = new BrowserWindow({
      width: 380,
      height: 560,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      backgroundMaterial: 'mica',
      alwaysOnTop: true,
      resizable: true,
      center: true,
      hasShadow: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });
    try { pipWindow.setAspectRatio(380 / 560); } catch (_) {}

    const query = `?pip=true&name=${encodeURIComponent(taskName)}&mode=${encodeURIComponent(mode)}&autostart=${autoStart}`;
    pipWindow.loadFile(path.join(__dirname, 'TaskTimer.html'), { search: query.slice(1) });
    pipWindow.on('closed', () => { pipWindow = null; });
  }

  function broadcastAutoStart(enabled) {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed() && win.webContents) {
        try {
          win.webContents.send('auto-start-changed', enabled);
        } catch (_) {}
      }
    }
  }

  ipcMain.handle('get-auto-start', () => {
    try {
      const settingsWithHidden = app.getLoginItemSettings({ args: ['--hidden'] });
      if (settingsWithHidden && settingsWithHidden.openAtLogin) return true;
      const settingsDefault = app.getLoginItemSettings();
      if (settingsDefault && settingsDefault.openAtLogin) return true;
      return false;
    } catch (e) {
      return false;
    }
  });

  ipcMain.on('set-auto-start', (event, enable) => {
    try {
      app.setLoginItemSettings({
        openAtLogin: !!enable,
        args: enable ? ['--hidden'] : []
      });
      broadcastAutoStart(!!enable);
    } catch (e) {
      console.error('Failed to set login item settings:', e);
    }
  });

  ipcMain.on('set-close-to-tray', (event, enable) => {
    globalCloseToTray = enable;
  });

  ipcMain.on('app-quit', () => {
    app.isQuiting = true;
    app.quit();
  });

  ipcMain.on('hide-context-menu-window', () => {
    if (contextMenuHideTimer) {
      clearTimeout(contextMenuHideTimer);
      contextMenuHideTimer = null;
    }
    if (contextMenuFocusTimer) {
      clearTimeout(contextMenuFocusTimer);
      contextMenuFocusTimer = null;
    }
    if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
      contextMenuWindow.hide();
    }
  });

  ipcMain.on('open-taskhub-sm', () => {
    hideContextMenuWithAnim();
    openTaskHubSmWindow();
  });

  ipcMain.on('open-taskflow-sm', () => {
    hideContextMenuWithAnim();
    openTaskFlowSmWindow();
  });

  ipcMain.on('open-tasktimer-sm', (event, data) => {
    hideContextMenuWithAnim();
    openTaskTimerSmWindow(data);
  });

  ipcMain.on('open-timer-pip', (event, data) => {
    hideContextMenuWithAnim();
    openTimerPipWindow(data);
  });

  function createTray() {
    if (tray) return;
    tray = new Tray(path.join(__dirname, 'Icon.ico'));
    tray.setToolTip('Tasks');
    void createContextMenuWindow();

    tray.on('click', () => {
      showMainWindow();
    });

    tray.on('double-click', () => {
      showMainWindow();
    });

    tray.on('right-click', (event, bounds) => {
      void toggleContextMenu(bounds).catch((error) => {
        console.error('Failed to show context menu:', error);
      });
    });

  }

  app.whenReady().then(() => {
    setupProtocolClient();
    createTray();

    // 监听系统电源与锁屏状态, 联动降载引擎
    if (powerMonitor) {
      powerMonitor.on('suspend', () => {
        isSystemSuspended = true;
        evaluatePerformanceThrottle();
        rescheduleCpuMonitor();
      });
      powerMonitor.on('resume', () => {
        isSystemSuspended = false;
        evaluatePerformanceThrottle();
        rescheduleCpuMonitor(true);
      });
      powerMonitor.on('lock-screen', () => {
        isSystemLocked = true;
        evaluatePerformanceThrottle();
        rescheduleCpuMonitor();
      });
      powerMonitor.on('unlock-screen', () => {
        isSystemLocked = false;
        evaluatePerformanceThrottle();
        rescheduleCpuMonitor(true);
      });
    }

    // 延迟启动 CPU 监控器, 将启动黄金期 CPU 资源让渡给主窗口首屏渲染
    cpuMonitorStartTimer = setTimeout(() => {
      cpuMonitorStartTimer = null;
      startCpuMonitor();
    }, 3000);

    // 注册协议:保证字体正常加载
    protocol.handle('local-font', (request) => {
      let fileName = decodeURIComponent(request.url.slice('local-font://'.length));
      fileName = path.basename(fileName);
      const filePath = path.join(__dirname, 'fonts', fileName);
      return net.fetch(pathToFileURL(filePath).href);
    });

    // 全局拦截所有 WebContents 实例上的 F11 快捷键，禁止全屏
    app.on('web-contents-created', (event, contents) => {
      contents.on('before-input-event', (event, input) => {
        if (input.key === 'F11' || input.code === 'F11') {
          event.preventDefault();
        }
      });
    });

    // 建立唯一的带有系统材质的主窗口
    createWindow(); 

  });

  app.on('before-quit', () => {
    app.isQuiting = true;
    stopCpuMonitor();
    clearPendingUpdateProgress();

    if (bringToFrontTimer) {
      clearTimeout(bringToFrontTimer);
      bringToFrontTimer = null;
    }
    if (pipMoveTimer) {
      clearTimeout(pipMoveTimer);
      pipMoveTimer = null;
    }
    pendingPipPosition = null;
    if (contextMenuHideTimer) {
      clearTimeout(contextMenuHideTimer);
      contextMenuHideTimer = null;
    }
    if (contextMenuFocusTimer) {
      clearTimeout(contextMenuFocusTimer);
      contextMenuFocusTimer = null;
    }
  });
}

// ======= 日程系统级持续通知逻辑 =======
ipcMain.on('show-alarm-notification', (event, { title, body }) => {
  if (!Notification.isSupported()) return;
  
  const notification = new Notification({
    title: title || 'TaskHub 日程提醒',
    body: body,
    // 已移除 actions 数组
    urgency: 'critical', // Windows/Linux: 提高优先级
    timeoutType: 'never' // Windows: 保持通知不自动消失
  });

  // 点击通知的文本/主体任意地方 → 仅静音, 【绝对不】执行窗口恢复或置顶
  notification.on('click', () => {
    if (mainWindow) {
      mainWindow.webContents.send('stop-alarm');
    }
  });

  // 点击系统自带“关闭”按钮（或划走通知）→ 仅静音, 【绝对不】打开软件
  notification.on('close', () => {
    if (mainWindow) {
      mainWindow.webContents.send('stop-alarm');
    }
  });

  notification.show();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})