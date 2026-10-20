// test/e2e/helpers.cjs: drive the real Electron app with playwright-core.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { _electron } = require('playwright-core');

const REPO = path.resolve(__dirname, '..', '..');

/**
 * Launches Memoro Vault from `appDir` with a throwaway profile. Every download is saved into
 * `downloadsDir` as "<n>-<filename>" and recorded so tests can wait for it.
 */
async function launchApp(appDir = REPO, { theme = 'cypherpunk', acceptEula = true, savedTheme = null, profile = null } = {}) {
  profile = profile || fs.mkdtempSync(path.join(os.tmpdir(), 'mv-e2e-profile-'));
  for (const name of ['memoro-vault', 'Electron', 'Memoro Vault']) {
    fs.mkdirSync(path.join(profile, name), { recursive: true });
    if (acceptEula) fs.writeFileSync(path.join(profile, name, 'eula_accepted_v1.json'), JSON.stringify({ accepted: true }));
    if (savedTheme) fs.writeFileSync(path.join(profile, name, 'prefs.json'), JSON.stringify({ theme: savedTheme }));
  }
  const downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-e2e-dl-'));
  // An older checkout runs on the Electron it shipped with, when its node_modules are installed.
  const ownElectron = path.join(appDir, 'node_modules', 'electron');
  const app = await _electron.launch({
    executablePath: require(fs.existsSync(ownElectron) ? ownElectron : path.join(REPO, 'node_modules', 'electron')),
    args: [path.join(appDir, 'main.js')],
    cwd: appDir,
    env: { ...process.env, XDG_CONFIG_HOME: profile, ELECTRON_ENABLE_LOGGING: '0' },
  });
  await app.evaluate(({ session }, dir) => {
    globalThis.__mvDownloads = [];
    let n = 0;
    const onDownload = (_e, item) => {
      const file = `${dir}/${++n}-${item.getFilename()}`;
      item.setSavePath(file);
      const rec = { name: item.getFilename(), file, state: 'progressing' };
      globalThis.__mvDownloads.push(rec);
      item.once('done', (_ev, state) => { rec.state = state; });
    };
    // current releases use an in-memory partition; v1.0.8 used the default session
    session.defaultSession.on('will-download', onDownload);
    session.fromPartition('memoro-ephemeral').on('will-download', onDownload);
  }, downloadsDir);
  // Saves that go through the main process (vault:save-file) use dialog.showSaveDialog: answer it
  // with a path in downloadsDir, or cancel when the test sets globalThis.__mvCancelSaves.
  await app.evaluate(({ dialog }, dir) => {
    globalThis.__mvCancelSaves = 0;
    let n = 1000;
    dialog.showSaveDialog = async (win, opts) => {
      const o = opts || win || {};
      const name = String(o.defaultPath || 'file').split(/[\\/]/).pop();
      if (globalThis.__mvCancelSaves > 0) { globalThis.__mvCancelSaves--; return { canceled: true }; }
      // a numbered folder per save keeps the real file name (the app shows it to the person)
      const fsm = process.getBuiltinModule && process.getBuiltinModule('fs');
      const sub = `${dir}/save-${++n}`;
      const file = fsm ? (fsm.mkdirSync(sub, { recursive: true }), `${sub}/${name}`) : `${dir}/${n}-${name}`;
      globalThis.__mvDownloads.push({ name, file, state: 'completed' });
      return { canceled: false, filePath: file };
    };
  }, downloadsDir);

  if (!acceptEula) return { app, appDir, profile, downloadsDir };
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForLoadState('domcontentloaded');
  if (theme) await page.evaluate((t) => { localStorage.setItem('theme', t); sessionStorage.setItem('theme', t); }, theme);
  return { app, page, appDir, profile, downloadsDir, errors };
}

async function goto(ctx, rel) {
  await ctx.page.goto('file://' + path.join(ctx.appDir, 'src', rel));
  await ctx.page.waitForLoadState('domcontentloaded');
}

/** Waits until a download with this file name (counted from `after`) has finished. */
async function waitForDownload(ctx, name, { after = 0, timeout = 180000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const list = await ctx.app.evaluate(() => globalThis.__mvDownloads);
    const hit = list.slice(after).find(d => d.name === name && d.state !== 'progressing');
    if (hit) {
      if (hit.state !== 'completed') throw new Error(`download ${name} ended as ${hit.state}`);
      // files saved through the main process may still be being written
      let last = -1;
      for (;;) {
        const size = fs.existsSync(hit.file) ? fs.statSync(hit.file).size : -1;
        if (size > 0 && size === last) return hit.file;
        last = size;
        if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${hit.file} to be written`);
        await new Promise(r => setTimeout(r, 200));
      }
    }
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for download ${name}; have ${JSON.stringify(list)}`);
    await new Promise(r => setTimeout(r, 250));
  }
}
async function downloadCount(ctx) {
  return (await ctx.app.evaluate(() => globalThis.__mvDownloads)).length;
}

// ---------------------------------------------------------------------------
// Fixtures: a real PNG, a real 3-page PDF, a text file
// ---------------------------------------------------------------------------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function makePng(w = 96, h = 64, seed = 1) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (x * 255 / w) & 0xff; raw[o + 1] = (y * 255 / h) & 0xff; raw[o + 2] = (seed * 70) & 0xff;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function makePdf(pages = 3, title = 'Memoro test document') {
  const objs = [];
  const kids = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(null); // pages, filled below
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 0; i < pages; i++) {
    const stream = `BT /F1 28 Tf 72 700 Td (${title}) Tj 0 -40 Td (Page ${i + 1} of ${pages}) Tj ET\n0 0 1 rg 72 300 200 200 re f`;
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const contentNo = objs.length;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNo} 0 R >>`);
    kids.push(`${objs.length} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Reads a ZIP from disk into { name: Buffer } using the app's own zip.js. */
async function readZip(file) {
  const zip = require(path.join(REPO, 'src', 'libs', 'zip.min.js'));
  zip.configure({ useWebWorkers: false });
  const r = new zip.ZipReader(new zip.BlobReader(new Blob([fs.readFileSync(file)])));
  const out = {};
  for (const e of await r.getEntries()) out[e.filename] = Buffer.from(await e.getData(new zip.Uint8ArrayWriter()));
  await r.close();
  return out;
}

// ---------------------------------------------------------------------------
// Page flows shared by the E2E suite and the screenshot script
// ---------------------------------------------------------------------------
/** Puts answers, uploads and seed files where the builder page reads them (as answer-questions.html does). */
async function seedBuildInputs(ctx, { userData, uploads, namedSeedFiles }) {
  await goto(ctx, 'dashboard.html');
  await ctx.page.evaluate(async ({ userData, uploads, namedSeedFiles }) => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('memoroVaultDB', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('vaultFiles')) db.createObjectStore('vaultFiles', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('vaultUserData')) db.createObjectStore('vaultUserData', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['vaultFiles', 'vaultUserData'], 'readwrite');
        tx.objectStore('vaultUserData').put(userData);
        for (const u of uploads) {
          const raw = Uint8Array.from(atob(u.b64), c => c.charCodeAt(0));
          tx.objectStore('vaultFiles').put({ id: u.id, name: u.name, size: raw.length, type: u.type, raw: raw.buffer });
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    localStorage.setItem('uploadedFileMeta', JSON.stringify(uploads.map(u => ({ id: u.id, name: u.name, size: u.size, type: u.type }))));
    localStorage.setItem('namedSeedFiles', JSON.stringify(namedSeedFiles));
  }, {
    userData, namedSeedFiles,
    // base64 keeps Playwright's serializer fast (number arrays are huge on the wire)
    uploads: uploads.map(u => ({ id: u.id, name: u.name, type: u.type, size: u.bytes.length, b64: Buffer.from(u.bytes).toString('base64') })),
  });
}

/** Runs build-vault.html end to end; returns the downloaded vault ZIP (and QR PDF when paper=true). */
async function buildVault(ctx, data, { paper }) {
  await seedBuildInputs(ctx, data);
  const before = await downloadCount(ctx);
  await goto(ctx, 'build-vault.html');
  const zipFile = await waitForDownload(ctx, 'memoro-vault.zip', { after: before });
  await ctx.page.locator('#litePickerModal').waitFor({ state: 'visible', timeout: 60000 });
  let pdfFile = null;
  if (paper) {
    await ctx.page.locator('#liteSeedsList input[type=checkbox]').first().check();
    await ctx.page.locator('#litePickerConfirm').click();
    pdfFile = await waitForDownload(ctx, 'memoro-lite-QR.pdf', { after: before });
  } else {
    await ctx.page.locator('#litePickerCancel').click();
  }
  await ctx.page.locator('#postBuildModal').waitFor({ state: 'visible', timeout: 60000 });
  return { zipFile, pdfFile };
}

async function importVault(ctx, zipFile) {
  await goto(ctx, 'dashboard.html');
  await ctx.page.setInputFiles('#vaultZipInput', zipFile);
  await ctx.page.locator('#messageModal').waitFor({ state: 'visible' });
  const msg = await ctx.page.locator('#messageModalText').innerText();
  if (!/imported successfully/i.test(msg)) throw new Error(`vault import failed: ${msg}`);
  await ctx.page.locator('#messageModal button').click();
}

async function unlock(ctx, a1, a2) {
  await ctx.page.locator('.unlock-button').last().click();
  await ctx.page.fill('#answer1Input', a1);
  await ctx.page.fill('#answer2Input', a2);
  await Promise.all([
    ctx.page.waitForURL(/recover\.html/, { timeout: 60000 }),
    ctx.page.click('#unlockButton'),
  ]);
  await ctx.page.waitForLoadState('domcontentloaded');
}

/** Fills the recover form (answers keyed by original question index) and waits for the result. */
async function recover(ctx, answers) {
  const rh = ctx.page.locator('#redHerringModal');
  if (await rh.isVisible()) await rh.locator('button').click();
  await ctx.page.locator('input.answer-input').first().waitFor();
  for (const [idx, val] of Object.entries(answers)) {
    await ctx.page.fill(`input.answer-input[data-index="${idx}"]`, val);
  }
  await ctx.page.click('button:has-text("Recover Vault")');
  await ctx.page.locator('#seedModal.show').waitFor({ state: 'visible', timeout: 240000 });
}

async function downloadAll(ctx) {
  const before = await downloadCount(ctx);
  await ctx.page.click('#seedModal button:has-text("Download All as ZIP")');
  return readZip(await waitForDownload(ctx, 'Memoro_Recovered_Files.zip', { after: before }));
}

async function dialogButton(ctx, label) {
  await ctx.page.locator(`.mv-dialog-overlay .mv-dialog-buttons button:has-text("${label}")`).click();
}

/** Lists files under `dir` whose raw bytes contain any of `needles` (strings). */
function filesContaining(dir, needles) {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        let buf;
        try { buf = fs.readFileSync(p); } catch { continue; }
        for (const n of needles) {
          if (buf.includes(Buffer.from(n, 'utf8')) || buf.includes(Buffer.from(n, 'utf16le'))) hits.push(`${path.relative(dir, p)}: ${n}`);
        }
      }
    }
  };
  walk(dir);
  return hits;
}

module.exports = {
  seedBuildInputs, buildVault, importVault, unlock, recover, downloadAll, dialogButton,
  REPO, filesContaining, launchApp, goto, waitForDownload, downloadCount, makePng, makePdf, readZip };
