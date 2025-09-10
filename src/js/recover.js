/* js/recover.js — Memoro Vault (single-file recover logic) */

/* ---------------------------
   0) WASM init (ES module)
----------------------------*/
import init, {
  sha256_hash,
  aes_gcm_encrypt,
  aes_gcm_decrypt,
  argon2_derive
} from "../wasm/memoro_crypto.js";

async function initCryptoWasm() {
  await init();
  // keep the same global surface you used inline
  window.sha256Hash       = (u8) => Promise.resolve(sha256_hash(u8));
  window.aesEncryptRust   = (k,n,p) => Promise.resolve(aes_gcm_encrypt(k,n,p));
  window.aesDecryptRust   = (k,n,c) => Promise.resolve(aes_gcm_decrypt(k,n,c));
  window.argon2DeriveRust = (pwdBytes, saltBytes, t, m, p, len) =>
    argon2_derive(pwdBytes, saltBytes, t, m, p, len);
}
initCryptoWasm().catch(console.error);

// ---------- Sensitive-data lifecycle helpers ----------
const __revokableUrls = new Set();
function trackURL(url) { __revokableUrls.add(url); return url; }
function revokeAllUrls() {
  for (const u of __revokableUrls) { URL.revokeObjectURL(u); }
  __revokableUrls.clear();
}

// Best-effort clipboard scrub (requires user gesture / permission in most browsers)
async function wipeClipboard() {
  try {
    // Replace with a single blank char—less suspicious than empty string in some UAs
    await navigator.clipboard.writeText(" ");
  } catch {}
}

// Zeroize Uint8Array or ArrayBuffer-ish
function zeroize(x) {
  try {
    if (!x) return;
    if (x instanceof Uint8Array) x.fill(0);
    else if (x.buffer && x.byteLength != null) new Uint8Array(x.buffer).fill(0);
  } catch {}
}

// Tear down globals and cached data
function forgetGlobals() {
  // keys / answers
  zeroize(window.finalRawKey);
  zeroize(window.rawFullKey);
  window.finalRawKey = null;
  window.rawFullKey = null;

  // decrypted files (blobs can’t be zeroized, but revoke URLs & drop references)
  window.recoveredFiles?.splice?.(0);
  delete window.recoveredFiles;

  // vault structures
  delete window.fileMap;
  delete window.loadedVaultZip;
  delete window.vaultData;
  delete window.vaultJson;
  delete window.baseKey;
  delete window.savedQuestions;
  delete window.selectedL2Indices;
  delete window.remainingL2Indices;
  delete window.gateIndices;

  // UI buffers
  const term = document.getElementById("powTerminal");
  if (term) term.textContent = "";
}

// One shot: revoke URLs, wipe clipboard, clear storages (except theme), wipe IDB, zeroize
async function nukeTempState() {
  try {
    revokeAllUrls();
    await wipeClipboard();
    forgetGlobals();

    // preserve theme only
    const THEME_KEY = "theme";
    const preserved =
      sessionStorage.getItem(THEME_KEY) ??
      localStorage.getItem(THEME_KEY) ?? null;

    // clear everything else
    function clearExceptTheme(store) {
      const keep = new Set([THEME_KEY]);
      for (let i = store.length - 1; i >= 0; i--) {
        const k = store.key(i);
        if (!keep.has(k)) store.removeItem(k);
      }
    }
    clearExceptTheme(localStorage);
    clearExceptTheme(sessionStorage);

    if (preserved !== null) {
      localStorage.setItem(THEME_KEY, preserved);
      sessionStorage.setItem(THEME_KEY, preserved);
    }

    // wipe known databases (broad sweep if supported)
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) if (db?.name) indexedDB.deleteDatabase(db.name);
    } else {
      indexedDB.deleteDatabase("memoroVaultVaultStorage");
      indexedDB.deleteDatabase("memoroVaultDB");
    }
  } catch {}
}

// Ensure this runs on any exit path (back, reload, close)
// pagehide fires on BFCache navigation too; beforeunload covers hard close
let __didNuke = false;
async function onLeave() {
  if (__didNuke) return;
  __didNuke = true;
  await nukeTempState();
}
window.addEventListener("pagehide", onLeave, { once: true });
window.addEventListener("beforeunload", onLeave, { once: true });

/* ---------------------------
   1) Theme & Matrix control
----------------------------*/
function applyRecoverTheme(theme) {
  const cy = document.getElementById('theme-cypherpunk');
  const cl = document.getElementById('theme-clean');
  const isCypher = (theme === 'cypherpunk');

  if (cy) cy.disabled = !isCypher;
  if (cl) cl.disabled =  isCypher;

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

  if (window.RecoverMatrix) {
    if (isCypher) RecoverMatrix.start();
    else RecoverMatrix.stop();
  }
}

// pre-flip like your inline version
(function initRecoverTheme(){
  const saved = sessionStorage.getItem('theme')
             ?? localStorage.getItem('theme')
             ?? 'cypherpunk';
  window.__savedRecoverTheme = saved;
  const cy = document.getElementById('theme-cypherpunk');
  const cl = document.getElementById('theme-clean');
  const isCypher = (saved === 'cypherpunk');
  if (cy) cy.disabled = !isCypher;
  if (cl) cl.disabled =  isCypher;
})();

/* ---------------------------
   2) Small UI helpers / globals
----------------------------*/
const $ = (id) => document.getElementById(id);
const terminal = $("powTerminal");

function showMessageModal(title, message) {
  alert(`${title}: ${message}`);
}
function showToast(text, type="info") {
  const el = $("toast");
  if (!el) return;
  el.textContent = text;
  el.className = `toast ${type}`;
  el.style.opacity = "1";
  setTimeout(() => { el.style.opacity = "0"; }, 1800);
}
async function backToDashboard() {
  await onLeave();
  window.location.href = "dashboard.html";
}
function closePreview() {
  $("previewModal").style.display = "none";
  $("previewContent").innerHTML = "";
}

async function closeSeedModal() {
  await onLeave();           // nuke secrets & storage
  window.location.href = "dashboard.html";
}

function copyDonationLink() {
  const url = "https://trocador.app/en/anonpay/?ticker_to=xmr&network_to=Mainnet&address=83czGNh6SKbhmjg3wPzeiDRQbN7gkLLqTYSvfMGRQRmKQf1SyQTG88Db67NoBdEvpCii6Qzcxq3BxNt94FDeJutmJ3xBXc6&donation=True&amount=0.1&name=Kasmaristo+Delvakto&description=Memoro+Vault+is+funded+by+donations+only.+Thanks+for+your+support!&ticker_from=xmr&network_from=Mainnet&bgcolor=";
  navigator.clipboard.writeText(url)
    .then(() => showToast("Donation link copied!", "success"))
    .catch(() => showToast("Failed to copy link.", "error"));
}
function closeRedHerringModal(){
  $("redHerringModal").style.display = "none";
}

// expose HTML-called functions
Object.assign(window, {
  backToDashboard, closePreview, closeSeedModal, copyDonationLink, closeRedHerringModal
});

/* ---------------------------
   3) Terminal / progress utilities
----------------------------*/
function printLineFast(line) {
  terminal.innerHTML += line + '<br>';
  terminal.scrollTop = terminal.scrollHeight;
}
function printLineSlow(line, delay = 30) {
  return new Promise(resolve => {
    let i = 0;
    const iv = setInterval(() => {
      terminal.innerHTML += line[i] || '';
      terminal.scrollTop = terminal.scrollHeight;
      i++;
      if (i >= line.length) {
        clearInterval(iv);
        terminal.innerHTML += '<br>';
        resolve();
      }
    }, delay);
  });
}
async function flushBatch(lines) {
  const out = lines.map(l => `<div>${l}</div>`).join('');
  terminal.insertAdjacentHTML('beforeend', out);
  const children = terminal.children;
  while (children.length > 50) terminal.removeChild(children[0]);
  terminal.scrollTop = terminal.scrollHeight;
  await new Promise(r => setTimeout(r, 0));
}

/* ---------------------------
   4) Argon2/AES helpers
----------------------------*/
async function deriveRawKeyBytes(password, saltHex, settings) {
  const enc = new TextEncoder();
  const pwdBytes = enc.encode(password);
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{1,2}/g).map(h => parseInt(h, 16)))
    : new Uint8Array(await crypto.subtle.digest("SHA-256", pwdBytes));
  const s = settings || { time: 3, mem: 16384, parallelism: 1, hashLen: 32 };
  return window.argon2DeriveRust(pwdBytes, salt, s.time, s.mem, s.parallelism, s.hashLen);
}
const encTxt = new TextEncoder();
function bufToHex(u8) {
  return Array.from(u8).map(b => b.toString(16).padStart(2,'0')).join('');
}

/* ---------------------------
   5) Hydrate from IndexedDB
   - builds window.loadedVaultZip adapter
   - exposes vaultJson (raw), vaultData (L1-decrypted)
   - renders question form
----------------------------*/
async function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("memoroVaultVaultStorage", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("vaultFiles")) {
        db.createObjectStore("vaultFiles", { keyPath: "vaultId" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(new Error("IndexedDB open failed: " + e.target.error));
  });
}
async function readTransfer(db, vaultId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("vaultFiles", "readonly");
    const store = tx.objectStore("vaultFiles");
    const getReq = store.get(vaultId + "-transfer");
    getReq.onsuccess = () => {
      const rec = getReq.result;
      resolve(rec?.data || rec); // tolerate both shapes
    };
    getReq.onerror = () => reject(new Error("Failed to read transfer payload"));
  });
}
async function hydrateFromIndexedDB() {
  const lastId = localStorage.getItem("lastVaultId");
  if (!lastId) throw new Error("No vault selected for recovery (missing lastVaultId).");

  const db = await openDB();
  const data = await readTransfer(db, lastId);
  if (!data) throw new Error("Recovery payload not found. Unlock the vault again from the dashboard.");

  // Expose basics
  window.baseKey   = data.baseKey || "";
  window.vaultJson = data.vaultJson || {};
  window.vaultData = data.decryptedVaultData || {}; // L1-decrypted contents from dashboard

  // Build a tolerant file map from the original ZIP (preferred)
  const fileMap = {};
  if (!window.zip) {
    throw new Error("zip.min.js not loaded. Include <script src=\"libs/zip.min.js\"></script>.");
  }
  if (data.vaultBlob && data.vaultBlob.byteLength) {
    const zipBlob = new Blob([data.vaultBlob], { type: "application/zip" });
    const zipReader = new zip.ZipReader(new zip.BlobReader(zipBlob));
    const entries = await zipReader.getEntries();
    // store each entry by exact name AND lowercase alias
    for (const entry of entries) {
      const blob = await entry.getData(new zip.BlobWriter());
      fileMap[entry.filename] = blob;
      fileMap[entry.filename.toLowerCase()] = blob;
    }
    await zipReader.close();
  }

  // Merge any serialized blobs we stashed (vault.json/meta/enc)
  if (data.fileMapRaw) {
    for (const [name, rec] of Object.entries(data.fileMapRaw)) {
      const u8 = Array.isArray(rec.data) ? new Uint8Array(rec.data)
            : ArrayBuffer.isView(rec.data) ? new Uint8Array(rec.data)
            : new Uint8Array(0);
      const blob = new Blob([u8], { type: rec.type || 'application/octet-stream' });
      fileMap[name] = blob;
      fileMap[name.toLowerCase()] = blob;
    }
  }

  window.fileMap = fileMap;
  window.loadedVaultZip = {
    async get(name){
      const key = String(name || "");
      const b = fileMap[key] || fileMap[key.toLowerCase()];
      if (!b) throw new Error("Missing file: " + name);
      return b;
    }
  };

  // With L1 decrypted payload already present (window.vaultData), render the questions
  const { selectedL2Indices = [], remainingL2Indices = [], gateIndices = [], questionList = [] } = window.vaultData || {};
  window.savedQuestions = questionList; // used by hint renderer
  loadQuestions(questionList, gateIndices, remainingL2Indices, selectedL2Indices);
}

/* ---------------------------
   6) Questions UI (with MCQ)
----------------------------*/
function escapeHtml(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}
function updateHint(renderIdx, originalIdx) {
  const q = window.savedQuestions?.[originalIdx];
  const hintDiv = $(`hint-${renderIdx}`);
  if (!q || !hintDiv) return;

  if (q.mcqEnabled && Array.isArray(q.mcqOptions)) {
    const custom = (q.custom || "").trim();
    hintDiv.innerHTML =
      `<div class="hint-custom-only">Multiple choice (${q.mcqOptions.length} options)` +
      (custom ? ` — Hint: ${escapeHtml(custom)}` : "") + `</div>`;
    return;
  }

  const expectedLength = q.expectedLength || 0;
  const spaceIndexes = Array.isArray(q.spaceIndexes) ? q.spaceIndexes : [];
  const hintLetters  = Array.isArray(q.hintLetters)  ? q.hintLetters  : [];
  const hintValues   = Array.isArray(q.hintValues)   ? q.hintValues   : [];

  let rendered = "", letterPos = 1, valueIndex = 0;
  for (let j=0; j<expectedLength; j++) {
    if (spaceIndexes.includes(j)) rendered += " ";
    else if (hintLetters.includes(letterPos)) {
      const val = hintValues[valueIndex++]; rendered += (val === undefined ? "_" : val);
    } else rendered += "_";
    letterPos++;
  }
  const spaced = rendered.split("").join(" ");
  hintDiv.innerHTML = `
    <div class="hint-row">
      <code class="hint-code">${spaced}</code>
      ${q.custom ? `<div class="hint-custom-text">Hint: ${escapeHtml(q.custom)}</div>` : ""}
    </div>`;
}

function loadQuestions(questionList, gateIndices, remainingL2Indices, selectedL2Indices) {
  const ordered = [...gateIndices, ...remainingL2Indices, ...selectedL2Indices];
  const form = $("recoveryForm");
  form.innerHTML = "";

  // crypto-strong shuffle for MCQ display (no bias)
  function shuffleInPlace(arr) {
    for (let i=arr.length-1; i>0; i--) {
      const r32 = new Uint32Array(1);
      crypto.getRandomValues(r32);
      const j = r32[0] % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  ordered.forEach((originalIdx, renderIdx) => {
    const q = questionList[originalIdx];

    const block = document.createElement("div");
    block.className = "question-block";

    const label = document.createElement("label");
    label.setAttribute("for", `answer-${renderIdx}`);
    label.innerHTML = `<b>${renderIdx + 1}.</b> ${q.question}`;
    block.appendChild(label);

    const input = document.createElement("input");
    input.type = "text";
    input.id   = `answer-${renderIdx}`;
    input.className = "l2-answer answer-input";
    input.setAttribute("data-index", String(originalIdx));
    input.required = true;
    input.addEventListener("input", () => {
      input.value = input.value.toLowerCase();
      const wrap = block.querySelector(".mcq-options");
      if (wrap) {
        const val = input.value.trim();
        wrap.querySelectorAll(".mcq-btn").forEach(btn => {
          btn.classList.toggle("selected", btn.textContent.toLowerCase() === val && val.length > 0);
        });
      }
    });
    block.appendChild(input);

    if (q.mcqEnabled && Array.isArray(q.mcqOptions) && q.mcqOptions.length >= 2) {
      const wrap = document.createElement("div");
      wrap.className = "mcq-options";
      const displayOpts = Array.from(new Set(q.mcqOptions.map(o => String(o ?? "").trim()).filter(Boolean)));
      shuffleInPlace(displayOpts);
      displayOpts.forEach((opt) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mcq-btn";
        btn.textContent = opt;
        btn.addEventListener("click", () => {
          input.value = String(opt).toLowerCase();
          wrap.querySelectorAll(".mcq-btn").forEach(b => b.classList.remove("selected"));
          btn.classList.add("selected");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        wrap.appendChild(btn);
      });
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "mcq-btn mcq-clear";
      clearBtn.textContent = "Clear";
      clearBtn.addEventListener("click", () => {
        input.value = "";
        wrap.querySelectorAll(".mcq-btn").forEach(b => b.classList.remove("selected"));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      wrap.appendChild(clearBtn);
      block.appendChild(wrap);
    }

    const hintDiv = document.createElement("div");
    hintDiv.className = "hint-display";
    hintDiv.id = `hint-${renderIdx}`;
    block.appendChild(hintDiv);

    form.appendChild(block);
    setTimeout(() => updateHint(renderIdx, originalIdx), 0);
  });
}

// enforce lowercase typing
document.addEventListener("input", (e) => {
  if (e.target.classList?.contains("answer-input")) {
    e.target.value = e.target.value.toLowerCase();
  }
});

/* ---------------------------
   7) Permutations + PoW
----------------------------*/
function generatePermutations(array) {
  if (array.length <= 1) return [array.slice()];
  const result = [];
  for (let i=0; i<array.length; i++) {
    const current = array[i];
    const remaining = array.slice(0,i).concat(array.slice(i+1));
    const perms = generatePermutations(remaining);
    for (const p of perms) result.push([current, ...p]);
  }
  return result;
}

// Optional “dynamic difficulty” hook; keep simple (leading 0s of sha256)
function getCurrentDifficulty(attempt) {
  const zeros = Math.min(4, 1 + Math.floor(attempt/500));
  return "0".repeat(zeros);
}
async function validateProofOfWorkWithAnswers(vaultJson, userAnswers) {
  if (!vaultJson?.powSalt || !vaultJson?.powChallengeSalt) {
    throw new Error("Vault is missing PoW salts.");
  }
  const fullConcat = userAnswers.map(a => a.trim().toLowerCase()).join("");
  const baseInput  = vaultJson.powSalt + vaultJson.powChallengeSalt + fullConcat;
  const dynamic   = getCurrentDifficulty(window.powAttempt || 1);

  let batch = [];
  let nonce = 0, solved = false;
  while (!solved) {
    const hashBytes = await window.sha256Hash(encTxt.encode(baseInput + nonce));
    const hash = bufToHex(hashBytes);
    batch.push(`Nonce ${nonce} → ${hash.slice(0,16)}...`);
    if (hash.startsWith(dynamic)) {
      solved = true;
      await flushBatch(batch);
      await printLineSlow(`Dynamic PoW success at nonce ${nonce}`);
    }
    nonce++;
    if (batch.length >= 2500) { await flushBatch(batch); batch = []; }
  }
  vaultJson.powNonce = String(nonce);
  await printLineSlow(`[✓] Dynamic PoW complete.`);
}

/* ---------------------------
   8) Decryption helpers
----------------------------*/
async function decryptVaultMeta(rawKey, metaIvU8, metaBlob) {
  const metaBuf = new Uint8Array(await metaBlob.arrayBuffer());
  const dec = await window.aesDecryptRust(rawKey, metaIvU8, metaBuf);
  const text = new TextDecoder().decode(dec);
  const metaJson = JSON.parse(text);
  if (!metaJson || !Array.isArray(metaJson.files)) {
    throw new Error("vault.meta decrypted but missing/invalid files array.");
  }
  return metaJson;
}
// final-message.txt via per-file Argon2id(fullConcat+fileId, sha256(...))
async function decryptFinalMessage(_fullKeyBytes, filesMeta, fullConcat) {
  const finalMeta = filesMeta.find(f => f.originalName === "final-message.txt");
  if (!finalMeta) { await printLineFast("[*] No final message to decrypt."); return ""; }

  const blob = window.fileMap[finalMeta.filename] || window.fileMap[finalMeta.filename.toLowerCase()];
  if (!blob) throw new Error("Missing final message file");

  const encrypted = new Uint8Array(await blob.arrayBuffer());
  if (encrypted.length < 17) return "";

  const enc = new TextEncoder();
  const fileId   = finalMeta.filename.replace(".vaultdoc", "");
  const password = fullConcat + fileId;
  const fileSalt = new Uint8Array(await window.sha256Hash(enc.encode(password)));

  const rawKey = window.argon2DeriveRust(enc.encode(password), fileSalt, 3, 16384, 1, 32);
  const iv = new Uint8Array(finalMeta.iv);

  const decU8 = await window.aesDecryptRust(rawKey, iv, encrypted);
  return new TextDecoder().decode(decU8).trim();
}
// all .vaultdoc files via per-file keys
async function decryptVaultDocs(_fullKeyRaw, vaultMetaFiles, fullConcat) {
  const recoveredFiles = [];
  const enc = new TextEncoder();

  for (const meta of vaultMetaFiles) {
    try {
      const blob = window.fileMap[meta.filename] || window.fileMap[String(meta.filename).toLowerCase()];
      if (!blob) { await printLineFast(`[!] Missing ${meta.filename}, skipping.`); continue; }

      const encrypted = new Uint8Array(await blob.arrayBuffer());
      if (encrypted.length < 17) { await printLineFast(`[!] ${meta.filename} too short, skipping.`); continue; }

      const fileId   = meta.filename.replace(".vaultdoc", "");
      const password = fullConcat + fileId;
      const fileSalt = new Uint8Array(await window.sha256Hash(enc.encode(password)));

      const rawKey = window.argon2DeriveRust(enc.encode(password), fileSalt, 3, 16384, 1, 32);
      const iv = new Uint8Array(meta.iv);
      const decU8 = await window.aesDecryptRust(rawKey, iv, encrypted);

      const outBlob = new Blob([new Uint8Array(decU8)], { type: meta.mimeType || "application/octet-stream" });

      recoveredFiles.push({
        name: meta.originalName || meta.filename,
        mime: meta.mimeType || "application/octet-stream",
        blob: outBlob
      });

      await printLineFast(`[+] Decrypted ${meta.filename}`);
    } catch (e) {
      await printLineFast(`[!] Failed to decrypt ${meta.filename}: ${e.message || e}`);
    }
  }

  return recoveredFiles;
}

/* ---------------------------
   9) Submit flow
----------------------------*/
async function submitRecovery() {
  const overlay = $("powOverlay");
  const progressBar = $("progressBar");
  const message = $("powMessage");

  try {
    overlay.style.display = "flex";
    overlay.style.opacity = "1";
    overlay.style.transition = "none";
    terminal.innerHTML = "";
    progressBar.innerHTML = "";
    message.innerText = "Trying permutations...";

    await printLineSlow("[*] Loading vault...");
    const vaultZip = window.loadedVaultZip;
    if (!vaultZip) throw new Error("No vault ZIP loaded.");

    // Raw vault.json (not L1-decrypted payload — that’s window.vaultData)
    const vaultJson = JSON.parse(await (await vaultZip.get("vault.json")).text());
    const fullSalt = vaultJson.fullSalt;
    const layer1Salt = vaultJson.layer1Salt;
    const vaultMetaIv = new Uint8Array(vaultJson.vaultMetaIv);
    const argon = vaultJson.argonSettings || { time:3, mem:16384, parallelism:1, hashLen:32 };

    // We already have window.vaultData (from dashboard L1). Pull indices/questions:
    const { selectedL2Indices = [], remainingL2Indices = [], gateIndices = [], questionList = [] } = window.vaultData || {};
    if (!questionList.length) throw new Error("No recovery questions available.");

    // Collect user inputs by original indices (from data-index)
    const userAnswerMap = {};
    document.querySelectorAll('input.answer-input').forEach(input => {
      const idx = parseInt(input.getAttribute("data-index"));
      if (!isNaN(idx)) userAnswerMap[idx] = (input.value || "").trim().toLowerCase();
    });
    if (Object.values(userAnswerMap).every(a => !a)) {
      showToast("Please fill out the recovery answers first.", "error");
      return;
    }

    // Prepare brute-force over the subset that’s permuted:
    const bruteAnswers = selectedL2Indices.map(idx => userAnswerMap[idx]);
    const permutations = generatePermutations(bruteAnswers);
    const totalAttempts = permutations.length;
    await printLineSlow(`[⛏] Brute-forcing ${totalAttempts} permutations...`);

    // Progress bar blocks
    const totalBlocks = 40;
    for (let i=0; i<totalBlocks; i++) {
      const block = document.createElement("div");
      block.className = "progress-block";
      progressBar.appendChild(block);
    }

    let attempt = 0;
    let success = false;
    let metaJson = null;
    let finalRawKey = null;
    let finalFullConcat = "";

    for (const permuted of permutations) {
      attempt++;

      // Materialize answers in original index order
      const resolved = [];
      gateIndices.forEach(idx => (resolved[idx] = userAnswerMap[idx]));
      remainingL2Indices.forEach(idx => (resolved[idx] = userAnswerMap[idx]));
      selectedL2Indices.forEach((origIdx, permIdx) => (resolved[origIdx] = permuted[permIdx]));

      // Full concat order = gates → remaining L2 → selected L2
      const fullConcat = [
        ...gateIndices.map(i => resolved[i]),
        ...remainingL2Indices.map(i => resolved[i]),
        ...selectedL2Indices.map(i => resolved[i]),
      ].join('');

      // Optional hash preview
      const hashBytes = await window.sha256Hash(encTxt.encode(fullConcat));
      const hashPreview = bufToHex(hashBytes).slice(0, 20);
      printLineFast(`[${attempt}/${totalAttempts}] trying: ${fullConcat.split('').join('|')} → hash=${hashPreview}...`);

      // progress fill
      const filled = Math.floor((attempt / totalAttempts) * totalBlocks);
      const blocks = progressBar.querySelectorAll(".progress-block");
      blocks.forEach((b, i) => b.classList.toggle("filled", i < filled));

      try {
        // L2 key (full key) → decrypt vault.meta
        const rawFullKey = await deriveRawKeyBytes(fullConcat, fullSalt, argon);
        const metaBlob = await vaultZip.get("vault.meta");
        metaJson = await decryptVaultMeta(rawFullKey, vaultMetaIv, metaBlob);

        await printLineSlow(`[✔] Vault unlocked on attempt ${attempt}.`);
        await printLineSlow(`[✔] Final Concat: ${fullConcat}`);
        await printLineSlow(`[✔] Answer Index Order: ${[
          ...gateIndices, ...remainingL2Indices, ...selectedL2Indices
        ].join(', ')}`);

        finalRawKey = rawFullKey;
        finalFullConcat = fullConcat;
        success = true;
        break;
      } catch {
        // try next permutation
      }
    }

    if (!success || !metaJson || !finalRawKey) {
      throw new Error("All permutations exhausted without success. Please review your answers and try again.");
    }

    // Optional PoW visual (kept lightweight)
    try { await validateProofOfWorkWithAnswers(vaultJson, finalFullConcat.split('')); } catch(e) {}

    // Decrypt files & final message (if present)
    const decryptedFiles = await decryptVaultDocs(finalRawKey, metaJson.files || [], finalFullConcat);

    let finalMessage = "";
    try {
      finalMessage = await decryptFinalMessage(finalRawKey, metaJson.files || [], finalFullConcat);
    } catch (e) {
      console.warn("Final message unavailable; continuing.", e);
      await printLineFast(`[!] Final message unavailable: ${e.message || e}. Continuing.`);
    }

    await showRecoveryModal(finalMessage, decryptedFiles);

  } catch (err) {
    console.error("❌ submitRecovery failed:", err);
    showMessageModal("Error", err.message || String(err));
  } finally {
    $("powOverlay").style.display = "none";
  }
}
window.submitRecovery = submitRecovery; // expose for onclick

/* ---------------------------
   10) Preview & modal UX
----------------------------*/
function blobToText(blob) {
  return blob.text();
}
async function showPreview(name, blob) {
  // Only open when the user clicks "Preview"
  const cont = $("previewContent");
  const title = $("previewTitle");
  title.textContent = `File Preview — ${name}`;
  cont.innerHTML = "";

  const type = (blob.type || "").toLowerCase();
  if (type.startsWith("text/") || /json|xml|csv|yaml|yml/.test(type) || name.endsWith(".txt")) {
    const pre = document.createElement("pre");
    pre.className = "preview-pre";
    pre.textContent = await blobToText(blob);
    cont.appendChild(pre);
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    a.textContent = "Download file";
    cont.appendChild(a);
  }
  $("previewModal").style.display = "flex";
}
async function showRecoveryModal(finalMessage, files) {
  const seedPre = $("recoveredSeed");
  const finalPre = $("finalMessage");
  seedPre.textContent = files.length
    ? `${files.length} file(s) decrypted successfully.`
    : "No files recovered.";

  // Build a clean list of file links + preview buttons (no auto-preview)
  const existing = document.getElementById("recoveryFileLinks");
  if (existing) existing.remove();

  const host = document.createElement("div");
  host.id = "recoveryFileLinks";
  host.className = "recovery-file-links";

  const title = document.createElement("h3");
  title.className = "decrypted-files-title";
  title.textContent = "Decrypted Files:";
  host.appendChild(title);

  // keep a set to avoid duplicate names
  const seen = new Set();
  function uniqueName(name) {
    let base = name, ext = "";
    const dot = name.lastIndexOf(".");
    if (dot !== -1) { base = name.slice(0, dot); ext = name.slice(dot); }
    let n = name, i = 1;
    while (seen.has(n)) n = `${base}_${i++}${ext}`;
    seen.add(n);
    return n;
  }

  for (const f of files) {
  const finalName = uniqueName(f.name || "file.bin");
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = "10px";
  row.style.margin = "8px 0";

  const link = document.createElement("a");
  link.href = trackURL(URL.createObjectURL(f.blob));   // ← fixed
  link.download = finalName;
  link.innerHTML = `📎 ${finalName}`;
  link.className = "file-link";

  const previewBtn = document.createElement("button");
  previewBtn.textContent = "Preview";
  previewBtn.className = "button";
  previewBtn.addEventListener("click", () => showPreview(finalName, f.blob));

  row.appendChild(link);
  row.appendChild(previewBtn);
  host.appendChild(row);
}

  // Buttons: Download All as ZIP / Return to Dashboard
  const btnRow = document.createElement("div");
  btnRow.className = "btn-row";
  btnRow.style.marginTop = "16px";
  btnRow.style.display = "flex";
  btnRow.style.gap = "12px";

  const zipAllBtn = document.createElement("button");
  zipAllBtn.textContent = "Download All as ZIP";
  zipAllBtn.className = "button";
  zipAllBtn.addEventListener("click", async () => {
    const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
    for (const f of files) {
      const safeName = f.name || "file.bin";
      await writer.add(safeName, new zip.BlobReader(f.blob));
    }
    const zipped = await writer.close();
    const url = URL.createObjectURL(zipped);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Memoro_Recovered_Files.zip";
    a.click();
  });

  const backBtn = document.createElement("button");
  backBtn.textContent = "Return to Dashboard";
  backBtn.className = "button";
  backBtn.addEventListener("click", backToDashboard);

  btnRow.appendChild(zipAllBtn);
  btnRow.appendChild(backBtn);
  host.appendChild(btnRow);

  // Attach to the modal’s recovered section (2nd .pow-section)
  const recoveredBox = document.querySelector("#seedModal .pow-section:nth-of-type(2)");
  recoveredBox.appendChild(host);

  $("seedModal").classList.add("show");
}

/* ---------------------------
   11) Recover matrix background
----------------------------*/
window.RecoverMatrix = {
  _interval: null, _ctx: null, _canvas: null, _drops: [], _fontSize: 14,
  _letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890@$%&'.split(''),
  _draw() {
    const ctx = this._ctx, c = this._canvas;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle = '#00ff99';
    ctx.font = `${this._fontSize}px monospace`;
    for (let i=0; i<this._drops.length; i++) {
      const t = this._letters[Math.floor(Math.random()*this._letters.length)];
      ctx.fillText(t, i*this._fontSize, this._drops[i]*this._fontSize);
      this._drops[i]++;
      if (this._drops[i]*this._fontSize > c.height && Math.random() > 0.975) this._drops[i] = 0;
    }
  },
  _resize() {
    const c = this._canvas;
    c.width = window.innerWidth; c.height = window.innerHeight;
    const cols = Math.floor(c.width / this._fontSize);
    this._drops = Array(cols).fill(0);
  },
  start() {
    if (this._interval) return;
    if (!this._canvas) {
      this._canvas = $("matrixCanvas");
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
      this._ctx.clearRect(0,0,this._canvas.width,this._canvas.height);
      this._canvas.style.display = 'none';
    }
  }
};

/* ---------------------------
   12) Bootstrap on DOM ready
----------------------------*/
(function bootstrapRecoverTheme(){
  const apply = () => applyRecoverTheme(window.__savedRecoverTheme || 'cypherpunk');
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', apply, { once: true });
  } else apply();
})();
window.addEventListener("DOMContentLoaded", () => {
  hydrateFromIndexedDB().catch(err => {
    console.error("[recover] bootstrap failed:", err);
    alert("Could not load your vault from local storage: " + (err.message || err));
  });
});

// --- secure exit (preserve theme) ---
async function secureExit() {
  try {
    const THEME_KEY = "theme";
    const preserved = sessionStorage.getItem(THEME_KEY) ?? localStorage.getItem(THEME_KEY) ?? null;

    function safeClear(store) {
      const keep = new Set([THEME_KEY]);
      for (let i = store.length - 1; i >= 0; i--) {
        const k = store.key(i);
        if (!keep.has(k)) store.removeItem(k);
      }
    }
    safeClear(localStorage);
    safeClear(sessionStorage);
    if (preserved !== null) {
      localStorage.setItem(THEME_KEY, preserved);
      sessionStorage.setItem(THEME_KEY, preserved);
    }

    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) if (db?.name) indexedDB.deleteDatabase(db.name);
    } else {
      indexedDB.deleteDatabase("memoroVaultVaultStorage");
      indexedDB.deleteDatabase("memoroVaultDB");
    }
  } catch (e) {
    console.warn("Secure exit cleanup issue:", e);
  } finally {
    window.location.href = "dashboard.html";
  }
}
