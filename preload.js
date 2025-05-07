const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC methods only
contextBridge.exposeInMainWorld('memoroAPI', {
  saveVaultFile: (data) => ipcRenderer.send('save-vault', data),
  showMessage: (msg) => ipcRenderer.send('show-message', msg)
});

// If you want to expose Web Crypto helpers, you could optionally do this:
contextBridge.exposeInMainWorld('memoroCrypto', {
  subtle: window.crypto.subtle,
  getRandomValues: (array) => window.crypto.getRandomValues(array)
});
