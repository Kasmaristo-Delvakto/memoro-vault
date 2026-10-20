// test/e2e/screenshots.cjs: regenerates docs/screenshots/*.png from the real app.
//
//   npm run screenshots        (Linux: xvfb-run -a npm run screenshots)
//
// All content is sample data generated on the fly; nothing personal goes into the images.
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./helpers.cjs');
const { REPO, launchApp, goto, waitForDownload, downloadCount } = H;

const OUT = path.join(REPO, 'docs', 'screenshots');
const W = 1280, HGT = 800;

const QUESTIONS = [
  'What was the name of your childhood best friend?', 'What was the street name where you grew up?',
  'What is your oldest sibling’s middle name?', 'What was the name of your first pet?',
  'What city were you born in?', 'What is the name of your favorite childhood teacher?',
  'What was the make of your first car?', 'What is the middle name of one of your grandparents?',
  'What is the title of your favorite childhood book?', 'What was the mascot of your high school?',
  'What was your favorite vacation spot as a kid?', 'What was the name of your first boss?',
];
const ANSWERS = ['Tomasz Wiley', 'Juniper Lane', 'Everett', 'Biscuit', 'Springfield', 'Mrs Halvorsen',
  'Subaru', 'Augustine', 'Hatchet', 'Falcons', 'Grandma Ruth’s lake house', 'Ruth Ann'];
const GATES = [0, 3];
const TRAP = 8;
const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FINAL = 'If you are reading this, the plan worked. Start with the letter of instruction, then call Dana at the credit union. Love you all.';

async function shot(ctx, name) {
  await ctx.page.waitForTimeout(350);
  await ctx.page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('saved', name);
}

/** Sample files drawn inside the app: a landscape photo (canvas) and a two-page PDF (jsPDF). */
async function makeSamples(ctx) {
  await goto(ctx, 'dashboard.html');
  return ctx.page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 1000;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 620);
    sky.addColorStop(0, '#1d2b64'); sky.addColorStop(0.55, '#f8a978'); sky.addColorStop(1, '#fbd786');
    g.fillStyle = sky; g.fillRect(0, 0, 1600, 620);
    g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(1080, 470, 90, 0, Math.PI * 2); g.fill();
    const ridge = (color, base, amp, seed) => {
      g.fillStyle = color; g.beginPath(); g.moveTo(0, 620);
      for (let x = 0; x <= 1600; x += 40) g.lineTo(x, base - Math.abs(Math.sin(x / 210 + seed) * amp) - Math.abs(Math.sin(x / 77 + seed * 3) * amp * 0.35));
      g.lineTo(1600, 620); g.closePath(); g.fill();
    };
    ridge('#5b4a7a', 470, 170, 1); ridge('#3b3557', 540, 120, 2.3); ridge('#23263d', 600, 70, 4.1);
    const lake = g.createLinearGradient(0, 620, 0, 1000);
    lake.addColorStop(0, '#f6b38a'); lake.addColorStop(1, '#1d2b64');
    g.fillStyle = lake; g.fillRect(0, 620, 1600, 380);
    g.globalAlpha = 0.35; g.fillStyle = '#fff3c4';
    for (let i = 0; i < 14; i++) g.fillRect(1000 - i * 6, 650 + i * 22, 160 + i * 12, 4);
    g.globalAlpha = 1;
    const png = c.toDataURL('image/png').split(',')[1];

    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'libs/jspdf.umd.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
    const page = (title, lines) => {
      pdf.setFont('times', 'bold'); pdf.setFontSize(22); pdf.text(title, 72, 90);
      pdf.setDrawColor(40); pdf.line(72, 102, 540, 102);
      pdf.setFont('times', 'normal'); pdf.setFontSize(12);
      let y = 132;
      for (const l of lines) { if (l === '') { y += 10; continue; } pdf.text(l, 72, y, { maxWidth: 468 }); y += 20; }
    };
    page('Letter of Instruction', [
      'To my family,', '',
      'This letter explains where everything is and who to call first.',
      'Nothing here is urgent. Take a week before you make decisions.', '',
      '1. Accounts: the list of banks and brokerages is in accounts.txt.',
      '2. Bitcoin: the seed phrase in this vault controls the cold wallet.',
      '   Do not type it into a website. Use the wallet app named in the list.',
      '3. House: the deed is with the county recorder; a scan is in this vault.',
      '4. Contacts: our attorney, accountant and insurance agent are on page 2.',
    ]);
    pdf.addPage();
    page('People to Call', [
      'Attorney: Dana Whitfield, (555) 010-4477',
      'Accountant: R. Osei, (555) 010-9921',
      'Insurance: Harbor Mutual, policy ending 4410', '',
      'Thank you for taking care of this.',
    ]);
    const pdfB64 = pdf.output('datauristring').split(',')[1];
    const txt = btoa('Accounts\n========\nCredit union checking (ends 2231)\nBrokerage IRA (ends 9180)\nHardware wallet: in the safe, top shelf\n');
    return { png, pdf: pdfB64, txt };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await launchApp(REPO, { theme: 'cypherpunk' });
  await ctx.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.w, size.h), { w: W, h: HGT });
  try {
    const samples = await makeSamples(ctx);
    const png = Buffer.from(samples.png, 'base64'), pdf = Buffer.from(samples.pdf, 'base64'), txt = Buffer.from(samples.txt, 'base64');
    const workDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mv-shots-'));
    const deedScan = path.join(workDir, 'house-deed-scan.png');
    fs.writeFileSync(deedScan, H.makePng(1200, 800, 2));

    // 1) welcome + safety guidance
    await goto(ctx, 'index.html');
    if (await ctx.page.locator('#themeModal').isVisible()) await ctx.page.click('#themeModal button[data-theme="cypherpunk"]');
    await ctx.page.click('#startBtn');
    await ctx.page.locator('#safetyModal').waitFor({ state: 'visible' });
    await shot(ctx, '01-before-you-begin');

    // 2) answers + entropy meter
    await ctx.page.evaluate(({ q, gates }) => {
      localStorage.setItem('questions', JSON.stringify(q));
      localStorage.setItem('questionCount', String(q.length));
      localStorage.setItem('unlockQuestions', JSON.stringify(gates));
      localStorage.setItem('selectedVaultType', 'docs-only');
    }, { q: QUESTIONS, gates: GATES });
    await goto(ctx, 'answer-questions.html');
    for (let i = 0; i < ANSWERS.length; i++) await ctx.page.fill(`#answer-${i}`, ANSWERS[i].toLowerCase());
    await ctx.page.locator(`.trap-checkbox[data-index="${TRAP}"]`).check();
    await ctx.page.evaluate(() => window.scrollTo(0, 0));
    await shot(ctx, '02-answers-and-entropy');

    // 3) build: the paper-backup picker
    const data = {
      userData: {
        id: 'userData', answers: ANSWERS, normalizedAnswers: ANSWERS.map(a => a.toLowerCase()),
        spaceIndexes: ANSWERS.map(a => [...a].flatMap((ch, i) => (ch === ' ' ? [i] : []))), seeds: [],
        hints: { 4: { letters: [1], custom: 'a very common town name', showLength: true }, 6: { mcqEnabled: true, mcqOptions: ['Subaru', 'Toyota', 'Ford', 'Honda', 'Jeep', 'Volvo'], letters: [], custom: '', showLength: false } },
        questions: QUESTIONS, questionCount: QUESTIONS.length, unlockIndexes: GATES, finalMessage: FINAL, trapIndex: TRAP,
      },
      uploads: [
        { id: 's1', name: 'letter-of-instruction.pdf', type: 'application/pdf', bytes: pdf },
        { id: 's2', name: 'cabin-sunset.png', type: 'image/png', bytes: png },
        { id: 's3', name: 'accounts.txt', type: 'text/plain', bytes: txt },
      ],
      namedSeedFiles: [{ name: 'btc_cold_storage.txt', content: SEED }],
    };
    await H.seedBuildInputs(ctx, data);
    const before = await downloadCount(ctx);
    await goto(ctx, 'build-vault.html');
    const zipFile = await waitForDownload(ctx, 'memoro-vault.zip', { after: before });
    await ctx.page.locator('#litePickerModal').waitFor({ state: 'visible' });
    await ctx.page.locator('#liteSeedsList input[type=checkbox]').first().check();
    await shot(ctx, '03-paper-backup-picker');
    await ctx.page.click('#litePickerConfirm');
    const qrPdf = await waitForDownload(ctx, 'memoro-lite-QR.pdf', { after: before });
    await ctx.page.locator('#postBuildModal').waitFor({ state: 'visible' });

    // 4) dashboard + unlock
    const named = path.join(workDir, 'Family Vault.zip');
    fs.copyFileSync(zipFile, named);
    await H.importVault(ctx, named);
    await ctx.page.locator('.unlock-button').last().click();
    await ctx.page.fill('#answer1Input', ANSWERS[GATES[0]].toLowerCase());
    await ctx.page.fill('#answer2Input', ANSWERS[GATES[1]].toLowerCase());
    await shot(ctx, '04-unlock');
    await Promise.all([ctx.page.waitForURL(/recover\.html/), ctx.page.click('#unlockButton')]);

    // 5) recover form, then the recovered files
    await ctx.page.locator('#redHerringModal button').click();
    const answers = Object.fromEntries(ANSWERS.map((a, i) => [i, i === TRAP ? '' : a.toLowerCase()]));
    for (const [i, v] of Object.entries(answers)) await ctx.page.fill(`input.answer-input[data-index="${i}"]`, v);
    await ctx.page.evaluate(() => window.scrollTo(0, 0));
    await shot(ctx, '05-recover-questions');
    await ctx.page.click('button:has-text("Recover Vault")');
    await ctx.page.locator('#seedModal.show').waitFor({ timeout: 240000 });
    await ctx.page.evaluate(() => document.querySelector('#seedModal .pow-section:nth-of-type(2)').scrollIntoView());
    await shot(ctx, '06-recovered-files');

    // 6) viewer
    await ctx.page.locator('.mv-recovered-row', { hasText: 'cabin-sunset.png' }).locator('button:has-text("Open")').click();
    await ctx.page.waitForFunction(() => document.querySelector('.mv-viewer img')?.naturalWidth > 0);
    await shot(ctx, '07-viewer-image');
    await ctx.page.keyboard.press('Escape');
    await ctx.page.locator('.mv-recovered-row', { hasText: 'letter-of-instruction.pdf' }).locator('button:has-text("Open")').click();
    await ctx.page.locator('.mv-viewer .mv-pdf-canvas').first().waitFor();
    await shot(ctx, '08-viewer-pdf');
    await ctx.page.keyboard.press('Escape');

    // 7) editor
    await ctx.page.click('.mv-edit-vault');
    await ctx.page.locator('.mv-editor').waitFor();
    await ctx.page.setInputFiles('.mv-file-input', deedScan);
    await ctx.page.locator('.mv-row', { hasText: 'accounts.txt' }).locator('button:has-text("Rename")').click();
    await ctx.page.fill('.mv-dialog input.mv-input', 'accounts-and-contacts.txt');
    await H.dialogButton(ctx, 'Save');
    await ctx.page.fill('.mv-final-message', FINAL + ' P.S. The deed scan is in here now too.');
    await ctx.page.evaluate(() => document.activeElement?.blur());
    await shot(ctx, '09-vault-editor');
    await ctx.page.click('.mv-save');
    await ctx.page.locator('.mv-dialog .mv-check-row input').check();
    await shot(ctx, '10-save-dialog');
    await H.dialogButton(ctx, 'Save new vault');
    await ctx.page.locator('.mv-dialog-title:has-text("Paper backup contents")').waitFor({ timeout: 240000 });
    await H.dialogButton(ctx, 'Make paper backup');
    await ctx.page.locator('.mv-dialog-title:has-text("Vault saved")').waitFor({ timeout: 240000 });
    await shot(ctx, '11-vault-saved');
    await H.dialogButton(ctx, 'OK');

    // 8) clean theme
    await ctx.page.evaluate(() => {
      localStorage.setItem('theme', 'clean'); sessionStorage.setItem('theme', 'clean');
      document.getElementById('theme-cypherpunk').disabled = true;
      document.getElementById('theme-clean').disabled = false;
      document.body.setAttribute('data-theme', 'clean');
      window.RecoverMatrix?.stop();
    });
    await shot(ctx, '12-vault-editor-clean');
    await ctx.page.locator('.mv-row', { hasText: 'house-deed-scan.png' }).locator('button:has-text("Open")').click();
    await ctx.page.waitForFunction(() => document.querySelector('.mv-viewer img')?.naturalWidth > 0);
    await ctx.page.keyboard.press('Escape');

    // 9) the paper backup itself (first page rendered by pdf.js)
    await goto(ctx, 'dashboard.html');
    const pagePng = await ctx.page.evaluate(async (b64) => {
      const doc = await pdfjsLib.getDocument({ data: Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)), isEvalSupported: false }).promise;
      const pg = await doc.getPage(1);
      const vp = pg.getViewport({ scale: 1.6 });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      return c.toDataURL('image/png');
    }, fs.readFileSync(qrPdf).toString('base64'));
    fs.writeFileSync(path.join(OUT, '13-paper-backup-page.png'), Buffer.from(pagePng.split(',')[1], 'base64'));
    console.log('saved 13-paper-backup-page');
  } finally {
    await ctx.app.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
