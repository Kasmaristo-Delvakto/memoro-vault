/* js/dashboard.js (ES module) — Memoro Vault Dashboard */

// ---------- Vendor configuration (runs only if the vendor lib is present) ----------
if (window.pdfjsLib) {
  // PDF.js worker path
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
}

// ---------- WASM: memoro_crypto init + helpers on window ----------
import init, {
  sha256_hash,
  aes_gcm_encrypt,
  aes_gcm_decrypt,
  argon2_derive
} from "../wasm/memoro_crypto.js";

async function initCryptoWasm() {
  await init();
  // Match your previous window helper surface so existing calls work unchanged
  window.sha256Hash       = (u8) => Promise.resolve(sha256_hash(u8));
  window.aesEncryptRust   = (k,n,p) => Promise.resolve(aes_gcm_encrypt(k,n,p));
  window.aesDecryptRust   = (k,n,c) => Promise.resolve(aes_gcm_decrypt(k,n,c));
  window.argon2DeriveRust = (pwdBytes, saltBytes, t, m, p, len) =>
    argon2_derive(pwdBytes, saltBytes, t, m, p, len);
}
initCryptoWasm().catch(console.error);

// ---------- THEME (pre-flip + apply) ----------
function applyDashboardTheme(theme) {
  const cy = document.getElementById('theme-cypherpunk');
  const cl = document.getElementById('theme-clean');
  const isCypher = (theme === 'cypherpunk');

  // flip stylesheets
  if (cy) cy.disabled = !isCypher;
  if (cl) cl.disabled =  isCypher;

  // body data attribute
  const setBodyAttr = () => {
    if (document.body) {
      document.body.setAttribute('data-theme', isCypher ? 'cypherpunk' : 'clean');
    }
  };
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', setBodyAttr, { once: true });
  } else {
    setBodyAttr();
  }

  // matrix start/stop
  if (window.DashboardMatrix) {
    if (isCypher) window.DashboardMatrix.start();
    else window.DashboardMatrix.stop();
  }
}

// pre-read saved theme & flip early to avoid FOUC
(function initDashboardTheme(){
  const saved = sessionStorage.getItem('theme') ??
                localStorage.getItem('theme') ??
                'cypherpunk';
  window.__savedDashboardTheme = saved;

  const cy = document.getElementById('theme-cypherpunk');
  const cl = document.getElementById('theme-clean');
  const isCypher = (saved === 'cypherpunk');
  if (cy) cy.disabled = !isCypher;
  if (cl) cl.disabled =  isCypher;
})();

// ---------- GLOBAL STATE ----------
const loadedVaults = {};
let currentUnlockVaultId = null;
let nextAction = null;
let confirmYesCallback = null;
let countdownInterval = null;
let failedAttempts = 0;
let lockoutUntil = 0;
let currentRenameVaultId = null;

// ---------- MODALS: message / confirm ----------
function showMessageModal(title, message) {
  document.getElementById('messageModalTitle').innerText = title;
  document.getElementById('messageModalText').innerText = message;
  document.getElementById('messageModal').style.display = 'flex';
}
function closeMessageModal() {
  document.getElementById('messageModal').style.display = 'none';
}
function showConfirmModal(message, yesCallback) {
  document.getElementById('confirmModalText').innerText = message;
  document.getElementById('confirmModal').style.display = 'flex';
  confirmYesCallback = yesCallback;
}
function confirmNo() {
  document.getElementById('confirmModal').style.display = 'none';
  confirmYesCallback = null;
}
function confirmYes() {
  document.getElementById('confirmModal').style.display = 'none';
  if (typeof confirmYesCallback === 'function') {
    confirmYesCallback();
    confirmYesCallback = null;
  }
}

// expose for HTML onclick
Object.assign(window, { showMessageModal, closeMessageModal, confirmNo, confirmYes });

// ---------- VAULT LIST (localStorage index + IndexedDB blobs) ----------
function saveVaultsToLocalStorage() {
  try {
    const index = Object.entries(loadedVaults).map(([vaultId, v]) => ({
      vaultId,
      fileName: v.fileName || 'Memoro Vault',
      createdAt: Date.now(),
    }));
    localStorage.setItem('memoroVaultIndex', JSON.stringify(index));
  } catch (err) {
    console.error('❌ Failed to write vault index to localStorage:', err);
  }
}

function loadVaultsFromLocalStorage() {
  // Back-compat with your prior 'savedVaults' format (rehydrates fileMap from IDB)
  const saved = localStorage.getItem('savedVaults');
  if (!saved) return;

  const vaultArray = JSON.parse(saved);
  vaultArray.forEach(({ vaultId, fileName, vaultData }) => {
    loadFilesFromIndexedDB(vaultId).then(fileMapRaw => {
      const reconstructedMap = {};
      const reconstructedRaw = {};

      for (const [name, fileObj] of Object.entries(fileMapRaw || {})) {
        const blob = new Blob([new Uint8Array(fileObj.data)], { type: fileObj.type });
        reconstructedMap[name] = blob;
        reconstructedRaw[name] = { type: fileObj.type, data: fileObj.data };
      }

      loadedVaults[vaultId] = {
        fileName,
        vaultData,
        fileMap: reconstructedMap,
        fileMapRaw: reconstructedRaw
      };

      addVaultToList(vaultId, fileName, vaultData, true);
    }).catch(err => {
      console.error(`Failed to load fileMapRaw for vault ${vaultId}:`, err);
      showMessageModal("Load Error", `Could not load vault files for "${fileName}".`);
    });
  });
}

function addVaultToList(vaultId, fileName, vaultData, skipSaving = false) {
  const vaultList = document.getElementById('vaultList');
  const vaultItem = document.createElement('div');
  vaultItem.className = 'vault-item';
  vaultItem.id = vaultId;
  vaultItem.innerHTML = `
    <div style="width:100%; display:flex; justify-content:space-between; align-items:center;">
      <h2 id="title-${vaultId}" style="margin:0;">${fileName}</h2>
      <div style="position:relative;">
        <button class="three-dots" onclick="toggleMenu('${vaultId}')">⋮</button>
        <div class="vault-menu" id="menu-${vaultId}">
          <button onclick="renameVault('${vaultId}')">Rename</button>
          <button onclick="deleteVault('${vaultId}')">Delete</button>
        </div>
      </div>
    </div>
    <p>Status:Locked</p>
    <button class="unlock-button" onclick="openUnlockModal('${vaultId}')">Unlock Vault</button>
  `;
  vaultList.appendChild(vaultItem);
  if (!skipSaving) saveVaultsToLocalStorage();
}

function toggleMenu(vaultId) {
  const menu = document.getElementById(`menu-${vaultId}`);
  menu.style.display = (menu.style.display === 'block' ? 'none' : 'block');
  document.querySelectorAll('.vault-menu').forEach(m => {
    if (m.id !== `menu-${vaultId}`) m.style.display = 'none';
  });
}
Object.assign(window, { toggleMenu });

function renameVault(vaultId) {
  currentRenameVaultId = vaultId;
  const vault = loadedVaults[vaultId];
  if (!vault) { showMessageModal('Error', 'Vault not found.'); return; }
  document.getElementById('renameInput').value = vault.fileName;
  document.getElementById('renameModal').style.display = 'flex';
}
function cancelRename() {
  currentRenameVaultId = null;
  document.getElementById('renameModal').style.display = 'none';
}
function submitRename() {
  const newName = document.getElementById('renameInput').value.trim();
  if (!newName) { showMessageModal('Missing Name', 'Please enter a new name.'); return; }
  if (currentRenameVaultId && loadedVaults[currentRenameVaultId]) {
    loadedVaults[currentRenameVaultId].fileName = newName;
    document.getElementById(`title-${currentRenameVaultId}`).innerText = newName;
    saveVaultsToLocalStorage();
  }
  cancelRename();
}
function deleteVault(vaultId) {
  showConfirmModal('Are you sure you want to delete this vault?', () => {
    delete loadedVaults[vaultId];
    document.getElementById(vaultId)?.remove();
    saveVaultsToLocalStorage();
  });
}
Object.assign(window, { renameVault, cancelRename, submitRename, deleteVault });

// ---------- OFFLINE WARNING FLOW ----------
function promptOfflineWarning(action) {
  nextAction = action;
  document.getElementById('offlineWarning').style.display = 'flex';
}
function proceedAfterOfflineWarning() {
  document.getElementById('offlineWarning').style.display = 'none';
  if (nextAction === 'create') {
    window.location.href = "create-vault.html";
  } else if (nextAction === 'load') {
    document.getElementById('vaultZipInput').click(); // important!
  }
  nextAction = null;
}
function cancelOfflineWarning() {
  document.getElementById('offlineWarning').style.display = 'none';
  nextAction = null;
}
function goToHowItWorks() { window.location.href = "how-it-works.html"; }

Object.assign(window, {
  promptOfflineWarning, proceedAfterOfflineWarning, cancelOfflineWarning, goToHowItWorks
});

// ---------- UNLOCK FLOW ----------
function openUnlockModal(vaultId) {
  clearInterval(countdownInterval);
  currentUnlockVaultId = vaultId;

  const vault = loadedVaults[vaultId];
  const prompts = vault?.vaultData?.questionPrompts || ["Question 1:", "Question 2:"];
  document.getElementById('question1Label').innerText = prompts[0];
  document.getElementById('question2Label').innerText = prompts[1];

  const a1 = document.getElementById('answer1Input');
  const a2 = document.getElementById('answer2Input');
  a1.value = ''; a2.value = '';
  a1.disabled = false; a2.disabled = false;

  document.getElementById('lockoutSection').style.display = 'none';
  document.getElementById('lockoutProgress').style.width = '100%';

  const unlockButton = document.getElementById('unlockButton');
  unlockButton.disabled = false;
  unlockButton.textContent = 'Unlock';

  document.getElementById('unlockModal').style.display = 'flex';
  setTimeout(() => a1.focus(), 100);

  failedAttempts = Number(localStorage.getItem(`failedAttempts_${vaultId}`)) || 0;
  lockoutUntil = Number(localStorage.getItem(`lockoutUntil_${vaultId}`)) || 0;
  checkIfLocked();
}
function cancelUnlock() {
  currentUnlockVaultId = null;
  document.getElementById('unlockModal').style.display = 'none';
  clearInterval(countdownInterval);
}
function checkIfLocked() {
  if (Date.now() < lockoutUntil) startCountdown();
}
function startCountdown() {
  clearInterval(countdownInterval);
  const now = Date.now();
  const totalTime = lockoutUntil - now;
  const lockoutSection = document.getElementById('lockoutSection');
  const timerText = document.getElementById('lockoutTimerText');
  const progressBar = document.getElementById('lockoutProgress');
  const unlockButton = document.getElementById('unlockButton');

  lockoutSection.style.display = 'block';
  document.getElementById('answer1Input').disabled = true;
  document.getElementById('answer2Input').disabled = true;
  unlockButton.disabled = true;
  unlockButton.textContent = 'Locked';

  countdownInterval = setInterval(() => {
    const nowInner = Date.now();
    const remaining = lockoutUntil - nowInner;

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      document.getElementById('answer1Input').disabled = false;
      document.getElementById('answer2Input').disabled = false;
      lockoutSection.style.display = 'none';
      unlockButton.disabled = false;
      unlockButton.textContent = 'Unlock';
      return;
    }
    const seconds = Math.ceil(remaining / 1000);
    timerText.innerText = `Locked for ${seconds}s`;
    const percent = (remaining / totalTime) * 100;
    progressBar.style.width = `${percent}%`;
  }, 200);
}
Object.assign(window, { openUnlockModal, cancelUnlock });

// --- Argon2 + AES helpers (WASM-backed) ---
async function deriveRawKeyBytes(password, saltHex, settings) {
  const enc = new TextEncoder();
  const pwdBytes = enc.encode(password);
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{1,2}/g).map(h => parseInt(h, 16)))
    : new Uint8Array(await crypto.subtle.digest("SHA-256", pwdBytes));
  const s = settings || { time: 3, mem: 16384, parallelism: 1, hashLen: 32 };
  return window.argon2DeriveRust(pwdBytes, salt, s.time, s.mem, s.parallelism, s.hashLen);
}
async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
async function decryptAES(ciphertextArray, ivArray, rawKeyBytes) {
  try {
    const decU8 = await window.aesDecryptRust(rawKeyBytes, new Uint8Array(ivArray), new Uint8Array(ciphertextArray));
    const decoded = new TextDecoder().decode(decU8);
    if (!decoded.startsWith('{') || !decoded.endsWith('}')) {
      throw new Error("Decryption returned incomplete JSON. Data may be too large or corrupted.");
    }
    return decoded;
  } catch (err) {
    console.error("❌ Decryption failed:", err);
    throw new Error("Decryption failed: Incorrect key or corrupted data.");
  }
}

async function submitUnlock() {
  if (Date.now() < lockoutUntil) return;

  const answer1 = document.getElementById('answer1Input').value.trim().toLowerCase();
  const answer2 = document.getElementById('answer2Input').value.trim().toLowerCase();
  if (!answer1 || !answer2) { showMessageModal('Missing Answers', 'Please answer both questions.'); return; }

  const vault = loadedVaults[currentUnlockVaultId];
  if (!vault || !vault.vaultData || !vault.fileMapRaw || !vault.zipBlob) {
    showMessageModal('Vault Error', 'Vault is missing required data.'); return;
  }

  const vaultEncRaw  = vault.fileMapRaw["vault.enc"];
  const vaultMetaRaw = vault.fileMapRaw["vault.meta"];
  if (!vaultEncRaw?.data || !vaultMetaRaw?.data) {
    showMessageModal('Vault Error', 'Required encrypted files are missing or incomplete.'); return;
  }

  try {
    const layer1Salt = vault.vaultData.layer1Salt;
    if (!layer1Salt) throw new Error("Vault metadata is incomplete: layer1Salt not found.");

    const vaultEncText = new TextDecoder().decode(Uint8Array.from(vaultEncRaw.data));
    const vaultEncJson = JSON.parse(vaultEncText);
    const { ciphertext, iv } = vaultEncJson;

    const l1KeyRaw = await deriveRawKeyBytes(answer1 + answer2, layer1Salt, vault.vaultData.argonSettings);
    const decU8 = await window.aesDecryptRust(l1KeyRaw, new Uint8Array(iv), new Uint8Array(ciphertext));
    const decrypted = new TextDecoder().decode(decU8);
    const fullVaultData = JSON.parse(decrypted);

    // Inject metadata used later
    fullVaultData.finalMessageIv = vault.vaultData.finalMessageIv || null;
    fullVaultData.vaultMetaIv    = vault.vaultData.vaultMetaIv;

    // Serialize fileMap
    const serializedMap = {};
    for (const [filename, blob] of Object.entries(vault.fileMap)) {
      const buffer = await blob.arrayBuffer();
      serializedMap[filename] = {
        type: blob.type || 'application/octet-stream',
        data: Array.from(new Uint8Array(buffer))
      };
    }

    // Use original imported ZIP blob
    const vaultBlob = new Uint8Array(await vault.zipBlob.arrayBuffer());
    if (vaultBlob.length === 0) throw new Error("Original vault ZIP blob is empty.");

    const transferObject = {
      vaultJson: vault.vaultData,
      decryptedVaultData: fullVaultData,
      baseKey: answer1 + answer2,
      fileMapRaw: serializedMap,
      vaultEncRaw,
      vaultMetaRaw,
      vaultId: currentUnlockVaultId,
      fullSalt: vault.vaultData.fullSalt,
      vaultBlob: vaultBlob.buffer
    };

    // Save to IndexedDB for recover.html handoff
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("memoroVaultVaultStorage", 1);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains("vaultFiles")) {
          db.createObjectStore("vaultFiles", { keyPath: "vaultId" });
        }
      };
      req.onsuccess = (ev) => {
        const db = ev.target.result;
        const tx = db.transaction("vaultFiles", "readwrite");
        const store = tx.objectStore("vaultFiles");
        store.put({ vaultId: currentUnlockVaultId + "-transfer", data: transferObject });
        tx.oncomplete = resolve;
        tx.onerror = (e) => reject("❌ IndexedDB write error: " + e.target.error.message);
      };
      req.onerror = (e) => reject("❌ Failed to open IndexedDB: " + e.target.error.message);
    });

    // Reset lockout
    clearInterval(countdownInterval);
    localStorage.removeItem(`failedAttempts_${currentUnlockVaultId}`);
    localStorage.removeItem(`lockoutUntil_${currentUnlockVaultId}`);
    localStorage.setItem("lastVaultId", currentUnlockVaultId);

    await delay(500);
    window.location.href = "recover.html";
  } catch (err) {
    console.warn("❌ Unlock failed:", err.message);
    failedAttempts++;
    const lockDelay = 15000 * Math.pow(2, failedAttempts - 1);
    lockoutUntil = Date.now() + lockDelay;

    localStorage.setItem(`failedAttempts_${currentUnlockVaultId}`, failedAttempts);
    localStorage.setItem(`lockoutUntil_${currentUnlockVaultId}`, lockoutUntil);

    showMessageModal("Unlock Failed", `Incorrect answers. Attempts: ${failedAttempts}`);
    startCountdown();
  }
}
window.submitUnlock = submitUnlock; // single, not duplicated

// Lowercase answers as user types
document.addEventListener("input", (e) => {
  if (e.target.id === "answer1Input" || e.target.id === "answer2Input") {
    e.target.value = e.target.value.toLowerCase();
  }
});

// Click outside menus closes them
document.addEventListener('click', (e) => {
  const isMenuButton = e.target.classList?.contains('three-dots');
  if (!isMenuButton && !e.target.closest('.vault-menu')) {
    document.querySelectorAll('.vault-menu').forEach(menu => (menu.style.display = 'none'));
  }
});

// ---------- IndexedDB helpers ----------
function saveFilesToIndexedDB(vaultId, fileMapRaw, transferObject = null) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("memoroVaultVaultStorage", 1);
    req.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("vaultFiles")) {
        db.createObjectStore("vaultFiles", { keyPath: "vaultId" });
      }
    };
    req.onsuccess = function (event) {
      const db = event.target.result;
      const tx = db.transaction("vaultFiles", "readwrite");
      const store = tx.objectStore("vaultFiles");
      store.put({ vaultId, fileMapRaw });
      if (transferObject) {
        store.put({ vaultId: vaultId + "-transfer", ...transferObject });
      }
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject("IndexedDB write failed: " + e.target.error?.message);
    };
    req.onerror = (e) => reject("Failed to open IndexedDB: " + e.target.error?.message);
  });
}
function loadFilesFromIndexedDB(vaultId) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("memoroVaultVaultStorage", 1);
    req.onsuccess = function (event) {
      const db = event.target.result;
      const tx = db.transaction("vaultFiles", "readonly");
      const store = tx.objectStore("vaultFiles");
      const getReq = store.get(vaultId);
      getReq.onsuccess = () => resolve(getReq.result?.fileMapRaw || {});
      getReq.onerror = () => reject("Failed to retrieve vault file blobs.");
    };
    req.onerror = () => reject("IndexedDB load failed.");
  });
}

// ---------- File input handler (Load Vault) ----------
async function handleVaultZip(event) {
  const file = event.target.files?.[0];
  if (!file || !file.name.toLowerCase().endsWith('.zip')) {
    showMessageModal('Invalid File', 'Please select a valid .zip vault file.');
    return;
  }

  const vaultId  = 'vault-' + Date.now();
  const fileName = file.name.replace(/\.zip$/i, '');

  let zipReader;
  try {
    zipReader = new zip.ZipReader(new zip.BlobReader(file));
    const entries = await zipReader.getEntries();
    const find = (n) => entries.find(e => e.filename.toLowerCase() === n);

    const eJson = find('vault.json');
    const eEnc  = find('vault.enc');
    const eMeta = find('vault.meta');
    if (!eJson || !eEnc || !eMeta) {
      throw new Error('ZIP is missing one or more required files: vault.json, vault.enc, vault.meta');
    }

    const vaultJsonBlob = await eJson.getData(new zip.BlobWriter('application/json'));
    const vaultData     = JSON.parse(await vaultJsonBlob.text());

    const vaultEncBlob = await eEnc.getData(new zip.BlobWriter('application/octet-stream'));
    const vaultEncU8   = new Uint8Array(await vaultEncBlob.arrayBuffer());

    const vaultMetaBlob = await eMeta.getData(new zip.BlobWriter('application/octet-stream'));
    const vaultMetaU8   = new Uint8Array(await vaultMetaBlob.arrayBuffer());

    const fileMap = {
      'vault.json': vaultJsonBlob,
      'vault.enc':  new Blob([vaultEncU8], { type: 'application/octet-stream' }),
      'vault.meta': new Blob([vaultMetaU8], { type: 'application/octet-stream' }),
    };
    const fileMapRaw = {
      'vault.json': { type: 'application/json',              data: new TextEncoder().encode(JSON.stringify(vaultData)) },
      'vault.enc':  { type: 'application/octet-stream',      data: vaultEncU8 },
      'vault.meta': { type: 'application/octet-stream',      data: vaultMetaU8 },
    };

    loadedVaults[vaultId] = {
      fileName,
      vaultData,
      fileMap,
      fileMapRaw,
      zipBlob: file
    };

    await saveFilesToIndexedDB(vaultId, {
      'vault.json': { type: 'application/json',         data: fileMapRaw['vault.json'].data },
      'vault.enc':  { type: 'application/octet-stream', data: fileMapRaw['vault.enc'].data  },
      'vault.meta': { type: 'application/octet-stream', data: fileMapRaw['vault.meta'].data },
    });

    addVaultToList(vaultId, fileName, vaultData);
    saveVaultsToLocalStorage();

    showMessageModal('Success', 'Vault imported successfully!');
  } catch (err) {
    console.error('ZIP Load Error:', err);
    showMessageModal('Load Failed', err.message || 'Could not load the vault ZIP file.');
  } finally {
    try { await zipReader?.close(); } catch {}
    event.target.value = ''; // allow selecting the same file again
  }
}
window.handleVaultZip = handleVaultZip;

// ---------- MATRIX BACKGROUND ----------
window.DashboardMatrix = {
  _interval: null,
  _ctx: null,
  _canvas: null,
  _drops: [],
  _fontSize: 14,
  _letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890@$%&'.split(''),

  _draw() {
    const ctx = this._ctx, c = this._canvas;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#00ff99';
    ctx.font = `${this._fontSize}px monospace`;

    for (let i = 0; i < this._drops.length; i++) {
      const t = this._letters[Math.floor(Math.random() * this._letters.length)];
      ctx.fillText(t, i * this._fontSize, this._drops[i] * this._fontSize);
      this._drops[i]++;
      if (this._drops[i] * this._fontSize > c.height && Math.random() > 0.975) {
        this._drops[i] = 0;
      }
    }
  },

  _resize() {
    const c = this._canvas;
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    const cols = Math.floor(c.width / this._fontSize);
    this._drops = Array(cols).fill(0);
  },

  start() {
    if (this._interval) return;
    if (!this._canvas) {
      this._canvas = document.getElementById("matrixCanvas");
      if (!this._canvas) return;
      this._ctx = this._canvas.getContext("2d");
      window.addEventListener('resize', () => this._resize());
    }
    this._resize();
    this._canvas.style.display = 'block';
    this._interval = setInterval(() => this._draw(), 66);
  },

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    if (this._canvas && this._ctx) {
      this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
      this._canvas.style.display = 'none';
    }
  }
};

// Apply the saved theme after DOM is ready (ensures body exists)
(function bootstrapDashboardTheme(){
  const apply = () => applyDashboardTheme(window.__savedDashboardTheme || 'cypherpunk');
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
})();

// ---------- NUKE (optional utility you had) ----------
async function nukeEverything() {
  try {
    const themeSession = sessionStorage.getItem("theme");
    const themeLocal   = localStorage.getItem("theme");
    const preservedTheme = themeSession || themeLocal || "cypherpunk";

    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem("theme", preservedTheme);
    localStorage.setItem("theme", preservedTheme);

    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db?.name && (db.name === "memoroVaultVaultStorage" || db.name === "memoroVaultDB")) {
          indexedDB.deleteDatabase(db.name);
        }
      }
    } else {
      indexedDB.deleteDatabase("memoroVaultVaultStorage");
      indexedDB.deleteDatabase("memoroVaultDB");
    }
    console.log("Memoro Vault (dashboard): Local memory wiped (theme preserved).");
  } catch (err) {
    console.warn("Memoro Vault (dashboard) wipe failed:", err);
  }
}
window.nukeEverything = nukeEverything;

// ===================================================================
// ============== Physical Backup Scanner / Rebuilder =================
// ===================================================================

const paperState = {
  header: null,            // { v, iv:number[], size:number, sha256:string }
  keyHex: null,            // 64 hex chars
  tiles: {},               // { 1: "b64...", 2: "b64...", ... }
  totalTiles: null,        // integer
  seenPayloads: new Set(), // dedupe across PDF & camera
};

const paperEls = {
  modal:      () => document.getElementById('paperDecryptModal'),
  files:      () => document.getElementById('paperFiles'),
  status:     () => document.getElementById('paperStatus'),
  barHost:    () => document.getElementById('paperProgressHost'),
  barText:    () => document.getElementById('paperProgressText'),
  bar:        () => document.getElementById('paperProgressBar'),
  rebuildBtn: () => document.getElementById('rebuildBtn') || document.getElementById('rebuildLiteBtn'),
  camVideo:   () => document.getElementById('paperCam'),
};

async function scanPdfFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  // Layout constants (approx letter@300dpi)
  const COLS      = 3;
  const MARGIN_PT = 24;
  const GAP_PT    = 12;
  const LABEL_PT  = 14;
  const BANNER_PT = 72;

  const hasNativeBD = 'BarcodeDetector' in window && String(BarcodeDetector).indexOf('Polyfill') === -1;
  const BD_NATIVE   = hasNativeBD ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
  const BD_ZXING    = (typeof window.BarcodeDetectorPolyfill === 'function')
    ? new window.BarcodeDetectorPolyfill({ formats: ['qr_code'] })
    : null;

  async function decodeRegion(ctx, srcCanvas, x, y, w, h) {
    if (w <= 0 || h <= 0) return [];
    const sub = document.createElement('canvas');
    sub.width = w; sub.height = h;
    const sctx = sub.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(srcCanvas, x, y, w, h, 0, 0, w, h);

    const hits = new Set();

    if (BD_NATIVE) {
      try {
        const bmp = await createImageBitmap(sub);
        const codes = await BD_NATIVE.detect(bmp);
        for (const c of (codes || [])) {
          const val = (c.rawValue || '').trim();
          if (val) hits.add(val);
        }
        if (hits.size) return Array.from(hits);
      } catch {}
    }
    if (BD_ZXING) {
      try {
        const bmp = await createImageBitmap(sub);
        const codes = await BD_ZXING.detect(bmp);
        for (const c of (codes || [])) {
          const val = (c.rawValue || '').trim();
          if (val) hits.add(val);
        }
        if (hits.size) return Array.from(hits);
      } catch {}
    }
    try {
      const img = sctx.getImageData(0, 0, w, h);
      const qr = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (qr?.data) hits.add(qr.data.trim());
    } catch {}
    return Array.from(hits);
  }

  const tick = () => new Promise(r => setTimeout(r, 0));

  for (let p = 1; p <= pdf.numPages; p++) {
    if (paperState.header && paperState.keyHex &&
        paperState.totalTiles && Object.keys(paperState.tiles).length === paperState.totalTiles) break;

    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 4.2 });
    const canvas = document.createElement('canvas');
    canvas.width  = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    await page.render({ canvasContext: ctx, viewport }).promise;

    const W = canvas.width, H = canvas.height;
    const pxPerPt = W / 612;
    const MARGIN = Math.round(MARGIN_PT * pxPerPt);
    const GAP    = Math.round(GAP_PT    * pxPerPt);
    const LABEL  = Math.round(LABEL_PT  * pxPerPt);
    const BANNER = Math.round(BANNER_PT * pxPerPt);

    const innerW = W - 2 * MARGIN;
    const tile   = Math.floor((innerW - GAP * (COLS - 1)) / COLS);
    const usedW  = COLS * tile + GAP * (COLS - 1);
    const startX = MARGIN + Math.floor((innerW - usedW) / 2);
    const rowH   = LABEL + tile + GAP;

    async function tryRect(x, y, w, h, tag) {
      const variants = [
        () => {
          const inset = Math.round(Math.min(w, h) * 0.02);
          const x1 = Math.max(0, x + inset), y1 = Math.max(0, y + inset);
          const w1 = Math.max(0, Math.min(W - x1, w - inset * 2));
          const h1 = Math.max(0, Math.min(H - y1, h - inset * 2));
          return { x:x1, y:y1, w:w1, h:h1 };
        },
        () => {
          const pad = Math.round(Math.min(w, h) * 0.08);
          const x0 = Math.max(0, x - pad), y0 = Math.max(0, y - pad);
          const w0 = Math.min(W - x0, w + pad * 2), h0 = Math.min(H - y0, h + pad * 2);
          return { x:x0, y:y0, w:w0, h:h0 };
        }
      ];

      for (const mk of variants) {
        const r = mk(); if (r.w <= 0 || r.h <= 0) continue;
        const vals = await decodeRegion(ctx, canvas, r.x, r.y, r.w, r.h);
        if (vals.length) { for (const v of vals) ingestQR(v, `${tag}`); return true; }
      }
      return false;
    }

    let y = MARGIN + BANNER + LABEL;
    let rowsScanned = 0;

    while (y + tile <= H - MARGIN) {
      for (let c = 0; c < COLS; c++) {
        const x = startX + c * (tile + GAP);
        if (p === 1 && rowsScanned === 0) {
          if      (c === 0) await tryRect(x, y, tile, tile, 'p1-key');
          else if (c === 1) await tryRect(x, y, tile, tile, 'p1-hdr');
          else              await tryRect(x, y, tile, tile, 'p1-ct');
        } else {
          await tryRect(x, y, tile, tile, `p${p}-ct`);
        }
      }
      rowsScanned++;
      y += rowH;

      await tick();

      if (paperState.header && paperState.keyHex &&
          paperState.totalTiles && Object.keys(paperState.tiles).length === paperState.totalTiles) break;
    }
    updatePaperProgress();
    await tick();
  }
}

async function scanImageFile(file) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await new Promise(r => (img.onload = r));

  const MAX = 3000;
  const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
  const canvas = document.createElement('canvas');
  canvas.width  = Math.floor(img.width  * ratio);
  canvas.height = Math.floor(img.height * ratio);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const found = await findAllQRCodesOnCanvas(canvas);
  if (!found.length) {
    setPaperMsg(`No QR detected in ${file.name}.`);
  } else {
    for (const t of found) ingestQR(t, `Image ${file.name}`);
  }
  updatePaperProgress();
}

async function findAllQRCodesOnCanvas(canvas) {
  const results = new Set();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const hasNativeBD = 'BarcodeDetector' in window && String(BarcodeDetector).indexOf('Polyfill') === -1;
  const BD_NATIVE   = hasNativeBD ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
  const BD_ZXING    = (typeof window.BarcodeDetectorPolyfill === 'function')
    ? new window.BarcodeDetectorPolyfill({ formats: ['qr_code'] })
    : null;

  const add = (s) => { if (s) results.add(s.trim()); };

  async function decodeRegion(x, y, w, h) {
    if (w <= 0 || h <= 0) return false;
    const sub = document.createElement('canvas');
    sub.width = w; sub.height = h;
    const sctx = sub.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);

    if (BD_NATIVE) {
      try {
        const bmp = await createImageBitmap(sub);
        const codes = await BD_NATIVE.detect(bmp);
        let any = false;
        for (const c of (codes || [])) {
          const v = (c.rawValue || '').trim();
          if (v) { add(v); any = true; }
        }
        if (any) return true;
      } catch {}
    }
    if (BD_ZXING) {
      try {
        const bmp = await createImageBitmap(sub);
        const codes = await BD_ZXING.detect(bmp);
        let any = false;
        for (const c of (codes || [])) {
          const v = (c.rawValue || '').trim();
          if (v) { add(v); any = true; }
        }
        if (any) return true;
      } catch {}
    }
    try {
      const img = sctx.getImageData(0, 0, w, h);
      const qr = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (qr?.data) { add(qr.data); return true; }
    } catch {}
    return false;
  }

  await decodeRegion(0, 0, canvas.width, canvas.height);

  // Simple grid sweeps (coarse→finer) to catch off-center codes
  async function sweep(grid, overlap = 0) {
    const stepX = Math.floor(canvas.width / grid);
    const stepY = Math.floor(canvas.height / grid);
    const oxs = overlap ? [0, Math.floor(stepX / 2)] : [0];
    const oys = overlap ? [0, Math.floor(stepY / 2)] : [0];
    for (const ox of oxs) for (const oy of oys) {
      for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) {
        const x = gx * stepX + ox;
        const y = gy * stepY + oy;
        const w = Math.min(stepX, canvas.width  - x);
        const h = Math.min(stepY, canvas.height - y);
        await decodeRegion(x, y, w, h);
      }
    }
  }
  await sweep(4, 0);
  await sweep(6, 1);

  // One upscaled pass for small/blurred codes
  {
    const scale = 1.5;
    const tmp = document.createElement('canvas');
    tmp.width  = Math.floor(canvas.width  * scale);
    tmp.height = Math.floor(canvas.height * scale);
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);

    if (BD_NATIVE) {
      try { const bmp = await createImageBitmap(tmp);
        const codes = await BD_NATIVE.detect(bmp);
        for (const c of (codes || [])) add((c.rawValue || '').trim());
      } catch {}
    }
    if (BD_ZXING) {
      try { const bmp = await createImageBitmap(tmp);
        const codes = await BD_ZXING.detect(bmp);
        for (const c of (codes || [])) add((c.rawValue || '').trim());
      } catch {}
    }
    try {
      const img = tctx.getImageData(0, 0, tmp.width, tmp.height);
      const qr = jsQR(img.data, tmp.width, tmp.height, { inversionAttempts: 'attemptBoth' });
      if (qr?.data) add(qr.data.trim());
    } catch {}
  }

  return Array.from(results);
}

function setPaperMsg(msg) {
  const el = paperEls.status();
  if (!el) return;
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.innerHTML += (el.innerHTML ? "<br>" : "") + line;
  el.scrollTop = el.scrollHeight;
}

function b64ToU8Direct(b64) {
  const clean = b64.replace(/\s+/g, '');
  const bin = atob(clean);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function sha256Hex(u8) {
  return crypto.subtle.digest("SHA-256", u8).then(buf => {
    const h = new Uint8Array(buf);
    return Array.from(h).map(b => b.toString(16).padStart(2,'0')).join('');
  });
}
function base64DecodedLen(b64) {
  const s = b64.replace(/\s+/g, '');
  const pad = (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);
  return Math.floor(s.length / 4) * 3 - pad;
}
function parseQRText(txt) {
  if (!txt || typeof txt !== 'string') return null;
  txt = txt.trim();

  if (txt.startsWith("MVKEY|")) {
    const hex = txt.slice(6).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) return null;
    return { type: "MVKEY", hex };
  }
  if (txt.startsWith("MVHDR|")) {
    const jsonB64 = txt.slice(6).trim();
    try {
      const raw = atob(jsonB64.replace(/\s+/g, ''));
      let json;
      try { json = JSON.parse(raw); }
      catch {
        const esc = Array.prototype.map.call(raw, ch => '%' + ch.charCodeAt(0).toString(16).padStart(2,'0')).join('');
        json = JSON.parse(decodeURIComponent(esc));
      }
      if (!json || !Array.isArray(json.iv) || typeof json.size !== 'number' || typeof json.sha256 !== 'string') return null;
      return { type: "MVHDR", data: json };
    } catch { return null; }
  }
  if (txt.startsWith("MVCT|")) {
    const m = txt.match(/^MVCT\|(\d+)\/(\d+)\|([A-Za-z0-9+/=\s]+)$/);
    if (!m) return null;
    const idx   = parseInt(m[1],10);
    const total = parseInt(m[2],10);
    const b64   = m[3].trim();
    if (!idx || !total || idx < 1 || idx > total) return null;
    return { type: "MVCT", idx, total, b64 };
  }
  return null;
}

function updatePaperProgress() {
  const haveHdr = !!paperState.header;
  const haveKey = !!paperState.keyHex;
  const haveCt  = Object.keys(paperState.tiles).length;
  const total   = paperState.totalTiles || "?";

  const txtEl = paperEls.barText();
  if (txtEl) txtEl.textContent = `Status — Header: ${haveHdr ? "yes" : "no"} | Tiles: ${haveCt}/${total} | KEY: ${haveKey ? "yes" : "no"}`;

  const pct = (() => {
    let p = 0;
    if (haveHdr) p += 25;
    if (haveKey) p += 25;
    if (paperState.totalTiles) p += Math.min(50, Math.round(50 * (haveCt / paperState.totalTiles)));
    return Math.min(100, p);
  })();
  const bar = paperEls.bar();
  if (bar) bar.style.width = pct + "%";

  const ready = haveHdr && haveKey && paperState.totalTiles && haveCt === paperState.totalTiles;
  const btn = paperEls.rebuildBtn();
  if (btn) {
    btn.disabled = !ready;
    btn.style.opacity = ready ? '1' : '.4';
    btn.style.filter = ready ? 'none' : 'grayscale(100%)';
    btn.style.pointerEvents = ready ? 'auto' : 'none';
  }

  if (ready && !window.__mvAutoRebuildDone) {
    window.__mvAutoRebuildDone = true;
    setPaperMsg("All pieces captured — rebuilding ZIP automatically…");
    setTimeout(() => rebuildLiteFromPaper().catch(console.error), 50);
  }
}

function ingestQR(raw, src = "QR") {
  if (!raw || paperState.seenPayloads.has(raw)) return;
  paperState.seenPayloads.add(raw);

  const p = parseQRText(raw);
  if (!p) return;

  if (p.type === "MVKEY") {
    if (!paperState.keyHex) { paperState.keyHex = p.hex; setPaperMsg(`Captured MVKEY (key).`); }
  } else if (p.type === "MVHDR") {
    if (!paperState.header) { paperState.header = p.data; setPaperMsg(`Captured MVHDR (header).`); }
  } else if (p.type === "MVCT") {
    if (!paperState.totalTiles) {
      paperState.totalTiles = p.total;
    } else if (paperState.totalTiles !== p.total) {
      setPaperMsg(`⚠️ Conflicting CT totals seen (was ${paperState.totalTiles}, now ${p.total}). Keeping first.`);
    }
    if (!paperState.tiles[p.idx]) {
      paperState.tiles[p.idx] = p.b64;
      setPaperMsg(`Captured MVCT tile ${p.idx}/${paperState.totalTiles || p.total}.`);
    }
  }
  updatePaperProgress();
}

async function handlePaperFiles(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  Object.assign(paperState, {
    header: null, keyHex: null, tiles: {}, totalTiles: null, seenPayloads: new Set()
  });
  const status = paperEls.status();
  if (status) status.innerHTML = "";
  setPaperMsg(`Processing ${files.length} file(s)...`);
  updatePaperProgress();

  for (const f of files) {
    const name = (f.name || '').toLowerCase();
    if (f.type === 'application/pdf' || name.endsWith('.pdf')) {
      await scanPdfFile(f);
    } else {
      await scanImageFile(f);
    }
  }
  updatePaperProgress();
}

// camera loop (optional)
let __mvCamStream = null;
let __mvCamLoop = null;

async function startPaperCamera() {
  const constraints = {
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  };

  stopPaperCamera();

  const v = document.getElementById('paperCam');
  if (!v) return;

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showMessageModal('Camera Unavailable', 'This environment does not support camera access.');
      return;
    }

    __mvCamStream = await navigator.mediaDevices.getUserMedia(constraints);
    v.srcObject = __mvCamStream;
    v.playsInline = true;
    v.style.display = 'block';
    await v.play();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let ticking = false;
    __mvCamLoop = setInterval(async () => {
      if (ticking) return;
      if (!v.videoWidth || !v.videoHeight) return;
      ticking = true;
      try {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const found = await findAllQRCodesOnCanvas(canvas);
        for (const t of found) ingestQR(t, 'camera');
        updatePaperProgress();
      } catch (e) {
        console.warn('scan frame failed:', e);
      } finally {
        ticking = false;
      }
    }, 300);
  } catch (e) {
    console.warn('getUserMedia failed:', e);
    const msg = (e && (e.message || e.name)) ? `${e.name || 'Error'}: ${e.message}` : 'Unknown error.';
    showMessageModal('Camera Blocked', `Couldn’t start camera. ${msg}\n\nCheck OS privacy settings and try again.`);
  }
}

function stopPaperCamera() {
  if (__mvCamLoop) { clearInterval(__mvCamLoop); __mvCamLoop = null; }
  if (__mvCamStream) {
    for (const tr of __mvCamStream.getTracks()) tr.stop();
    __mvCamStream = null;
  }
  const v = document.getElementById('paperCam');
  if (v) {
    v.pause();
    v.removeAttribute('srcObject');
    v.srcObject = null;
    v.style.display = 'none';
  }
}
async function startKeyCam(){ await startPaperCamera(); }
function stopKeyCam(){ stopPaperCamera(); }
async function scanFromVideoOnce(){
  const v = document.getElementById('paperCam');
  if (!v || !v.videoWidth) return;
  const c = document.createElement('canvas');
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(v, 0, 0);
  const found = await findAllQRCodesOnCanvas(c);
  for (const t of found) ingestQR(t, 'camera-once');
  updatePaperProgress();
}

function openPaperDecrypt() {
  if (!paperEls.barHost()) {
    const host = document.createElement('div');
    host.id = 'paperProgressHost';
    host.className = 'paper-progress';

    const text = document.createElement('div');
    text.id = 'paperProgressText';
    text.className = 'paper-progress-text';
    text.textContent = 'Status — waiting for uploads…';

    const track = document.createElement('div');
    track.className = 'paper-progress-track';

    const bar = document.createElement('div');
    bar.id = 'paperProgressBar';
    bar.className = 'paper-progress-bar';
    bar.style.width = '0%';

    track.appendChild(bar);
    host.appendChild(text);
    host.appendChild(track);

    const modal = paperEls.modal();
    const status = paperEls.status();
    (modal.querySelector('.modal') || modal).insertBefore(host, status);
  }

  Object.assign(paperState, {
    header: null, keyHex: null, tiles: {}, totalTiles: null, seenPayloads: new Set()
  });

  const statusEl = paperEls.status();
  if (statusEl) { statusEl.innerHTML = 'Waiting for uploads…'; statusEl.scrollTop = 0; }

  const btn = paperEls.rebuildBtn();
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '.4';
    btn.style.filter = 'grayscale(100%)';
    btn.style.pointerEvents = 'none';
  }

  const files = paperEls.files();
  if (files) files.onchange = handlePaperFiles;

  const m = paperEls.modal();
  if (m) m.style.display = 'flex';

  window.__mvAutoRebuildDone = false;
  updatePaperProgress();
}
function closePaperDecrypt() {
  stopPaperCamera();
  const m = paperEls.modal();
  if (m) m.style.display = 'none';
}

async function rebuildLiteFromPaper() {
  try {
    const { header, keyHex, tiles, totalTiles } = paperState;
    if (!header) throw new Error("Missing header (MVHDR).");
    if (!keyHex) throw new Error("Missing key (MVKEY).");
    if (!totalTiles) throw new Error("Tiles not detected yet.");

    let totalCtBytes = 0;
    for (let i = 1; i <= totalTiles; i++) {
      const part = tiles[i];
      if (!part) throw new Error(`Missing ciphertext tile ${i}/${totalTiles}.`);
      totalCtBytes += base64DecodedLen(part);
    }
    const ctBytes = new Uint8Array(totalCtBytes);

    let offset = 0;
    for (let i = 1; i <= totalTiles; i++) {
      const chunkU8 = b64ToU8Direct(tiles[i]);
      ctBytes.set(chunkU8, offset);
      offset += chunkU8.length;
    }

    const keyU8 = new Uint8Array(keyHex.match(/.{1,2}/g).map(h => parseInt(h, 16)));
    const ivU8  = new Uint8Array(header.iv);
    const zipBytes = await window.aesDecryptRust(keyU8, ivU8, ctBytes);

    if (zipBytes.length !== header.size) {
      throw new Error(`Size mismatch (expected ${header.size}, got ${zipBytes.length}).`);
    }
    const gotSha = await sha256Hex(zipBytes);
    if (gotSha !== header.sha256) {
      throw new Error(`SHA-256 mismatch. Expected ${header.sha256}, got ${gotSha}.`);
    }

    const blob = new Blob([zipBytes], { type: "application/zip" });
    const name = "memoro-lite.zip";
    const url  = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setPaperMsg(`✅ Rebuild complete. Download started: ${name}`);

    if (typeof handleVaultZip === 'function') {
      const dt = new DataTransfer();
      dt.items.add(new File([blob], name, { type: "application/zip" }));
      const fakeInput = document.createElement('input');
      fakeInput.type = 'file';
      fakeInput.files = dt.files;
      await handleVaultZip({ target: fakeInput });
      setPaperMsg("ZIP auto-imported into your vault list.");
    }

    stopPaperCamera();
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch {}
      closePaperDecrypt();
    }, 5000);

  } catch (err) {
    console.error(err);
    setPaperMsg(`❌ Rebuild failed: ${err.message}`);
    alert(`Rebuild failed: ${err.message}`);
    window.__mvAutoRebuildDone = false;
  }
}

// expose paper helpers used by HTML buttons
Object.assign(window, {
  openPaperDecrypt, closePaperDecrypt, rebuildLiteFromPaper,
  startKeyCam, stopKeyCam, scanFromVideoOnce
});

// ---------- Start-up: hydrate dashboard ----------
window.addEventListener("DOMContentLoaded", () => {
  sessionStorage.removeItem("memoroTransfer");
  Object.keys(loadedVaults).forEach(key => delete loadedVaults[key]);
  loadVaultsFromLocalStorage();
});