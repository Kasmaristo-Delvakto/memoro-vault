// preload.js
'use strict';

const { contextBridge, ipcRenderer, clipboard } = require('electron');

// --- Constants (write-only donation link) ---
const DONATION_URL =
  "https://trocador.app/en/anonpay/?ticker_to=xmr&network_to=Mainnet&address=83czGNh6SKbhmjg3wPzeiDRQbN7gkLLqTYSvfMGRQRmKQf1SyQTG88Db67NoBdEvpCii6Qzcxq3BxNt94FDeJutmJ3xBXc6&donation=True&amount=0.1&name=Kasmaristo+Delvakto&description=Memoro+Vault+is+funded+by+donations+only.+Thanks+for+your+support!&ticker_from=xmr&network_from=Mainnet&bgcolor=";

// --- Bridge: core app APIs (same names you already use) ---
contextBridge.exposeInMainWorld('memoroAPI', {
  saveVaultFile: (data) => ipcRenderer.send('save-vault', data),
  showMessage:   (msg)  => ipcRenderer.send('show-message', msg),
  openExternalLink: (url) => ipcRenderer.send('open-external-link', url),
  writeDonationLink: () => clipboard.writeText(DONATION_URL) // write-only helper
});

// --- Bridge: crypto helpers (unchanged) ---
contextBridge.exposeInMainWorld('memoroCrypto', {
  subtle: window.crypto.subtle,
  getRandomValues: (array) => window.crypto.getRandomValues(array)
});

// --- Bridge: first-run license modal (used by src/license.html) ---
contextBridge.exposeInMainWorld('mvLicense', {
  accept: () => ipcRenderer.invoke('license:accept'),
  decline: () => ipcRenderer.invoke('license:decline')
});
