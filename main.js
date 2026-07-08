const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

let mainWindow = null
let splashWindow = null

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 440,
    height: 320,
    frame: false,
    transparent: true,      
    backgroundColor: '#00000000', 
    roundedCorners: false,  
    alwaysOnTop: true,
    resizable: false,
    opacity: 0,             // [核心补丁] 初始完全透明，为原生淡入做准备
    webPreferences: { nodeIntegration: false }
  })
  splashWindow.loadFile('splash.html')
  splashWindow.center()

  // 当内容加载完成后，触发高频原生淡入
  splashWindow.once('ready-to-show', () => {
    splashWindow.show()
    let opacity = 0
    const fadeInTimer = setInterval(() => {
      opacity += 0.04 // 步长，可调节淡入速度
      if (opacity >= 1) {
        splashWindow.setOpacity(1)
        clearInterval(fadeInTimer)
      } else {
        splashWindow.setOpacity(opacity)
      }
    }, 16) // ~60fps 丝滑渲染
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
        // 保持透明，让底部的毛玻璃透上来
        color: '#00000000', 
        // 不用纯黑，用 Project ALPHA 的深岩灰色，过渡更自然
        symbolColor: '#0f172a', 
        height: 44
      }
    }),
    backgroundMaterial: 'mica',
    show: false,  // 保持隐藏，等待 splash 关闭后再显示
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  mainWindow.loadFile('wrapper.html')

  // 仅准备就绪，但不显示
  mainWindow.once('ready-to-show', () => {
    // 不再调用 show()
  })

  // 监听来自渲染进程的 splash 关闭信号
  ipcMain.on('splash-ready', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      let opacity = 1
      // [核心补丁] 收到就绪信号后，先执行原生淡出，再销毁窗口并唤醒主界面
      const fadeOutTimer = setInterval(() => {
        opacity -= 0.04 // 步长，可调节淡出速度
        if (opacity <= 0) {
          clearInterval(fadeOutTimer)
          splashWindow.close()
          // 消隐完成后，丝滑展现主视窗
          if (mainWindow) {
            mainWindow.show()
          }
        } else {
          splashWindow.setOpacity(opacity)
        }
      }, 16)
    } else {
      if (mainWindow) mainWindow.show()
    }
  })

  ipcMain.on('window-minimize', () => mainWindow.minimize())
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window-close', () => mainWindow.close())
}

app.whenReady().then(() => {
  createSplash()
  setTimeout(createWindow, 300)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})