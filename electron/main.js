const { app, BrowserWindow, Tray, Menu, dialog } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')

const PORT = 8000
const isDev = !app.isPackaged

let ffmpegPath = null
try {
  ffmpegPath = require('ffmpeg-static')
} catch (e) {
  // ffmpeg-static not available
}

// Dev: app files are one level up (C:\shape\playlist\)
// Packaged: data (mp3, json) lives next to the .exe
const appRoot = isDev ? path.join(__dirname, '..') : path.dirname(app.getPath('exe'))
const dataDir = appRoot

const serverScript = isDev
  ? path.join(appRoot, 'server.py')
  : path.join(process.resourcesPath, 'server.py')

let pythonProcess = null
let mainWindow = null
let tray = null
let isQuitting = false

const fs = require('fs')
const logPath = path.join(dataDir, 'budburry.log')

function log(msg) {
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`)
}

function startPythonServer() {
  log(`dataDir: ${dataDir}`)
  log(`serverScript: ${serverScript}`)
  log(`serverScript exists: ${fs.existsSync(serverScript)}`)
  log(`ffmpegPath: ${ffmpegPath}`)

  const env = { ...process.env, PLAYLIST_ROOT: dataDir }
  if (ffmpegPath) {
    const ffmpegDir = path.dirname(ffmpegPath)
    env.PATH = ffmpegDir + path.delimiter + (process.env.PATH || '')
    env.FFMPEG_PATH = ffmpegPath
  }

  pythonProcess = spawn('python', [serverScript], {
    cwd: dataDir,
    env,
    windowsHide: true,
    shell: true,
  })

  pythonProcess.stdout.on('data', (d) => log(`stdout: ${d}`))
  pythonProcess.stderr.on('data', (d) => log(`stderr: ${d}`))
  pythonProcess.on('error', (err) => log(`spawn error: ${err.message}`))
  pythonProcess.on('exit', (code) => log(`exit code: ${code}`))
}

function waitForServer(maxRetries = 30) {
  return new Promise((resolve, reject) => {
    let tries = 0
    const attempt = () => {
      const req = http.get(`http://127.0.0.1:${PORT}`, () => resolve())
      req.on('error', () => {
        if (++tries >= maxRetries) return reject(new Error('timeout'))
        setTimeout(attempt, 400)
      })
      req.setTimeout(400, () => { req.destroy() })
    }
    attempt()
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(appRoot, 'icons', 'icon.ico'),
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    backgroundColor: '#161616',
    show: false,
    autoHideMenuBar: true,
  })

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`)
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow.webContents.executeJavaScript('document.getElementById("audio-player").pause()')
      mainWindow.hide()
    }
  })
}

function createTray() {
  tray = new Tray(path.join(appRoot, 'icons', 'icon.ico'))
  tray.setToolTip("Budburry's")
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Otvoriť', click: () => { mainWindow.show(); mainWindow.focus() } },
    { type: 'separator' },
    { label: 'Zatvoriť', click: () => { isQuitting = true; app.quit() } },
  ]))
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus() })
}

app.whenReady().then(async () => {
  startPythonServer()
  try {
    await waitForServer()
    createWindow()
    createTray()
  } catch {
    dialog.showErrorBox(
      'Chyba spustenia',
      'Server sa nepodarilo spustiť.\nUisti sa že máš nainštalovaný Python a je dostupný v PATH.'
    )
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  if (pythonProcess) pythonProcess.kill()
})

app.on('window-all-closed', () => {})
