const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

let mainWindow;
let audioWindow;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    icon: path.join(__dirname, 'src', 'assets', 'memoro-vault.ico'),
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
            win.webContents.executeJavaScript(`typeof nukeEverything === 'function' ? nukeEverything() : Promise.resolve();`),
            new Promise(resolve => setTimeout(resolve, 750))
          ]);
        } catch (err) {
          console.warn('Nuke call failed:', err.message);
        }
      }

      // Now destroy everything manually
      if (audioWindow && !audioWindow.isDestroyed()) {
        audioWindow.destroy();
      }
      mainWindow.destroy(); // Don't use .close() again or loop

      app.quit(); // Explicit after everything is wiped
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
