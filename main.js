// main.js — whitelist project root, no audio window, inline-friendly CSP

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
process.env.NODE_ENV = 'production';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
  session,
  Menu
} = require('electron');

// ---- Config ----
const projectRoot = path.resolve(__dirname);
const projectRootLC = projectRoot.toLowerCase();
// DevTools only when running from source (npm start / tests), never in release builds
const ALLOW_DEVTOOLS = !app.isPackaged;
app.commandLine.appendSwitch('disable-features', 'Geolocation');
// The app is offline by design: Chromium may not resolve any host name at all.
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');

// NEW: cross-platform icon resolver (PNG on Linux, ICO on Windows, PNG on macOS)
function getPlatformIcon() {
  const assets = path.join(projectRoot, 'src', 'assets');
  if (process.platform === 'win32') return path.join(assets, 'memoro-vault.ico');
  if (process.platform === 'darwin') return path.join(assets, 'memoro-logo-white.png'); // you can swap to .icns later
  return path.join(assets, 'memoro-vault.png'); // Linux prefers PNG
}

let mainWindow;
let isQuitting = false;

// All windows use an in-memory session: answers, seed phrases and files that pages keep in
// IndexedDB/localStorage never reach the disk, so nothing is left behind for recovery tools.
// (No "persist:" prefix means Chromium keeps the whole partition in RAM.)
const SESSION_PARTITION = 'memoro-ephemeral';

// Releases up to 1.0.8 kept answers, seed phrases and uploaded files in the on-disk storage of
// the default session. Nothing uses those folders any more, so overwrite (best effort) and delete
// them before Chromium opens the profile. On SSDs and copy-on-write file systems the overwrite
// cannot be guaranteed, but the files stop being readable from the profile.
const LEGACY_WEB_STORAGE = ['IndexedDB', 'Local Storage', 'Session Storage', 'blob_storage', 'WebStorage', 'databases', 'File System', 'Service Worker'];
function scrubFile(file) {
  try {
    // O_NOFOLLOW: a file swapped for a symlink is refused instead of overwriting its target
    const fd = fs.openSync(file, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW || 0));
    try {
      const size = fs.fstatSync(fd).size;
      const zeros = Buffer.alloc(Math.min(size, 1 << 20));
      for (let off = 0; off < size; off += zeros.length) fs.writeSync(fd, zeros, 0, Math.min(zeros.length, size - off), off);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch { /* best effort */ }
}
function scrubDir(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue; // removed with the folder, target left alone
    if (e.isDirectory()) scrubDir(p);
    else if (e.isFile()) scrubFile(p);
  }
}
function scrubLegacyWebStorage() {
  const base = app.getPath('userData');
  for (const name of LEGACY_WEB_STORAGE) {
    const dir = path.join(base, name);
    let st;
    try { st = fs.lstatSync(dir); } catch { continue; }
    if (st.isSymbolicLink()) { try { fs.unlinkSync(dir); } catch {} continue; }
    if (st.isDirectory()) scrubDir(dir);
    else if (st.isFile()) scrubFile(dir);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
scrubLegacyWebStorage();

// --- Non-secret preferences (only the theme) live in a small JSON file ---
const PREFS_FILE = path.join(app.getPath('userData'), 'prefs.json');
const THEMES = new Set(['cypherpunk', 'clean']);
function readTheme() {
  try {
    const t = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8'))?.theme;
    return THEMES.has(t) ? t : null;
  } catch {
    return null;
  }
}
ipcMain.on('prefs:get-theme', (e) => { e.returnValue = readTheme(); });
ipcMain.handle('prefs:set-theme', async (_e, theme) => {
  if (!THEMES.has(theme)) return false;
  try { fs.writeFileSync(PREFS_FILE, JSON.stringify({ theme }), 'utf8'); return true; } catch { return false; }
});

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
      partition: SESSION_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: ALLOW_DEVTOOLS,
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
    // file://host/... is a network (UNC) path on Windows and would leak credentials over SMB
    if (u.protocol !== 'file:' || u.host) return false;
    let p = decodeURIComponent(u.pathname);
    if (process.platform === 'win32' && p.startsWith('/')) p = p.slice(1);
    const norm = path.normalize(p);
    const caseInsensitiveFs = process.platform === 'win32' || process.platform === 'darwin';
    return caseInsensitiveFs
      ? norm.toLowerCase().startsWith(projectRootLC + path.sep)
      : norm.startsWith(projectRoot + path.sep);
  } catch {
    return false;
  }
}

async function hardenSession(ses) {

  // 1) Allowlist: app files under the project root, data: and blob: URLs; everything else
  //    (http, https, ws, wss, ftp, other schemes) is cancelled.
  ses.webRequest.onBeforeRequest((details, cb) => {
    const url = details.url || '';
    let scheme;
    try { scheme = new URL(url).protocol; } catch { return cb({ cancel: true }); }
    if (scheme === 'file:') return cb({ cancel: !isPathAllowedFileUrl(url) });
    if (scheme === 'data:' || scheme === 'blob:') return cb({ cancel: false });
    if (scheme === 'devtools:' && ALLOW_DEVTOOLS) return cb({ cancel: false });
    return cb({ cancel: true });
  });

  // 2) Tight offline CSP. Every page also carries the same policy in a <meta> tag as a
  //    second layer, so it still holds if a page is ever loaded without this hook.
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
      partition: SESSION_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: ALLOW_DEVTOOLS,
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

// Saving a vault or paper backup: the renderer hands over the finished bytes and learns whether
// they really reached the disk (an <a download> cannot report a cancelled or failed save).
const SAVE_TYPES = {
  '.zip': { name: 'Memoro Vault (ZIP)', extensions: ['zip'] },
  '.pdf': { name: 'Paper backup (PDF)', extensions: ['pdf'] },
};
ipcMain.handle('vault:save-file', async (event, { name, bytes } = {}) => {
  const fileName = path.basename(String(name || 'memoro-vault.zip'));
  const type = SAVE_TYPES[path.extname(fileName).toLowerCase()];
  if (!type || !(bytes instanceof Uint8Array)) return { saved: false, error: 'Unsupported file.' };
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('downloads'), fileName),
    filters: [type],
    properties: ['showOverwriteConfirmation', 'createDirectory', 'dontAddToRecent'],
  });
  if (canceled || !filePath) return { saved: false, canceled: true };
  // Write next to the target and rename, so a crash or full disk never leaves a half-written vault
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.part`);
  try {
    const fh = await fs.promises.open(tmp, 'wx');
    try {
      await fh.writeFile(bytes);
      await fh.sync();
    } finally {
      await fh.close();
    }
    if ((await fs.promises.stat(tmp)).size !== bytes.length) throw new Error('The file on disk has the wrong size.');
    await fs.promises.rename(tmp, filePath);
    return { saved: true, fileName: path.basename(filePath) };
  } catch (err) {
    try { await fs.promises.unlink(tmp); } catch { /* already gone */ }
    return { saved: false, error: err?.message || String(err) };
  }
});

// Write-only donation link helper (renderers have no clipboard module since Electron 44)
const DONATION_URL =
  "https://trocador.app/en/anonpay/?ticker_to=xmr&network_to=Mainnet&address=83czGNh6SKbhmjg3wPzeiDRQbN7gkLLqTYSvfMGRQRmKQf1SyQTG88Db67NoBdEvpCii6Qzcxq3BxNt94FDeJutmJ3xBXc6&donation=True&amount=0.1&name=Kasmaristo+Delvakto&description=Memoro+Vault+is+funded+by+donations+only.+Thanks+for+your+support!&ticker_from=xmr&network_from=Mainnet&bgcolor=";
ipcMain.handle('copy-donation-link', async () => { await clipboard.writeText(DONATION_URL); return true; });

// The only page the app ever opens in the system browser is this fixed donation link;
// renderers cannot pass a URL of their own.
ipcMain.handle('open-donation-page', async () => { await shell.openExternal(DONATION_URL); return true; });

app.whenReady()
  .then(() => Promise.all([
    hardenSession(session.fromPartition(SESSION_PARTITION)),
    hardenSession(session.defaultSession),
    // Releases up to 1.0.8 kept answers and files in the on-disk default session. Nothing uses
    // it any more, so clear whatever an older version may have left behind.
    session.defaultSession.clearStorageData().catch(() => {}),
    session.defaultSession.clearCache().catch(() => {})
  ]))
  .then(() => {
    Menu.setApplicationMenu(null);
  })
  .then(createAppWindows);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createAppWindows();
});
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
  // F12 / Ctrl+Shift+I open DevTools only in development, and only while this window has focus
  if (ALLOW_DEVTOOLS) {
    contents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const combo = (input.control || input.meta) && input.shift && String(input.key).toLowerCase() === 'i';
      if (input.key === 'F12' || combo) { e.preventDefault(); contents.toggleDevTools(); }
    });
  }
  // Every window (license included): no pop-ups, no navigation outside the app folder.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e, url) => {
    if (!isPathAllowedFileUrl(url)) e.preventDefault();
  });
  contents.on('will-redirect', (e, url) => {
    if (!isPathAllowedFileUrl(url)) e.preventDefault();
  });
});
