const { contextBridge, ipcRenderer } = require('electron');
const CryptoJS = require('crypto-js');

// Expose safe IPC methods
contextBridge.exposeInMainWorld('memoroAPI', {
  saveVaultFile: (data) => ipcRenderer.send('save-vault', data),
  showMessage: (msg) => ipcRenderer.send('show-message', msg)
});

// ✅ Expose full CryptoJS API securely to renderer
contextBridge.exposeInMainWorld('CryptoJS', {
  SHA256: (data) => CryptoJS.SHA256(data).toString(),
  AES: {
    encrypt: (data, key) => CryptoJS.AES.encrypt(data, key).toString(),
    decrypt: (ciphertext, key) => {
      const bytes = CryptoJS.AES.decrypt(ciphertext, key);
      return bytes.toString(CryptoJS.enc.Utf8);
    }
  },
  PBKDF2: (data, salt, options) => CryptoJS.PBKDF2(data, salt, options).toString(),
  enc: {
    Utf8: CryptoJS.enc.Utf8,
    Hex: CryptoJS.enc.Hex,
    Base64: CryptoJS.enc.Base64
  }
});
