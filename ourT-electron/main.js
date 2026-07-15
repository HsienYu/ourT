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
  app, BrowserWindow, Tray, Menu, shell, dialog, nativeImage, ipcMain,
} = require('electron');
const { fork }  = require('child_process');
const path      = require('path');
const os        = require('os');
const fs        = require('fs');
const { WebSocket } = require('ws'); // main process is plain Node — no browser globals

// ── Paths ──────────────────────────────────────────────────────────────────────
// In development: resources live at ../../server relative to this file.
// In packaged app: electron-builder copies server/ to Resources/server/.
const IS_PACKAGED = app.isPackaged;
const SERVER_DIR  = IS_PACKAGED
  ? path.join(process.resourcesPath, 'server')
  : path.join(__dirname, '../server');
const SERVER_ENTRY = path.join(SERVER_DIR, 'index.js');

// User config lives in ~/Library/Application Support/ourT/.env
const USER_DATA   = app.getPath('userData');
const ENV_PATH    = path.join(USER_DATA, '.env');
const ENV_EXAMPLE = path.join(SERVER_DIR, '.env.example');

// ── State ──────────────────────────────────────────────────────────────────────
let serverProcess  = null;
let serverPort     = 3000;
let tray           = null;
let projectionWin  = null;
let monitorWin     = null;
let controlWin     = null;

// ── App ready ──────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  ensureEnvFile();
  await startServer();
  openWindows();
  connectBus();
  createTray();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
});

// On macOS clicking the dock icon when all windows are closed re-opens them
app.on('activate', () => {
  if (!projectionWin || projectionWin.isDestroyed()) openWindows();
});

// ── .env file setup ────────────────────────────────────────────────────────────
function ensureEnvFile() {
  if (!fs.existsSync(USER_DATA)) fs.mkdirSync(USER_DATA, { recursive: true });

  if (!fs.existsSync(ENV_PATH)) {
    // Copy .env.example as a starting point
    if (fs.existsSync(ENV_EXAMPLE)) {
      fs.copyFileSync(ENV_EXAMPLE, ENV_PATH);
    } else {
      fs.writeFileSync(ENV_PATH,
        '# ourT configuration\nOPENAI_API_KEY=\nANTHROPIC_API_KEY=\nPORT=3000\n', 'utf8');
    }
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'ourT — 首次設定',
      message: '請設定 API 金鑰',
      detail: `在以下位置填入 OPENAI_API_KEY 和 ANTHROPIC_API_KEY 後重新啟動：\n\n${ENV_PATH}`,
      buttons: ['開啟設定檔', '稍後設定'],
    });
    shell.openPath(ENV_PATH);
  }
}

// ── Server start ───────────────────────────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = fork(SERVER_ENTRY, [], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        DOTENV_CONFIG_PATH: ENV_PATH,  // tell dotenv where to look
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

function toggleProjectionFullscreen() {
  if (!projectionWin || projectionWin.isDestroyed()) return;
  const isFull = projectionWin.isFullScreen();
  projectionWin.setFullScreen(!isFull);
  projectionWin.setFrame(!isFull); // frameless when fullscreen, framed when windowed
  console.log(`[main] projection fullscreen → ${!isFull}`);
}

function base(url) {
  return `http://localhost:${serverPort}${url}`;
}

function openWindows() {
  // ── Projection: windowed by default, can go fullscreen via tray/control ───────────
  projectionWin = createWindow({
    title:      'ourT — Projection',
    fullscreen: false,
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
          projectionWin = createWindow({ title: 'ourT — Projection', fullscreen: true, frame: false });
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
          controlWin = createWindow({ title: 'ourT — Control', width: 420, height: 900 });
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
      label: '開啟設定檔',
      click: () => shell.openPath(ENV_PATH),
    },
    {
      label: '切換投影全螢幕',
      click: () => {
        if (projectionWin && !projectionWin.isDestroyed()) {
          const isFull = projectionWin.isFullScreen();
          projectionWin.setFullScreen(!isFull);
        }
      },
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
ipcMain.handle('projection:toggle-fullscreen', () => {
  if (projectionWin && !projectionWin.isDestroyed()) {
    const isFull = projectionWin.isFullScreen();
    projectionWin.setFullScreen(!isFull);
    return !isFull;
  }
  return false;
});

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
      if (projectionWin && !projectionWin.isDestroyed()) {
        const isFull = projectionWin.isFullScreen();
        projectionWin.setFullScreen(!isFull);
        console.log(`[main] projection fullscreen → ${!isFull}`);
      }
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
