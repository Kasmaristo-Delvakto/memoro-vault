/* js/vault-editor.js: edit an unlocked vault and save it again (ES module).
 *
 * Works entirely in memory on the recover page. Saving re-seals the contents with the same
 * answers through vault-core.js (fresh salts, IVs, file ids and hidden answer order), re-opens
 * the new ZIP to verify every file, and only then offers it for download.
 */
import { h, openViewer, closeViewer, fileKind, formatBytes, downloadBytes } from './file-viewer.js';

const MV = window.MemoroVaultCore;
const enc = new TextEncoder();

let uidSeq = 0;
const nextUid = () => `item-${++uidSeq}`;

const KIND_BADGE = { image: 'IMG', pdf: 'PDF', text: 'TXT', audio: 'AUD', video: 'VID', other: 'BIN' };
const LARGE_FILE = 250 * 1024 * 1024;

/** Seed file names follow the builder's rule: lowercase letters, digits and _ plus ".txt". */
export function seedFileName(input) {
  const base = String(input || '').trim().replace(/\.txt$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '_');
  return base ? `${base}.txt` : '';
}

/** File names stay plain (same rules as names read from a vault); empty input stays empty. */
export function cleanFileName(input) {
  const s = String(input || '').trim();
  return s ? MV.cleanFileName(s, '') : '';
}

function wordCount(s) {
  const t = String(s || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

// ---------------------------------------------------------------------------
// Small modal helpers (Electron has no window.prompt)
// ---------------------------------------------------------------------------
function modal({ title, body, buttons, onKey }) {
  return new Promise((resolve) => {
    const btnRow = h('div', { class: 'mv-dialog-buttons' });
    const box = h('div', { class: 'mv-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h3', { class: 'mv-dialog-title', text: title }),
      h('div', { class: 'mv-dialog-body' }, body),
      btnRow);
    const overlay = h('div', { class: 'mv-dialog-overlay' }, box);
    const done = (value) => {
      document.removeEventListener('keydown', keyHandler, true);
      overlay.remove();
      resolve(value);
    };
    for (const b of buttons) {
      btnRow.appendChild(h('button', {
        type: 'button', class: `mv-btn ${b.primary ? 'mv-btn-primary' : ''} ${b.danger ? 'mv-btn-danger' : ''}`,
        text: b.label, onclick: () => { const v = b.value(); if (v !== undefined) done(v); },
      }));
    }
    const keyHandler = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      else if (onKey) onKey(e, done);
    };
    document.addEventListener('keydown', keyHandler, true);
    document.body.appendChild(overlay);
    (box.querySelector('input,textarea') || box.querySelector('.mv-btn-primary') || box).focus();
  });
}

function confirmDialog(title, message, { okLabel = 'OK', danger = false } = {}) {
  const body = Array.isArray(message) ? message : [h('p', { text: message })];
  return modal({
    title, body,
    buttons: [
      { label: 'Cancel', value: () => false },
      { label: okLabel, primary: !danger, danger, value: () => true },
    ],
  }).then(v => v === true);
}

function infoDialog(title, message) {
  const body = Array.isArray(message) ? message : [h('p', { text: message })];
  return modal({ title, body, buttons: [{ label: 'OK', primary: true, value: () => true }] });
}

function textDialog(title, label, value, validate) {
  const input = h('input', { type: 'text', class: 'mv-input', spellcheck: 'false' });
  input.value = value || '';
  const err = h('p', { class: 'mv-error', role: 'alert' });
  const submit = () => {
    const problem = validate ? validate(input.value) : '';
    if (problem) { err.textContent = problem; return undefined; }
    return input.value;
  };
  return modal({
    title,
    body: [h('label', { class: 'mv-label' }, label, input), err],
    buttons: [{ label: 'Cancel', value: () => null }, { label: 'Save', primary: true, value: submit }],
    onKey: (e, done) => { if (e.key === 'Enter') { const v = submit(); if (v !== undefined) done(v); } },
  });
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
/**
 * @param {object} args
 * @param {object} args.session   { vaultJson, vaultEnc, unlockConcat, gateAnswers, remainingAnswers, selectedAnswers }
 * @param {object} args.contents  { uploads:[{name,mime,bytes}], seeds:[{name,content}], finalMessage }
 * @param {object} [args.meta]    decrypted vault.meta (for revision / modified)
 * @param {function} [args.onClose]  (contents) => void, called with the last saved contents
 */
export function createVaultEditor({ session, contents, meta = {}, onClose }) {
  const s = {
    session: Object.assign({}, session),
    revision: Number.isInteger(meta.revision) && meta.revision > 0 ? meta.revision : 1,
    lastSaved: meta.modified || session.vaultJson?.created || '',
    uploads: contents.uploads.map(u => ({ uid: nextUid(), name: u.name, mime: u.mime || '', bytes: u.bytes })),
    seeds: contents.seeds.map(sd => ({ uid: nextUid(), name: sd.name, content: sd.content })),
    finalMessage: contents.finalMessage || '',
    baseline: null,
    shownSeeds: new Set(),
    root: null,
    busy: false,
  };
  s.baseline = snapshot();

  function snapshot() {
    return {
      uploads: s.uploads.map(u => ({ ...u })),
      seeds: s.seeds.map(sd => ({ ...sd })),
      finalMessage: s.finalMessage,
    };
  }

  function changes() {
    const b = s.baseline;
    const out = [];
    const before = new Map(b.uploads.map(u => [u.uid, u]));
    const after = new Map(s.uploads.map(u => [u.uid, u]));
    for (const u of s.uploads) {
      const old = before.get(u.uid);
      if (!old) out.push(`Added ${u.name}`);
      else {
        if (old.name !== u.name) out.push(`Renamed ${old.name} to ${u.name}`);
        if (old.bytes !== u.bytes) out.push(`Edited ${u.name}`);
      }
    }
    for (const u of b.uploads) if (!after.has(u.uid)) out.push(`Removed ${u.name}`);

    const sBefore = new Map(b.seeds.map(x => [x.uid, x]));
    const sAfter = new Map(s.seeds.map(x => [x.uid, x]));
    for (const sd of s.seeds) {
      const old = sBefore.get(sd.uid);
      if (!old) out.push(`Added seed phrase ${sd.name}`);
      else if (old.name !== sd.name || old.content !== sd.content) out.push(`Changed seed phrase ${sd.name}`);
    }
    for (const sd of b.seeds) if (!sAfter.has(sd.uid)) out.push(`Removed seed phrase ${sd.name}`);
    if (b.finalMessage.trim() !== s.finalMessage.trim()) out.push('Changed the final message');
    return out;
  }

  const isDirty = () => changes().length > 0;

  // ---------------- rendering ----------------
  function totalBytes() {
    return s.uploads.reduce((n, u) => n + u.bytes.length, 0) +
      s.seeds.reduce((n, sd) => n + enc.encode(sd.content).length, 0) +
      enc.encode(s.finalMessage.trim()).length;
  }

  function render() {
    if (!s.root) return;
    const st = s.root.querySelector('.mv-editor-status');
    const dirty = isDirty();
    st.replaceChildren(
      h('span', { class: `mv-pill ${dirty ? 'mv-pill-warn' : 'mv-pill-ok'}`, text: dirty ? 'Unsaved changes' : 'All changes saved' }),
      h('span', { text: ` Revision ${s.revision}${s.lastSaved ? `, last saved ${new Date(s.lastSaved).toLocaleString()}` : ''}` }),
      h('span', { text: ` · ${s.uploads.length} file${s.uploads.length === 1 ? '' : 's'}, ${s.seeds.length} seed phrase${s.seeds.length === 1 ? '' : 's'} · ${formatBytes(totalBytes())}` }));

    const list = s.root.querySelector('.mv-file-list');
    list.replaceChildren(...(s.uploads.length ? s.uploads.map(fileRow) :
      [h('p', { class: 'mv-empty', text: 'No files yet. Add files with the button above or drop them here.' })]));

    const seedList = s.root.querySelector('.mv-seed-list');
    seedList.replaceChildren(...(s.seeds.length ? s.seeds.map(seedRow) :
      [h('p', { class: 'mv-empty', text: 'No seed phrases in this vault.' })]));

    const fm = s.root.querySelector('.mv-final-message');
    if (document.activeElement !== fm) fm.value = s.finalMessage;
  }

  function fileRow(u) {
    const kind = fileKind(u.name, u.mime, u.bytes);
    const base = s.baseline.uploads.find(b => b.uid === u.uid);
    const tag = !base ? 'new' : (base.bytes !== u.bytes ? 'edited' : (base.name !== u.name ? 'renamed' : ''));
    return h('div', { class: 'mv-row', 'data-uid': u.uid },
      h('span', { class: `mv-badge mv-badge-${kind}`, text: KIND_BADGE[kind] }),
      h('div', { class: 'mv-row-main' },
        h('span', { class: 'mv-row-name', text: u.name, title: u.name }),
        h('span', { class: 'mv-row-sub' }, `${formatBytes(u.bytes.length)}`, tag ? h('span', { class: 'mv-tag', text: tag }) : null)),
      h('div', { class: 'mv-row-actions' },
        h('button', { type: 'button', class: 'mv-btn mv-btn-sm', text: 'Open', onclick: () => openUpload(u) }),
        h('button', { type: 'button', class: 'mv-btn mv-btn-sm', text: 'Rename', onclick: () => renameUpload(u) }),
        h('button', { type: 'button', class: 'mv-btn mv-btn-sm', text: 'Download', onclick: () => downloadBytes(u.bytes, u.name, u.mime) }),
        h('button', { type: 'button', class: 'mv-btn mv-btn-sm mv-btn-danger', text: 'Remove', onclick: () => removeUpload(u) })));
  }

  function seedRow(sd) {
    const shown = s.shownSeeds.has(sd.uid);
    const words = wordCount(sd.content);
    return h('div', { class: 'mv-row mv-seed-row', 'data-uid': sd.uid },
      h('span', { class: 'mv-badge mv-badge-seed', text: 'KEY' }),
      h('div', { class: 'mv-row-main' },
        h('span', { class: 'mv-row-name', text: sd.name }),
        h('span', { class: `mv-row-sub ${shown ? 'mv-seed-text' : ''}`, text: shown ? sd.content : `${words} word${words === 1 ? '' : 's'} (hidden)` })),
      h('div', { class: 'mv-row-actions' },
        h('button', { type: 'button', class: 'mv-btn mv-btn-sm', text: shown ? 'Hide' : 'Show', onclick: () => { shown ? s.shownSeeds.delete(sd.uid) : s.shownSeeds.add(sd.uid); render(); } }),
        h('button', { type: 'button', class: 'mv-btn mv-btn-sm', text: 'Edit', onclick: () => editSeed(sd) }),
        h('button', { type: 'button', class: 'mv-btn mv-btn-sm mv-btn-danger', text: 'Remove', onclick: () => removeSeed(sd) })));
  }

  // ---------------- actions ----------------
  function openUpload(u) {
    const kind = fileKind(u.name, u.mime, u.bytes);
    openViewer({ name: u.name, mime: u.mime, bytes: u.bytes }, {
      onSaveBytes: kind === 'text' ? (bytes) => { u.bytes = bytes; render(); } : null,
    });
  }

  function nameTaken(name, exceptUid) {
    const n = name.toLowerCase();
    if (n === MV.FINAL_MESSAGE_NAME) return true;
    return s.uploads.some(u => u.uid !== exceptUid && u.name.toLowerCase() === n) ||
      s.seeds.some(sd => sd.name.toLowerCase() === n);
  }

  async function renameUpload(u) {
    const name = await textDialog('Rename file', 'New name', u.name, (v) => {
      const clean = cleanFileName(v);
      if (!clean) return 'Please enter a name.';
      if (nameTaken(clean, u.uid)) return 'Another item in this vault already uses that name.';
      return '';
    });
    if (name == null) return;
    u.name = cleanFileName(name);
    render();
  }

  async function removeUpload(u) {
    const ok = await confirmDialog('Remove file', [
      h('p', { text: `Remove ${u.name} from this vault?` }),
      h('p', { class: 'mv-note', text: 'Copies of the vault you saved before still contain it. Replace those copies after you save if it must be gone everywhere.' }),
    ], { okLabel: 'Remove', danger: true });
    if (!ok) return;
    s.uploads = s.uploads.filter(x => x !== u);
    render();
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const large = files.filter(f => f.size > LARGE_FILE);
    if (large.length && !await confirmDialog('Large file', `${large.map(f => f.name).join(', ')} ${large.length === 1 ? 'is' : 'are'} over ${formatBytes(LARGE_FILE)}. Saving will take a while and needs plenty of free memory. Add anyway?`, { okLabel: 'Add' })) {
      return;
    }
    for (const f of files) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        let name = cleanFileName(f.name) || 'file.bin';
        if (nameTaken(name)) name = MV.dedupeNames([{ name }], [MV.FINAL_MESSAGE_NAME, ...s.uploads.map(u => u.name), ...s.seeds.map(sd => sd.name)])[0].name;
        s.uploads.push({ uid: nextUid(), name, mime: f.type || '', bytes });
      } catch (err) {
        await infoDialog('Could not add file', `${f.name}: ${err.message || err}`);
      }
    }
    render();
  }

  async function seedDialog(existing) {
    const nameInput = h('input', { type: 'text', class: 'mv-input', spellcheck: 'false', placeholder: 'for example btc_wallet' });
    nameInput.value = existing ? existing.name.replace(/\.txt$/i, '') : '';
    const content = h('textarea', { class: 'mv-textarea', rows: '5', spellcheck: 'false', placeholder: 'seed words or key' });
    content.value = existing ? existing.content : '';
    const err = h('p', { class: 'mv-error', role: 'alert' });
    const submit = () => {
      const name = seedFileName(nameInput.value);
      const text = content.value.trim();
      if (!name) { err.textContent = 'Please enter a name.'; return undefined; }
      if (!text) { err.textContent = 'Please enter the seed phrase.'; return undefined; }
      if (s.seeds.some(sd => sd !== existing && sd.name === name) || s.uploads.some(u => u.name.toLowerCase() === name)) {
        err.textContent = 'Another item in this vault already uses that name.'; return undefined;
      }
      return { name, content: text };
    };
    return modal({
      title: existing ? 'Edit seed phrase' : 'Add seed phrase',
      body: [
        h('label', { class: 'mv-label' }, 'Name (saved as name.txt)', nameInput),
        h('label', { class: 'mv-label' }, 'Seed phrase', content),
        h('p', { class: 'mv-note', text: 'Type the phrase rather than pasting it, so it never passes through the clipboard.' }),
        err,
      ],
      buttons: [{ label: 'Cancel', value: () => null }, { label: existing ? 'Keep changes' : 'Add', primary: true, value: submit }],
    });
  }

  async function addSeed() {
    const r = await seedDialog(null);
    if (!r) return;
    s.seeds.push({ uid: nextUid(), name: r.name, content: r.content });
    render();
  }

  async function editSeed(sd) {
    const r = await seedDialog(sd);
    if (!r) return;
    sd.name = r.name;
    sd.content = r.content;
    render();
  }

  async function removeSeed(sd) {
    const ok = await confirmDialog('Remove seed phrase', `Remove ${sd.name} from this vault? Copies of the vault you saved before still contain it.`, { okLabel: 'Remove', danger: true });
    if (!ok) return;
    s.seeds = s.seeds.filter(x => x !== sd);
    s.shownSeeds.delete(sd.uid);
    render();
  }

  // ---------------- save ----------------
  function progress(label, pct) {
    let el = document.querySelector('.mv-progress');
    if (label == null) { el?.remove(); return; }
    if (!el) {
      el = h('div', { class: 'mv-progress', role: 'status', 'aria-live': 'polite' },
        h('div', { class: 'mv-progress-box' },
          h('p', { class: 'mv-progress-label' }),
          h('div', { class: 'mv-progress-track' }, h('div', { class: 'mv-progress-fill' }))));
      document.body.appendChild(el);
    }
    el.querySelector('.mv-progress-label').textContent = label;
    el.querySelector('.mv-progress-fill').style.width = `${Math.max(2, Math.min(100, pct))}%`;
  }

  /** Writes bytes through the main process; resolves to { saved, fileName } once they are on disk. */
  async function writeFile(name, bytes) {
    const api = window.memoroAPI;
    if (api && typeof api.saveFile === 'function') return api.saveFile(name, bytes);
    downloadBytes(bytes, name); // outside the desktop app the browser download cannot be confirmed
    return { saved: true, fileName: name, unconfirmed: true };
  }

  /** Keeps offering the save dialog until the file is written or the person decides not to save. */
  async function saveUntilWritten(name, bytes, what) {
    for (;;) {
      const r = await writeFile(name, bytes);
      if (r && r.saved) return r;
      const again = await modal({
        title: `${what} not saved`,
        body: [h('p', { text: r && r.error ? `The file could not be written: ${r.error}` : `The ${what.toLowerCase()} has not been saved to disk yet.` })],
        buttons: [{ label: 'Do not save', value: () => false }, { label: 'Choose a location', primary: true, value: () => true }],
      });
      if (!again) return null;
    }
  }

  async function save() {
    if (s.busy) return;
    const list = changes();
    const paperBox = h('input', { type: 'checkbox', class: 'mv-check' });
    const body = list.length
      ? [h('p', { text: 'These changes will be sealed into a new vault file:' }),
        h('ul', { class: 'mv-change-list' }, ...list.slice(0, 12).map(c => h('li', { text: c })),
          list.length > 12 ? h('li', { text: `and ${list.length - 12} more` }) : null)]
      : [h('p', { text: 'Nothing has changed. Saving now makes a fresh copy of the same contents with new salts and new encryption, which can be useful when you want to replace every stored copy.' })];
    body.push(
      h('p', { class: 'mv-note', text: 'Your questions and answers stay the same. Saving takes a few seconds per file because every file gets its own Argon2id key.' }),
      h('label', { class: 'mv-check-row' }, paperBox, ' Also make a new paper backup (QR PDF)'));
    const go = await modal({
      title: 'Save vault',
      body,
      buttons: [{ label: 'Cancel', value: () => false }, { label: 'Save new vault', primary: true, value: () => true }],
    });
    if (!go) return;

    // Freeze the editor (keyboard included) and seal exactly what is on screen now
    s.busy = true;
    if (s.root) s.root.inert = true;
    const submitted = {
      uploads: s.uploads.map(u => ({ ...u })),
      seeds: s.seeds.map(sd => ({ ...sd })),
      finalMessage: s.finalMessage,
    };
    try {
      progress('Sealing your vault...', 2);
      const now = new Date().toISOString();
      const result = await MV.resealVault({
        vaultJson: s.session.vaultJson,
        vaultEnc: s.session.vaultEnc,
        unlockConcat: s.session.unlockConcat,
        gateAnswers: s.session.gateAnswers,
        remainingAnswers: s.session.remainingAnswers,
        selectedAnswers: s.session.selectedAnswers,
        uploads: submitted.uploads.map(u => ({ name: u.name, mime: u.mime, bytes: u.bytes })),
        seeds: submitted.seeds.map(sd => ({ name: sd.name, content: sd.content })),
        finalMessage: submitted.finalMessage,
        metaExtras: { revision: s.revision + 1, modified: now },
        onProgress: (done, total, label) => progress(`Sealing: ${label}`, 5 + 80 * done / total),
      });
      progress(null);

      const written = await saveUntilWritten('memoro-vault.zip', new Uint8Array(await result.blob.arrayBuffer()), 'Vault');
      if (!written) {
        await infoDialog('Changes kept', 'The new vault was not saved, so nothing changed on disk. Your edits are still here, and you can save again whenever you are ready.');
        return;
      }

      // Only a confirmed write makes this the saved state
      result.uploads.forEach((u, i) => { submitted.uploads[i].name = u.name; });
      submitted.finalMessage = result.finalMessage;
      for (const su of submitted.uploads) {
        const live = s.uploads.find(x => x.uid === su.uid);
        if (live) live.name = su.name;
      }
      s.finalMessage = result.finalMessage;
      s.session.vaultJson = result.sealed.vaultJson;
      s.session.vaultEnc = result.sealed.vaultEnc;
      s.revision += 1;
      s.lastSaved = now;
      s.baseline = {
        uploads: submitted.uploads.map(u => ({ ...u })),
        seeds: submitted.seeds.map(sd => ({ ...sd })),
        finalMessage: submitted.finalMessage,
      };
      render();

      let paperNote = null;
      if (paperBox.checked) paperNote = await makePaperBackup(result.sealed);

      await infoDialog('Vault saved', [
        h('p', { text: `Revision ${s.revision} was sealed, re-opened and checked file by file, then saved as ${written.fileName}. It opens with the same answers as before.` }),
        paperNote ? h('p', { text: paperNote }) : null,
        h('p', { class: 'mv-note', text: 'Copies you saved earlier still open with these answers and still hold their old contents. Replace them on every drive, disc and cloud folder where you keep this vault, and print the new paper backup if you made one.' }),
      ].filter(Boolean));
    } catch (err) {
      progress(null);
      console.error('vault save failed:', err);
      await infoDialog('Save failed', `Nothing was saved. ${err.message || err}`);
    } finally {
      s.busy = false;
      if (s.root) s.root.inert = false;
    }
  }

  async function makePaperBackup(sealed) {
    const pick = await paperPicker();
    if (!pick) return 'The paper backup was skipped.';
    progress('Building the paper backup...', 20);
    try {
      const lite = await MV.sealVault({
        unlockConcat: s.session.unlockConcat,
        layer1Payload: await currentLayer1(),
        gateAnswers: s.session.gateAnswers,
        remainingAnswers: s.session.remainingAnswers,
        selectedAnswers: s.session.selectedAnswers,
        questionPrompts: s.session.vaultJson.questionPrompts,
        created: s.session.vaultJson.created,
        uploads: pick.uploads.map(u => ({ name: u.name, mime: u.mime, bytes: u.bytes })),
        seeds: pick.seeds.map(sd => ({ name: sd.name, content: sd.content })),
        finalMessage: pick.finalMessage ? s.finalMessage : '',
        metaExtras: { revision: s.revision, modified: s.lastSaved, lite: true },
        fixed: { layer1Salt: sealed.layer1Salt, fullSalt: sealed.fullSalt, permutation: sealed.permutation },
      });
      const zipBlob = await MV.packageZip(lite, { includeDocs: false });
      progress('Drawing QR codes...', 60);
      const r = await window.MemoroPaperBackup.buildPaperPdfFromLiteZip(zipBlob, {
        save: async (bytes, name) => { progress(null); return saveUntilWritten(name, bytes, 'Paper backup'); },
      });
      progress(null);
      if (!r.saved) return 'The paper backup was not saved.';
      return `The paper backup (${r.pages} page${r.pages === 1 ? '' : 's'}, ${r.tiles + 2} QR codes) was saved as ${r.fileName}.`;
    } catch (err) {
      progress(null);
      return `The paper backup could not be made: ${err.message || err}`;
    }
  }

  async function currentLayer1() {
    const l1 = await MV.decryptLayer1(s.session.unlockConcat, s.session.vaultJson, s.session.vaultEnc);
    return {
      questionList: l1.questionList,
      selectedL2Indices: l1.selectedL2Indices,
      remainingL2Indices: l1.remainingL2Indices,
      gateIndices: l1.gateIndices,
    };
  }

  function paperPicker() {
    const rows = [];
    const total = h('strong');
    const err = h('p', { class: 'mv-error', role: 'alert' });
    const add = (label, size, data) => {
      const box = h('input', { type: 'checkbox', class: 'mv-check' });
      rows.push({ box, size, data });
      return h('label', { class: 'mv-pick-row' }, box, h('span', { class: 'mv-pick-name', text: label }), h('span', { class: 'mv-pick-size', text: formatBytes(size) }));
    };
    const fmSize = enc.encode(s.finalMessage.trim()).length;
    const list = h('div', { class: 'mv-pick-list' },
      ...s.seeds.map(sd => add(sd.name, enc.encode(sd.content).length, { seed: sd })),
      fmSize ? add('Final message', fmSize, { final: true }) : null,
      ...s.uploads.map(u => add(u.name, u.bytes.length, { upload: u })));
    rows.forEach(r => { if (r.data.seed || r.data.final) r.box.checked = true; });
    const sum = () => rows.reduce((n, r) => n + (r.box.checked ? r.size : 0), 0);
    const update = () => {
      const t = sum();
      total.textContent = `${formatBytes(t)} of ${formatBytes(MV.LITE_CAP_BYTES)}`;
      err.textContent = t > MV.LITE_CAP_BYTES ? 'That is more than a paper backup can hold. Untick some items.' : '';
    };
    list.addEventListener('change', update);
    update();
    return modal({
      title: 'Paper backup contents',
      body: [h('p', { text: 'QR codes hold about 150 KB, so pick the items that matter most (seed phrases and the final message are selected for you).' }), list, h('p', {}, 'Selected: ', total), err],
      buttons: [
        { label: 'Skip', value: () => null },
        {
          label: 'Make paper backup', primary: true, value: () => {
            const t = sum();
            if (t === 0) { err.textContent = 'Select at least one item.'; return undefined; }
            if (t > MV.LITE_CAP_BYTES) { update(); return undefined; }
            const chosen = rows.filter(r => r.box.checked).map(r => r.data);
            return {
              seeds: chosen.filter(d => d.seed).map(d => d.seed),
              uploads: chosen.filter(d => d.upload).map(d => d.upload),
              finalMessage: chosen.some(d => d.final),
            };
          },
        },
      ],
    });
  }

  // ---------------- open / close ----------------
  function build() {
    const fileInput = h('input', { type: 'file', multiple: true, hidden: true, class: 'mv-file-input' });
    fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

    const finalMessage = h('textarea', { class: 'mv-textarea mv-final-message', rows: '5', spellcheck: 'false', placeholder: 'A message for whoever opens this vault (optional)' });
    finalMessage.addEventListener('input', () => { s.finalMessage = finalMessage.value; render(); });

    const drop = h('section', { class: 'mv-section mv-drop' },
      h('div', { class: 'mv-section-head' },
        h('h2', { text: 'Files' }),
        h('button', { type: 'button', class: 'mv-btn', text: '+ Add files', onclick: () => fileInput.click() })),
      h('p', { class: 'mv-hint', text: 'Open a file to view it here (images, PDFs, text, audio and video). You can also drop files onto this window.' }),
      h('div', { class: 'mv-list mv-file-list' }));

    const root = h('div', { class: 'mv-editor', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Vault editor' },
      h('div', { class: 'mv-editor-panel' },
        h('header', { class: 'mv-editor-head' },
          h('div', {},
            h('h1', { class: 'mv-editor-title', text: 'Vault Editor' }),
            h('p', { class: 'mv-editor-status' })),
          h('div', { class: 'mv-editor-actions' },
            h('button', { type: 'button', class: 'mv-btn mv-btn-primary mv-save', text: 'Save vault', onclick: save }),
            h('button', { type: 'button', class: 'mv-btn', text: 'Close editor', onclick: () => close() }))),
        h('p', { class: 'mv-hint mv-privacy', text: 'Everything you see here lives only in this window\'s memory. Nothing touches the disk until you save, and the saved file is encrypted with your answers.' }),
        drop,
        h('section', { class: 'mv-section' },
          h('div', { class: 'mv-section-head' },
            h('h2', { text: 'Seed phrases' }),
            h('button', { type: 'button', class: 'mv-btn', text: '+ Add seed phrase', onclick: addSeed })),
          h('div', { class: 'mv-list mv-seed-list' })),
        h('section', { class: 'mv-section' },
          h('div', { class: 'mv-section-head' }, h('h2', { text: 'Final message' })),
          finalMessage),
        fileInput));

    // Drag and drop (never let a dropped file navigate the window)
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    root.addEventListener('dragenter', (e) => { stop(e); drop.classList.add('mv-drop-active'); });
    root.addEventListener('dragover', (e) => { stop(e); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
    root.addEventListener('dragleave', (e) => { if (e.target === root) drop.classList.remove('mv-drop-active'); });
    root.addEventListener('drop', (e) => { stop(e); drop.classList.remove('mv-drop-active'); addFiles(e.dataTransfer?.files); });
    return root;
  }

  // Ctrl/Cmd+S saves while the editor is the top layer (no dialog or viewer above it)
  function onKey(e) {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
    e.preventDefault();
    if (!document.querySelector('.mv-dialog-overlay, .mv-viewer, .mv-progress')) save();
  }

  function open() {
    if (s.root) return;
    s.root = build();
    document.addEventListener('keydown', onKey);
    document.body.appendChild(s.root);
    document.body.classList.add('mv-editor-open');
    render();
    s.root.querySelector('.mv-save').focus();
  }

  async function close({ force = false } = {}) {
    if (!s.root) return true;
    if (!force && isDirty()) {
      const ok = await confirmDialog('Discard changes?', 'You have changes that are not saved yet. Close the editor and discard them?', { okLabel: 'Discard changes', danger: true });
      if (!ok) return false;
    }
    // back to the last saved state
    s.uploads = s.baseline.uploads.map(u => ({ ...u }));
    s.seeds = s.baseline.seeds.map(sd => ({ ...sd }));
    s.finalMessage = s.baseline.finalMessage;
    closeViewer();
    document.removeEventListener('keydown', onKey);
    s.root.remove();
    s.root = null;
    document.body.classList.remove('mv-editor-open');
    if (onClose) onClose(getContents());
    return true;
  }

  function getContents() {
    return {
      uploads: s.uploads.map(u => ({ name: u.name, mime: u.mime, bytes: u.bytes })),
      seeds: s.seeds.map(sd => ({ name: sd.name, content: sd.content })),
      finalMessage: s.finalMessage.trim(),
    };
  }

  function destroy() {
    closeViewer();
    document.removeEventListener('keydown', onKey);
    document.querySelectorAll('.mv-dialog-overlay,.mv-progress').forEach(el => el.remove());
    s.root?.remove();
    s.root = null;
    s.uploads = []; s.seeds = []; s.finalMessage = '';
    s.baseline = { uploads: [], seeds: [], finalMessage: '' };
    s.session = {};
    document.body.classList.remove('mv-editor-open');
  }

  return { open, close, isOpen: () => !!s.root, isDirty, destroy, getContents, save, addFiles };
}

export { confirmDialog };
