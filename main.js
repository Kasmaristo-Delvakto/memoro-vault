// Disable Electron DevTools warnings and source map errors in production
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
process.env.NODE_ENV = 'production';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
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

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
