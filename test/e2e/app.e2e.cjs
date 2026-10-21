// test/e2e/app.e2e.cjs: full user flows in the real Electron app.
//
//   npm run test:e2e            (needs a display; on Linux CI use xvfb-run)
//   MV_LEGACY_APP=/path/to/v1.0.8/checkout npm run test:e2e
//
// With MV_LEGACY_APP set, vaults saved by the editor are also recovered in that untouched
// older release, and a vault built by that release is edited in this one.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers.cjs');
const { REPO, filesContaining, launchApp, goto, waitForDownload, downloadCount, makePng, makePdf, readZip } = H;

const LEGACY = process.env.MV_LEGACY_APP ? path.resolve(process.env.MV_LEGACY_APP) : null;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-e2e-work-'));

const QUESTIONS = [
  'What city were you born in?', 'What was the name of your first pet?', 'What color were your bedroom walls?',
  'Who was your childhood best friend?', 'What street did you grow up on?', 'What was the make of your first car?',
  'What was your high school mascot?', 'Who was your favorite teacher?', 'What was the first concert you attended?',
  'What was your childhood nickname?', 'What was your childhood dream job?', 'What was your favorite cartoon?',
  'What was your favorite childhood meal?', 'What was the first video game you played?',
];
const ANSWERS = ['Tacoma', 'Rex', 'Blue', 'Maria Lopez', 'Maple Street', 'Civic', 'Eagles', 'Ms Ortiz',
  'Weezer', 'decoyname', 'Astronaut', 'Ducktales', 'Lasagna', 'Zelda'];
const GATES = [3, 7];
const TRAP = 9;
const recoverAnswers = () => Object.fromEntries(ANSWERS.map((a, i) => [i, i === TRAP ? '' : a.toLowerCase()]));

const PNG = makePng(96, 64, 1);
const PNG2 = makePng(40, 120, 3);
const PDF = makePdf(3, 'Memoro deed');
const PDF2 = makePdf(1, 'A letter');
const NOTES = Buffer.from('Safe deposit box 114\nKey is with the lawyer.\n');
const DROP = Buffer.from('this file gets removed in the editor');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const WIN_NOTES = Buffer.concat([BOM, Buffer.from('Line one\r\nLine two\r\n')]);
const WIN_NOTES_EDITED = Buffer.concat([BOM, Buffer.from('Line one\r\nLine TWO, edited\r\n')]);
const EMPTY = Buffer.alloc(0);
const SEED1 = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
const SEED2 = 'zoo wrong zoo wrong zoo wrong zoo wrong zoo wrong zoo wrong';
const SEED_ETH = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

function writeFixture(name, bytes) { const p = path.join(WORK, name); fs.writeFileSync(p, bytes); return p; }

const userData = {
  id: 'userData',
  answers: ANSWERS,
  normalizedAnswers: ANSWERS.map(a => a.toLowerCase()),
  spaceIndexes: ANSWERS.map(a => [...a].flatMap((c, i) => (c === ' ' ? [i] : []))),
  seeds: [],
  hints: {
    // a hostile hint value: must render as text, never as markup
    2: { letters: [1], values: ['<img src=x onerror="window.__mvXss=1">'], custom: 'think paint', showLength: true, mcqEnabled: false },
    5: { letters: [], custom: '', showLength: false, mcqEnabled: true, mcqOptions: ['Civic', 'Accord', 'Corolla', 'Camry', 'Model 3', 'Focus'] },
    9: { letters: [], custom: '', showLength: true, mcqEnabled: false },
  },
  questions: QUESTIONS,
  questionCount: QUESTIONS.length,
  unlockIndexes: GATES,
  finalMessage: 'Look in the blue box under the stairs.',
  trapIndex: TRAP,
};
const uploads = [
  { id: 'u1', name: 'photo.png', type: 'image/png', bytes: PNG },
  { id: 'u2', name: 'deed.pdf', type: 'application/pdf', bytes: PDF },
  { id: 'u3', name: 'notes.txt', type: 'text/plain', bytes: NOTES },
  { id: 'u4', name: 'drop-me.txt', type: 'text/plain', bytes: DROP },
];
const namedSeedFiles = [{ name: 'btc_wallet.txt', content: SEED1 }];

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------
const DATA = () => ({ userData, uploads, namedSeedFiles });
const buildVault = (ctx, opts) => H.buildVault(ctx, DATA(), opts);
const unlock = (ctx, a1 = ANSWERS[GATES[0]], a2 = ANSWERS[GATES[1]]) => H.unlock(ctx, a1, a2);
const recover = (ctx, answers = recoverAnswers()) => H.recover(ctx, answers);
const { importVault, downloadAll, dialogButton } = H;

/** The row (file, seed or recovered item) whose name is exactly `name`. */
function row(page, name, cls = '.mv-row') {
  const exact = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const nameCls = cls === '.mv-recovered-row' ? '.mv-recovered-name' : '.mv-row-name';
  return page.locator(cls).filter({ has: page.locator(nameCls, { hasText: exact }) });
}

function assertContents(files, expected) {
  assert.deepEqual(Object.keys(files).sort(), Object.keys(expected).sort(), 'recovered file names');
  for (const [name, bytes] of Object.entries(expected)) {
    assert.ok(Buffer.from(bytes).equals(files[name]), `contents differ for ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Shared state between steps
// ---------------------------------------------------------------------------
const S = {};

test.after(async () => {
  for (const k of ['ctx', 'legacy']) { try { await S[k]?.app.close(); } catch {} }
});

test('first run: the license window gates the app and Accept opens it', { timeout: 60000 }, async () => {
  const ctx = await launchApp(REPO, { acceptEula: false });
  try {
    const lic = await ctx.app.firstWindow();
    await lic.waitForLoadState('domcontentloaded');
    assert.match(lic.url(), /license\.html$/);
    // the license window gets the same no-pop-up rule as the main window
    const popup = await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents
      .executeJavaScript("String(window.open('https://example.com'))"));
    assert.equal(popup, 'null');
    const [main] = await Promise.all([ctx.app.waitForEvent('window'), lic.click('#acceptBtn')]);
    await main.waitForLoadState('domcontentloaded');
    assert.match(main.url(), /index\.html$/);
    const versions = await ctx.app.evaluate(() => process.versions.electron);
    assert.equal(versions, require('../../node_modules/electron/package.json').version);
  } finally {
    await ctx.app.close();
  }
});

test('the saved theme is restored on launch even though storage is in memory', { timeout: 60000 }, async () => {
  const ctx = await launchApp(REPO, { theme: null, savedTheme: 'clean' });
  try {
    await goto(ctx, 'dashboard.html');
    assert.equal(await ctx.page.evaluate(() => localStorage.getItem('theme')), 'clean');
    assert.equal(await ctx.page.getAttribute('body', 'data-theme'), 'clean');
  } finally {
    await ctx.app.close();
  }
});

test('builder: seals, verifies and downloads a vault plus a QR paper backup', { timeout: 300000 }, async () => {
  S.ctx = await launchApp(REPO);
  const { zipFile, pdfFile } = await buildVault(S.ctx, { paper: true });
  S.builtZip = zipFile;
  S.builtPdf = pdfFile;
  const entries = await readZip(zipFile);
  const vj = JSON.parse(entries['vault.json']);
  assert.equal(vj.version, '1.1.0');
  assert.equal(Object.keys(entries).filter(n => n.endsWith('.vaultdoc')).length, 6);
  assert.ok(fs.statSync(pdfFile).size > 10000);
  assert.deepEqual(S.ctx.errors.filter(e => !/favicon|ERR_FILE_NOT_FOUND/.test(e)), []);
});

test('pages run under an enforced Content-Security-Policy (no eval)', async () => {
  // Playwright's own CDP evaluation is exempt from CSP, so ask Electron's main process to run
  // the check inside the page instead.
  for (const p of ['dashboard.html', 'setup-questions.html', 'answer-questions.html', 'index.html', 'how-it-works.html']) {
    await goto(S.ctx, p);
    const r = await S.ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
      "(() => { try { eval('1'); return 'eval allowed'; } catch (e) { return 'blocked'; } })()"));
    assert.equal(r, 'blocked', `${p}: ${r}`);
  }
});

test('dashboard + recover: unlock, recover, verify every file and view them in the app', { timeout: 300000 }, async () => {
  const ctx = S.ctx;
  await importVault(ctx, S.builtZip);
  await unlock(ctx);
  await recover(ctx);
  const names = await ctx.page.locator('.mv-recovered-name').allInnerTexts();
  assert.deepEqual(names, ['photo.png', 'deed.pdf', 'notes.txt', 'drop-me.txt', 'btc_wallet.txt', 'final-message.txt']);
  assert.match(await ctx.page.locator('#finalMessage').innerText(), /blue box under the stairs/);
  assert.match(await ctx.page.locator('#recoveredSeed').innerText(), /6 file\(s\) decrypted and verified/);
  // the hostile hint showed up as a plain "<" and ran nothing
  assert.equal(await ctx.page.evaluate(() => window.__mvXss), undefined);
  const hintText = await ctx.page.evaluate(() => Array.from(document.querySelectorAll('.hint-code')).map(e => e.textContent).join('|'));
  assert.ok(hintText.includes('<'), 'hint value rendered as text');
  // the donation button only ever opens the fixed page held by the main process
  await ctx.page.click('#seedModal .donation-button');
  await ctx.page.waitForTimeout(300);
  const opened = await ctx.app.evaluate(() => globalThis.__mvOpened);
  assert.equal(opened.length, 1);
  assert.match(opened[0], /^https:\/\/trocador\.app\/en\/anonpay\//);
  const term = await ctx.page.locator('#powTerminal').innerText();
  for (const a of ANSWERS) assert.ok(!term.toLowerCase().includes(a.toLowerCase()), `answer shown on screen: ${a}`);

  // image viewer
  await row(ctx.page, 'photo.png', '.mv-recovered-row').locator('button:has-text("Open")').click();
  const img = ctx.page.locator('.mv-viewer img.mv-image');
  await img.waitFor();
  await ctx.page.waitForFunction(() => document.querySelector('.mv-viewer img')?.naturalWidth === 96);
  assert.ok(await ctx.page.evaluate(() => {
    const im = document.querySelector('.mv-viewer img');
    const r = im.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === im;
  }), 'image is covered by another element');
  await ctx.page.locator('.mv-viewer button:has-text("+")').click();
  assert.match(await ctx.page.locator('.mv-viewer .mv-zoom-label').innerText(), /%/);
  await ctx.page.locator('.mv-viewer button:has-text("Close")').click();
  assert.equal(await ctx.page.locator('.mv-viewer').count(), 0);

  // PDF viewer: 3 pages, first page actually painted
  await row(ctx.page, 'deed.pdf', '.mv-recovered-row').locator('button:has-text("Open")').click();
  await ctx.page.locator('.mv-viewer .mv-pdf-canvas').first().waitFor({ timeout: 30000 });
  assert.equal(await ctx.page.locator('.mv-viewer .mv-pdf-page').count(), 3);
  const painted = await ctx.page.evaluate(() => {
    const c = document.querySelector('.mv-viewer .mv-pdf-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    // count near-black pixels only: the page's text (its blue square does not count)
    let text = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90 && d[i + 3] > 0) text++;
    return text;
  });
  assert.ok(painted > 300, `PDF text did not render (${painted} text pixels)`);
  // ...and the page is really on top, not hidden behind its own background
  const onTop = await ctx.page.evaluate(() => {
    const c = document.querySelector('.mv-viewer .mv-pdf-canvas');
    const r = c.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 200)) === c;
  });
  assert.ok(onTop, 'PDF canvas is covered by another element');
  await ctx.page.keyboard.press('Escape');
  assert.equal(await ctx.page.locator('.mv-viewer').count(), 0);

  // text viewer
  await row(ctx.page, 'notes.txt', '.mv-recovered-row').locator('button:has-text("Open")').click();
  assert.match(await ctx.page.locator('.mv-viewer pre.mv-text').innerText(), /Safe deposit box 114/);
  await ctx.page.locator('.mv-viewer button:has-text("Close")').click();
});

test('editor: add, remove, rename, edit text, seeds and message, then save (twice) with a paper backup', { timeout: 400000 }, async () => {
  const ctx = S.ctx;
  const page = ctx.page;
  await page.click('.mv-edit-vault');
  await page.locator('.mv-editor').waitFor();
  assert.match(await page.locator('.mv-editor-status').innerText(), /All changes saved/);

  // remove
  await row(page, 'drop-me.txt').locator('button:has-text("Remove")').click();
  await dialogButton(ctx, 'Remove');
  // add two files
  await page.setInputFiles('.mv-file-input', [
    writeFixture('second.png', PNG2), writeFixture('letter.pdf', PDF2),
    writeFixture('empty.txt', EMPTY), writeFixture('windows-notes.txt', WIN_NOTES),
  ]);
  await row(page, 'windows-notes.txt').waitFor();
  // a BOM + CRLF text file keeps both when edited in the viewer
  await row(page, 'windows-notes.txt').locator('button:has-text("Open")').click();
  await page.click('.mv-viewer button:has-text("Edit text")');
  await page.fill('.mv-viewer textarea.mv-text-edit', 'Line one\nLine TWO, edited\n');
  await page.click('.mv-viewer button:has-text("Keep changes")');
  await page.click('.mv-viewer button:has-text("Close")');
  // rename
  await row(page, 'photo.png').locator('button:has-text("Rename")').click();
  await page.fill('.mv-dialog input.mv-input', 'family/photo.png');
  await dialogButton(ctx, 'Save');
  await row(page, 'family_photo.png').waitFor();
  // a rename onto a reserved name is refused
  await row(page, 'second.png').locator('button:has-text("Rename")').click();
  await page.fill('.mv-dialog input.mv-input', 'final-message.txt');
  await dialogButton(ctx, 'Save');
  assert.match(await page.locator('.mv-dialog .mv-error').innerText(), /already uses that name/);
  await dialogButton(ctx, 'Cancel');
  // edit a text file inside the viewer
  await row(page, 'notes.txt').locator('button:has-text("Open")').click();
  await page.click('.mv-viewer button:has-text("Edit text")');
  await page.fill('.mv-viewer textarea.mv-text-edit', 'Safe deposit box 221\nKey is with Aunt June.\n');
  await page.click('.mv-viewer button:has-text("Keep changes")');
  await page.click('.mv-viewer button:has-text("Close")');
  // seeds
  await row(page, 'btc_wallet.txt', '.mv-seed-row').locator('button:has-text("Edit")').click();
  await page.fill('.mv-dialog textarea', SEED2);
  await dialogButton(ctx, 'Keep changes');
  await page.click('button:has-text("+ Add seed phrase")');
  await page.fill('.mv-dialog input.mv-input', 'ETH Wallet');
  await page.fill('.mv-dialog textarea', SEED_ETH);
  await dialogButton(ctx, 'Add');
  await row(page, 'eth_wallet.txt', '.mv-seed-row').waitFor();
  assert.ok(!(await row(page, 'eth_wallet.txt', '.mv-seed-row').innerText()).includes('legal winner'), 'seed hidden by default');
  // final message
  await page.fill('.mv-final-message', 'New plan: the green box in the attic.');
  assert.match(await page.locator('.mv-editor-status').innerText(), /Unsaved changes/);

  // a cancelled save dialog must leave everything unsaved
  await ctx.app.evaluate(() => { globalThis.__mvCancelSaves = 1; });
  await page.click('.mv-save');
  await dialogButton(ctx, 'Save new vault');
  await page.locator('.mv-dialog-title:has-text("Vault not saved")').waitFor({ timeout: 240000 });
  await dialogButton(ctx, 'Do not save');
  await page.locator('.mv-dialog-title:has-text("Changes kept")').waitFor();
  await dialogButton(ctx, 'OK');
  assert.match(await page.locator('.mv-editor-status').innerText(), /Unsaved changes/);
  assert.match(await page.locator('.mv-editor-status').innerText(), /Revision 1/);

  // save + paper backup
  const before = await downloadCount(ctx);
  await page.click('.mv-save');
  const summary = await page.locator('.mv-dialog .mv-change-list').innerText();
  for (const s of ['Removed drop-me.txt', 'Added second.png', 'Added letter.pdf', 'Added empty.txt', 'Added windows-notes.txt', 'Renamed photo.png to family_photo.png', 'Edited notes.txt', 'Changed seed phrase btc_wallet.txt', 'Added seed phrase eth_wallet.txt', 'Changed the final message']) {
    assert.ok(summary.includes(s), `summary is missing "${s}"`);
  }
  await page.locator('.mv-dialog .mv-check-row input').check();
  await dialogButton(ctx, 'Save new vault');
  await page.locator('.mv-dialog-title:has-text("Paper backup contents")').waitFor({ timeout: 240000 });
  await dialogButton(ctx, 'Make paper backup');
  await page.locator('.mv-dialog-title:has-text("Vault saved")').waitFor({ timeout: 240000 });
  S.editedZip = await waitForDownload(ctx, 'memoro-vault.zip', { after: before });
  S.editedPdf = await waitForDownload(ctx, 'memoro-lite-QR.pdf', { after: before });
  assert.match(await page.locator('.mv-dialog').innerText(), /Revision 2/);
  await dialogButton(ctx, 'OK');
  assert.match(await page.locator('.mv-editor-status').innerText(), /All changes saved/);

  // second save chains from the first (fresh salts again)
  await row(page, 'second.png').locator('button:has-text("Rename")').click();
  await page.fill('.mv-dialog input.mv-input', 'house.png');
  await dialogButton(ctx, 'Save');
  const before2 = await downloadCount(ctx);
  await page.keyboard.press('Control+s');
  await dialogButton(ctx, 'Save new vault');
  await page.locator('.mv-dialog-title:has-text("Vault saved")').waitFor({ timeout: 240000 });
  S.editedZip2 = await waitForDownload(ctx, 'memoro-vault.zip', { after: before2 });
  assert.match(await page.locator('.mv-dialog').innerText(), /Revision 3/);
  await dialogButton(ctx, 'OK');

  // closing returns to the recovered list, refreshed
  await page.click('.mv-editor button:has-text("Close editor")');
  const names = await page.locator('.mv-recovered-name').allInnerTexts();
  assert.deepEqual(names, ['family_photo.png', 'deed.pdf', 'notes.txt', 'house.png', 'letter.pdf', 'empty.txt', 'windows-notes.txt', 'btc_wallet.txt', 'eth_wallet.txt', 'final-message.txt']);

  const a = JSON.parse((await readZip(S.editedZip))['vault.json']);
  const b = JSON.parse((await readZip(S.editedZip2))['vault.json']);
  const o = JSON.parse((await readZip(S.builtZip))['vault.json']);
  assert.notEqual(a.fullSalt, o.fullSalt);
  assert.notEqual(b.fullSalt, a.fullSalt);
  assert.notEqual(b.layer1Salt, a.layer1Salt);
  assert.equal(b.created, o.created);
});

const EXPECTED_AFTER_EDIT = () => ({
  'family_photo.png': PNG,
  'deed.pdf': PDF,
  'notes.txt': Buffer.from('Safe deposit box 221\nKey is with Aunt June.\n'),
  'house.png': PNG2,
  'letter.pdf': PDF2,
  'empty.txt': EMPTY,
  'windows-notes.txt': WIN_NOTES_EDITED,
  'btc_wallet.txt': Buffer.from(SEED2),
  'eth_wallet.txt': Buffer.from(SEED_ETH),
  'final-message.txt': Buffer.from('New plan: the green box in the attic.'),
});

test('the twice-edited vault recovers byte-for-byte in this release', { timeout: 300000 }, async () => {
  const ctx = S.ctx;
  await importVault(ctx, S.editedZip2);
  await unlock(ctx);
  await recover(ctx);
  assertContents(await downloadAll(ctx), EXPECTED_AFTER_EDIT());
});

test('paper restore shows hostile file names as text', { timeout: 120000 }, async () => {
  const ctx = S.ctx;
  await goto(ctx, 'dashboard.html');
  await ctx.page.click('button:has-text("Restore Physical Backup")');
  const evil = writeFixture('<img src=x onerror="window.__mvXss2=1">.png', PNG);
  await ctx.page.setInputFiles('#paperFiles', evil);
  await ctx.page.waitForFunction(() => /No QR detected/.test(document.getElementById('paperStatus').textContent), null, { timeout: 60000 });
  assert.equal(await ctx.page.evaluate(() => window.__mvXss2), undefined);
  assert.equal(await ctx.page.locator('#paperStatus img').count(), 0);
  assert.match(await ctx.page.locator('#paperStatus').innerText(), /<img src=x onerror/);
  await ctx.page.click('#paperDecryptModal button:has-text("Close")');
});

test('paper backup made by the editor restores and unlocks', { timeout: 400000 }, async () => {
  const ctx = S.ctx;
  await goto(ctx, 'dashboard.html');
  await ctx.page.click('button:has-text("Restore Physical Backup")');
  const before = await downloadCount(ctx);
  await ctx.page.setInputFiles('#paperFiles', S.editedPdf);
  await waitForDownload(ctx, 'memoro-lite.zip', { after: before, timeout: 300000 });
  await ctx.page.locator('#messageModal').waitFor({ state: 'visible', timeout: 60000 });
  await ctx.page.locator('#messageModal button').click();
  await unlock(ctx);
  await recover(ctx);
  const files = await downloadAll(ctx);
  assert.deepEqual(Object.keys(files).sort(), ['btc_wallet.txt', 'eth_wallet.txt', 'final-message.txt']);
  assert.equal(files['eth_wallet.txt'].toString(), SEED_ETH);
});

test('wrong answers do not open the vault and give no hint which one was wrong', { timeout: 300000 }, async () => {
  const ctx = S.ctx;
  await importVault(ctx, S.editedZip2);
  await unlock(ctx);
  const answers = recoverAnswers();
  answers[TRAP] = 'decoyname'; // answering the red herring must fail
  const rh = ctx.page.locator('#redHerringModal');
  if (await rh.isVisible()) await rh.locator('button').click();
  for (const [idx, val] of Object.entries(answers)) await ctx.page.fill(`input.answer-input[data-index="${idx}"]`, val);
  const alerted = new Promise((resolve) => ctx.page.once('dialog', async (d) => { const m = d.message(); await d.dismiss(); resolve(m); }));
  await ctx.page.click('button:has-text("Recover Vault")');
  const alertText = await alerted;
  await ctx.page.waitForFunction(() => document.getElementById('powOverlay').style.display === 'none', null, { timeout: 60000 });
  assert.match(alertText, /exhausted/);
  assert.equal(await ctx.page.locator('#seedModal.show').count(), 0);
});

test('v1.0.8 compatibility: the old release recovers vaults built and edited by this one', { skip: !LEGACY, timeout: 600000 }, async () => {
  S.legacy = await launchApp(LEGACY);
  const ctx = S.legacy;
  const { 'empty.txt': _skippedByV108, ...editedForV108 } = EXPECTED_AFTER_EDIT(); // v1.0.8 never showed 0-byte files
  for (const [zipFile, expected] of [
    [S.editedZip2, editedForV108],
    [S.builtZip, {
      'photo.png': PNG, 'deed.pdf': PDF, 'notes.txt': NOTES, 'drop-me.txt': DROP,
      'btc_wallet.txt': Buffer.from(SEED1), 'final-message.txt': Buffer.from(userData.finalMessage),
    }],
  ]) {
    await importVault(ctx, zipFile);
    await unlock(ctx);
    await recover(ctx);
    assertContents(await downloadAll(ctx), expected);
  }
});

test('v1.0.8 compatibility: a vault built by the old release can be edited here', { skip: !LEGACY, timeout: 600000 }, async () => {
  const { zipFile } = await buildVault(S.legacy, { paper: false });
  const ctx = S.ctx;
  await importVault(ctx, zipFile);
  await unlock(ctx);
  await recover(ctx);
  await ctx.page.click('.mv-edit-vault');
  await row(ctx.page, 'notes.txt').locator('button:has-text("Remove")').click();
  await dialogButton(ctx, 'Remove');
  await ctx.page.setInputFiles('.mv-file-input', [writeFixture('added-later.pdf', PDF2)]);
  const before = await downloadCount(ctx);
  await ctx.page.click('.mv-save');
  await dialogButton(ctx, 'Save new vault');
  await ctx.page.locator('.mv-dialog-title:has-text("Vault saved")').waitFor({ timeout: 240000 });
  const edited = await waitForDownload(ctx, 'memoro-vault.zip', { after: before });
  await dialogButton(ctx, 'OK');

  await importVault(S.legacy, edited);
  await unlock(S.legacy);
  await recover(S.legacy);
  assertContents(await downloadAll(S.legacy), {
    'photo.png': PNG, 'deed.pdf': PDF, 'drop-me.txt': DROP, 'added-later.pdf': PDF2,
    'btc_wallet.txt': Buffer.from(SEED1), 'final-message.txt': Buffer.from(userData.finalMessage),
  });
});

test('no answers, seed phrases or file contents were written into the app profile on disk', { timeout: 60000 }, async () => {
  const profile = S.ctx.profile;
  await S.ctx.app.close();
  S.ctx = null;
  const needles = ['maria lopez', 'Maria Lopez', 'ms ortiz', 'abandon ability able', 'legal winner thank', 'Safe deposit box', 'blue box under the stairs', 'green box in the attic'];
  assert.deepEqual(filesContaining(profile, needles), []);
  if (S.legacy) {
    const legacyProfile = S.legacy.profile;
    await S.legacy.app.close();
    S.legacy = null;
    const leaks = filesContaining(legacyProfile, needles);
    console.log(`# v1.0.8 profile for comparison: ${leaks.length} leftover secret hit(s)${leaks.length ? ' e.g. ' + leaks.slice(0, 3).join(' | ') : ''}`);

    // Upgrading: the first launch of this release clears what the old version left behind
    if (leaks.length) {
      const upgraded = await launchApp(REPO, { profile: legacyProfile });
      await upgraded.page.waitForTimeout(1500);
      await upgraded.app.close();
      assert.deepEqual(filesContaining(legacyProfile, needles), [], 'leftovers from 1.0.8 survived the upgrade launch');
    }
  }
});
