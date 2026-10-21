// preload.js
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Storage is in-memory (see main.js), so seed the saved theme before page scripts read it.
try {
  const theme = ipcRenderer.sendSync('prefs:get-theme');
  if (theme) {
    if (!localStorage.getItem('theme')) localStorage.setItem('theme', theme);
    if (!sessionStorage.getItem('theme')) sessionStorage.setItem('theme', theme);
  }
} catch (_) { /* storage unavailable: pages fall back to their default theme */ }

// --- Bridge: the small set of main-process helpers pages may call ---
contextBridge.exposeInMainWorld('memoroAPI', {
  openDonationPage: () => ipcRenderer.invoke('open-donation-page'), // fixed URL, chosen in main
  writeDonationLink: () => ipcRenderer.invoke('copy-donation-link'), // write-only helper (clipboard lives in main)
  saveTheme: (theme) => ipcRenderer.invoke('prefs:set-theme', theme),
  // Resolves { saved, fileName } only after the bytes are on disk; { saved:false, canceled } otherwise
  saveFile: (name, bytes) => ipcRenderer.invoke('vault:save-file', { name, bytes })
});

// --- Bridge: first-run license modal (used by src/license.html) ---
contextBridge.exposeInMainWorld('mvLicense', {
  accept: () => ipcRenderer.invoke('license:accept'),
  decline: () => ipcRenderer.invoke('license:decline')
});
