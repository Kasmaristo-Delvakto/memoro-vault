// test/e2e/large-vault.e2e.cjs: vaults bigger than one in-memory IndexedDB write (about 128 MB).
//
// The app keeps its storage in memory; anything that passes between pages through IndexedDB must
// travel in pieces, and big vault parts must stay out of the capped in-memory Blob storage. These
// flows failed before that was handled (Unlock did nothing, recovery could not unpack the vault).
//
// MV_LARGE_MB sets the file size (default 160 MB, just over the single-write limit). Building and
// checking vaults happens in child processes (legacy-cli.cjs) so the runner stays small and the
// app's own memory use is what counts.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers.cjs');
const { REPO, launchApp, goto, waitForDownload, downloadCount } = H;

const LARGE_MB = Number(process.env.MV_LARGE_MB) || 160;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-e2e-large-'));
const CLI = path.join(__dirname, '..', 'helpers', 'legacy-cli.cjs');
const LONG = 3000000;

const SPEC = {
  questions: Array.from({ length: 8 }, (_, i) => `Large vault question ${i + 1}?`),
  answers: ['harbor', 'lantern', 'violet', 'granite', 'willow', 'decoy answer', 'meadow', 'copper'],
  unlockIndexes: [0, 1],
  trapIndex: 5,
  finalMessage: 'big vault message',
  fileName: 'family-videos.bin',
};
const SPEC_FILE = path.join(WORK, 'spec.json');
fs.writeFileSync(SPEC_FILE, JSON.stringify(SPEC));
const recoverAnswers = () => Object.fromEntries(SPEC.answers.map((a, i) => [i, i === SPEC.trapIndex ? '' : a]));

function cli(...args) {
  return JSON.parse(execFileSync(process.execPath, ['--no-warnings', '--max-old-space-size=6144', CLI, ...args], { maxBuffer: 1 << 20 }).toString());
}

const RAW = path.join(WORK, 'scan-archive.bin');
let RAW_SHA;

test('a 1.0.8 vault larger than one in-memory write unlocks, recovers and re-saves', { timeout: 3600000 }, async () => {
  const zipFile = path.join(WORK, 'Old Big Vault.zip');
  RAW_SHA = cli('build', zipFile, RAW, String(LARGE_MB), SPEC_FILE).sha256;
  assert.ok(fs.statSync(zipFile).size > (LARGE_MB - 10) * 1024 * 1024);

  const ctx = await launchApp(REPO);
  let saved;
  try {
    await H.importVault(ctx, zipFile);
    await H.unlock(ctx, SPEC.answers[0], SPEC.answers[1]);
    await H.recover(ctx, recoverAnswers());
    assert.deepEqual(await ctx.page.locator('.mv-recovered-name').allInnerTexts(), [SPEC.fileName, 'final-message.txt']);

    // re-save from the editor
    await ctx.page.click('.mv-edit-vault');
    const note = path.join(WORK, 'note.txt');
    fs.writeFileSync(note, 'added after the upgrade');
    await ctx.page.setInputFiles('.mv-file-input', note);
    const before = await downloadCount(ctx);
    await ctx.page.click('.mv-save');
    await H.dialogButton(ctx, 'Save new vault');
    await ctx.page.locator('.mv-dialog-title:has-text("Vault saved")').waitFor({ timeout: LONG });
    saved = await waitForDownload(ctx, 'memoro-vault.zip', { after: before, timeout: LONG });
    await H.dialogButton(ctx, 'OK');
  } finally {
    await ctx.app.close();
  }

  // the re-saved vault, recovered with the v1.0.8 algorithm in a separate process
  const back = cli('recover', saved, SPEC_FILE);
  assert.deepEqual(back.files.map(f => f.name), [SPEC.fileName, 'note.txt', 'final-message.txt']);
  assert.equal(back.files[0].sha256, RAW_SHA);
  assert.equal(back.finalMessage, SPEC.finalMessage);
});

test('creating a vault with a large upload through the answers page works end to end', { timeout: 3600000 }, async () => {
  const ctx = await launchApp(REPO);
  let zipFile;
  try {
    await goto(ctx, 'dashboard.html');
    await ctx.page.evaluate(({ q }) => {
      localStorage.setItem('questions', JSON.stringify(q));
      localStorage.setItem('questionCount', String(q.length));
      localStorage.setItem('unlockQuestions', JSON.stringify([0, 1]));
      localStorage.setItem('selectedVaultType', 'docs-only');
    }, { q: SPEC.questions });
    await goto(ctx, 'answer-questions.html');
    await ctx.page.setInputFiles('#fileUpload', RAW);
    await ctx.page.waitForFunction(() => /1 file uploaded/.test(document.getElementById('fileUploadStatus').textContent), null, { timeout: LONG });
    for (let i = 0; i < SPEC.answers.length; i++) await ctx.page.fill(`#answer-${i}`, SPEC.answers[i]);
    await ctx.page.locator(`.trap-checkbox[data-index="${SPEC.trapIndex}"]`).check();
    await ctx.page.fill('#finalMessage', SPEC.finalMessage);

    const before = await downloadCount(ctx);
    await Promise.all([ctx.page.waitForURL(/build-vault\.html/, { timeout: 120000 }), ctx.page.click('button:has-text("Create Vault")')]);
    zipFile = await waitForDownload(ctx, 'memoro-vault.zip', { after: before, timeout: LONG });
    await ctx.page.locator('#litePickerModal').waitFor({ state: 'visible', timeout: LONG });
    await ctx.page.locator('#litePickerCancel').click();
  } finally {
    await ctx.app.close();
  }

  const back = cli('recover', zipFile, SPEC_FILE);
  assert.deepEqual(back.files.map(f => f.name), ['scan-archive.bin', 'final-message.txt']);
  assert.equal(back.files[0].sha256, RAW_SHA);
  assert.equal(back.finalMessage, SPEC.finalMessage);
  // the red herring stays out of the hidden-order group in new vaults
  assert.ok(!back.selectedL2Indices.includes(SPEC.trapIndex));
});
