const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('memoroAPI', {
  saveVaultFile: (data) => ipcRenderer.send('save-vault', data),
  showMessage: (msg) => ipcRenderer.send('show-message', msg),
  openExternalLink: (url) => ipcRenderer.send('open-external-link', url),
});

contextBridge.exposeInMainWorld('memoroCrypto', {
  subtle: window.crypto.subtle,
  getRandomValues: (array) => window.crypto.getRandomValues(array)
});

// preload.js (tighten the clipboard bridge)
const { contextBridge, ipcRenderer, clipboard } = require('electron');

const DONATION_URL = "https://trocador.app/en/anonpay/?ticker_to=xmr&network_to=Mainnet&address=83czGNh6SKbhmjg3wPzeiDRQbN7gkLLqTYSvfMGRQRmKQf1SyQTG88Db67NoBdEvpCii6Qzcxq3BxNt94FDeJutmJ3xBXc6&donation=True&amount=0.1&name=Kasmaristo+Delvakto&description=Memoro+Vault+is+funded+by+donations+only.+Thanks+for+your+support!&ticker_from=xmr&network_from=Mainnet&bgcolor=";

contextBridge.exposeInMainWorld('memoroAPI', {
  saveVaultFile: (data) => ipcRenderer.send('save-vault', data),
  showMessage: (msg) => ipcRenderer.send('show-message', msg),
  openExternalLink: (url) => ipcRenderer.send('open-external-link', url),
  writeDonationLink: () => clipboard.writeText(DONATION_URL) // write-only, fixed value
});

