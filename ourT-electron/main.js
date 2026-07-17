'use strict';

/**
 * main.js — Electron main process for ourT
 *
 * On launch:
 *  1. Forks server/index.js as a child process
 *  2. Waits for "READY:<port>" on stdout
 *  3. Opens three BrowserWindows: projection, monitor, control
 *  4. Adds a system tray icon with a menu
 *  5. On quit: kills the server child process
 */

const {
  app, BrowserWindow, Tray, Menu, nativeImage, ipcMain,
} = require('electron');
const { fork }  = require('child_process');
const path      = require('path');
const os        = require('os');
const fs        = require('fs');
const { WebSocket } = require('ws'); // main process is plain Node — no browser globals
const { isBuildExpired, nextExpiryCheckDelay } = require('./build-expiry');

// ── Paths ──────────────────────────────────────────────────────────────────────
// In development: resources live at ../../server relative to this file.
// In packaged app: electron-builder copies server/ to Resources/server/.
const IS_PACKAGED = app.isPackaged;
const SERVER_DIR  = IS_PACKAGED
  ? path.join(process.resourcesPath, 'server')
  : path.join(__dirname, '../server');
const SERVER_ENTRY = path.join(SERVER_DIR, 'index.js');
const BUNDLED_SONGS_DIR = path.join(SERVER_DIR, '../songs');

// User config has one canonical location in Application Support.
const USER_DATA   = app.getPath('userData');
const SETTINGS_PATH = path.join(USER_DATA, 'settings.json');
const LEGACY_ENV_PATH = path.join(USER_DATA, '.env');
const RUNTIME_SONGS_DIR = path.join(USER_DATA, 'songs');
const { seedSongsDirectory } = require(path.join(SERVER_DIR, 'lib/song-storage'));

// ── State ──────────────────────────────────────────────────────────────────────
let serverProcess  = null;
let serverPort     = 3000;
let tray           = null;
let projectionWin  = null;
let monitorWin     = null;
let controlWin     = null;
let expiryTimer    = null;

// ── App ready ──────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  if (exitIfBuildExpired()) return;
  ensureSettingsDirectory();
  ensureSongsDirectory();
  await startServer();
  openWindows();
  connectBus();
  createTray();
  scheduleExpiryCheck();
});

app.on('before-quit', () => {
  clearTimeout(expiryTimer);
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
});

function exitIfBuildExpired() {
  if (!isBuildExpired(IS_PACKAGED)) return false;
  const { dialog } = require('electron');
  dialog.showErrorBox('ourT 已到期', '此版本的使用期限已於 2026 年 9 月 1 日結束，無法繼續執行。');
  app.quit();
  return true;
}

function scheduleExpiryCheck() {
  if (!IS_PACKAGED) return;
  const delay = nextExpiryCheckDelay();
  expiryTimer = setTimeout(() => {
    if (exitIfBuildExpired()) return;
    scheduleExpiryCheck();
  }, delay);
}

// On macOS clicking the dock icon when all windows are closed re-opens them
app.on('activate', () => {
  if (!projectionWin || projectionWin.isDestroyed()) openWindows();
});

// ── Canonical settings setup ───────────────────────────────────────────────────
function ensureSettingsDirectory() {
  if (!fs.existsSync(USER_DATA)) fs.mkdirSync(USER_DATA, { recursive: true });
}

function ensureSongsDirectory() {
  if (IS_PACKAGED) seedSongsDirectory(BUNDLED_SONGS_DIR, RUNTIME_SONGS_DIR);
}

// ── Server start ───────────────────────────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = fork(SERVER_ENTRY, [], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        OURT_SETTINGS_PATH: SETTINGS_PATH,
        OURT_LEGACY_SETTINGS_PATH: path.join(SERVER_DIR, 'settings.json'),
        OURT_LEGACY_ENV_PATH: LEGACY_ENV_PATH,
        OURT_SONGS_DIR: IS_PACKAGED ? RUNTIME_SONGS_DIR : BUNDLED_SONGS_DIR,
        NODE_ENV: 'production',
      },
      silent: true,  // capture stdout/stderr
    });

    const timeout = setTimeout(() => {
      reject(new Error('Server did not start within 15 seconds'));
    }, 15000);

    serverProcess.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      process.stdout.write(`[server] ${text}`);

      // Detect readiness line: "READY:3000"
      const match = text.match(/READY:(\d+)/);
      if (match) {
        serverPort = parseInt(match[1], 10);
        clearTimeout(timeout);
        resolve();
      }
    });

    serverProcess.stderr.on('data', (chunk) => {
      process.stderr.write(`[server] ${chunk}`);
    });

    serverProcess.on('exit', (code) => {
      console.log(`[server] exited with code ${code}`);
    });

    serverProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ── Window factory ─────────────────────────────────────────────────────────────
function createWindow(opts) {
  const win = new BrowserWindow({
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    ...opts,
  });
  win.on('closed', () => {});
  return win;
}

/**
 * Toggle the projection window between windowed and fullscreen.
 *
 * Uses the platform-native setFullScreen() rather than kiosk mode. Kiosk mode
 * was tried first for a more aggressive edge-to-edge surface, but is a known
 * unreliable Electron/macOS combination (see electron/electron#35684,
 * #38261, #1054 — dock/menu bar and the actual fullscreen transition don't
 * consistently happen together). setFullScreen() is the standard, reliable
 * mechanism on both macOS (native fullscreen Space, menu bar/dock auto-hide
 * as part of that transition) and Windows (OS fullscreen, covers the
 * taskbar) — i.e. "whatever the OS itself calls fullscreen," matching how a
 * user would expect this app to behave relative to any other app.
 *
 * Note: BrowserWindow has no setFrame() method on any platform — the frame
 * can only be set at window creation, never toggled at runtime.
 *
 * @returns {boolean} the resulting fullscreen state, or null if there is no
 *   projection window to toggle.
 */
function toggleProjectionFullscreen() {
  try {
    if (!projectionWin || projectionWin.isDestroyed()) return null;
    const isFull = projectionWin.isFullScreen();
    projectionWin.setFullScreen(!isFull);
    console.log(`[main] projection fullscreen → ${!isFull}`);
    return !isFull;
  } catch (error) {
    console.error('[main] toggleProjectionFullscreen failed:', error.message);
    return null;
  }
}

function base(url) {
  return `http://localhost:${serverPort}${url}`;
}

function openControlSettings() {
  const settingsUrl = base('/control?settings=1');
  if (!controlWin || controlWin.isDestroyed()) {
    controlWin = createWindow({ title: 'ourT — Control', x: 60, y: 60, width: 420, height: 900 });
    controlWin.loadURL(settingsUrl);
    controlWin.on('closed', () => { controlWin = null; });
  } else {
    controlWin.loadURL(settingsUrl);
    controlWin.show();
    controlWin.focus();
  }
}

function openWindows() {
  // ── Projection: windowed by default, can go fullscreen via tray/control ───────────
  projectionWin = createWindow({
    title:      'ourT — Projection',
    fullscreen: false,
    fullscreenable: true,
    frame:      true,
    alwaysOnTop: false,
    width:      1280,
    height:     720,
    // Put on the primary display
  });
  projectionWin.loadURL(base('/projection'));
  projectionWin.on('closed', () => { projectionWin = null; });

  // ── Monitor: performer stage monitor ────────────────────────────────────────
  // Try to position on the secondary display if one exists
  const { screen } = require('electron');
  const displays  = screen.getAllDisplays();
  const secondary = displays.find((d) => d.id !== screen.getPrimaryDisplay().id);

  const monitorBounds = secondary
    ? { x: secondary.bounds.x, y: secondary.bounds.y, width: 900, height: 560 }
    : { width: 900, height: 560 };

  monitorWin = createWindow({
    title:      'ourT — Monitor',
    alwaysOnTop: true,
    ...monitorBounds,
  });
  monitorWin.loadURL(base('/monitor'));
  monitorWin.on('closed', () => { monitorWin = null; });

  // ── Control: operator panel ──────────────────────────────────────────────────
  controlWin = createWindow({
    title:  'ourT — Control',
    x:      60,
    y:      60,
    width:  420,
    height: 900,
  });
  controlWin.loadURL(base('/control'));
  controlWin.on('closed', () => { controlWin = null; });
}

// ── System tray ────────────────────────────────────────────────────────────────
function createTray() {
  // Use a 16×16 template image; fall back to a blank image
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('ourT');

  const menuTemplate = [
    {
      label: '開啟投影畫面',
      click: () => {
        if (!projectionWin || projectionWin.isDestroyed()) {
          projectionWin = createWindow({ title: 'ourT — Projection', width: 1280, height: 720 });
          projectionWin.loadURL(base('/projection'));
        } else {
          projectionWin.show();
        }
      },
    },
    {
      label: '開啟演員監看',
      click: () => {
        if (!monitorWin || monitorWin.isDestroyed()) {
          monitorWin = createWindow({ title: 'ourT — Monitor', width: 900, height: 560, alwaysOnTop: true });
          monitorWin.loadURL(base('/monitor'));
        } else {
          monitorWin.show();
        }
      },
    },
    {
      label: '開啟控制台',
      click: () => {
        if (!controlWin || controlWin.isDestroyed()) {
          controlWin = createWindow({ title: 'ourT — Control', x: 60, y: 60, width: 420, height: 900 });
          controlWin.loadURL(base('/control'));
        } else {
          controlWin.show();
        }
      },
    },
    { type: 'separator' },
    {
      label: '複製觀眾點歌網址',
      click: () => {
        const { clipboard } = require('electron');
        // Get local IP
        const nets = os.networkInterfaces();
        let localIP = 'localhost';
        for (const ifaces of Object.values(nets)) {
          for (const iface of ifaces) {
            if (iface.family === 'IPv4' && !iface.internal) {
              localIP = iface.address; break;
            }
          }
        }
        clipboard.writeText(`http://${localIP}:${serverPort}/audience`);
        tray.setToolTip(`已複製：http://${localIP}:${serverPort}/audience`);
      },
    },
    {
      label: '開啟系統設定',
      click: () => openControlSettings(),
    },
    {
      label: '切換投影全螢幕',
      click: () => toggleProjectionFullscreen(),
    },
    { type: 'separator' },
    {
      label: '結束 ourT',
      role:  'quit',
    },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
  tray.on('click', () => tray.popUpContextMenu());
}

// ── IPC: control panel → main process ──────────────────────────────────────────
ipcMain.handle('projection:toggle-fullscreen', () => toggleProjectionFullscreen());

// ── Bus WebSocket connection (main process) ────────────────────────────────────
let busWs = null;
let busReconnectTimer = null;

function connectBus() {
  if (busWs && busWs.readyState === WebSocket.OPEN) return;
  const wsUrl = `ws://localhost:${serverPort}/ws/bus?role=main`;
  busWs = new WebSocket(wsUrl);

  busWs.onopen = () => {
    console.log('[main] Connected to bus');
    clearTimeout(busReconnectTimer);
  };

  busWs.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === 'projection.fullscreen') {
      toggleProjectionFullscreen();
    }
  };

  busWs.onclose = () => {
    console.log('[main] Bus disconnected, reconnecting in 3s...');
    busReconnectTimer = setTimeout(connectBus, 3000);
  };

  busWs.onerror = (err) => {
    console.error('[main] Bus error:', err.message);
  };
}
