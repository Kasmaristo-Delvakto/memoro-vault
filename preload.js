const { contextBridge, ipcRenderer } = require('electron');

// Expose only safe, intentional API to the renderer
contextBridge.exposeInMainWorld('memoroAPI', {
  saveVaultFile: (data) => ipcRenderer.send('save-vault', data),
  showMessage: (msg) => ipcRenderer.send('show-message', msg),
  openExternalLink: (url) => ipcRenderer.send('open-external-link', url)
});

// Optional: Expose cryptographic helpers
contextBridge.exposeInMainWorld('memoroCrypto', {
  subtle: window.crypto.subtle,
  getRandomValues: (array) => window.crypto.getRandomValues(array)
});
