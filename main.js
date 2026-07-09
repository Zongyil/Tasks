const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

let mainWindow = null
let splashWindow = null
let pipWindow = null            // 缓存画中画窗口引用, 避免重复遍历

let cachedPipWidth = 0
let cachedPipHeight = 0
let initialDomX = null
let initialDomY = null
let initialPhysicalX = 0
let initialPhysicalY = 0

let splashFadeInTimer = null    // 淡入动画定时器
let bringToFrontTimer = null    // 主窗口置顶延时定时器
let splashTimeout = null        // splash 超时兜底定时器

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 440,
    height: 320,
    frame: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      height: 1,
      color: '#f2f5f900',
      symbolColor: '#f2f5f900'
    },
    closable: false,
    minimizable: false,
    maximizable: false,
    transparent: false,
    backgroundColor: '#f2f5f9',
    roundedCorners: true,
    alwaysOnTop: true,
    resizable: false,
    opacity: 0,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  splashWindow.loadFile('splash.html')
  splashWindow.center()

  splashWindow.once('ready-to-show', () => {
    splashWindow.show()
    // 保留原有淡入动画（约 320ms, 与之前完全一致）
    let opacity = 0
    splashFadeInTimer = setInterval(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        opacity += 0.05
        if (opacity >= 1) {
          splashWindow.setOpacity(1)
          clearInterval(splashFadeInTimer)
          splashFadeInTimer = null
        } else {
          splashWindow.setOpacity(opacity)
        }
      } else {
        // 窗口已意外销毁, 停止动画
        clearInterval(splashFadeInTimer)
        splashFadeInTimer = null
      }
    }, 16)
  })

  // 窗口关闭时清理定时器, 避免泄漏
  splashWindow.on('closed', () => {
    if (splashFadeInTimer) {
      clearInterval(splashFadeInTimer)
      splashFadeInTimer = null
    }
    splashWindow = null
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin' && {
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#0f172a',
        height: 44
      }
    }),
    backgroundMaterial: 'mica',
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
  createSplash()
  setTimeout(createWindow, 300)

  // splash 超时保护: 若 8 秒内未收到就绪信号, 强制显示主窗口并销毁 splash
  splashTimeout = setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.destroy()
      splashWindow = null
    }
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  }, 8000)

  // splash 就绪后, 启动退出动画
  ipcMain.on('splash-ready', () => {
    if (splashTimeout) {
      clearTimeout(splashTimeout)
      splashTimeout = null
    }
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('splash-start-exit')
    } else {
      // splash 已意外关闭, 直接显示主窗口
      if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })

  // splash 退出动画完成后, 淡出并强制销毁
  ipcMain.on('splash-exit-done', () => {
    if (splashTimeout) {
      clearTimeout(splashTimeout)
      splashTimeout = null
    }

    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }

    if (splashWindow && !splashWindow.isDestroyed()) {
      let opacity = 1
      const fadeOut = setInterval(() => {
        if (splashWindow && !splashWindow.isDestroyed()) {
          opacity -= 0.1
          try {
            if (opacity <= 0) {
              clearInterval(fadeOut)
              splashWindow.destroy()
              splashWindow = null
            } else {
              splashWindow.setOpacity(opacity)
            }
          } catch (error) {
            clearInterval(fadeOut)
            splashWindow.destroy()
            splashWindow = null
          }
        } else {
          clearInterval(fadeOut)
          splashWindow = null
        }
      }, 16)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})