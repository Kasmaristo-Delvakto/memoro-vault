const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    icon: path.join(__dirname, 'src', 'assets', 'memoro-vault.ico'),
    webPreferences: {
      nodeIntegration: false, // safer
      contextIsolation: true,  // isolates frontend and backend
      preload: path.join(__dirname, 'preload.js') // we'll make this next
    },
    focusable: true
  });

  // Load your starting page
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Ensure the window is shown and focused
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  // Optional: Open dev tools automatically (you can comment out later)
  // win.webContents.openDevTools();
}

// When Electron is ready, create the window
app.whenReady().then(createWindow);

// On macOS, re-create a window if the dock icon is clicked and no windows are open
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
