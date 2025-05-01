// preload.js
const { contextBridge } = require('electron');

// Expose safe APIs to frontend
contextBridge.exposeInMainWorld('electronAPI', {
  // You can expose anything you need here later
});
