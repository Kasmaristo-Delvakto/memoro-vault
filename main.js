// Disable Electron DevTools warnings and source map errors in production
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
process.env.NODE_ENV = 'production';

const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron'); // ← add Menu
const path = require('path');

// Disable Chromium geolocation prompt
app.commandLine.appendSwitch('disable-features', 'Geolocation');

let mainWindow;
let audioWindow;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    icon: path.join(__dirname, 'src', 'assets', 'memoro-vault.ico'),
    title: 'Memoro Vault',

    // --- window chrome & menu behavior ---
    fullscreen: false,          // start windowed (not true fullscreen)
    frame: true,                // keep OS title bar (maximize/fullscreen/close buttons)
    autoHideMenuBar: true,      // hide menu bar on Win/Linux (Alt won't show it if menu is null)

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();  // ✅ fill the screen by default (keeps title bar/buttons)
    mainWindow.show();
    mainWindow.focus();
  });

  audioWindow = new BrowserWindow({
    show: false,
    focusable: false,
    transparent: true,
    frame: false,
    fullscreenable: false,
    resizable: false,
    webPreferences: {
      contextIsolation: true
    }
  });

  audioWindow.loadFile(path.join(__dirname, 'src', 'audio.html'));

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
          console.warn('Nuke call failed:', err.message);
        }
      }

      if (audioWindow && !audioWindow.isDestroyed()) {
        audioWindow.destroy();
      }
      mainWindow.destroy();
      app.quit();
    }
  });
}

// External link handling via IPC
ipcMain.on('open-external-link', (event, url) => {
  try {
    const allowedHosts = ['trocador.app', 'github.com', 'boatingaccidentapparel.com'];
    const parsed = new URL(url);
    if (allowedHosts.includes(parsed.hostname)) {
      shell.openExternal(url);
    } else {
      console.warn('Blocked unsafe URL:', url);
    }
  } catch (e) {
    console.error('Invalid URL passed to openExternalLink:', url);
  }
});

app.whenReady().then(() => {
  // Remove the application menu entirely so no devtools/menu bar appears
  Menu.setApplicationMenu(null);     // ✅ no top menu/devtools bar
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
