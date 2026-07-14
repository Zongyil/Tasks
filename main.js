const { app, BrowserWindow, ipcMain, protocol, net, webFrameMain, Notification } = require('electron')
const path = require('path')
app.commandLine.appendSwitch('disable-features', 'OverlayScrollbar');
const { pathToFileURL } = require('url') 

let mainWindow = null
let splashWindow = null
let pipWindow = null           // 缓存画中画窗口引用, 避免重复遍历

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

// ======= 小窗拖拽逻辑（基于缓存的 pipWindow 引用, 性能更优） =======
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

app.whenReady().then(() => {
  // 注册协议：保证字体正常加载
  protocol.handle('local-font', (request) => {
    let fileName = decodeURIComponent(request.url.slice('local-font://'.length));
    fileName = path.basename(fileName);
    const filePath = path.join(__dirname, 'fonts', fileName);
    return net.fetch(pathToFileURL(filePath).href);
  });

  // 万象归一：直接建立唯一的带有系统材质的主窗口！
  createWindow(); 
})

// ======= 日程系统级持续通知逻辑 =======
ipcMain.on('show-alarm-notification', (event, { title, body }) => {
  if (!Notification.isSupported()) return;
  
  const notification = new Notification({
    title: title || 'TaskHub 日程提醒',
    body: body,
    // 👈 彻底移除 actions 数组，绝不给 Windows 拼装双按钮的机会，回归纯净原生视觉
    urgency: 'critical', // Windows/Linux: 提高优先级
    timeoutType: 'never' // Windows: 保持通知不自动消失
  });

  // 1. 核心修复：点击通知的文本/主体任意地方 -> 仅静音，【绝对不】执行窗口恢复或置顶
  notification.on('click', () => {
    if (mainWindow) {
      mainWindow.webContents.send('stop-alarm');
    }
  });

  // 2. 核心修复：点击系统自带的唯一“关闭”按钮（或划走通知） -> 仅静音，【绝对不】打开软件
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