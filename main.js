const { app, BrowserWindow, ipcMain, protocol, net, webFrameMain, Notification } = require('electron')
const path = require('path')
const { Worker } = require('worker_threads')
app.commandLine.appendSwitch('disable-features', 'OverlayScrollbar');
const { pathToFileURL } = require('url') 

let mainWindow = null
let splashWindow = null
let pipWindow = null           // 缓存画中画窗口引用, 避免重复遍历

// ======= Main Process Worker Thread Manager =======
let mainWorker = null
let taskIdCounter = 0
const pendingWorkerTasks = new Map()

function initMainWorker() {
  if (mainWorker) return
  try {
    const workerPath = path.join(__dirname, 'main_worker.js')
    mainWorker = new Worker(workerPath)
    mainWorker.on('message', (data) => {
      const { taskId, success, result, error } = data
      if (pendingWorkerTasks.has(taskId)) {
        const { resolve, reject } = pendingWorkerTasks.get(taskId)
        pendingWorkerTasks.delete(taskId)
        if (success) resolve(result)
        else reject(new Error(error))
      }
    })
    mainWorker.on('error', (err) => {
      console.error('Main worker error:', err)
      mainWorker = null
    })
  } catch (e) {
    console.error('Failed to initialize main worker:', e)
  }
}

function runMainWorkerTask(action, payload = {}) {
  initMainWorker()
  if (!mainWorker) {
    return Promise.reject(new Error('Worker threads unavailable'))
  }
  return new Promise((resolve, reject) => {
    const taskId = ++taskIdCounter
    pendingWorkerTasks.set(taskId, { resolve, reject })
    mainWorker.postMessage({ taskId, action, payload })
  })
}


let cachedPipWidth = 0
let cachedPipHeight = 0
let initialDomX = null
let initialDomY = null
let initialPhysicalX = 0
let initialPhysicalY = 0

let splashFadeInTimer = null    // 淡入动画定时器
let bringToFrontTimer = null    // 主窗口置顶延时定时器

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 800,
    minWidth: 750,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin' && {
      titleBarOverlay: {
        color: 'rgba(0, 0, 0, 0)',
        symbolColor: '#0f172a',
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
      
      const bounds = window.getBounds()
      window.setAspectRatio(bounds.width / bounds.height)

      window.on('closed', () => {
        if (pipWindow === window) {
          pipWindow = null
        }
      })
    }
  })

  mainWindow.loadFile('wrapper.html')
  // 主窗口 ready-to-show 无需额外操作, 直接等待 splash 退出
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })
}

// ======= 小窗拖拽逻辑 =======
ipcMain.on('start-pip-drag', () => {
  if (pipWindow && !pipWindow.isDestroyed()) {
    const bounds = pipWindow.getBounds()
    cachedPipWidth = bounds.width
    cachedPipHeight = bounds.height
    initialDomX = null
    initialDomY = null
  }
})

ipcMain.on('move-pip-window', (event, x, y) => {
  if (!pipWindow || pipWindow.isDestroyed()) return
  if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) return
  if (pipWindow.isMaximized() || pipWindow.isFullScreen()) return

  try {
    if (initialDomX === null || initialDomY === null) {
      initialDomX = x
      initialDomY = y
      const bounds = pipWindow.getBounds()
      initialPhysicalX = bounds.x
      initialPhysicalY = bounds.y
    }

    pipWindow.setBounds({
      x: Math.round(initialPhysicalX + (x - initialDomX)),
      y: Math.round(initialPhysicalY + (y - initialDomY)),
      width: cachedPipWidth,
      height: cachedPipHeight
    })
  } catch (e) {
    // 忽略拖拽过程中的异常
  }
})

ipcMain.on('stop-pip-drag', () => {
  initialDomX = null
  initialDomY = null
})

// 处理窗口控制
ipcMain.on('window-minimize', () => mainWindow?.minimize())
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window-close', () => mainWindow?.close())

ipcMain.on('bring-main-to-front', () => {
  if (!mainWindow) return
  // 防止短时间内多次调用导致 alwaysOnTop 状态异常
  if (bringToFrontTimer) clearTimeout(bringToFrontTimer)

  mainWindow.setAlwaysOnTop(true)
  mainWindow.show()
  mainWindow.focus()

  bringToFrontTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false)
    }
    bringToFrontTimer = null
  }, 200)
})

let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
  console.warn('electron-updater 模块未加载 (可能处于纯本地开发/无 node_modules 环境):', e.message);
}

let isUpdateDownloaded = false;
let updateDownloadedInfo = null;

function setupAutoUpdater() {
  if (!autoUpdater) return;

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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }
    mainWindow?.webContents.send('updater-status', {
      status: 'error',
      error: err ? (err.message || String(err)) : '未知错误'
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    // 实时同步任务栏进度 (0.0 ~ 1.0)
    if (mainWindow && !mainWindow.isDestroyed()) {
      const progressRatio = Math.min(Math.max((progressObj.percent || 0) / 100, 0), 1);
      mainWindow.setProgressBar(progressRatio);
    }
    // 实时推送进度给 settings.html
    mainWindow?.webContents.send('updater-progress', {
      percent: progressObj.percent || 0,
      bytesPerSecond: progressObj.bytesPerSecond || 0,
      transferred: progressObj.transferred || 0,
      total: progressObj.total || 0
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
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
          autoUpdater.quitAndInstall();
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
ipcMain.handle('read-version-json', async () => {
  try {
    return await runMainWorkerTask('read-version-json');
  } catch (e) {
    try {
      const fs = require('fs');
      const versionPath = path.join(__dirname, 'version.json');
      const content = await fs.promises.readFile(versionPath, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      console.error('读取 version.json 失败:', err);
      return null;
    }
  }
});


ipcMain.handle('check-for-update', async () => {
  if (isUpdateDownloaded) {
    return { status: 'downloaded', info: updateDownloadedInfo };
  }
  if (!autoUpdater) {
    return { status: 'unavailable', message: 'electron-updater 未就绪' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
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
  if (!autoUpdater) {
    return { status: 'unavailable', message: 'electron-updater 未就绪' };
  }
  try {
    await autoUpdater.downloadUpdate();
    return { status: 'downloading' };
  } catch (e) {
    console.error('触发下载更新失败:', e);
    return { status: 'error', error: e.message };
  }
});

ipcMain.handle('quit-and-install-update', () => {
  if (autoUpdater && isUpdateDownloaded) {
    autoUpdater.quitAndInstall();
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

function parseInstancePayload(commandLine, workingDirectory, additionalData) {
  const url = extractProtocolUrl(commandLine);
  return {
    commandLine: commandLine || [],
    workingDirectory: workingDirectory || '',
    additionalData: additionalData || null,
    url: url,
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
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();

      // 在 Windows 上通过 short alwaysOnTop 强制拉到最前端
      if (bringToFrontTimer) clearTimeout(bringToFrontTimer);
      mainWindow.setAlwaysOnTop(true);
      bringToFrontTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(false);
        }
        bringToFrontTimer = null;
      }, 200);
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

  app.whenReady().then(() => {
    setupProtocolClient();

    // 注册协议:保证字体正常加载
    protocol.handle('local-font', (request) => {
      let fileName = decodeURIComponent(request.url.slice('local-font://'.length));
      fileName = path.basename(fileName);
      const filePath = path.join(__dirname, 'fonts', fileName);
      return net.fetch(pathToFileURL(filePath).href);
    });

    setupAutoUpdater();

    // 建立唯一的带有系统材质的主窗口
    createWindow(); 
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