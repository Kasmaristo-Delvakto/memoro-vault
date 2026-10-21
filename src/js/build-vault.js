  // Toggle Build Vault styles (and Matrix effect, if available)
  function applyBuildTheme(theme) {
    const cy = document.getElementById('theme-cypherpunk');
    const cl = document.getElementById('theme-clean');
    const isCypher = (theme === 'cypherpunk');

    // 1) Flip stylesheets
    if (cy) cy.disabled = !isCypher;
    if (cl) cl.disabled =  isCypher;

    // 2) Set a body data-attribute (useful for CSS hooks)
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

    // 3) Optional Matrix controller for this page
    if (window.BuildMatrix) {
      if (isCypher) BuildMatrix.start();
      else BuildMatrix.stop();
    }
  }

  // Initialize from saved preference and apply once DOM is ready
(function initBuildTheme() {
  const THEME_KEY = 'theme';

  // 1) Prefer sessionStorage (index sets it there), then fall back to localStorage, then default
  const sessionVal = sessionStorage.getItem(THEME_KEY);
  const localVal   = localStorage.getItem(THEME_KEY);
  const saved      = (sessionVal ?? localVal) ?? 'cypherpunk';

  // 2) Keep BOTH storages in sync so other pages find the same value
  if (localVal   !== saved) localStorage.setItem(THEME_KEY, saved);
  if (sessionVal !== saved) sessionStorage.setItem(THEME_KEY, saved);

  // 3) Pre-flip styles early to avoid FOUC
  const cy = document.getElementById('theme-cypherpunk');
  const cl = document.getElementById('theme-clean');
  const isCypher = (saved === 'cypherpunk');
  if (cy) cy.disabled = !isCypher;
  if (cl) cl.disabled =  isCypher;

  // 4) Apply body attribute + optional Matrix hook
  const apply = () => applyBuildTheme(saved);
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
})();


// Paper backup (Lite ZIP → QR PDF) lives in js/paper-backup.js; vault sealing in js/vault-core.js.
const MV = window.MemoroVaultCore;

// ---------- Lite Picker helpers ----------
const LITE_CAP_BYTES = MV.LITE_CAP_BYTES; // ≈ 150 KiB cap on raw content

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`;
  return `${(n/1024/1024).toFixed(2)} MB`;
}

// One checkbox row in the Lite picker. Names are user-supplied, so they go in as text, never HTML.
function litePickerRow(id, dataAttr, dataValue, rawSize, label = dataValue) {
  const row = document.createElement('label');
  row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-bottom:1px dashed rgba(0,255,153,.2)';
  const left = document.createElement('span');
  left.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = id;
  box.setAttribute(dataAttr, dataValue);
  const code = document.createElement('code');
  code.textContent = label;
  left.append(box, code);
  const size = document.createElement('span');
  size.style.color = '#b8ffd9';
  size.textContent = fmtBytes(rawSize);
  row.append(left, size);
  return row;
}

/**
 * Open a modal allowing the user to choose which seeds, uploads, and whether the final message
 * should be included. Enforces ≤ 150 KB total (raw).
 *
 * @param {Object} args
 * @param {{name:string,content:string}[]} args.seedFiles
 * @param {{id:string,name:string,type:string,raw:ArrayBuffer}[]} args.uploads
 * @param {number} args.finalMessageBytesLen
 * @returns {Promise<{ includeFinalMessage:boolean, seedNames:string[], uploadIds:string[] }>}
 */
function openLitePicker({ seedFiles, uploads, finalMessageBytesLen }) {
  return new Promise((resolve, reject) => {
    const modal    = document.getElementById('litePickerModal');
    const seedsEl  = document.getElementById('liteSeedsList');
    const uploadsEl= document.getElementById('liteUploadsList');
    const pickFinal= document.getElementById('litePickFinalMsg');
    const totalEl  = document.getElementById('liteTotalBytes');
    const errEl    = document.getElementById('litePickerError');
    const btnOK    = document.getElementById('litePickerConfirm');
    const btnCancel= document.getElementById('litePickerCancel');

    if (!modal) return reject(new Error('Lite picker modal missing'));

    seedsEl.innerHTML   = '';
    uploadsEl.innerHTML = '';
    errEl.textContent   = '';
    totalEl.textContent = '0';
    pickFinal.checked   = !!finalMessageBytesLen && finalMessageBytesLen > 0;

    // Seeds list
    for (const s of seedFiles) {
      const rawSize = new TextEncoder().encode(s.content || '').length;
      const id = `seed_${seedFiles.indexOf(s)}`;
      seedsEl.appendChild(litePickerRow(id, 'data-name', s.name, rawSize));
    }

    // Uploads list
    for (const f of uploads) {
      const rawSize = (f.raw && f.raw.byteLength) ? f.raw.byteLength : 0;
      const id = `upl_${f.id}`;
      uploadsEl.appendChild(litePickerRow(id, 'data-id', String(f.id), rawSize, f.name));
    }

    function calcTotalBytes() {
      let total = 0;
      // seeds
      for (const el of seedsEl.querySelectorAll('input[type="checkbox"]')) {
        if (el.checked) {
          const nm = el.getAttribute('data-name');
          const s = seedFiles.find(x => x.name === nm);
          total += new TextEncoder().encode(s?.content || '').length;
        }
      }
      // final message
      if (pickFinal.checked) total += (finalMessageBytesLen || 0);
      // uploads
      for (const el of uploadsEl.querySelectorAll('input[type="checkbox"]')) {
        if (el.checked) {
          const id = el.getAttribute('data-id');
          const u = uploads.find(x => String(x.id) === String(id));
          total += (u?.raw?.byteLength || 0);
        }
      }
      totalEl.textContent = `${total} (${fmtBytes(total)})`;
      errEl.textContent = total > LITE_CAP_BYTES ? `Too large. Reduce selection below ${fmtBytes(LITE_CAP_BYTES)}.` : '';
      return total;
    }

    seedsEl.addEventListener('change', calcTotalBytes);
    uploadsEl.addEventListener('change', calcTotalBytes);
    pickFinal.addEventListener('change', calcTotalBytes);

    btnCancel.onclick = () => { modal.style.display = 'none'; reject(new Error('User cancelled Lite picker')); };

    btnOK.onclick = () => {
      const total = calcTotalBytes();
      if (total === 0) { errEl.textContent = 'Select at least one item.'; return; }
      if (total > LITE_CAP_BYTES) { errEl.textContent = `Too large. Reduce selection below ${fmtBytes(LITE_CAP_BYTES)}.`; return; }

      const seedNames = Array.from(seedsEl.querySelectorAll('input[type="checkbox"]:checked'))
        .map(el => el.getAttribute('data-name'));
      const uploadIds = Array.from(uploadsEl.querySelectorAll('input[type="checkbox"]:checked'))
        .map(el => el.getAttribute('data-id'));

      modal.style.display = 'none';
      resolve({ includeFinalMessage: !!pickFinal.checked && !!finalMessageBytesLen, seedNames, uploadIds });
    };

    modal.style.display = 'block';
    calcTotalBytes();
  });
}

  function copyDonationLink() {
    const url = "https://trocador.app/en/anonpay/?ticker_to=xmr&network_to=Mainnet&address=83czGNh6SKbhmjg3wPzeiDRQbN7gkLLqTYSvfMGRQRmKQf1SyQTG88Db67NoBdEvpCii6Qzcxq3BxNt94FDeJutmJ3xBXc6&donation=True&amount=0.1&name=Kasmaristo+Delvakto&description=Memoro+Vault+is+funded+by+donations+only.+Thanks+for+your+support!&ticker_from=xmr&network_from=Mainnet&bgcolor=";
    navigator.clipboard.writeText(url)
      .then(() => alert("Donation link copied to clipboard. You can paste it into your browser later."))
      .catch(() => alert("Failed to copy. Please copy it manually:\n" + url));
  }
    let vaultBuildManuallyTriggered = false;

   document.addEventListener("DOMContentLoaded", async () => {
  vaultBuildManuallyTriggered = true;

  window.cryptoWasmReady = window.initCryptoWasm();
  await window.cryptoWasmReady;
  startVaultBuild();
});


    function printToTerminal(labelText, percent = null) {
  const label = document.getElementById("progressLabel");
  const fill = document.getElementById("progressFill");

  if (label) label.textContent = labelText;

  if (percent !== null && fill) {
    const blocks = fill.querySelectorAll(".progress-block");
    const total = blocks.length;
    const filledCount = Math.round((percent / 100) * total);

    blocks.forEach((block, i) => {
      block.classList.toggle("filled", i < filledCount);
    });
  }
}

    function showToast(msg) {
      alert(msg);
    }

    async function delay(ms) {
      return new Promise(res => setTimeout(res, ms));
    }

    async function streamTerminalLogs() {
      const lines = [
  "[booting] Initializing consciousness...",
    ];
      
for (const line of lines) {
        await printToTerminal(line);
        document.getElementById('logoContent').style.opacity = 1;
setTimeout(() => {
  document.getElementById('actionButtons').style.opacity = 1;
}, 200);

        await delay(300 + Math.random() * 200);
      }
    }

async function startVaultBuild() {
  if (!vaultBuildManuallyTriggered) {
    console.warn("Prevented auto-start of vault build.");
    return;
  }

  try {
    printToTerminal("[*] Loading user input...", 5);
    await delay(200);
    const inputs = await loadUserInputs();

    printToTerminal("[*] Preparing vault structure...", 15);
    const files = await loadIndexedFiles();
    printToTerminal(`[+] Found ${files.length} file(s) for encryption.`, 20);
    await delay(150);

    printToTerminal("[*] Selecting and permuting questions...", 30);
    // Layer-2 layout: a CSPRNG shuffle of the non-gate questions. The first six get a
    // hidden answer order (brute-forced at recovery), the rest keep a fixed order.
    const numQuestions = inputs.normalizedAnswers.length;
    const gateIndices = [inputs.unlockIndexes[0], inputs.unlockIndexes[1]];
    // The red herring (an empty answer) stays out of the six: inside them it would cut the
    // possible orders from 720 to 120.
    const trap = Number.isInteger(inputs.trapIndex) ? inputs.trapIndex : -1;
    const layer2Indices = MV.shuffle(
      Array.from({ length: numQuestions }, (_, i) => i).filter(i => !gateIndices.includes(i) && i !== trap)
    );
    const selectedL2Indices = layer2Indices.slice(0, 6);
    const remainingL2Indices = MV.shuffle([...layer2Indices.slice(6), ...(trap >= 0 && !gateIndices.includes(trap) ? [trap] : [])]);

    const namedSeedFiles = JSON.parse(localStorage.getItem("namedSeedFiles") || "[]");
    const answerAt = (i) => inputs.normalizedAnswers[i];
    const sealArgs = {
      unlockConcat: inputs.unlockAnswer1 + inputs.unlockAnswer2,
      layer1Payload: {
        questionList: buildQuestionList(inputs),
        selectedL2Indices, remainingL2Indices, gateIndices
      },
      gateAnswers: gateIndices.map(answerAt),
      remainingAnswers: remainingL2Indices.map(answerAt),
      selectedAnswers: selectedL2Indices.map(answerAt),
      questionPrompts: gateIndices.map(i => inputs.questions[i] || `Question ${i + 1}`),
      uploads: files.map(f => ({ name: f.name, mime: f.type, bytes: new Uint8Array(f.raw) })),
      seeds: namedSeedFiles.map(s => ({ name: s.name, content: s.content })),
      finalMessage: inputs.finalMessage || ""
    };

    // 1) FULL vault (includes uploads)
    printToTerminal("[+] Encrypting FULL vault...", 45);
    const full = await MV.sealVault(Object.assign({}, sealArgs, {
      onProgress: (done, total) => printToTerminal("[+] Encrypting FULL vault...", 45 + Math.round(30 * done / total))
    }));

    printToTerminal("[*] Packaging FULL vault...", 76);
    const fullZip = await MV.packageZip(full, { includeDocs: true });
    for (const f of full.files) f.bytes = null; // the ZIP holds them now

    // Re-open the ZIP we just made and decrypt every part before handing it over.
    printToTerminal("[*] Verifying vault (re-opening and decrypting every file)...", 80);
    await MV.verifyVaultZip(fullZip, {
      unlockConcat: sealArgs.unlockConcat,
      permutedConcat: full.permutedConcat,
      expected: [
        ...sealArgs.uploads.map(u => ({ name: u.name, bytes: u.bytes })),
        ...sealArgs.seeds.map(sd => ({ name: sd.name, bytes: new TextEncoder().encode(sd.content) })),
        ...(sealArgs.finalMessage.trim()
          ? [{ name: MV.FINAL_MESSAGE_NAME, bytes: new TextEncoder().encode(sealArgs.finalMessage.trim()) }]
          : [])
      ]
    });

    if (!await saveVaultBytes(fullZip, "memoro-vault.zip")) {
      printToTerminal("[!] The vault was not saved. Use Retry Download to build it again.", null);
      showToast("The vault was not saved. Use Retry Download to build it again.");
      return;
    }
    printToTerminal("[✔] Full vault verified and saved.", 90);

    // 2) LITE payload: let the user choose contents (≤ 150 KB)
    const finalMessageBytesLen = sealArgs.finalMessage.trim()
      ? new TextEncoder().encode(sealArgs.finalMessage.trim()).length
      : 0;

    printToTerminal("[*] Choose what to include in your paper backup...", 92);
    let liteSelection = null;
    try {
      liteSelection = await openLitePicker({
        seedFiles: namedSeedFiles,
        uploads: files,
        finalMessageBytesLen
      });
    } catch (e) {
      if (e && e.message === "User cancelled Lite picker") {
        printToTerminal("[i] Paper backup skipped by user. Proceeding to final instructions...", 96);
        showPostBuildModal();
        return; // exit gracefully instead of throwing
      }
      throw e; // real error, let outer catch handle
    }

    printToTerminal("[*] Building Lite Vault (using your selection)...", 94);
    const uploadIds = new Set(liteSelection.uploadIds.map(String));
    const liteUploads = sealArgs.uploads.filter((_, i) => uploadIds.has(String(files[i].id)));
    const liteSeeds = sealArgs.seeds.filter(sd => liteSelection.seedNames.includes(sd.name));
    const liteFinal = liteSelection.includeFinalMessage ? sealArgs.finalMessage : "";

    let liteTotal = liteFinal.trim() ? finalMessageBytesLen : 0;
    for (const u of liteUploads) liteTotal += u.bytes.byteLength;
    for (const sd of liteSeeds) liteTotal += new TextEncoder().encode(sd.content || "").length;
    if (liteTotal > LITE_CAP_BYTES) {
      throw new Error(`Lite selection exceeds 150 KB cap (${liteTotal} bytes).`);
    }

    // Same answers, salts and hidden order as the full vault, so the same answers open both.
    const lite = await MV.sealVault(Object.assign({}, sealArgs, {
      uploads: liteUploads,
      seeds: liteSeeds,
      finalMessage: liteFinal,
      fixed: { layer1Salt: full.layer1Salt, fullSalt: full.fullSalt, permutation: full.permutation }
    }));
    const liteZip = await MV.packageZip(lite, { includeDocs: false });

    // Turn Lite ZIP into a single-file QR PDF and auto-download
    printToTerminal("[*] Encrypting Lite ZIP and creating single-file QR PDF...", 96);
    await MemoroPaperBackup.buildPaperPdfFromLiteZip(liteZip);

    printToTerminal("[✔] Full vault and paper PDF created.", 100);
    showPostBuildModal();
  } catch (err) {
    console.error("Vault build error:", err);
    printToTerminal(`[!] Error: ${err.message}`, null);
    showToast("Something went wrong while creating your vault.");
  }
}

// Saves through the main process, so a cancelled or failed write is noticed and a large vault
// never has to become one huge in-memory Blob. Outside the desktop app it is a normal download.
async function saveVaultBytes(bytes, fileName) {
  const api = window.memoroAPI;
  if (!api || typeof api.saveFile !== "function") {
    downloadBlob(new Blob([bytes], { type: "application/zip" }), fileName);
    return true;
  }
  for (;;) {
    const r = await api.saveFile(fileName, bytes);
    if (r && r.saved) return true;
    const why = r && r.error ? `The vault could not be written (${r.error}).` : "The vault was not saved.";
    if (!confirm(`${why}\n\nChoose a location again?`)) return false;
  }
}

function downloadBlob(blob, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
}

async function loadUserInputs() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("memoroVaultDB", 2);
    req.onerror = () => reject("Failed to open IndexedDB.");
    req.onsuccess = async () => {
      const db = req.result;
      const tx = db.transaction("vaultUserData", "readonly");
      const store = tx.objectStore("vaultUserData");
      const getReq = store.get("userData");

      getReq.onsuccess = () => {
        const data = getReq.result;
        if (!data) return reject("User data not found in IndexedDB.");

        const unlockAnswer1 = (data.answers[data.unlockIndexes[0]] || "").trim().toLowerCase();
        const unlockAnswer2 = (data.answers[data.unlockIndexes[1]] || "").trim().toLowerCase();

        const normalizedAnswers = data.answers.map((a, i) =>
          i === data.trapIndex ? "" : (a || "").trim().toLowerCase()
        );

        resolve({
          ...data,
          unlockAnswer1,
          unlockAnswer2,
          normalizedAnswers
        });

        db.close();
      };
      getReq.onerror = () => reject("Failed to read user data from IndexedDB.");
    };
  });
}

    async function loadIndexedFiles() {
      const uploadedMeta = JSON.parse(localStorage.getItem("uploadedFileMeta") || "[]");
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("memoroVaultDB", 2);
        req.onerror = () => reject("IndexedDB open failed");
        req.onsuccess = () => resolve(req.result);
      });

      const result = [];
      try {
        for (const meta of uploadedMeta) {
          const rec = await new Promise((resolve, reject) => {
            const tx = db.transaction("vaultFiles", "readonly");
            const store = tx.objectStore("vaultFiles");
            const getReq = store.get(meta.id);
            getReq.onsuccess = () => resolve(getReq.result);
            getReq.onerror = () => reject(new Error("File read failed"));
          });
          // uploads are stored in 16 MB pieces (idb-chunks.js); older records carry the bytes whole
          let raw = rec && rec.raw;
          if (!raw && rec && Number.isInteger(rec.chunks)) {
            raw = (await MemoroChunks.getBytes(db, "vaultFiles", meta.id, { chunks: rec.chunks, size: rec.size })).buffer;
          }
          if (!raw) throw new Error(`${meta.name} is no longer in memory. Go back to the answers page and add it again.`);
          result.push({ ...meta, raw });
        }
      } finally {
        db.close();
      }
      return result;
    }

// Question list stored in vault.enc (MCQ-aware; MCQ options get a CSPRNG shuffle per question)
function buildQuestionList(userData) {
  return userData.answers.map((ans, i) => {
  const trimmed = (ans || "").trim();
  const spaceIndexes = userData.spaceIndexes?.[i] || [];
  const hintEntry = userData.hints?.[i] || {};

  const showLength =
    typeof hintEntry.showLength === "boolean" ? hintEntry.showLength : true;

  // Back-compat for any legacy "values/letters" forms
  let hintValuesLocal = Array.isArray(hintEntry.values)
    ? [...hintEntry.values]
    : Array.isArray(hintEntry.letters)
      ? hintEntry.letters.map(pos => {
          const ch = trimmed[pos - 1];
          return ch !== undefined ? ch : "_";
        })
      : [];

  // ---- MCQ (options 6–12, include the real answer, then shuffle) ----
  const mcqEnabled = !!hintEntry.mcqEnabled;
  let mcqOptions = null;

  if (mcqEnabled) {
    // Collect options; ensure real answer is present
    const entered = String(trimmed);
    const raw = Array.isArray(hintEntry.mcqOptions)
      ? hintEntry.mcqOptions.map(s => String(s || "").trim()).filter(Boolean)
      : [];
    if (!raw.some(x => x.toLowerCase() === entered.toLowerCase())) raw.unshift(entered);

    // Clamp 6–12 and shuffle
    const targetCount = Math.min(12, Math.max(6, raw.length));
    const limited = raw.slice(0, targetCount);
    mcqOptions = MV.shuffle(limited);

    // For MCQ, length/letters aren’t shown in UI
    hintValuesLocal = [];
  }

  return {
    question: userData.questions[i] || `Question ${i + 1}`,
    expectedLength: mcqEnabled ? null : (showLength ? trimmed.length : null),
    hintLetters: mcqEnabled ? [] : [...(hintEntry.letters || [])],
    hintValues: hintValuesLocal,
    spaceIndexes: [...spaceIndexes],
    custom: typeof hintEntry.custom === "string"
      ? hintEntry.custom
      : Array.isArray(hintEntry.custom)
        ? hintEntry.custom.join(", ")
        : (typeof hintEntry.custom === "object" && hintEntry.custom !== null)
          ? JSON.stringify(hintEntry.custom)
          : "",
    showLength,
    // NEW: MCQ
    mcqEnabled,
    mcqOptions
  };
});
}

    function showBackupMessage(url) {
      const msg = document.createElement('p');
      msg.innerHTML = `If your download didn’t start, <a href="${url}" download="memoro-vault.zip">click here to download manually</a>.`;
      msg.style.color = '#aaa';
      msg.style.fontSize = '16px';
      msg.style.marginTop = '30px';
      document.body.appendChild(msg);
    }


function retryDownload() {
  window.location.reload();
}

    // Matrix Rain Controller for Build Vault
const canvas = document.getElementById('matrixCanvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const letters = 'モヤユヨラリルレロワヲンABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890@$%&'.split('');
const fontSize = 14;
let drops = [];
let intervalId = null;

function initDrops() {
  const columns = Math.floor(canvas.width / fontSize);
  drops = Array(columns).fill(1);
}

function drawMatrixFrame() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#0F0';
  ctx.font = fontSize + 'px monospace';

  for (let i = 0; i < drops.length; i++) {
    const text = letters[Math.floor(Math.random() * letters.length)];
    ctx.fillText(text, i * fontSize, drops[i] * fontSize);

    if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
      drops[i] = 0;
    }

    drops[i]++;
  }
}

window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  initDrops();
});

// Exposed controller
window.BuildMatrix = {
  start() {
    if (!intervalId) {
      initDrops();
      intervalId = setInterval(drawMatrixFrame, 40);
    }
  },
  stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
};

// Auto-start in cypherpunk mode
if (document.body.getAttribute('data-theme') === 'cypherpunk') {
  window.BuildMatrix.start();
}

// ---- Wipe helpers / guards ----
const THEME_KEY = "theme";
let preserveOnBack = false;
let _nukeHasRun = false;

function preserveAndGoBack() {
  preserveOnBack = true;           // don't auto-wipe on this navigation
  history.back();
}

window.addEventListener("beforeunload", () => {
  if (!preserveOnBack) {
    // Fire-and-forget wipe on uncontrolled unloads (tab close, hard nav, etc.)
    nukeEverything({ fireAndForget: true });
  }
});

/**
 * Wipes all app data except the theme.
 * - Preserves THEME_KEY from both storages (reads from either, writes to both)
 * - Deletes only known Memoro Vault IndexedDB databases
 * - Guarded to run once per page (prevents double-wipe on redirects)
 */
async function nukeEverything(opts = {}) {
  if (_nukeHasRun) return;
  _nukeHasRun = true;

  try {
    // 1) Cache theme from either storage (session wins, then local)
    const themeSession = sessionStorage.getItem(THEME_KEY);
    const themeLocal   = localStorage.getItem(THEME_KEY);
    const preservedTheme = themeSession ?? themeLocal ?? "cypherpunk";

    // 2) Clear storages EXCEPT THEME_KEY (avoid .clear() so theme survives)
    const safeClear = (store) => {
      for (let i = store.length - 1; i >= 0; i--) {
        const k = store.key(i);
        if (k !== THEME_KEY) store.removeItem(k);
      }
    };
    safeClear(localStorage);
    safeClear(sessionStorage);

    // 3) Restore theme to BOTH storages so any page can read it
    localStorage.setItem(THEME_KEY, preservedTheme);
    sessionStorage.setItem(THEME_KEY, preservedTheme);

    // 4) Delete only our app DBs
    // Delete by name right away (no await before it), so it also runs during page unload
    const deleteKnownDBs = async () => {
      try {
        indexedDB.deleteDatabase("memoroVaultVaultStorage");
        indexedDB.deleteDatabase("memoroVaultDB");
      } catch (e) {
        console.warn("Memoro Vault: DB wipe warning:", e);
      }
    };

    if (opts.fireAndForget) {
      // Don't block unload; kick off async DB cleanup
      deleteKnownDBs();
    } else {
      await deleteKnownDBs();
    }

    console.log("Memoro Vault: Local data wiped (theme preserved).");
  } catch (err) {
    console.warn("Memoro Vault wipe failed:", err);
  }
}

function showPostBuildModal() {
  const modal = document.getElementById("postBuildModal");
  document.body.style.overflow = "hidden"; // Prevent body scroll behind modal
  if (modal) {
    modal.style.display = "flex"; // Keep it centered and scrollable
  }
}

function closePostBuildModal() {
  const modal = document.getElementById("postBuildModal");
  if (modal) {
    document.body.style.overflow = "";
    modal.style.display = "none";
    preserveOnBack = true;               // ✅ prevent beforeunload from wiping again on redirect
    setTimeout(async () => {
      await nukeEverything();            // full, awaited wipe here
      window.location.href = "dashboard.html";
    }, 300);
  }
}

