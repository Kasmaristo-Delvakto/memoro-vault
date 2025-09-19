// main.js — whitelist project root, no audio window, inline-friendly CSP

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
process.env.NODE_ENV = 'production';

const fs = require('fs');
const path = require('path');
const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  session,
  globalShortcut,
  Menu
} = require('electron');

// ---- Config ----
const projectRoot = path.resolve(__dirname);
const projectRootLC = projectRoot.toLowerCase();
const ALLOW_DEVTOOLS = true;
app.commandLine.appendSwitch('disable-features', 'Geolocation');

// NEW: cross-platform icon resolver (PNG on Linux, ICO on Windows, PNG on macOS)
function getPlatformIcon() {
  const assets = path.join(projectRoot, 'src', 'assets');
  if (process.platform === 'win32') return path.join(assets, 'memoro-vault.ico');
  if (process.platform === 'darwin') return path.join(assets, 'memoro-logo-white.png'); // you can swap to .icns later
  return path.join(assets, 'memoro-vault.png'); // Linux prefers PNG
}

let mainWindow;
let isQuitting = false;

// --- First-run License Gate (main process) ---
const EULA_FILE = path.join(app.getPath('userData'), 'eula_accepted_v1.json');

function isLicenseAccepted() {
  try {
    const data = JSON.parse(fs.readFileSync(EULA_FILE, 'utf8'));
    return data?.accepted === true;
  } catch {
    return false;
  }
}
function markLicenseAccepted() {
  try {
    fs.writeFileSync(EULA_FILE, JSON.stringify({ accepted: true, ts: Date.now() }), 'utf8');
  } catch (e) {
    console.warn('Could not persist EULA acceptance:', e?.message || e);
  }
}
function createLicenseWindow() {
  const win = new BrowserWindow({
    width: 680,
    height: 560,
    resizable: false,
    modal: true,
    show: false,
    title: 'Memoro Vault — License Agreement',
    icon: getPlatformIcon(), // CHANGED
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      enableRemoteModule: false,
      preload: path.join(projectRoot, 'preload.js')
    }
  });
  win.removeMenu?.();
  win.loadFile(path.join(projectRoot, 'src', 'license.html'));
  win.once('ready-to-show', () => win.show());
  return win;
}
ipcMain.handle('license:accept', async () => { markLicenseAccepted(); return true; });
ipcMain.handle('license:decline', async () => { app.quit(); return false; });

// Convert file:// URL -> local path and check it's under projectRoot
function isPathAllowedFileUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'file:') return false;
    let p = decodeURIComponent(u.pathname);
    if (process.platform === 'win32' && p.startsWith('/')) p = p.slice(1);
    const norm = path.normalize(p);
    return norm.toLowerCase().startsWith(projectRootLC + path.sep);
  } catch {
    return false;
  }
}

async function hardenSession() {
  const ses = session.defaultSession;

  // 1) Only allow file:// under project root; block http/https
  ses.webRequest.onBeforeRequest((details, cb) => {
    const url = details.url || '';
    if (url.startsWith('file://')) return cb({ cancel: !isPathAllowedFileUrl(url) });
    if (/^https?:/i.test(url)) return cb({ cancel: true });
    return cb({ cancel: false });
  });

  // 2) Tight offline CSP
  ses.webRequest.onHeadersReceived((details, cb) => {
    const csp = [
      "default-src 'self' data: blob: filesystem:",
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: filesystem:",
      "font-src 'self' data:",
      "connect-src 'self' data: blob: filesystem: file:",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "worker-src 'self' blob:",
      "media-src 'self' blob:"
    ].join('; ');
    const headers = { ...details.responseHeaders, 'Content-Security-Policy': [csp] };
    cb({ responseHeaders: headers });
  });

  // 3) Camera (video only) permission sample
  const isVideoOnly = (details) => (details?.mediaTypes || []).length === 1 && details.mediaTypes[0] === 'video';
  const isOurRenderer = (wc) => {
    try {
      const url = wc?.getURL?.() || '';
      return url.startsWith('file://') && isPathAllowedFileUrl(url);
    } catch { return false; }
  };
  if (typeof ses.setPermissionCheckHandler === 'function') {
    ses.setPermissionCheckHandler((wc, permission, _origin, details) => {
      if (!isOurRenderer(wc)) return false;
      if (permission === 'media' || permission === 'camera' || permission === 'videoCapture') return isVideoOnly(details);
      return false;
    });
  }
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (isOurRenderer(wc) &&
        (permission === 'media' || permission === 'camera' || permission === 'videoCapture') &&
        isVideoOnly(details)) return callback(true);
    return callback(false);
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    icon: getPlatformIcon(), // CHANGED
    title: 'Memoro Vault',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      enableRemoteModule: false,
      spellcheck: false,
      webgl: false,
      autoplayPolicy: 'document-user-activation-required',
      preload: path.join(projectRoot, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(projectRoot, 'src', 'index.html'));

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isPathAllowedFileUrl(url)) e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('close', async (e) => {
    if (!isQuitting) {
      e.preventDefault();
      isQuitting = true;
      const allWindows = BrowserWindow.getAllWindows();
      for (const win of allWindows) {
        try {
          await Promise.race([
            win.webContents.executeJavaScript(`typeof nukeEverything === 'function' ? nukeEverything() : Promise.resolve();`),
            new Promise(resolve => setTimeout(resolve, 750))
          ]);
        } catch (err) {
          console.warn('Nuke call failed:', err?.message || err);
        }
      }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      app.quit();
    }
  });
}

function createAppWindows() {
  if (!isLicenseAccepted()) {
    const lwin = createLicenseWindow();
    lwin.on('closed', () => {
      if (isLicenseAccepted()) createMainWindow();
      else app.quit();
    });
  } else {
    createMainWindow();
  }
}

// External link allowlist
ipcMain.on('open-external-link', (_event, url) => {
  try {
    const allowedHosts = ['trocador.app', 'github.com'];
    const parsed = new URL(url);
    if (allowedHosts.includes(parsed.hostname)) shell.openExternal(url);
    else console.warn('Blocked unsafe URL:', url);
  } catch {
    console.error('Invalid URL passed to openExternalLink:', url);
  }
});

app.whenReady()
  .then(hardenSession)
  .then(() => {
    Menu.setApplicationMenu(null);
    if (ALLOW_DEVTOOLS) {
      globalShortcut.register('CommandOrControl+Shift+I', () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.toggleDevTools();
      });
      globalShortcut.register('F12', () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.toggleDevTools();
      });
    }
  })
  .then(createAppWindows);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createAppWindows();
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); });
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});
