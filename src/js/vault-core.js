/* js/vault-core.js: Memoro Vault format + crypto core (classic script).
 *
 * One audited code path for every vault write: the builder (build-vault.js) and
 * the vault editor (vault-editor.js) both seal vaults here, so a vault saved by
 * the editor is byte-for-byte the same format as a freshly built one and opens
 * in every Memoro Vault release since v1.0.8.
 *
 * Crypto primitives come from the Rust/WASM module (window.argon2DeriveRust,
 * window.aesEncryptRust, window.aesDecryptRust, window.sha256Hash). Randomness
 * comes only from crypto.getRandomValues (never Math.random).
 *
 * Also loads under Node for the test suite (attaches to globalThis).
 */
(function (root) {
  'use strict';

  const APP_VERSION = '1.1.0';

  // Argon2id cost. Must stay identical to v1.0.8: per-file keys are derived with
  // these values hard-coded in every released recover.js.
  const ARGON = Object.freeze({ time: 3, mem: 16384, parallelism: 1, hashLen: 32 });

  const SALT_BYTES = 16;          // fullSalt / layer1Salt (32 hex chars)
  const IV_BYTES = 12;            // AES-GCM nonce
  const GCM_TAG_BYTES = 16;
  const FILE_ID_BYTES = 16;       // 32 hex chars, same shape as v1.0.8 ids
  const FINAL_MESSAGE_NAME = 'final-message.txt';
  const LITE_CAP_BYTES = 153600;  // ≈150 KiB raw cap for the QR paper backup
  const INSTRUCTIONS = 'Use recover.html to unlock this archive using your answers.';

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ---------------------------------------------------------------------------
  // Primitives
  // ---------------------------------------------------------------------------
  function prims() {
    const p = {
      argon2: root.argon2DeriveRust,
      aesEncrypt: root.aesEncryptRust,
      aesDecrypt: root.aesDecryptRust,
      sha256: root.sha256Hash,
    };
    for (const [name, fn] of Object.entries(p)) {
      if (typeof fn !== 'function') throw new Error(`Crypto engine not ready (${name}).`);
    }
    return p;
  }

  function toU8(x) {
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    if (Array.isArray(x)) return Uint8Array.from(x);
    throw new TypeError('Expected bytes.');
  }

  function bytesToHex(bytes) {
    const u8 = toU8(bytes);
    let s = '';
    for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
    return s;
  }

  function hexToBytes(hex) {
    if (typeof hex !== 'string' || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
      throw new Error('Invalid hex string.');
    }
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function zeroize(u8) {
    try { if (u8 instanceof Uint8Array) u8.fill(0); } catch (_) { /* best effort */ }
  }

  function normalizeAnswer(s) {
    return String(s ?? '').trim().toLowerCase();
  }

  // ---------------------------------------------------------------------------
  // CSPRNG helpers (crypto.getRandomValues only)
  // ---------------------------------------------------------------------------
  function rng() {
    const c = root.crypto;
    if (!c || typeof c.getRandomValues !== 'function') {
      throw new Error('Secure random number generator unavailable.');
    }
    return c;
  }

  function randomBytes(n) {
    const out = new Uint8Array(n);
    // getRandomValues fills at most 65536 bytes per call
    for (let off = 0; off < n; off += 65536) {
      rng().getRandomValues(out.subarray(off, Math.min(n, off + 65536)));
    }
    return out;
  }

  function randomHex(nBytes) {
    return bytesToHex(randomBytes(nBytes));
  }

  /** Uniform integer in [0, n) by rejection sampling, so there is no modulo bias. */
  function randomInt(n) {
    if (!Number.isInteger(n) || n <= 0 || n > 0x100000000) throw new RangeError('randomInt: bad range');
    const limit = 0x100000000 - (0x100000000 % n); // largest multiple of n that fits in 2^32
    const buf = new Uint32Array(1);
    for (;;) {
      rng().getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % n;
    }
  }

  /** Unbiased Fisher-Yates shuffle; returns a new array. */
  function shuffle(list) {
    const a = Array.from(list);
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ---------------------------------------------------------------------------
  // Key derivation + file encryption (format identical to v1.0.8)
  // ---------------------------------------------------------------------------
  async function deriveKey(password, saltHex, settings = ARGON) {
    const s = settings || ARGON;
    const out = prims().argon2(enc.encode(password), hexToBytes(saltHex), s.time, s.mem, s.parallelism, s.hashLen);
    return toU8(out);
  }

  /** Per-file key: Argon2id(permutedConcat + fileId, salt = SHA-256(permutedConcat + fileId)). */
  async function deriveFileKey(permutedConcat, fileId) {
    const p = prims();
    const pw = enc.encode(permutedConcat + fileId);
    const salt = toU8(await p.sha256(pw));
    return toU8(p.argon2(pw, salt, ARGON.time, ARGON.mem, ARGON.parallelism, ARGON.hashLen));
  }

  async function sha256Hex(bytes) {
    return bytesToHex(await prims().sha256(toU8(bytes)));
  }

  async function encryptFile(permutedConcat, bytes, originalName, mimeType) {
    const p = prims();
    const plain = toU8(bytes);
    const fileId = randomHex(FILE_ID_BYTES);
    const key = await deriveFileKey(permutedConcat, fileId);
    const iv = randomBytes(IV_BYTES);
    try {
      const ct = toU8(await p.aesEncrypt(key, iv, plain));
      return {
        meta: {
          id: fileId,
          filename: fileId + '.vaultdoc',
          originalName,
          mimeType,
          iv: Array.from(iv),
          sha256: await sha256Hex(plain),
        },
        ciphertext: ct,
      };
    } finally {
      zeroize(key);
    }
  }

  /** Decrypts one .vaultdoc and checks the SHA-256 recorded in vault.meta (when present). */
  async function decryptFile(permutedConcat, meta, ciphertext) {
    const ct = toU8(ciphertext);
    // An empty file encrypts to exactly the 16-byte GCM tag, which is valid
    if (ct.length < GCM_TAG_BYTES) throw new Error(`${meta.filename} is too short to be valid.`);
    const fileId = String(meta.filename).replace(/\.vaultdoc$/i, '');
    const key = await deriveFileKey(permutedConcat, fileId);
    try {
      const plain = toU8(await prims().aesDecrypt(key, Uint8Array.from(meta.iv), ct));
      if (meta.sha256) {
        const got = await sha256Hex(plain);
        if (got !== String(meta.sha256).toLowerCase()) {
          throw new Error(`Integrity check failed for ${meta.originalName || meta.filename} (SHA-256 mismatch).`);
        }
      }
      return plain;
    } finally {
      zeroize(key);
    }
  }

  function composeConcat(gateAnswers, remainingAnswers, permutation) {
    return [...gateAnswers, ...remainingAnswers, ...permutation].join('');
  }

  function sameMultiset(a, b) {
    if (a.length !== b.length) return false;
    const x = [...a].sort(), y = [...b].sort();
    return x.every((v, i) => v === y[i]);
  }

  // ---------------------------------------------------------------------------
  // Seal: build every encrypted part of a vault
  // ---------------------------------------------------------------------------
  /**
   * @param {object} o
   * @param {string}   o.unlockConcat      layer-1 password (the two gate answers, normalized, joined)
   * @param {object}   o.layer1Payload     { questionList, selectedL2Indices, remainingL2Indices, gateIndices }
   * @param {string[]} o.gateAnswers       normalized answers at gateIndices (full-key order)
   * @param {string[]} o.remainingAnswers  normalized answers in remainingL2Indices order
   * @param {string[]} o.selectedAnswers   normalized answers at selectedL2Indices (any order)
   * @param {string[]} o.questionPrompts   the two gate prompts shown on unlock
   * @param {{name:string,mime:string,bytes:Uint8Array}[]} [o.uploads]
   * @param {{name:string,content:string}[]} [o.seeds]
   * @param {string}   [o.finalMessage]
   * @param {string}   [o.created]         ISO timestamp for vault.json (defaults to now)
   * @param {object}   [o.metaExtras]      extra fields stored inside the encrypted vault.meta
   * @param {object}   [o.fixed]           { layer1Salt, fullSalt, permutation } to reuse (Lite companion)
   * @param {function} [o.onProgress]      (done, total, label)
   */
  async function sealVault(o) {
    const p = prims();
    const uploads = o.uploads || [];
    const seeds = o.seeds || [];
    const finalMessage = String(o.finalMessage || '').trim();
    const fixed = o.fixed || {};

    const payload = o.layer1Payload;
    if (!payload || !Array.isArray(payload.questionList) || !Array.isArray(payload.gateIndices) ||
        !Array.isArray(payload.selectedL2Indices) || !Array.isArray(payload.remainingL2Indices)) {
      throw new Error('Layer-1 payload is incomplete.');
    }
    if (!o.unlockConcat) throw new Error('Unlock answers are missing.');
    if (o.gateAnswers.length !== payload.gateIndices.length ||
        o.remainingAnswers.length !== payload.remainingL2Indices.length ||
        o.selectedAnswers.length !== payload.selectedL2Indices.length) {
      throw new Error('Answer sets do not match the vault question layout.');
    }
    if (!Array.isArray(o.questionPrompts) || o.questionPrompts.length !== 2) {
      throw new Error('Two unlock question prompts are required.');
    }

    const total = uploads.length + seeds.length + (finalMessage ? 1 : 0) + 3;
    let done = 0;
    const tick = (label) => { done++; if (o.onProgress) o.onProgress(done, total, label); };

    // ── Layer 1: question list + index layout, keyed by the two gate answers ──
    const layer1Salt = fixed.layer1Salt || randomHex(SALT_BYTES);
    const l1Key = await deriveKey(o.unlockConcat, layer1Salt, ARGON);
    const iv1 = randomBytes(IV_BYTES);
    let l1Cipher;
    try {
      l1Cipher = toU8(await p.aesEncrypt(l1Key, iv1, enc.encode(JSON.stringify({
        questionList: payload.questionList,
        selectedL2Indices: payload.selectedL2Indices,
        remainingL2Indices: payload.remainingL2Indices,
        gateIndices: payload.gateIndices,
      }))));
    } finally {
      zeroize(l1Key);
    }
    tick('Encrypted question layer');

    // ── Full key: gates → remaining L2 → hidden order of the selected L2 answers ──
    let permutation;
    if (fixed.permutation) {
      if (!sameMultiset(fixed.permutation, o.selectedAnswers)) {
        throw new Error('Fixed permutation does not match the selected answers.');
      }
      permutation = fixed.permutation.slice();
    } else {
      permutation = shuffle(o.selectedAnswers);
    }
    const permutedConcat = composeConcat(o.gateAnswers, o.remainingAnswers, permutation);
    const fullSalt = fixed.fullSalt || randomHex(SALT_BYTES);
    const fullKey = await deriveKey(permutedConcat, fullSalt, ARGON);
    const vaultHash = await sha256Hex(enc.encode(permutedConcat));
    tick('Derived vault key');

    try {
      // ── Contents: uploads, then seed files, then the final message (v1.0.8 order) ──
      const fileMeta = [];
      const files = [];
      const push = async (bytes, name, mime) => {
        const r = await encryptFile(permutedConcat, bytes, name, mime);
        fileMeta.push(r.meta);
        files.push({ filename: r.meta.filename, bytes: r.ciphertext });
        tick(`Encrypted ${name}`);
      };
      for (const u of uploads) await push(toU8(u.bytes), u.name, u.mime || '');
      for (const s of seeds) await push(enc.encode(s.content), s.name, 'text/plain');
      if (finalMessage) await push(enc.encode(finalMessage), FINAL_MESSAGE_NAME, 'text/plain');

      // ── vault.meta: file map + seed copies + vault hash, under the full key ──
      const metaObj = Object.assign(
        { files: fileMeta, seedFiles: seeds.map(s => ({ name: s.name, content: s.content })), vaultHash },
        o.metaExtras || {}
      );
      const metaIv = randomBytes(IV_BYTES);
      const metaBytes = toU8(await p.aesEncrypt(fullKey, metaIv, enc.encode(JSON.stringify(metaObj))));
      tick('Encrypted vault index');

      // Only the minimum needed to attempt recovery stays in plaintext.
      const vaultJson = {
        version: APP_VERSION,
        created: o.created || new Date().toISOString(),
        instructions: INSTRUCTIONS,
        fullSalt,
        layer1Salt,
        questionPrompts: o.questionPrompts.slice(0, 2),
        vaultMetaIv: Array.from(metaIv),
        argonSettings: { time: ARGON.time, mem: ARGON.mem, parallelism: ARGON.parallelism, type: 'Argon2id', hashLen: ARGON.hashLen },
      };

      return {
        vaultJson,
        vaultEnc: { ciphertext: Array.from(l1Cipher), iv: Array.from(iv1) },
        metaBytes,
        files,
        fileMeta,
        layer1Salt,
        fullSalt,
        permutation,
        permutedConcat,
        vaultHash,
      };
    } finally {
      zeroize(fullKey);
    }
  }

  // ---------------------------------------------------------------------------
  // ZIP packaging
  // ---------------------------------------------------------------------------
  const README_TEXT =
`Memoro Vault
===========

What you have found is an encrypted archive created with Memoro Vault.
It was likely prepared by someone who wished their most important digital
information to be preserved securely and passed down.

Inside this archive are files and messages that can only be unlocked
with the correct answers to memory-based questions. Without those answers,
decryption is mathematically impossible. There are no backdoors.

To open this vault, you will need:
1. The Memoro Vault program (provided as a desktop installer in the same folder).
2. The exact answers to the questions chosen by the person who built it.
3. The original vault file itself (this ZIP).

If you are a family member who has recently discovered these files, this vault
was designed to protect sensitive material such as letters, records,
cryptocurrency keys, or final instructions. Guard it carefully.

Redundant storage is critical: make multiple copies to M-DISC, offline drives,
and printed QR backups if available. A single corrupt copy can render it
unrecoverable.

Libereco ne estas donaco. Ĝi estas devo.
— Kaŝmaristo Delvakto`;

  const BUILDER_TEXT =
`Vault Builder Instructions
=========================

This archive was created with Memoro Vault. If you are reading this, it
means the vault was intentionally packaged for long-term preservation.

To keep it safe:
1. Place this ZIP file together with the Memoro Vault installer
   (e.g. memoro-win.exe, memoro-linux.AppImage, or memoro-mac.dmg)
   inside a clearly labeled folder (for example, "Family_Vault").
2. Copy that folder to multiple storage media:
   • One archival M-DISC
   • One offline USB/SSD in a fireproof safe
   • One cloud service of your choice
3. If a paper QR backup PDF was produced, print and store it with equal care.
   Those QR tiles can fully reconstruct this vault if digital copies are lost.

Important: Do not rename, modify, or edit any files inside this archive.
Doing so will make the vault impossible to recover.

To unlock, run the Memoro Vault recovery program and follow the on-screen
instructions. You will be prompted to enter answers in the exact order
chosen by the original builder.

Libereco ne estas donaco. Ĝi estas devo.
— Kaŝmaristo Delvakto`;

  function zipLib() {
    const z = root.zip;
    if (!z || typeof z.ZipWriter !== 'function') throw new Error('zip.min.js is not loaded.');
    return z;
  }

  /** Packs a sealed vault into a ZIP Blob (full vaults carry the two helper text files). */
  async function packageZip(sealed, { includeDocs = true } = {}) {
    const z = zipLib();
    const writer = new z.ZipWriter(new z.BlobWriter('application/zip'));
    const addJSON = (name, data) => writer.add(name, new z.TextReader(JSON.stringify(data, null, 2)));
    const addBytes = (name, u8) => writer.add(name, new z.BlobReader(new Blob([u8], { type: 'application/octet-stream' })));

    await addJSON('vault.json', sealed.vaultJson);
    await addJSON('vault.enc', sealed.vaultEnc);
    await addBytes('vault.meta', sealed.metaBytes);
    for (const f of sealed.files) await addBytes(f.filename, f.bytes);
    if (includeDocs) {
      await writer.add('README.txt', new z.TextReader(README_TEXT));
      await writer.add('Vault_Builder_Instructions.txt', new z.TextReader(BUILDER_TEXT));
    }
    return writer.close();
  }

  /** Reads a vault ZIP into { entries: Map<lowercaseName, Uint8Array>, vaultJson, vaultEnc }. */
  async function readVaultZip(blob) {
    const z = zipLib();
    const reader = new z.ZipReader(new z.BlobReader(blob));
    const entries = new Map();
    try {
      for (const e of await reader.getEntries()) {
        if (e.directory) continue;
        const data = await e.getData(new z.Uint8ArrayWriter());
        entries.set(e.filename.toLowerCase(), data);
      }
    } finally {
      await reader.close();
    }
    const need = (n) => {
      const v = entries.get(n);
      if (!v) throw new Error(`Vault ZIP is missing ${n}.`);
      return v;
    };
    const vaultJson = JSON.parse(dec.decode(need('vault.json')));
    const vaultEnc = JSON.parse(dec.decode(need('vault.enc')));
    need('vault.meta');
    return { entries, vaultJson, vaultEnc };
  }

  // ---------------------------------------------------------------------------
  // Decrypt helpers shared by verify + editor
  // ---------------------------------------------------------------------------
  async function decryptLayer1(unlockConcat, vaultJson, vaultEnc) {
    const key = await deriveKey(unlockConcat, vaultJson.layer1Salt, vaultJson.argonSettings || ARGON);
    try {
      const plain = await prims().aesDecrypt(key, Uint8Array.from(vaultEnc.iv), Uint8Array.from(vaultEnc.ciphertext));
      return JSON.parse(dec.decode(toU8(plain)));
    } finally {
      zeroize(key);
    }
  }

  async function decryptMeta(permutedConcat, vaultJson, metaBytes) {
    const key = await deriveKey(permutedConcat, vaultJson.fullSalt, vaultJson.argonSettings || ARGON);
    try {
      const plain = await prims().aesDecrypt(key, Uint8Array.from(vaultJson.vaultMetaIv), toU8(metaBytes));
      const meta = JSON.parse(dec.decode(toU8(plain)));
      if (!meta || !Array.isArray(meta.files)) throw new Error('vault.meta has no file list.');
      return meta;
    } finally {
      zeroize(key);
    }
  }

  /**
   * Re-opens a sealed ZIP from scratch and proves it is recoverable: layer 1 opens with the
   * unlock answers, vault.meta opens with the full answer string, the vault hash matches, and
   * every file decrypts with a matching SHA-256 (and matches `expected` byte-for-byte when given).
   */
  async function verifyVaultZip(blob, { unlockConcat, permutedConcat, expected, onProgress } = {}) {
    const { entries, vaultJson, vaultEnc } = await readVaultZip(blob);
    const l1 = await decryptLayer1(unlockConcat, vaultJson, vaultEnc);
    if (!Array.isArray(l1.questionList)) throw new Error('Verification: question layer is malformed.');
    const meta = await decryptMeta(permutedConcat, vaultJson, entries.get('vault.meta'));
    if (meta.vaultHash !== await sha256Hex(enc.encode(permutedConcat))) {
      throw new Error('Verification: vault hash mismatch.');
    }
    const out = [];
    let i = 0;
    for (const m of meta.files) {
      const ct = entries.get(String(m.filename).toLowerCase());
      if (!ct) throw new Error(`Verification: ${m.filename} is missing from the ZIP.`);
      const plain = await decryptFile(permutedConcat, m, ct);
      out.push({ meta: m, bytes: plain });
      if (onProgress) onProgress(++i, meta.files.length, m.originalName);
    }
    if (expected) {
      if (expected.length !== out.length) throw new Error('Verification: file count mismatch.');
      expected.forEach((e, idx) => {
        const got = out[idx];
        if (got.meta.originalName !== e.name) throw new Error(`Verification: name mismatch for ${e.name}.`);
        const want = toU8(e.bytes);
        if (want.length !== got.bytes.length || !want.every((b, k) => b === got.bytes[k])) {
          throw new Error(`Verification: contents differ for ${e.name}.`);
        }
      });
    }
    return { vaultJson, layer1: l1, meta, files: out };
  }

  // ---------------------------------------------------------------------------
  // Editing an unlocked vault
  // ---------------------------------------------------------------------------
  /** UTF-8 text when the bytes are exactly valid UTF-8 (no BOM), otherwise null. */
  function strictUtf8(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch (_) { return null; }
  }

  /**
   * Sorts decrypted vault files into the three kinds the builder writes, in the order it writes
   * them: uploads, then the named seed files listed in meta.seedFiles, then the final message
   * (last, as trimmed text in final-message.txt). Anything that does not match exactly stays an
   * upload with its original bytes, so nothing is ever re-encoded by mistake.
   * @param {object} meta  decrypted vault.meta
   * @param {{meta:object, bytes:Uint8Array}[]} decrypted  one entry per meta.files item, same order
   */
  function splitContents(meta, decrypted) {
    const claimed = new Set();

    let finalMessage = '';
    const last = decrypted.length - 1;
    if (last >= 0) {
      const m = decrypted[last].meta;
      const text = strictUtf8(decrypted[last].bytes);
      if (m.originalName === FINAL_MESSAGE_NAME && (m.mimeType || 'text/plain') === 'text/plain' &&
          text !== null && text.length > 0 && text === text.trim()) {
        finalMessage = text;
        claimed.add(last);
      }
    }

    // Seeds sit right before the final message; match name AND content, scanning from the end.
    const listed = Array.isArray(meta.seedFiles) ? meta.seedFiles.filter(sf => sf && typeof sf.name === 'string') : [];
    const seeds = [];
    for (let k = listed.length - 1; k >= 0; k--) {
      const sf = listed[k];
      let found = -1;
      for (let i = decrypted.length - 1; i >= 0; i--) {
        if (claimed.has(i) || decrypted[i].meta.originalName !== sf.name) continue;
        const text = strictUtf8(decrypted[i].bytes);
        if (text !== null && (typeof sf.content !== 'string' || text === sf.content)) { found = i; break; }
      }
      if (found >= 0) {
        claimed.add(found);
        seeds.unshift({ name: sf.name, content: strictUtf8(decrypted[found].bytes) });
      } else if (typeof sf.content === 'string') {
        seeds.unshift({ name: sf.name, content: sf.content }); // listed in the index but stored without a file
      }
    }

    const uploads = [];
    decrypted.forEach((d, i) => {
      if (claimed.has(i)) return;
      uploads.push({ name: d.meta.originalName || d.meta.filename, mime: d.meta.mimeType || '', bytes: d.bytes });
    });
    return { uploads, seeds, finalMessage };
  }

  /** Makes upload names unique and keeps them clear of the reserved final-message name. */
  function dedupeNames(items, reserved = []) {
    const seen = new Set(reserved.map(n => n.toLowerCase()));
    return items.map((it) => {
      const name = String(it.name || 'file.bin');
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      let candidate = name, n = 1;
      while (seen.has(candidate.toLowerCase())) candidate = `${base} (${n++})${ext}`;
      seen.add(candidate.toLowerCase());
      return candidate === name ? it : Object.assign({}, it, { name: candidate });
    });
  }

  /**
   * Re-seals an unlocked vault with edited contents. The answers stay the same; every salt,
   * IV, file id and the hidden answer order are new, so nothing about the old copy carries
   * over except the questions. The result is re-opened and fully verified before it is returned.
   *
   * @param {object} o
   * @param {object}   o.vaultJson, o.vaultEnc   from the vault being edited
   * @param {string}   o.unlockConcat           the two gate answers (what unlocked layer 1)
   * @param {string[]} o.gateAnswers, o.remainingAnswers, o.selectedAnswers  (see sealVault)
   * @param {object[]} o.uploads, o.seeds; {string} o.finalMessage
   * @param {object}   [o.metaExtras]; {function} [o.onProgress]
   */
  async function resealVault(o) {
    const l1 = await decryptLayer1(o.unlockConcat, o.vaultJson, o.vaultEnc); // also proves unlockConcat
    const layer1Payload = {
      questionList: l1.questionList,
      selectedL2Indices: l1.selectedL2Indices,
      remainingL2Indices: l1.remainingL2Indices,
      gateIndices: l1.gateIndices,
    };
    const finalMessage = String(o.finalMessage || '').trim();
    const seeds = (o.seeds || []).map(s => ({ name: String(s.name), content: String(s.content) }));
    const uploads = dedupeNames(o.uploads || [], [FINAL_MESSAGE_NAME, ...seeds.map(s => s.name)]);

    const sealed = await sealVault({
      unlockConcat: o.unlockConcat,
      layer1Payload,
      gateAnswers: o.gateAnswers,
      remainingAnswers: o.remainingAnswers,
      selectedAnswers: o.selectedAnswers,
      questionPrompts: o.vaultJson.questionPrompts,
      created: o.vaultJson.created,
      uploads, seeds, finalMessage,
      metaExtras: o.metaExtras,
      onProgress: o.onProgress,
    });
    const blob = await packageZip(sealed, { includeDocs: true });

    const expected = [
      ...uploads.map(u => ({ name: u.name, bytes: u.bytes })),
      ...seeds.map(s => ({ name: s.name, bytes: enc.encode(s.content) })),
      ...(finalMessage ? [{ name: FINAL_MESSAGE_NAME, bytes: enc.encode(finalMessage) }] : []),
    ];
    await verifyVaultZip(blob, { unlockConcat: o.unlockConcat, permutedConcat: sealed.permutedConcat, expected });
    return { blob, sealed, uploads, seeds, finalMessage };
  }

  root.MemoroVaultCore = Object.freeze({
    APP_VERSION, ARGON, SALT_BYTES, IV_BYTES, FINAL_MESSAGE_NAME, LITE_CAP_BYTES,
    README_TEXT, BUILDER_TEXT,
    toU8, bytesToHex, hexToBytes, zeroize, normalizeAnswer,
    randomBytes, randomHex, randomInt, shuffle,
    deriveKey, deriveFileKey, sha256Hex, encryptFile, decryptFile, composeConcat,
    sealVault, packageZip, readVaultZip, decryptLayer1, decryptMeta, verifyVaultZip,
    splitContents, dedupeNames, resealVault,
  });
})(typeof window !== 'undefined' ? window : globalThis);
