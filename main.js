// main.js — whitelist project root, no audio window, inline-friendly CSP

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
process.env.NODE_ENV = 'production';

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
// Whitelist EVERYTHING inside the project folder that contains this file:
const projectRoot = path.resolve(__dirname); // e.g. C:\Users\...\memoro-vault
const projectRootLC = projectRoot.toLowerCase();

// Optional: always allow DevTools (handy while you harden)
const ALLOW_DEVTOOLS = true;

// Disable Chromium geolocation prompt (and other features if you wish)
app.commandLine.appendSwitch('disable-features', 'Geolocation');

let mainWindow;
let isQuitting = false;

// Convert file:// URL -> local path and check it's under projectRoot
function isPathAllowedFileUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'file:') return false;
    // Decode and normalize Windows path
    let p = decodeURIComponent(u.pathname);
    // On Windows, pathname starts with a leading '/' like /C:/...
    if (process.platform === 'win32' && p.startsWith('/')) p = p.slice(1);
    const norm = path.normalize(p);
    return norm.toLowerCase().startsWith(projectRootLC + path.sep);
  } catch {
    return false;
  }
}

async function hardenSession() {
  const ses = session.defaultSession;

  // 1) Only allow file:// URLs that resolve inside the project root
  ses.webRequest.onBeforeRequest((details, cb) => {
    const url = details.url || '';

    if (url.startsWith('file://')) {
      return cb({ cancel: !isPathAllowedFileUrl(url) });
    }
    // Block http/https and any other external protocol outright
    if (/^https?:/i.test(url)) return cb({ cancel: true });

    // Default: allow (covers about:blank, devtools:, etc.)
    return cb({ cancel: false });
  });

  // 2) Apply a consistent CSP header (keeps inline & WASM working, no network)
  ses.webRequest.onHeadersReceived((details, cb) => {
    const csp = [
      "default-src 'self' data: blob: filesystem:",
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: filesystem:",
      "font-src 'self' data:",
      "connect-src 'self' data: blob: filesystem: file:",
      "object-src 'none'",
      "frame-ancestors 'none'",     // cannot be embedded
      "base-uri 'self'",
      "form-action 'self'",
      "worker-src 'self' blob:",
      "media-src 'self' blob:"
    ].join('; ');

    const headers = { ...details.responseHeaders };
    headers['Content-Security-Policy'] = [csp];
    cb({ responseHeaders: headers });
  });

  // 3) Deny ALL permission prompts (camera/mic/fs/etc.)
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    icon: path.join(projectRoot, 'src', 'assets', 'memoro-vault.ico'),
    title: 'Memoro Vault',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,                 // safe renderer sandbox
      enableRemoteModule: false,
      spellcheck: false,
      webgl: false,                  // optional hardening
      autoplayPolicy: 'document-user-activation-required',
      preload: path.join(projectRoot, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(projectRoot, 'src', 'index.html'));

  // Block navigation away from your app files
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isPathAllowedFileUrl(url)) e.preventDefault();
  });

  // No popups
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Graceful shutdown sweep
  mainWindow.on('close', async (e) => {
    if (!isQuitting) {
      e.preventDefault();
      isQuitting = true;

      const allWindows = BrowserWindow.getAllWindows();
      for (const win of allWindows) {
        try {
          await Promise.race([
            win.webContents.executeJavaScript(
              `typeof nukeEverything === 'function' ? nukeEverything() : Promise.resolve();`
            ),
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

// External link allowlist (or remove to be 100% offline)
ipcMain.on('open-external-link', (_event, url) => {
  try {
    const allowedHosts = ['trocador.app', 'github.com'];
    const parsed = new URL(url);
    if (allowedHosts.includes(parsed.hostname)) {
      shell.openExternal(url);
    } else {
      console.warn('Blocked unsafe URL:', url);
    }
  } catch {
    console.error('Invalid URL passed to openExternalLink:', url);
  }
});

app.whenReady()
  .then(hardenSession)
  .then(() => {
// Remove the application menu completely
Menu.setApplicationMenu(null);

    // Handy DevTools shortcut even in production if ALLOW_DEVTOOLS = true
    if (ALLOW_DEVTOOLS) {
      globalShortcut.register('CommandOrControl+Shift+I', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.toggleDevTools();
        }
      });
      globalShortcut.register('F12', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.toggleDevTools();
        }
      });
    }
  })
  .then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => {
  // Clean up shortcuts
  globalShortcut.unregisterAll();
});

// Extra belt-and-suspenders: block any <webview> usage
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});
