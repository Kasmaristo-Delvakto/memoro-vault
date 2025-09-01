  // Toggle dashboard styles + (later) matrix by theme
  function applyDashboardTheme(theme) {
    const cy = document.getElementById('theme-cypherpunk');
    const cl = document.getElementById('theme-clean');
    const isCypher = (theme === 'cypherpunk');

    // 1) Flip stylesheets (safe in <head>)
    if (cy) cy.disabled = !isCypher;
    if (cl) cl.disabled =  isCypher;

    // 2) Body attribute (only when body exists)
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

    // 3) Matrix control happens after DashboardMatrix is defined (bottom of file)
    if (window.DashboardMatrix) {
      if (isCypher) DashboardMatrix.start();
      else DashboardMatrix.stop();
    }
  }

  // Read saved theme and pre-flip stylesheets early (avoid FOUC). Body/matrix handled later.
   (function initDashboardTheme(){
const saved =
  sessionStorage.getItem('theme') ??
  localStorage.getItem('theme') ??
  'cypherpunk';
    window.__savedDashboardTheme = saved;

    const cy = document.getElementById('theme-cypherpunk');
    const cl = document.getElementById('theme-clean');
    const isCypher = (saved === 'cypherpunk');
    if (cy) cy.disabled = !isCypher;
    if (cl) cl.disabled =  isCypher;
  })();
const loadedVaults = {};
let currentUnlockVaultId = null;
let nextAction = null;
let confirmYesCallback = null;
let countdownInterval = null;
let failedAttempts = 0;
let lockoutUntil = 0;

  // Message Modal
  function showMessageModal(title, message) {
  document.getElementById('messageModalTitle').innerText = title;
  document.getElementById('messageModalText').innerText = message;
  document.getElementById('messageModal').style.display = 'flex';
}
function closeMessageModal() {
  document.getElementById('messageModal').style.display = 'none';
}

  // Confirm Modal
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

function saveVaultsToLocalStorage() {
  try {
    const index = Object.entries(loadedVaults).map(([vaultId, v]) => ({
      vaultId,
      fileName: v.fileName || 'Memoro Vault',
      // keep minimal metadata for display/restoration
      createdAt: Date.now(),
    }));
    localStorage.setItem('memoroVaultIndex', JSON.stringify(index));
    // no huge binary here — that’s what IndexedDB is for
  } catch (err) {
    console.error('❌ Failed to write vault index to localStorage:', err);
  }
}

  function loadVaultsFromLocalStorage() {
    const saved = localStorage.getItem('memoroVaultIndex');
  if (!saved) return;

  const vaultArray = JSON.parse(saved);
  vaultArray.forEach(({ vaultId, fileName, vaultData }) => {
    loadFilesFromIndexedDB(vaultId).then(fileMapRaw => {
      const reconstructedMap = {};
      const reconstructedRaw = {};

      for (const [name, fileObj] of Object.entries(fileMapRaw || {})) {
        const blob = new Blob([new Uint8Array(fileObj.data)], { type: fileObj.type });
        reconstructedMap[name] = blob;
        reconstructedRaw[name] = {
          type: fileObj.type,
          data: fileObj.data
        };
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
    if (!skipSaving) {
  saveVaultsToLocalStorage();
}
  }

  function toggleMenu(vaultId) {
    const menu = document.getElementById(`menu-${vaultId}`);
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    document.querySelectorAll('.vault-menu').forEach(m => {
      if (m.id !== `menu-${vaultId}`) m.style.display = 'none';
    });
  }

  let currentRenameVaultId = null;

  function renameVault(vaultId) {
    currentRenameVaultId = vaultId;
    const vault = loadedVaults[vaultId];
    if (!vault) {
      showMessageModal('Error', 'Vault not found.');
      return;
    }
    document.getElementById('renameInput').value = vault.fileName;
    document.getElementById('renameModal').style.display = 'flex';
  }

  function cancelRename() {
    currentRenameVaultId = null;
    document.getElementById('renameModal').style.display = 'none';
  }

  function submitRename() {
    const newName = document.getElementById('renameInput').value.trim();
    if (!newName) {
      showMessageModal('Missing Name', 'Please enter a new name.');
      return;
    }
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
      document.getElementById(vaultId).remove();
      saveVaultsToLocalStorage();
    });
  }

  function openUnlockModal(vaultId) {
  clearInterval(countdownInterval);

  currentUnlockVaultId = vaultId;
  const vault = loadedVaults[vaultId];
  const prompts = vault.vaultData.questionPrompts || ["Question 1:", "Question 2:"];

  document.getElementById('question1Label').innerText = prompts[0];
  document.getElementById('question2Label').innerText = prompts[1];

  document.getElementById('answer1Input').value = '';
  document.getElementById('answer2Input').value = '';
  document.getElementById('answer1Input').disabled = false;
  document.getElementById('answer2Input').disabled = false;

  document.getElementById('lockoutSection').style.display = 'none';
  document.getElementById('lockoutProgress').style.width = '100%';

  const unlockButton = document.getElementById('unlockButton');
  unlockButton.disabled = false;
  unlockButton.textContent = 'Unlock';

  document.getElementById('unlockModal').style.display = 'flex';
  setTimeout(() => document.getElementById('answer1Input').focus(), 100);

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
  if (Date.now() < lockoutUntil) {
    startCountdown();
  }
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

  function promptOfflineWarning(action) {
    nextAction = action;
    document.getElementById('offlineWarning').style.display = 'flex';
  }

  function proceedAfterOfflineWarning() {
  document.getElementById('offlineWarning').style.display = 'none';
  if (nextAction === 'create') {
    window.location.href = "create-vault.html";
  } else if (nextAction === 'load') {
    document.getElementById('vaultZipInput').click(); // ✅ THIS IS MISSING
  }
  nextAction = null;
}

  function cancelOfflineWarning() {
    document.getElementById('offlineWarning').style.display = 'none';
    nextAction = null;
  }

  function goToHowItWorks() {
    window.location.href = "how-it-works.html";
  }

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
    // Open without materializing the whole thing
    zipReader = new zip.ZipReader(new zip.BlobReader(file));

    // Read central directory
    const entries = await zipReader.getEntries();

    // Helper to find an entry by (case-insensitive) name
    const find = (n) => entries.find(e => e.filename.toLowerCase() === n);

    const eJson = find('vault.json');
    const eEnc  = find('vault.enc');
    const eMeta = find('vault.meta');

    if (!eJson || !eEnc || !eMeta) {
      throw new Error('ZIP is missing one or more required files: vault.json, vault.enc, vault.meta');
    }

    // Extract only what we need, and do it efficiently
    // vault.json → text
    const vaultJsonBlob = await eJson.getData(new zip.BlobWriter('application/json'));
    const vaultData     = JSON.parse(await vaultJsonBlob.text());

    // vault.enc → bytes (leave as Uint8Array)
    const vaultEncBlob = await eEnc.getData(new zip.BlobWriter('application/octet-stream'));
    const vaultEncU8   = new Uint8Array(await vaultEncBlob.arrayBuffer());

    // vault.meta → bytes
    const vaultMetaBlob = await eMeta.getData(new zip.BlobWriter('application/octet-stream'));
    const vaultMetaU8   = new Uint8Array(await vaultMetaBlob.arrayBuffer());

    // Build minimal in‑memory structures (no full file map mirror)
    const fileMap = {
      'vault.json': vaultJsonBlob,
      'vault.enc':  new Blob([vaultEncU8], { type: 'application/octet-stream' }),
      'vault.meta': new Blob([vaultMetaU8], { type: 'application/octet-stream' }),
    };

    // Raw (compact) representation — keep Uint8Array, not big JS arrays
    const fileMapRaw = {
      'vault.json': { type: 'application/json',              data: new TextEncoder().encode(JSON.stringify(vaultData)) },
      'vault.enc':  { type: 'application/octet-stream',      data: vaultEncU8 },
      'vault.meta': { type: 'application/octet-stream',      data: vaultMetaU8 },
    };

    // Keep a handle to the original ZIP for pass‑through to recover.html
    loadedVaults[vaultId] = {
      fileName,
      vaultData,
      fileMap,
      fileMapRaw,
      zipBlob: file
    };

    // Persist the heavy bits in IndexedDB (not localStorage)
    await saveFilesToIndexedDB(vaultId, {
      'vault.json': { type: 'application/json',         data: fileMapRaw['vault.json'].data },
      'vault.enc':  { type: 'application/octet-stream', data: fileMapRaw['vault.enc'].data  },
      'vault.meta': { type: 'application/octet-stream', data: fileMapRaw['vault.meta'].data },
    });

    // Add to UI (and store only lightweight metadata in localStorage)
    addVaultToList(vaultId, fileName, vaultData);
    saveVaultsToLocalStorage(); // this will now write only small metadata

    showMessageModal('Success', 'Vault imported successfully!');

  } catch (err) {
    console.error('ZIP Load Error:', err);
    showMessageModal('Load Failed', err.message || 'Could not load the vault ZIP file.');
  } finally {
    try { await zipReader?.close(); } catch {}
    // Reset the file input so selecting the same file again re‑fires change
    event.target.value = '';
  }
}

async function deriveKey(password, saltHex = null, vaultData = null) {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  const salt = saltHex 
    ? Uint8Array.from(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)))
    : new Uint8Array(await crypto.subtle.digest("SHA-256", passwordBytes));

  const settings = vaultData?.argonSettings || {
    time: 10,
    mem: 65536,
    parallelism: 4,
    type: "Argon2id",
    hashLen: 32
  };

  const argonResult = await argon2.hash({
    pass: password,
    salt,
    time: settings.time,
    mem: settings.mem,
    parallelism: settings.parallelism,
    type: argon2.ArgonType[settings.type] || argon2.ArgonType.Argon2id,
    hashLen: settings.hashLen || 32
  });

  const keyBytes = new Uint8Array(argonResult.hash);
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function decryptAES(ciphertextArray, ivArray, key) {
  try {
    const iv = new Uint8Array(ivArray);
    const ciphertext = new Uint8Array(ciphertextArray);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );

    const decoded = new TextDecoder().decode(decryptedBuffer);

    // ✅ Ensure full JSON was returned for large payloads
    if (!decoded.startsWith('{') || !decoded.endsWith('}')) {
      throw new Error("Decryption returned incomplete JSON. Data may be too large or corrupted.");
    }

    return decoded;
  } catch (err) {
    console.error("❌ Decryption failed:", err);
    throw new Error("Decryption failed: Incorrect key or corrupted vault.enc.");
  }
}

async function submitUnlock() {
  if (Date.now() < lockoutUntil) return;

  const answer1 = document.getElementById('answer1Input').value.trim().toLowerCase();
  const answer2 = document.getElementById('answer2Input').value.trim().toLowerCase();

  if (!answer1 || !answer2) {
    showMessageModal('Missing Answers', 'Please answer both questions.');
    return;
  }

  const vault = loadedVaults[currentUnlockVaultId];
  if (!vault || !vault.vaultData || !vault.fileMapRaw || !vault.zipBlob) {
    showMessageModal('Vault Error', 'Vault is missing required data.');
    return;
  }

  const vaultEncRaw = vault.fileMapRaw["vault.enc"];
  const vaultMetaRaw = vault.fileMapRaw["vault.meta"];
  if (!vaultEncRaw || !vaultEncRaw.data|| !vaultMetaRaw || !vaultMetaRaw.data) {
    showMessageModal('Vault Error', 'Required encrypted files are missing or incomplete.');
    return;
  }

  try {
    console.log("🔑 Unlock attempt with answers:", answer1, answer2);

    const vaultData = vault.vaultData;
    const layer1Salt = vaultData.layer1Salt;
    if (!layer1Salt) {
      throw new Error("Vault metadata is incomplete: layer1Salt not found.");
    }

    const vaultEncText = new TextDecoder().decode(Uint8Array.from(vaultEncRaw.data));
    const vaultEncJson = JSON.parse(vaultEncText);
    const { ciphertext, iv } = vaultEncJson;

    const aesKey = await deriveKey(answer1 + answer2, layer1Salt, vaultData);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv) },
      aesKey,
      new Uint8Array(ciphertext)
    );
    const decrypted = new TextDecoder().decode(decryptedBuffer);
    const fullVaultData = JSON.parse(decrypted);

    // Inject metadata
    fullVaultData.finalMessageIv = vaultData.finalMessageIv || null;
    fullVaultData.vaultMetaIv = vaultData.vaultMetaIv;

    // Serialize fileMap
    const serializedMap = {};
    for (const [filename, blob] of Object.entries(vault.fileMap)) {
      const buffer = await blob.arrayBuffer();
      serializedMap[filename] = {
        type: blob.type || 'application/octet-stream',
        data: Array.from(new Uint8Array(buffer))
      };
    }

    // ✅ Use the original imported ZIP blob
    const vaultBlob = new Uint8Array(await vault.zipBlob.arrayBuffer());
    if (vaultBlob.length === 0) throw new Error("Original vault ZIP blob is empty.");

    const transferObject = {
      vaultJson: vaultData,
      decryptedVaultData: fullVaultData,
      baseKey: answer1 + answer2,
      fileMapRaw: serializedMap,
      vaultEncRaw,
      vaultMetaRaw,
      vaultId: currentUnlockVaultId,
      fullSalt: vaultData.fullSalt,
      vaultBlob: vaultBlob.buffer
    };

    // Save to IndexedDB
    await new Promise((resolve, reject) => {
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

        store.put({ vaultId: currentUnlockVaultId + "-transfer", data: transferObject });

        tx.oncomplete = () => {
          console.log("📦 IndexedDB write completed:", currentUnlockVaultId + "-transfer");
          resolve();
        };
        tx.onerror = (e) => reject("❌ IndexedDB write error: " + e.target.error.message);
      };
      req.onerror = (e) => reject("❌ Failed to open IndexedDB: " + e.target.error.message);
    });

    // Reset lockout state
    clearInterval(countdownInterval);
    localStorage.removeItem(`failedAttempts_${currentUnlockVaultId}`);
    localStorage.removeItem(`lockoutUntil_${currentUnlockVaultId}`);
    localStorage.setItem("lastVaultId", currentUnlockVaultId);

    await delay(500); // Optional delay

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

// Expose globally
window.submitUnlock = submitUnlock;
  // Expose to global scope for onclick handler
  window.submitUnlock = submitUnlock;

window.addEventListener("DOMContentLoaded", () => {
  sessionStorage.removeItem("memoroTransfer");
  Object.keys(loadedVaults).forEach(key => delete loadedVaults[key]); // 💥 flush stale in-memory blobs
  loadVaultsFromLocalStorage();  // 🧠 this rehydrates cleanly from saved localStorage
});

// 🧼 Force input to lowercase as user types
document.addEventListener("input", (e) => {
  if (e.target.id === "answer1Input" || e.target.id === "answer2Input") {
    e.target.value = e.target.value.toLowerCase();
  }
});

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

      // Always store fileMapRaw for dashboard hydration
      store.put({ vaultId, fileMapRaw });
      console.log("Saved fileMapRaw for vaultId:", vaultId);

      // Store transfer object if provided
      if (transferObject) {
        store.put({ vaultId: vaultId + "-transfer", ...transferObject });
        console.log("Saved transfer object for vaultId:", vaultId + "-transfer");
      }

      tx.oncomplete = () => {
        console.log("IndexedDB transaction completed for vaultId:", vaultId);
        resolve();
      };
      tx.onerror = (e) => {
        console.error("IndexedDB transaction error:", e.target.error);
        reject("IndexedDB write failed: " + e.target.error.message);
      };
    };
    req.onerror = (e) => reject("Failed to open IndexedDB: " + e.target.error.message);
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

  // Matrix controller that can be started/stopped by theme
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
      if (this._interval) {
        clearInterval(this._interval);
        this._interval = null;
      }
      if (this._canvas && this._ctx) {
        this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        this._canvas.style.display = 'none';
      }
    }
  };

(function bootstrapDashboardTheme(){
  const apply = () => applyDashboardTheme(window.__savedDashboardTheme || 'cypherpunk');
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
})();

  /* ---- keep everything that originally followed this point (your existing dashboard code) ---- */

  document.addEventListener('click', (e) => {
  const menus = document.querySelectorAll('.vault-menu');
  const isMenuButton = e.target.classList.contains('three-dots');

  // If clicked outside all menus and not the ⋮ button, hide all
  if (!isMenuButton && !e.target.closest('.vault-menu')) {
    menus.forEach(menu => menu.style.display = 'none');
  }
});

async function nukeEverything() {
  try {
    // Preserve theme from either storage
    const themeSession = sessionStorage.getItem("theme");
    const themeLocal   = localStorage.getItem("theme");
    const preservedTheme = themeSession || themeLocal || "cypherpunk";

    // Clear storages
    localStorage.clear();
    sessionStorage.clear();

    // Restore theme to both
    localStorage.setItem("theme", preservedTheme);
    sessionStorage.setItem("theme", preservedTheme);

    // Delete only Memoro Vault DBs
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

// ==============================
// Memoro Physical Backup — Dashboard
// Scans MVKEY (hex), MVHDR (b64(JSON)), MVCT tiles → reassembles memoro-lite.zip
// ==============================

// ---------- State & element refs ----------
const paperState = {
  header: null,            // { v, iv:number[], size:number, sha256:string }
  keyHex: null,            // 64 hex chars (32 bytes)
  tiles: {},               // { 1: "b64...", 2: "b64...", ... }
  totalTiles: null,        // integer
  seenPayloads: new Set(), // dedupe across PDF & camera (raw strings)
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

// ---------- PDF scanner (4-col, Native BD → ZXing polyfill → jsQR, mini-sweep fallback) ----------
async function scanPdfFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  // Paper generator constants (letter @ ~300dpi)
  const COLS      = 4;
  const MARGIN_PT = 6;     // pt
  const GAP_PT    = 6;     // pt
  const LABEL_PT  = 6;     // pt
  const BANNER_PT = 60;    // pt

  const hasNativeBD = 'BarcodeDetector' in window && String(BarcodeDetector).indexOf('Polyfill') === -1;
  const BD_NATIVE   = hasNativeBD ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
  const BD_ZXING    = (typeof window.BarcodeDetectorPolyfill === 'function')
    ? new window.BarcodeDetectorPolyfill({ formats: ['qr_code'] })
    : null;

  // region decoder: Native BD → ZXing (polyfill) → jsQR
  async function decodeRegion(ctx, srcCanvas, x, y, w, h) {
    if (w <= 0 || h <= 0) return [];
    // crop → offscreen canvas → bitmap
    const sub = document.createElement('canvas');
    sub.width = w; sub.height = h;
    const sctx = sub.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(srcCanvas, x, y, w, h, 0, 0, w, h);

    const hits = new Set();

    // 1) Native BD
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

    // 2) ZXing via BarcodeDetectorPolyfill (always uses ZXing under the hood)
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

    // 3) jsQR fallback
    try {
      const img = sctx.getImageData(0, 0, w, h);
      const qr = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (qr?.data) hits.add(qr.data.trim());
    } catch {}

    return Array.from(hits);
  }

  // small helper to keep UI responsive
  const tick = () => new Promise(r => setTimeout(r, 0));

  for (let p = 1; p <= pdf.numPages; p++) {
    // Early-exit if we already have everything
    if (paperState.header && paperState.keyHex &&
        paperState.totalTiles && Object.keys(paperState.tiles).length === paperState.totalTiles) break;

    const page = await pdf.getPage(p);

    // ~300dpi: 72 pt/in → 4.166 px/pt → use 4.2 scale
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

    // helper: try tight & padded crop
    async function tryRect(x, y, w, h, tag) {
      const variants = [
        // tight
        () => {
          const inset = Math.round(Math.min(w, h) * 0.02);
          const x1 = Math.max(0, x + inset), y1 = Math.max(0, y + inset);
          const w1 = Math.max(0, Math.min(W - x1, w - inset * 2));
          const h1 = Math.max(0, Math.min(H - y1, h - inset * 2));
          return { x:x1, y:y1, w:w1, h:h1, kind:'tight' };
        },
        // padded
        () => {
          const pad = Math.round(Math.min(w, h) * 0.08);
          const x0 = Math.max(0, x - pad), y0 = Math.max(0, y - pad);
          const w0 = Math.min(W - x0, w + pad * 2), h0 = Math.min(H - y0, h + pad * 2);
          return { x:x0, y:y0, w:w0, h:h0, kind:'pad' };
        }
      ];

      for (const mk of variants) {
        const r = mk(); if (r.w <= 0 || r.h <= 0) continue;
        const vals = await decodeRegion(ctx, canvas, r.x, r.y, r.w, r.h);
        if (vals.length) {
          for (const v of vals) ingestQR(v, `${tag}:${r.kind}`);
          return true;
        }
      }
      return false;
    }

    // deterministic scan rows
    let y = MARGIN + BANNER + LABEL;
    let rowsScanned = 0;

    while (y + tile <= H - MARGIN) {
      for (let c = 0; c < COLS; c++) {
        const x = startX + c * (tile + GAP);

        // Page 1, first row: KEY | HDR | CT | CT
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

    // mini-sweep fallback: overlapping windows along rows
    if (!paperState.totalTiles || Object.keys(paperState.tiles).length < (paperState.totalTiles || Infinity)) {
      const cols = 3, rows = Math.max(6, Math.floor((H - (MARGIN + BANNER)) / (tile * 0.9)));
      const winW = Math.floor(tile * 1.2), winH = Math.floor(tile * 1.2);
      for (let r = 0; r < rows; r++) {
        const yy = Math.max(MARGIN, Math.min(H - winH - MARGIN, MARGIN + BANNER + Math.round(r * (tile * 0.8))));
        for (let c = 0; c < cols; c++) {
          const xx = Math.max(MARGIN, Math.min(W - winW - MARGIN, startX + Math.round(c * (tile + GAP) - tile * 0.1)));
          await tryRect(xx, yy, winW, winH, `p${p}-mini`);
        }
        await tick();
      }
    }

    updatePaperProgress();
    await tick();
  }
}

// ---------- Image file scanner (layout-aware → sweeps → upscale; BD → ZXing → jsQR) ----------
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

// ---------- Canvas sweep (4-col aware) with BD → ZXing-polyfill → jsQR + upscale ----------
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

    // 1) Native BD
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

    // 2) ZXing via polyfill (separate pass even if native exists)
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

    // 3) jsQR
    try {
      const img = sctx.getImageData(0, 0, w, h);
      const qr = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (qr?.data) { add(qr.data); return true; }
    } catch {}

    return false;
  }

  // Pass 0: full frame
  await decodeRegion(0, 0, canvas.width, canvas.height);

  // Pass 1: 4-column grid (M=6pt, G=6pt, L=6pt, B=60pt at 300dpi)
  {
    const DPI = 300, PT_PER_IN = 72, pt2px = DPI / PT_PER_IN;
    const MARGIN = Math.round(6  * pt2px);
    const GAP    = Math.round(6  * pt2px);
    const LABEL  = Math.round(6  * pt2px);
    const BANNER = Math.round(60 * pt2px);
    const COLS   = 4;

    const W = canvas.width, H = canvas.height;
    const innerW = W - 2 * MARGIN;
    const tile   = Math.floor((innerW - GAP * (COLS - 1)) / COLS);
    const usedW  = COLS * tile + GAP * (COLS - 1);
    const startX = MARGIN + Math.floor((innerW - usedW) / 2);
    const rowH   = LABEL + tile + GAP;

    let y = MARGIN + BANNER + LABEL;
    while (y + tile <= H - MARGIN) {
      for (let c = 0; c < COLS; c++) {
        const x = startX + c * (tile + GAP);
        if (x + tile > W - MARGIN) break;
        await decodeRegion(x, y, tile, tile);
      }
      y += rowH;
    }
  }

  // Pass 2: sweeps (coarse → fine with overlap)
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

  // Pass 3: upscale retry (1.5× full + 3×3 subtiles)
  {
    const scale = 1.5;
    const tmp = document.createElement('canvas');
    tmp.width  = Math.floor(canvas.width  * scale);
    tmp.height = Math.floor(canvas.height * scale);
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);

    // full upscaled
    await (async () => {
      // Native BD
      if (BD_NATIVE) {
        try {
          const bmp = await createImageBitmap(tmp);
          const codes = await BD_NATIVE.detect(bmp);
          for (const c of (codes || [])) add((c.rawValue || '').trim());
        } catch {}
      }
      // ZXing polyfill
      if (BD_ZXING) {
        try {
          const bmp = await createImageBitmap(tmp);
          const codes = await BD_ZXING.detect(bmp);
          for (const c of (codes || [])) add((c.rawValue || '').trim());
        } catch {}
      }
      // jsQR
      try {
        const img = tctx.getImageData(0, 0, tmp.width, tmp.height);
        const qr = jsQR(img.data, tmp.width, tmp.height, { inversionAttempts: 'attemptBoth' });
        if (qr?.data) add(qr.data.trim());
      } catch {}
    })();

    // 3×3 subtiles
    const sx = Math.floor(tmp.width  / 3);
    const sy = Math.floor(tmp.height / 3);
    for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 3; gx++) {
      const x = gx * sx, y = gy * sy;
      try {
        const sub = tctx.getImageData(x, y, sx, sy);
        const qr2 = jsQR(sub.data, sx, sy, { inversionAttempts: 'attemptBoth' });
        if (qr2?.data) add(qr2.data.trim());
      } catch {}
    }
  }

  return Array.from(results);
}

// ---------- File picker ----------
async function handlePaperFiles(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  // reset state
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

// ===== Simple camera loop just for MVKEY/MVHDR/MVCT scanning =====
let __mvCamStream = null;
let __mvCamLoop = null;

async function startPaperCamera() {
  // pick "environment" / rear if available
  const constraints = {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  };

  stopPaperCamera(); // clean any existing

  const v = document.getElementById('paperCam');
  if (!v) return;

  __mvCamStream = await navigator.mediaDevices.getUserMedia(constraints);
  v.srcObject = __mvCamStream;
  v.playsInline = true;
  v.style.display = 'block';
  await v.play();

  // light periodic scan (2–4 fps) to keep CPU down
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
  }, 300); // ~3.3 fps; adjust if you want faster
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

// Small wrappers used by your HTML buttons
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

// expose for inline onclick
window.startKeyCam = startKeyCam;
window.stopKeyCam = stopKeyCam;
window.scanFromVideoOnce = scanFromVideoOnce;

// ---------- Small helpers ----------
function setPaperMsg(msg) {
  const el = paperEls.status();
  if (!el) return;
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.innerHTML += (el.innerHTML ? "<br>" : "") + line;
  el.scrollTop = el.scrollHeight;
}

function b64ToU8Direct(b64) {
  // decode a base64 string (may include CR/LF/spaces) → Uint8Array
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

// Compute decoded length from raw base64 length
function base64DecodedLen(b64) {
  const s = b64.replace(/\s+/g, '');
  const pad = (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);
  return Math.floor(s.length / 4) * 3 - pad;
}

// ---------- Parse MV payloads (single-file spec) ----------
// MVKEY|<hex-64>
// MVHDR|<base64(JSON:{v,iv,size,sha256})>
// MVCT|<index>/<total>|<base64-chunk>
function parseQRText(txt) {
  if (!txt || typeof txt !== 'string') return null;
  txt = txt.trim();

  if (txt.startsWith("MVKEY|")) {
    const hex = txt.slice(6).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) return null;   // 32 bytes as hex
    return { type: "MVKEY", hex };
  }

  if (txt.startsWith("MVHDR|")) {
    const jsonB64 = txt.slice(6).trim();
    try {
      const raw = atob(jsonB64.replace(/\s+/g, ''));
      let json;
      try {
        json = JSON.parse(raw);
      } catch {
        // Fallback for btoa(unescape(encodeURIComponent(...))) style
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
  if (txtEl) {
    txtEl.textContent = `Status — Header: ${haveHdr ? "yes" : "no"} | Tiles: ${haveCt}/${total} | KEY: ${haveKey ? "yes" : "no"}`;
  }

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

  // 🔁 Auto-rebuild once when everything is ready
  if (ready && !window.__mvAutoRebuildDone) {
    window.__mvAutoRebuildDone = true;
    setPaperMsg("All pieces captured — rebuilding ZIP automatically…");
    // slight microtask delay to allow UI update before heavy work
    setTimeout(() => rebuildLiteFromPaper().catch(console.error), 50);
  }
}

// ---------- Intake a decoded QR payload ----------
function ingestQR(raw, src = "QR") {
  if (!raw || paperState.seenPayloads.has(raw)) return;
  paperState.seenPayloads.add(raw);

  const p = parseQRText(raw);
  if (!p) return;

  if (p.type === "MVKEY") {
    if (!paperState.keyHex) {
      paperState.keyHex = p.hex;
      setPaperMsg(`Captured MVKEY (key).`);
    }
  } else if (p.type === "MVHDR") {
    if (!paperState.header) {
      paperState.header = p.data;
      setPaperMsg(`Captured MVHDR (header).`);
    }
  } else if (p.type === "MVCT") {
    // Lock in total once seen; detect conflicts
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



// ==============================
// Open/Close modal + wiring (updated)
// ==============================
function openPaperDecrypt() {
  // Insert progress UI once
  if (!paperEls.barHost()) {
    const host = document.createElement('div');
    host.id = 'paperProgressHost';
    host.style.cssText = 'width:100%;text-align:left;margin:6px 0;';
    host.innerHTML = `
      <div id="paperProgressText" style="font-size:14px;color:#ccc;margin-bottom:6px;">
        Status — waiting for uploads…
      </div>
      <div style="background:#222;border:1px solid #0f0;border-radius:6px;overflow:hidden;height:12px;">
        <div id="paperProgressBar" style="height:12px;width:0%;background:#00ff99;"></div>
      </div>`;
    const modal = paperEls.modal();
    const status = paperEls.status();
    modal.querySelector('.modal')?.insertBefore(host, status) || modal.insertBefore(host, status);
  }

  // Reset capture state
  Object.assign(paperState, { header:null, keyHex:null, tiles:{}, totalTiles:null, seenPayloads:new Set() });
  const statusEl = paperEls.status();
  if (statusEl) statusEl.innerHTML = "Waiting for uploads...";

  // Reset button look
  const btn = paperEls.rebuildBtn();
  if (btn) { 
    btn.disabled = true; 
    btn.style.opacity = '.4'; 
    btn.style.filter = 'grayscale(100%)'; 
    btn.style.pointerEvents = 'none'; 
  }

  // Bind file input
  const files = paperEls.files();
  if (files) files.onchange = handlePaperFiles;

  // Show modal
  const m = paperEls.modal();
  if (m) m.style.display = 'flex';

  // ❌ Removed auto-start of camera here.
  // ✅ Camera will now only start when the user clicks "Start Camera" (startKeyCam → startPaperCamera).

  // Reset auto-rebuild latch
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

    // 1) Pre-size the ciphertext buffer
    let totalCtBytes = 0;
    for (let i = 1; i <= totalTiles; i++) {
      const part = tiles[i];
      if (!part) throw new Error(`Missing ciphertext tile ${i}/${totalTiles}.`);
      totalCtBytes += base64DecodedLen(part);
    }
    const ctBytes = new Uint8Array(totalCtBytes);

    // 2) Decode each chunk directly into the buffer
    let offset = 0;
    for (let i = 1; i <= totalTiles; i++) {
      const chunkU8 = b64ToU8Direct(tiles[i]);
      ctBytes.set(chunkU8, offset);
      offset += chunkU8.length;
    }

    // 3) Decrypt
    const keyU8 = new Uint8Array(keyHex.match(/.{1,2}/g).map(h => parseInt(h, 16)));
    const aesKey = await crypto.subtle.importKey("raw", keyU8, "AES-GCM", false, ["decrypt"]);
    const ivU8  = new Uint8Array(header.iv);
    const zipBytes = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivU8 }, aesKey, ctBytes)
    );

    // 4) Verify
    if (zipBytes.length !== header.size) {
      throw new Error(`Size mismatch (expected ${header.size}, got ${zipBytes.length}).`);
    }
    const gotSha = await sha256Hex(zipBytes);
    if (gotSha !== header.sha256) {
      throw new Error(`SHA-256 mismatch. Expected ${header.sha256}, got ${gotSha}.`);
    }

    // 5) Download + optional auto-import
    const blob = new Blob([zipBytes], { type: "application/zip" });
    const name = "memoro-lite.zip";
    const url  = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setPaperMsg(`✅ Rebuild complete. Download started: ${name}`);

    // Optional auto-import into dashboard vault list
    if (typeof handleVaultZip === 'function') {
      const dt = new DataTransfer();
      dt.items.add(new File([blob], name, { type: "application/zip" }));
      const fakeInput = document.createElement('input');
      fakeInput.type = 'file';
      fakeInput.files = dt.files;
      await handleVaultZip({ target: fakeInput });
      setPaperMsg("ZIP auto-imported into your vault list.");
    }

    // Clean up & close after a short grace period
    stopPaperCamera();
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch {}
      closePaperDecrypt();
    }, 5000);

  } catch (err) {
    console.error(err);
    setPaperMsg(`❌ Rebuild failed: ${err.message}`);
    alert(`Rebuild failed: ${err.message}`);
    // allow another auto attempt if user keeps scanning/adding pages
    window.__mvAutoRebuildDone = false;
  }
}

// Expose for UI
window.openPaperDecrypt = openPaperDecrypt;
window.closePaperDecrypt = closePaperDecrypt;
window.rebuildLiteFromPaper = rebuildLiteFromPaper;
window.startKeyCam = startKeyCam;
window.stopKeyCam  = stopKeyCam;

/* ========= Delegated action handler ========= */

// tiny helper so missing functions don't explode
function callIf(name, ...args) {
  const fn = (typeof name === "function") ? name
           : (typeof window[name] === "function" ? window[name] : null);
  if (!fn) return console.warn(`[dashboard] Missing handler: ${name}`);
  return fn(...args);
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;

  const action = el.getAttribute("data-action");

  switch (action) {
    /* Offline warning */
    case "offline-warning":
      callIf("promptOfflineWarning", el.getAttribute("data-mode"));
      break;
    case "offline-continue":
      callIf("proceedAfterOfflineWarning");
      break;
    case "offline-cancel":
      callIf("cancelOfflineWarning");
      break;

    /* Vault list items */
    case "vault-menu":
      callIf("toggleMenu", el.getAttribute("data-vault-id"));
      break;
    case "vault-rename":
      callIf("renameVault", el.getAttribute("data-vault-id"));
      break;
    case "vault-delete":
      callIf("deleteVault", el.getAttribute("data-vault-id"));
      break;
    case "vault-unlock":
      callIf("openUnlockModal", el.getAttribute("data-vault-id"));
      break;

    /* Unlock modal */
    case "unlock-submit":
      callIf("submitUnlock");
      break;
    case "unlock-cancel":
      callIf("cancelUnlock");
      break;

    /* Message modal */
    case "message-close":
      callIf("closeMessageModal");
      break;

    /* Confirm modal */
    case "confirm-yes":
      callIf("confirmYes");
      break;
    case "confirm-no":
      callIf("confirmNo");
      break;

    /* Rename modal */
    case "rename-submit":
      callIf("submitRename");
      break;
    case "rename-cancel":
      callIf("cancelRename");
      break;

    /* Paper decrypt modal */
    case "open-paper-decrypt":
      callIf("openPaperDecrypt");
      break;
    case "paper-close":
      callIf("closePaperDecrypt");
      break;
    case "paper-rebuild":
      callIf("rebuildLiteFromPaper");
      break;
    case "paper-cam-start":
      callIf("startKeyCam");
      break;
    case "paper-cam-stop":
      callIf("stopKeyCam");
      break;
    case "paper-cam-scan":
      callIf("scanFromVideoOnce");
      break;

    /* Navigation */
    case "go-how-it-works":
      callIf("goToHowItWorks");
      break;
  }
});

/* ========= Non-click bindings & quality-of-life ========= */
document.addEventListener("DOMContentLoaded", () => {
  // Hidden inputs -> JS handlers
  const zipInput = document.getElementById("vaultZipInput");
  if (zipInput) zipInput.addEventListener("change", (ev) => callIf("handleVaultZip", ev));

  const pdfInput = document.getElementById("paperPdfInput");
  if (pdfInput) pdfInput.addEventListener("change", (ev) => callIf("scanPdfFile", ev));

  const imgInput = document.getElementById("paperImageInput");
  if (imgInput) imgInput.addEventListener("change", (ev) => callIf("scanImageFile", ev));
});

// Optional: close modals on backdrop click or ESC (only if you like)
document.addEventListener("click", (e) => {
  const id = (e.target && e.target.id) || "";
  if (id === "offlineWarning") callIf("cancelOfflineWarning");
  if (id === "messageModal")   callIf("closeMessageModal");
  if (id === "confirmModal")   callIf("confirmNo");
  if (id === "renameModal")    callIf("cancelRename");
  if (id === "paperDecryptModal") callIf("closePaperDecrypt");
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // Call the safest “close” for each modal if it’s open
  const visible = (id) => document.getElementById(id)?.style.display === "flex";
  if (visible("offlineWarning")) callIf("cancelOfflineWarning");
  if (visible("messageModal"))   callIf("closeMessageModal");
  if (visible("confirmModal"))   callIf("confirmNo");
  if (visible("renameModal"))    callIf("cancelRename");
  if (visible("paperDecryptModal")) callIf("closePaperDecrypt");
});
