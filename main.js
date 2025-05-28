const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;
let audioWindow;

function createWindow() {
  // Main app window
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    icon: path.join(__dirname, 'src', 'assets', 'memoro-vault.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    focusable: true
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // 🔊 Background audio window (hidden and persistent)
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

  // ✅ Close everything when main window closes
  mainWindow.on('closed', () => {
    if (audioWindow && !audioWindow.isDestroyed()) {
      audioWindow.destroy();
    }
    app.quit();
  });
}

// When Electron is ready, create the windows
app.whenReady().then(createWindow);

// macOS: re-create window if dock icon is clicked and none open
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
