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

const { app, BrowserWindow, ipcMain, protocol, net, Notification, Tray, powerMonitor, screen, nativeTheme, shell } = require('electron')
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

app.commandLine.appendSwitch('disable-features', 'OverlayScrollbar,SpareRendererForSitePerProcess');
app.commandLine.appendSwitch('enable-features', 'ElasticOverscrollWin,VaapiVideoDecoder');
app.commandLine.appendSwitch('js-flags', '--expose-gc --max-old-space-size=256');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? 'com.zongyi.pjalpha.tasks' : process.execPath);
}
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


const { execFile } = require('child_process')

// ======= 后台与托盘深度节能与内存释放引擎 =======
let backgroundMemoryTrimTimer = null;
let isPerformingCleanup = false;

let nodeGc = null;
try {
  const v8 = require('v8');
  const vm = require('vm');
  v8.setFlagsFromString('--expose_gc');
  nodeGc = vm.runInNewContext('gc');
} catch (_) {}

function getAllAppPids() {
  const pids = new Set([process.pid]);
  try {
    if (typeof app.getAppMetrics === 'function') {
      for (const m of app.getAppMetrics()) {
        if (m && m.pid) pids.add(m.pid);
      }
    }
  } catch (_) {}
  try {
    const { webContents } = require('electron');
    if (webContents && typeof webContents.getAllWebContents === 'function') {
      for (const wc of webContents.getAllWebContents()) {
        if (wc && !wc.isDestroyed() && typeof wc.getOSProcessId === 'function') {
          const pid = wc.getOSProcessId();
          if (pid) pids.add(pid);
        }
      }
    }
  } catch (_) {}
  return Array.from(pids);
}

function trimAllWorkingSets() {
  if (process.platform !== 'win32') return;
  const pids = getAllAppPids();
  if (!pids.length) return;
  const exePath = path.join(__dirname, 'scripts', 'trim_ws.exe');
  if (fs.existsSync(exePath)) {
    // 传递每个 PID 作为独立参数，同时首个参数包含逗号连接以最大兼容
    const args = [pids.join(','), ...pids.map(String)];
    execFile(exePath, args, { windowsHide: true, timeout: 4000 }, () => {});
  }
}

function performBackgroundMemoryRelease() {
  if (isPerformingCleanup) return;
  isPerformingCleanup = true;

  try {
    // 1. 通知所有活跃窗口的渲染层释放空闲缓存与执行垃圾回收
    const allWindows = BrowserWindow.getAllWindows();
    for (const win of allWindows) {
      if (win && !win.isDestroyed() && win.webContents) {
        try {
          win.webContents.send('background-deep-cleanup');
        } catch (_) {}

        try {
          win.webContents.executeJavaScript('try { if (typeof window.gc === "function") window.gc(); } catch (_) {}').catch(() => {});
        } catch (_) {}
      }
    }

    // 2. 清理 Chromium 共享 Session 网络与临时渲染缓存（仅当主窗口处于非活跃状态时清理，避免在前台活跃展示时频繁擦除资源缓存）
    try {
      const throttleState = getPerformanceThrottleState();
      if (!throttleState.isWindowActive) {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && mainWindow.webContents.session) {
          mainWindow.webContents.session.clearCache().catch(() => {});
        }
      }
    } catch (_) {}

    // 3. 主进程 V8 堆内存紧缩与真实垃圾回收
    try {
      if (typeof nodeGc === 'function') {
        nodeGc();
      } else if (typeof global.gc === 'function') {
        global.gc();
      }
    } catch (_) {}

    // 4. 原生 Windows 物理内存 Working Set 深度压缩 (两阶段冲刷，确保异步释放的堆内存被物理清除)
    setTimeout(() => {
      trimAllWorkingSets();
    }, 200);

    setTimeout(() => {
      trimAllWorkingSets();
    }, 1000);
  } finally {
    isPerformingCleanup = false;
  }
}

function scheduleBackgroundMemoryRelease(delayMs = 1500) {
  if (backgroundMemoryTrimTimer) clearTimeout(backgroundMemoryTrimTimer);
  backgroundMemoryTrimTimer = setTimeout(() => {
    backgroundMemoryTrimTimer = null;
    performBackgroundMemoryRelease();
  }, delayMs);
  backgroundMemoryTrimTimer.unref?.();
}

function cancelBackgroundMemoryRelease() {
  if (backgroundMemoryTrimTimer) {
    clearTimeout(backgroundMemoryTrimTimer);
    backgroundMemoryTrimTimer = null;
  }
}

function broadcastToAllWindows(channel, ...args) {
  try {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (win && !win.isDestroyed() && win.webContents) {
        try {
          win.webContents.send(channel, ...args);
        } catch (_) {}
      }
    }
  } catch (_) {}
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
  const stateChanged = !lastBroadcastThrottle ||
      lastBroadcastThrottle.pauseClockBreath !== currentState.pauseClockBreath ||
      lastBroadcastThrottle.pauseBgMotion !== currentState.pauseBgMotion ||
      lastBroadcastThrottle.isWindowActive !== currentState.isWindowActive;

  if (stateChanged) {
    const wasActive = lastBroadcastThrottle ? lastBroadcastThrottle.isWindowActive : true;
    lastBroadcastThrottle = currentState;
    broadcastToAllWindows('performance-throttle-changed', currentState);

    // 仅当窗口状态从活动真正转入非活动/隐藏/后台时，调度内存释放
    if (!currentState.isWindowActive && wasActive) {
      scheduleBackgroundMemoryRelease(2000);
    } else if (currentState.isWindowActive) {
      cancelBackgroundMemoryRelease();
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
    scheduleBackgroundMemoryRelease(1500);
  });

  mainWindow.on('show', () => {
    cancelBackgroundMemoryRelease();
  });

  mainWindow.on('restore', () => {
    cancelBackgroundMemoryRelease();
  });

  let isHidingToTray = false;
  mainWindow.on('close', (e) => {
    if (globalCloseToTray && !app.isQuiting) {
      e.preventDefault();
      if (isHidingToTray) return;
      isHidingToTray = true;
      // 允许原生 Windows 标题栏覆盖按钮 (titleBarOverlay) 完成点击与悬停动画的退场帧，
      // 避免由于瞬时 hide 导致 Chromium Views 原生 Button 的 CompositorAnimationObserver 被长久挂起报错
      setTimeout(() => {
        isHidingToTray = false;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.hide();
        }
      }, 80);
      return;
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

// ======= 自动更新引擎 (Robust Auto-Updater Engine) =======
let autoUpdater = null;
let isUpdaterInitialized = false;

let isUpdateDownloaded = false;
let updateDownloadedInfo = null;
let directDownloadedInstallerPath = null;
let isDownloadingUpdate = false;
let currentAvailableUpdate = null;
let pendingUpdateProgress = null;
let updateProgressTimer = null;
let isCheckingForUpdate = false;

// 友好的更新错误信息格式化工具 (防止抛出过长堆栈或技术 URL)
function formatFriendlyUpdaterError(err) {
  if (!err) return '网络连接异常，请稍后重试';
  const msg = typeof err === 'string' ? err : (err.message || String(err));
  if (msg.includes('CHANNEL_FILE_NOT_FOUND') || msg.includes('latest.yml') || msg.includes('404')) {
    return '未在服务器找到更新配置文件，请稍后再试';
  }
  if (msg.includes('403') || msg.includes('rate limit') || msg.includes('API rate limit')) {
    return '请求更新服务器过于频繁，请稍后再试';
  }
  if (msg.includes('ENOTFOUND') || msg.includes('ERR_INTERNET_DISCONNECTED') || msg.includes('ECONNREFUSED') || msg.includes('net::ERR_')) {
    return '无法连接到更新服务器，请检查网络设置';
  }
  if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
    return '连接更新服务器超时，请稍后重试';
  }
  if (msg.includes('ERR_UPDATER_INVALID_SIGNATURE') || msg.includes('signature') || msg.includes('签名')) {
    return '更新安装包安全签名验证未通过';
  }
  const cleaned = msg.replace(/https?:\/\/[^\s)]+/g, '').replace(/HttpError:\s*/g, '').replace(/Error:\s*/g, '').replace(/[()]/g, '').trim();
  if (cleaned.length > 50 || cleaned.length === 0) {
    return '检查更新遇到问题，请稍后重试';
  }
  return cleaned;
}

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
  }
  broadcastToAllWindows('updater-progress', {
    percent: progressObj.percent || 0,
    bytesPerSecond: progressObj.bytesPerSecond || 0,
    transferred: progressObj.transferred || 0,
    total: progressObj.total || 0
  });
}

// 语义化版本比对工具 (SemVer Comparator)
function compareSemVer(v1, v2) {
  if (!v1 || !v2) return 0;
  const clean1 = String(v1).trim().replace(/^[vV]/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const clean2 = String(v2).trim().replace(/^[vV]/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(clean1.length, clean2.length); i++) {
    const n1 = clean1[i] || 0;
    const n2 = clean2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

// 自定义 Authenticode 签名安全校验器 (兼顾安全校验与自签名证书支持)
function verifyWindowsCodeSignature(publisherNames, unescapedTempUpdateFile) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve(null);
    }
    const tempUpdateFile = unescapedTempUpdateFile.replace(/'/g, "''");
    const cmd = `Get-AuthenticodeSignature -LiteralPath '${tempUpdateFile}' | ConvertTo-Json -Compress`;
    const { execFile } = require('child_process');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-Command', cmd],
      { timeout: 25000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error || stderr) {
          console.warn('[AutoUpdater] PowerShell 验签命令警告:', error || stderr);
          return resolve(null); // 系统异常时不阻断升级
        }
        try {
          const data = JSON.parse(stdout);
          // Status: 0=Valid, 4=NotTrusted (自签证书正常状态)
          // Status: 2=NotSigned (未签名), 3=HashMismatch (被篡改)
          if (data.Status === 2) {
            return resolve('安装包未包含 Authenticode 数字签名 (Status: NotSigned)');
          }
          if (data.Status === 3) {
            return resolve('安装包数字签名哈希校验不匹配，文件可能已损坏或遭篡改 (Status: HashMismatch)');
          }
          if (!data.SignerCertificate || !data.SignerCertificate.Subject) {
            return resolve('安装包缺少有效的签名证书信息');
          }

          const subject = data.SignerCertificate.Subject || '';
          const thumbprint = (data.SignerCertificate.Thumbprint || '').toUpperCase();

          // 预期证书信息 (匹配 devcert.pfx: CN=Zongyi, AF9A37626A4396289C03C7A037C3ECC3D44A0C3D)
          const expectedCn = 'CN=Zongyi';
          const expectedThumbprint = 'AF9A37626A4396289C03C7A037C3ECC3D44A0C3D';
          const isPublisherMatch = subject.includes(expectedCn) ||
            (Array.isArray(publisherNames) && publisherNames.some(p => subject.includes(p)));
          const isThumbprintMatch = thumbprint === expectedThumbprint;

          if (isPublisherMatch || isThumbprintMatch) {
            console.log(`[AutoUpdater] 签名校验通过: Subject=${subject}, Thumbprint=${thumbprint}, Status=${data.Status}`);
            return resolve(null);
          }

          return resolve(`签名发布者不匹配: ${subject}, 预期包含: ${expectedCn}`);
        } catch (e) {
          console.warn('[AutoUpdater] 解析签名信息异常:', e);
          return resolve(null);
        }
      }
    );
  });
}

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

function setupAutoUpdater() {
  if (isUpdaterInitialized || !autoUpdater) return;
  isUpdaterInitialized = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  // 开发环境启用 forceDevUpdateConfig 并注入源配置
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
    try {
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'Zongyil',
        repo: 'Tasks'
      });
    } catch (_) {}
  }

  // 注入 Windows 自定义签名校验器
  try {
    autoUpdater.verifyUpdateCodeSignature = (publisherNames, tempUpdateFile) =>
      verifyWindowsCodeSignature(publisherNames, tempUpdateFile);
  } catch (_) {}

  autoUpdater.on('checking-for-update', () => {
    if (!isCheckingForUpdate) {
      broadcastToAllWindows('updater-status', { status: 'checking' });
    }
  });

  autoUpdater.on('update-available', (info) => {
    currentAvailableUpdate = info;
    if (!isCheckingForUpdate) {
      broadcastToAllWindows('updater-status', {
        status: 'available',
        info: info,
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
        alreadyDownloaded: isUpdateDownloaded
      });
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    if (!isCheckingForUpdate) {
      broadcastToAllWindows('updater-status', { status: 'not-available', info });
    }
  });

  autoUpdater.on('error', (err) => {
    clearPendingUpdateProgress();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }
    console.warn('[AutoUpdater] autoUpdater 错误:', err ? (err.message || err) : '未知');
    // 若处于手动检查更新期间，不广播全局错误，避免打扰用户或与后续智能降级机制产生冲突
    if (isCheckingForUpdate) {
      return;
    }
    // 仅在正在后台下载更新失败时，才向窗口广播下载错误
    if (isDownloadingUpdate) {
      isDownloadingUpdate = false;
      broadcastToAllWindows('updater-status', {
        status: 'error',
        error: formatFriendlyUpdaterError(err)
      });
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    pendingUpdateProgress = progressObj;
    if (!updateProgressTimer) {
      updateProgressTimer = setTimeout(flushUpdateProgress, 100);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    clearPendingUpdateProgress();
    isUpdateDownloaded = true;
    updateDownloadedInfo = info;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }

    if (Notification.isSupported()) {
      const notif = new Notification({
        title: 'Tasks 更新已准备就绪',
        body: `新版本 ${info && info.version ? 'v' + info.version : ''} 已下载完成，点击或在设置中重启应用即可完成更新。`,
        urgency: 'normal'
      });
      notif.on('click', () => {
        quitAndInstallUpdate();
      });
      notif.show();
    }

    broadcastToAllWindows('updater-status', { status: 'downloaded', info });
  });
}

// 降级检索 GitHub Releases (当 electron-updater 因缺失 latest.yml 或网络异常失败时触发)
async function fetchLatestGitHubReleaseFallback() {
  try {
    const res = await net.fetch('https://api.github.com/repos/Zongyil/Tasks/releases/latest', {
      headers: {
        'User-Agent': 'Tasks-Electron-App',
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (res.ok) {
      const data = await res.json();
      const tagName = data.tag_name || '';
      const version = tagName.replace(/^[vV]/, '');
      const exeAsset = Array.isArray(data.assets)
        ? data.assets.find(a => a && a.name && a.name.toLowerCase().endsWith('.exe'))
        : null;
      return {
        version,
        tagName,
        releaseName: data.name || tagName,
        releaseNotes: data.body || '',
        releaseDate: data.published_at,
        releaseUrl: data.html_url,
        downloadUrl: exeAsset ? exeAsset.browser_download_url : data.html_url,
        assetName: exeAsset ? exeAsset.name : null,
        assetSize: exeAsset ? exeAsset.size : 0,
        isDirectDownload: !!exeAsset
      };
    }
  } catch (e) {
    console.warn('[AutoUpdater] Fallback GitHub API 请求失败:', e.message);
  }
  return null;
}

// 降级直接下载安装包 (带进度广播与 Authenticode 验签)
async function downloadDirectInstaller(downloadUrl, assetName) {
  const updateDir = path.join(app.getPath('userData'), 'pending-update');
  await fs.promises.mkdir(updateDir, { recursive: true });
  const targetFile = path.join(updateDir, assetName || 'Tasks-Setup-latest.exe');
  const tempFile = targetFile + '.downloading';

  if (fs.existsSync(tempFile)) {
    try { await fs.promises.unlink(tempFile); } catch (_) {}
  }

  return new Promise((resolve, reject) => {
    const request = net.request({
      url: downloadUrl,
      method: 'GET'
    });

    request.on('response', (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
        return downloadDirectInstaller(redirectUrl, assetName).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`下载更新失败 (HTTP ${response.statusCode})`));
      }

      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let transferredBytes = 0;
      let startTime = Date.now();
      let lastProgressTime = startTime;
      const fileStream = fs.createWriteStream(tempFile);

      response.on('data', (chunk) => {
        transferredBytes += chunk.length;
        fileStream.write(chunk);

        const now = Date.now();
        if (now - lastProgressTime >= 100 || (totalBytes && transferredBytes >= totalBytes)) {
          const elapsedSec = (now - startTime) / 1000;
          const bytesPerSecond = elapsedSec > 0 ? Math.round(transferredBytes / elapsedSec) : 0;
          const percent = totalBytes > 0 ? (transferredBytes / totalBytes) * 100 : 0;

          pendingUpdateProgress = { percent, bytesPerSecond, transferred: transferredBytes, total: totalBytes };
          if (!updateProgressTimer) {
            updateProgressTimer = setTimeout(flushUpdateProgress, 100);
          }
          lastProgressTime = now;
        }
      });

      response.on('end', async () => {
        fileStream.end(async () => {
          clearPendingUpdateProgress();
          try {
            if (fs.existsSync(targetFile)) {
              try { await fs.promises.unlink(targetFile); } catch (_) {}
            }
            await fs.promises.rename(tempFile, targetFile);

            // 运行安全验签
            const signErr = await verifyWindowsCodeSignature(['CN=Zongyi'], targetFile);
            if (signErr) {
              try { await fs.promises.unlink(targetFile); } catch (_) {}
              return reject(new Error(`安全校验失败: ${signErr}`));
            }

            directDownloadedInstallerPath = targetFile;
            isUpdateDownloaded = true;
            updateDownloadedInfo = {
              version: currentAvailableUpdate?.version || 'new',
              downloadedFile: targetFile
            };

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setProgressBar(-1);
            }

            if (Notification.isSupported()) {
              const notif = new Notification({
                title: 'Tasks 更新已准备就绪',
                body: `新版本已下载完成，点击或在设置中重启应用即可完成更新。`,
                urgency: 'normal'
              });
              notif.on('click', () => {
                quitAndInstallUpdate();
              });
              notif.show();
            }

            broadcastToAllWindows('updater-status', { status: 'downloaded', info: updateDownloadedInfo });
            resolve(targetFile);
          } catch (err) {
            reject(err);
          }
        });
      });

      response.on('error', (err) => {
        fileStream.close();
        try { fs.unlinkSync(tempFile); } catch (_) {}
        reject(err);
      });
    });

    request.on('error', (err) => {
      reject(err);
    });

    request.end();
  });
}

function quitAndInstallUpdate() {
  if (directDownloadedInstallerPath && fs.existsSync(directDownloadedInstallerPath)) {
    const { spawn } = require('child_process');
    spawn(directDownloadedInstallerPath, ['--updated'], {
      detached: true,
      stdio: 'ignore'
    }).unref();
    app.exit(0);
    return;
  }
  const updater = getAutoUpdater();
  if (updater && isUpdateDownloaded) {
    updater.quitAndInstall(false, true);
  } else {
    app.relaunch();
    app.exit(0);
  }
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

  isCheckingForUpdate = true;
  try {
    let currentVer = '12.8.0';
    try {
      const versionData = await fs.promises.readFile(path.join(__dirname, 'version.json'), 'utf8');
      currentVer = JSON.parse(versionData).version || currentVer;
    } catch (_) {}

    const updater = getAutoUpdater();
    let autoUpdaterError = null;

    if (updater) {
      try {
        const result = await updater.checkForUpdates();
        if (result) {
          const updateInfo = result.updateInfo;
          const latestVer = updateInfo.version;
          const cmp = compareSemVer(latestVer, currentVer);

          if (cmp > 0 && result.isUpdateAvailable) {
            currentAvailableUpdate = updateInfo;
            return {
              status: 'available',
              updateInfo,
              version: latestVer,
              releaseDate: updateInfo.releaseDate,
              releaseNotes: updateInfo.releaseNotes,
              isDifferential: true
            };
          } else if (cmp < 0) {
            return { status: 'ahead', version: latestVer, currentVersion: currentVer };
          } else {
            return { status: 'not-available', version: latestVer, currentVersion: currentVer };
          }
        }
      } catch (err) {
        autoUpdaterError = err;
        console.warn('[AutoUpdater] electron-updater 检查失败, 尝试启动智能降级引擎:', err.message);
      }
    }

    // 触发 Fallback GitHub Release 检索
    const fallbackRelease = await fetchLatestGitHubReleaseFallback();
    if (fallbackRelease && fallbackRelease.version) {
      const cmp = compareSemVer(fallbackRelease.version, currentVer);
      if (cmp > 0) {
        currentAvailableUpdate = fallbackRelease;
        return {
          status: 'available',
          updateInfo: fallbackRelease,
          version: fallbackRelease.version,
          releaseDate: fallbackRelease.releaseDate,
          releaseNotes: fallbackRelease.releaseNotes,
          downloadUrl: fallbackRelease.downloadUrl,
          releaseUrl: fallbackRelease.releaseUrl,
          isDirectDownload: fallbackRelease.isDirectDownload
        };
      } else if (cmp < 0) {
        return { status: 'ahead', version: fallbackRelease.version, currentVersion: currentVer };
      } else {
        return { status: 'not-available', version: fallbackRelease.version, currentVersion: currentVer };
      }
    }

    if (autoUpdaterError) {
      return {
        status: 'error',
        error: formatFriendlyUpdaterError(autoUpdaterError),
        releaseUrl: 'https://github.com/Zongyil/Tasks/releases'
      };
    }

    return { status: 'not-available', version: currentVer };
  } finally {
    isCheckingForUpdate = false;
  }
});

ipcMain.handle('start-download-update', async () => {
  if (isUpdateDownloaded) {
    return { status: 'downloaded', info: updateDownloadedInfo };
  }

  if (isDownloadingUpdate) {
    return { status: 'downloading' };
  }
  isDownloadingUpdate = true;

  const updater = getAutoUpdater();

  // 若 autoUpdater 已经成功识别更新配置，优先尝试差分下载
  if (updater && updater.updateInfoAndProvider) {
    try {
      await updater.downloadUpdate();
      return { status: 'downloading' };
    } catch (diffErr) {
      console.warn('[AutoUpdater] 差分更新失败, 自动回退全量下载:', diffErr.message);
      try {
        updater.disableDifferentialDownload = true;
        await updater.downloadUpdate();
        return { status: 'downloading' };
      } catch (fullErr) {
        console.error('[AutoUpdater] 全量更新下载失败:', fullErr.message);
      }
    }
  }

  // 若 autoUpdater 无法直接下载（如 Release 缺少 latest.yml），采用 directDownload 回退机制
  if (currentAvailableUpdate && currentAvailableUpdate.downloadUrl && currentAvailableUpdate.isDirectDownload) {
    try {
      downloadDirectInstaller(currentAvailableUpdate.downloadUrl, currentAvailableUpdate.assetName)
        .then(() => {
          isDownloadingUpdate = false;
        })
        .catch((err) => {
          isDownloadingUpdate = false;
          console.error('[AutoUpdater] 直接下载安装包失败:', err);
          broadcastToAllWindows('updater-status', { status: 'error', error: formatFriendlyUpdaterError(err) });
        });
      return { status: 'downloading' };
    } catch (err) {
      isDownloadingUpdate = false;
      return { status: 'error', error: formatFriendlyUpdaterError(err) };
    }
  }

  isDownloadingUpdate = false;
  return { status: 'error', error: '未找到可用的安装包下载地址' };
});

ipcMain.handle('quit-and-install-update', () => {
  quitAndInstallUpdate();
});

// 外部超链接安全打开处理 (仅限 http/https)
ipcMain.on('open-external', (event, targetUrl) => {
  if (typeof targetUrl === 'string' && (targetUrl.startsWith('https://') || targetUrl.startsWith('http://'))) {
    shell.openExternal(targetUrl).catch((err) => {
      console.warn('打开外部链接失败:', err);
    });
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
  let contextMenuIdleDestroyTimer = null;

  function showMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    bringWindowToFront(mainWindow);
  }

  function scheduleContextMenuIdleDestroy() {
    if (contextMenuIdleDestroyTimer) clearTimeout(contextMenuIdleDestroyTimer);
    contextMenuIdleDestroyTimer = setTimeout(() => {
      contextMenuIdleDestroyTimer = null;
      if (contextMenuWindow && !contextMenuWindow.isDestroyed() && !contextMenuWindow.isVisible()) {
        try {
          contextMenuWindow.destroy();
        } catch (_) {}
        contextMenuWindow = null;
        contextMenuReadyPromise = null;
      }
    }, 20000);
    contextMenuIdleDestroyTimer.unref?.();
  }

  function createContextMenuWindow() {
    if (contextMenuIdleDestroyTimer) {
      clearTimeout(contextMenuIdleDestroyTimer);
      contextMenuIdleDestroyTimer = null;
    }

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
        scheduleContextMenuIdleDestroy();
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

  ipcMain.on('trim-memory', () => {
    performBackgroundMemoryRelease();
  });

  ipcMain.on('set-window-title', (_event, title) => {
    if (mainWindow && !mainWindow.isDestroyed() && typeof title === 'string') {
      mainWindow.setTitle(title);
    }
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

    // 监听系统电源与锁屏状态, 联动降载引擎并广播至所有窗口
    if (powerMonitor) {
      powerMonitor.on('suspend', () => {
        isSystemSuspended = true;
        broadcastToAllWindows('system-suspend');
        evaluatePerformanceThrottle();
        rescheduleCpuMonitor();
      });
      powerMonitor.on('resume', () => {
        isSystemSuspended = false;
        broadcastToAllWindows('system-resume');
        evaluatePerformanceThrottle();
        rescheduleCpuMonitor(true);
      });
      powerMonitor.on('lock-screen', () => {
        isSystemLocked = true;
        broadcastToAllWindows('system-lock-screen');
        evaluatePerformanceThrottle();
        rescheduleCpuMonitor();
      });
      powerMonitor.on('unlock-screen', () => {
        isSystemLocked = false;
        broadcastToAllWindows('system-unlock-screen');
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

    // 初始化全局日程闹钟调度器 (支持托盘/后台持续监听)
    loadAlarmsFromDisk();
    loadRingtoneFromDisk();
    startAlarmScheduler();
  });

  app.on('before-quit', () => {
    app.isQuiting = true;
    stopCpuMonitor();
    stopAlarmScheduler();
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
    if (contextMenuIdleDestroyTimer) {
      clearTimeout(contextMenuIdleDestroyTimer);
      contextMenuIdleDestroyTimer = null;
    }
  });
}

// ======= 全局日程闹钟主进程持久化与高精度调度引擎 =======
let globalAlarms = [];
let globalRingtone = null;
let alarmSchedulerTimer = null;

function getAlarmsFilePath() {
  return path.join(app.getPath('userData'), 'alpha_alarms.json');
}

function getRingtoneFilePath() {
  return path.join(app.getPath('userData'), 'alpha_ringtone.json');
}

function loadAlarmsFromDisk() {
  try {
    const filePath = getAlarmsFilePath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        globalAlarms = parsed;
      }
    }
  } catch (err) {
    console.error('Failed to load alarms from disk:', err);
  }
}

function saveAlarmsToDisk() {
  try {
    const filePath = getAlarmsFilePath();
    fs.writeFileSync(filePath, JSON.stringify(globalAlarms, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save alarms to disk:', err);
  }
}

function loadRingtoneFromDisk() {
  try {
    const filePath = getRingtoneFilePath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      globalRingtone = JSON.parse(data);
    }
  } catch (err) {
    globalRingtone = null;
  }
}

function saveRingtoneToDisk(ringtone) {
  try {
    globalRingtone = ringtone;
    const filePath = getRingtoneFilePath();
    fs.writeFileSync(filePath, JSON.stringify(ringtone, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save ringtone to disk:', err);
  }
}

function stopAlarmAll() {
  const windows = [mainWindow, taskHubSmWindow, taskFlowSmWindow, taskTimerSmWindow, pipWindow];
  for (const win of windows) {
    if (win && !win.isDestroyed() && win.webContents) {
      try { win.webContents.send('stop-alarm'); } catch (_) {}
    }
  }
}

function triggerAlarm(al) {
  // 1. 发送 Windows / 系统原生 Toast 通知
  if (Notification.isSupported()) {
    const iconPath = path.join(__dirname, 'Icon.png');
    const notification = new Notification({
      title: `日程提醒: ${al.time} 到了!`,
      body: al.name || '日程提醒',
      icon: fs.existsSync(iconPath) ? iconPath : undefined,
      urgency: 'critical',
      timeoutType: 'never',
      silent: false
    });

    notification.on('click', () => {
      stopAlarmAll();
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      }
    });

    notification.on('close', () => {
      stopAlarmAll();
    });

    notification.show();
  }

  // 2. 向所有窗口广播闹钟触发事件
  const windows = [mainWindow, taskHubSmWindow, taskFlowSmWindow, taskTimerSmWindow, pipWindow];
  for (const win of windows) {
    if (win && !win.isDestroyed() && win.webContents) {
      try {
        win.webContents.send('alarm-triggered', {
          id: al.id,
          time: al.time,
          name: al.name,
          triggeredDay: al.triggeredDay
        });
      } catch (_) {}
    }
  }
}

function checkAlarmsTick() {
  if (!globalAlarms || !globalAlarms.length) return;
  const now = new Date();
  const currentHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const todayStr = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

  let hasTriggered = false;
  for (const al of globalAlarms) {
    if (al && al.time === currentHM && al.triggeredDay !== todayStr) {
      al.triggeredDay = todayStr;
      hasTriggered = true;
      triggerAlarm(al);
    }
  }

  if (hasTriggered) {
    saveAlarmsToDisk();
  }
}

function startAlarmScheduler() {
  if (alarmSchedulerTimer) clearInterval(alarmSchedulerTimer);
  alarmSchedulerTimer = setInterval(checkAlarmsTick, 1000);
  alarmSchedulerTimer.unref?.();
}

function stopAlarmScheduler() {
  if (alarmSchedulerTimer) {
    clearInterval(alarmSchedulerTimer);
    alarmSchedulerTimer = null;
  }
}

// ======= 日程闹钟与系统通知 IPC 绑定 =======
ipcMain.on('sync-alarms', (event, alarms) => {
  if (Array.isArray(alarms)) {
    globalAlarms = alarms;
    saveAlarmsToDisk();
  }
});

ipcMain.on('sync-ringtone', (event, ringtoneData) => {
  saveRingtoneToDisk(ringtoneData);
});

ipcMain.handle('get-alarms', () => {
  return globalAlarms;
});

ipcMain.on('stop-alarm-audio', () => {
  stopAlarmAll();
});

ipcMain.on('show-alarm-notification', (event, { title, body }) => {
  if (!Notification.isSupported()) return;
  const iconPath = path.join(__dirname, 'Icon.png');
  const notification = new Notification({
    title: title || 'TaskHub 日程提醒',
    body: body || '',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    urgency: 'critical',
    timeoutType: 'never',
    silent: false
  });

  notification.on('click', () => {
    stopAlarmAll();
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  notification.on('close', () => {
    stopAlarmAll();
  });

  notification.show();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})