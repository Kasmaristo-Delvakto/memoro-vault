// test/vault-format.test.cjs: format, compatibility, entropy and tamper tests for vault-core.js.
// Run with: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/env.cjs');
const { legacyBuild, legacyRecover } = require('./helpers/legacy-v108.cjs');

const enc = new TextEncoder();
const dec = new TextDecoder();

// 14 questions => 2 gates + 12 layer-2 (6 permuted). Question 9 is the red herring.
const QUESTIONS = Array.from({ length: 14 }, (_, i) => `Question number ${i + 1}?`);
const ANSWERS = ['Maple Street', 'rex', 'blue', 'Ms. Ortiz', 'tacoma', 'civic', 'el paso', 'ruth', 'decoy', 'pluto', 'zelda', 'ducktales', 'pizza', 'astronaut'];
const TRAP = 8;
const UNLOCK = [0, 1];

function recoverAnswers(answers = ANSWERS, trap = TRAP) {
  const m = {};
  answers.forEach((a, i) => { m[i] = i === trap ? '' : a; });
  return m;
}
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
async function zipEntries(blob) {
  const zip = globalThis.zip;
  const r = new zip.ZipReader(new zip.BlobReader(blob));
  const out = {};
  for (const e of await r.getEntries()) out[e.filename] = await e.getData(new zip.Uint8ArrayWriter());
  await r.close();
  return out;
}
async function rezip(entries) {
  const zip = globalThis.zip;
  const w = new zip.ZipWriter(new zip.BlobWriter('application/zip'));
  for (const [name, bytes] of Object.entries(entries)) await w.add(name, new zip.Uint8ArrayReader(bytes));
  return w.close();
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 250, 251, 252]);
const PDF = enc.encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

let MV;
test.before(async () => { ({ MV } = await load()); });

// ---------------------------------------------------------------------------
// Entropy: CSPRNG helpers
// ---------------------------------------------------------------------------
test('randomInt is uniform (chi-square) and never uses Math.random', () => {
  const orig = Math.random;
  Math.random = () => { throw new Error('Math.random used'); };
  try {
    for (const n of [6, 7, 720]) {
      const N = n * 400;
      const counts = new Array(n).fill(0);
      for (let i = 0; i < N; i++) counts[MV.randomInt(n)]++;
      const e = N / n;
      const chi = counts.reduce((s, c) => s + (c - e) ** 2 / e, 0);
      // df = n-1; mean = n-1, sd = sqrt(2(n-1)); 6 sd above mean is astronomically unlikely
      assert.ok(chi < (n - 1) + 6 * Math.sqrt(2 * (n - 1)), `chi-square too high for n=${n}: ${chi}`);
    }
  } finally {
    Math.random = orig;
  }
});

test('randomInt rejects bad ranges and handles n=1 and n=2^32', () => {
  assert.equal(MV.randomInt(1), 0);
  const v = MV.randomInt(0x100000000);
  assert.ok(v >= 0 && v < 0x100000000);
  for (const bad of [0, -1, 1.5, NaN, 0x100000001]) assert.throws(() => MV.randomInt(bad));
});

test('shuffle produces every permutation of 4 items about equally often', () => {
  const counts = new Map();
  const N = 24 * 500;
  for (let i = 0; i < N; i++) {
    const k = MV.shuffle(['a', 'b', 'c', 'd']).join('');
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  assert.equal(counts.size, 24);
  const e = N / 24;
  const chi = [...counts.values()].reduce((s, c) => s + (c - e) ** 2 / e, 0);
  assert.ok(chi < 23 + 6 * Math.sqrt(46), `shuffle chi-square too high: ${chi}`);
});

test('randomBytes fills large buffers and salts never repeat', () => {
  const big = MV.randomBytes(200000);
  assert.equal(big.length, 200000);
  assert.ok(big.slice(150000).some(b => b !== 0), 'tail beyond 64 KiB must be random too');
  const salts = new Set(Array.from({ length: 2000 }, () => MV.randomHex(16)));
  assert.equal(salts.size, 2000);
  assert.match(MV.randomHex(16), /^[0-9a-f]{32}$/);
});

test('sealVault draws all randomness from crypto.getRandomValues', async () => {
  const orig = Math.random;
  Math.random = () => { throw new Error('Math.random used during sealing'); };
  try {
    const s = await MV.sealVault(basicSealArgs());
    assert.ok(s.fullSalt && s.layer1Salt);
  } finally {
    Math.random = orig;
  }
});

function layoutFor(answers, trap = TRAP) {
  const normalized = answers.map((a, i) => (i === trap ? '' : MV.normalizeAnswer(a)));
  const l2 = MV.shuffle(answers.map((_, i) => i).filter(i => !UNLOCK.includes(i)));
  const selected = l2.slice(0, 6), remaining = l2.slice(6);
  return {
    normalized, selected, remaining,
    payload: {
      questionList: answers.map((a, i) => ({ question: QUESTIONS[i], expectedLength: a.length, hintLetters: [], hintValues: [], spaceIndexes: [], custom: '', showLength: true, mcqEnabled: false, mcqOptions: null })),
      selectedL2Indices: selected, remainingL2Indices: remaining, gateIndices: UNLOCK.slice(),
    },
  };
}
function basicSealArgs(extra = {}) {
  const L = layoutFor(ANSWERS);
  return Object.assign({
    unlockConcat: MV.normalizeAnswer(ANSWERS[0]) + MV.normalizeAnswer(ANSWERS[1]),
    layer1Payload: L.payload,
    gateAnswers: UNLOCK.map(i => L.normalized[i]),
    remainingAnswers: L.remaining.map(i => L.normalized[i]),
    selectedAnswers: L.selected.map(i => L.normalized[i]),
    questionPrompts: [QUESTIONS[0], QUESTIONS[1]],
    uploads: [{ name: 'photo.png', mime: 'image/png', bytes: PNG }, { name: 'will.pdf', mime: 'application/pdf', bytes: PDF }],
    seeds: [{ name: 'btc_wallet.txt', content: 'abandon ability able about above absent absorb abstract absurd abuse access accident' }],
    finalMessage: 'Look in the blue box.',
  }, extra);
}

// ---------------------------------------------------------------------------
// Compatibility in both directions
// ---------------------------------------------------------------------------
test('a vault sealed by vault-core opens with the v1.0.8 recovery code', async () => {
  const sealed = await MV.sealVault(basicSealArgs());
  const blob = await MV.packageZip(sealed);
  const r = await legacyRecover(blob, { gateAnswer1: ANSWERS[0], gateAnswer2: ANSWERS[1], answersByIndex: recoverAnswers() });
  assert.deepEqual(r.files.map(f => f.name), ['photo.png', 'will.pdf', 'btc_wallet.txt', 'final-message.txt']);
  assert.ok(bytesEqual(r.files[0].bytes, PNG));
  assert.ok(bytesEqual(r.files[1].bytes, PDF));
  assert.equal(r.finalMessage, 'Look in the blue box.');
  assert.equal(r.fullConcat, sealed.permutedConcat);
  assert.ok(r.attempt >= 1 && r.attempt <= 720);
});

test('a v1.0.8 vault opens, splits and verifies in vault-core', async () => {
  const built = await legacyBuild({
    answers: ANSWERS, questions: QUESTIONS, unlockIndexes: UNLOCK, trapIndex: TRAP,
    finalMessage: '  Hello heirs  ',
    uploads: [{ name: 'scan.png', type: 'image/png', raw: PNG }],
    seeds: [{ name: 'eth.txt', content: 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong' }],
  });
  const { entries, vaultJson, vaultEnc } = await MV.readVaultZip(built.zipBlob);
  const l1 = await MV.decryptLayer1(built.unlockConcat, vaultJson, vaultEnc);
  assert.deepEqual(l1.gateIndices, UNLOCK);
  const meta = await MV.decryptMeta(built.permutedConcat, vaultJson, entries.get('vault.meta'));
  const decrypted = [];
  for (const m of meta.files) decrypted.push({ meta: m, bytes: await MV.decryptFile(built.permutedConcat, m, entries.get(m.filename)) });
  const parts = MV.splitContents(meta, decrypted);
  assert.equal(parts.finalMessage, 'Hello heirs');
  assert.deepEqual(parts.seeds, [{ name: 'eth.txt', content: 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong' }]);
  assert.equal(parts.uploads.length, 1);
  assert.equal(parts.uploads[0].name, 'scan.png');
  assert.ok(bytesEqual(parts.uploads[0].bytes, PNG));
});

// ---------------------------------------------------------------------------
// The edit + re-save cycle
// ---------------------------------------------------------------------------
async function openLegacy(built) {
  const r = await legacyRecover(built.zipBlob, { gateAnswer1: ANSWERS[0], gateAnswer2: ANSWERS[1], answersByIndex: recoverAnswers() });
  const L1 = r.layer1;
  const map = recoverAnswers();
  const norm = (i) => MV.normalizeAnswer(map[i]);
  // the same answer sets recover.js hands the editor after a successful unlock
  return {
    r,
    session: {
      vaultJson: r.vaultJson,
      vaultEnc: JSON.parse(dec.decode((await zipEntries(built.zipBlob))['vault.enc'])),
      unlockConcat: MV.normalizeAnswer(ANSWERS[0]) + MV.normalizeAnswer(ANSWERS[1]),
      gateAnswers: L1.gateIndices.map(norm),
      remainingAnswers: L1.remainingL2Indices.map(norm),
      selectedAnswers: L1.selectedL2Indices.map(norm),
    },
  };
}

test('edit cycle: remove, add, rename, change seed + message; result opens in v1.0.8 and in the new code', async () => {
  const built = await legacyBuild({
    answers: ANSWERS, questions: QUESTIONS, unlockIndexes: UNLOCK, trapIndex: TRAP,
    finalMessage: 'old message',
    uploads: [
      { name: 'keep.png', type: 'image/png', raw: PNG },
      { name: 'drop-me.txt', type: 'text/plain', raw: enc.encode('delete this') },
    ],
    seeds: [{ name: 'old_seed.txt', content: 'one two three' }],
  });
  const { r, session } = await openLegacy(built);
  const parts = MV.splitContents(r.meta, r.files.map((f, i) => ({ meta: r.meta.files[i], bytes: f.bytes })));

  const big = MV.randomBytes(3 * 1024 * 1024 + 17);
  const uploads = [
    { name: 'renamed.png', mime: 'image/png', bytes: parts.uploads.find(u => u.name === 'keep.png').bytes },
    { name: 'deed.pdf', mime: 'application/pdf', bytes: PDF },
    { name: 'final-message.txt', mime: 'text/plain', bytes: enc.encode('user upload with a reserved name') },
    { name: 'big.bin', mime: 'application/octet-stream', bytes: big },
  ];
  const seeds = [{ name: 'old_seed.txt', content: 'one two four' }, { name: 'new_seed.txt', content: 'alpha beta' }];
  const out = await MV.resealVault(Object.assign({}, session, {
    uploads, seeds, finalMessage: 'new message', metaExtras: { revision: 2, modified: new Date().toISOString() },
  }));

  // v1.0.8 recovery of the edited vault
  const back = await legacyRecover(out.blob, { gateAnswer1: ANSWERS[0], gateAnswer2: ANSWERS[1], answersByIndex: recoverAnswers() });
  assert.deepEqual(back.files.map(f => f.name),
    ['renamed.png', 'deed.pdf', 'final-message (1).txt', 'big.bin', 'old_seed.txt', 'new_seed.txt', 'final-message.txt']);
  assert.equal(back.finalMessage, 'new message', 'old recover shows the real final message, not the renamed upload');
  assert.ok(bytesEqual(back.files[3].bytes, big));
  assert.equal(dec.decode(back.files[4].bytes), 'one two four');
  assert.ok(!back.files.some(f => f.name === 'drop-me.txt'));
  assert.equal(back.meta.revision, 2);
  assert.deepEqual(back.meta.seedFiles, seeds);

  // nothing reused from the old copy except questions and created date
  const oldJson = r.vaultJson, newJson = back.vaultJson;
  assert.notEqual(newJson.fullSalt, oldJson.fullSalt);
  assert.notEqual(newJson.layer1Salt, oldJson.layer1Salt);
  assert.notDeepEqual(newJson.vaultMetaIv, oldJson.vaultMetaIv);
  assert.equal(newJson.created, oldJson.created);
  assert.deepEqual(newJson.questionPrompts, oldJson.questionPrompts);
  assert.equal(newJson.version, MV.APP_VERSION);
  const oldIds = new Set(r.meta.files.map(f => f.id));
  assert.ok(back.meta.files.every(f => !oldIds.has(f.id)), 'file ids must be fresh');
  assert.deepEqual(back.layer1, { ...r.layer1 }, 'question layer content is preserved exactly');
});

test('re-saving twice gives unlinkable ciphertexts for unchanged content', async () => {
  const sealedA = await MV.sealVault(basicSealArgs());
  const sealedB = await MV.sealVault(Object.assign(basicSealArgs(), {}));
  const ivs = new Set();
  for (const s of [sealedA, sealedB]) {
    ivs.add(s.vaultJson.vaultMetaIv.join(','));
    ivs.add(s.vaultEnc.iv.join(','));
    for (const m of s.fileMeta) ivs.add(m.iv.join(','));
  }
  assert.equal(ivs.size, 2 * (2 + 4), 'every IV is unique');
  assert.ok(!bytesEqual(sealedA.files[0].bytes, sealedB.files[0].bytes));
});

test('Lite companion reuses salts + order and opens with the same answers', async () => {
  const args = basicSealArgs();
  const full = await MV.sealVault(args);
  const lite = await MV.sealVault(Object.assign({}, args, {
    uploads: [], finalMessage: '',
    fixed: { layer1Salt: full.layer1Salt, fullSalt: full.fullSalt, permutation: full.permutation },
  }));
  assert.equal(lite.permutedConcat, full.permutedConcat);
  const blob = await MV.packageZip(lite, { includeDocs: false });
  const names = Object.keys(await zipEntries(blob));
  assert.ok(!names.includes('README.txt'));
  const back = await legacyRecover(blob, { gateAnswer1: ANSWERS[0], gateAnswer2: ANSWERS[1], answersByIndex: recoverAnswers() });
  assert.deepEqual(back.files.map(f => f.name), ['btc_wallet.txt']);
  await assert.rejects(MV.sealVault(Object.assign({}, args, { fixed: { permutation: ['x', 'y', 'z', 'q', 'r', 's'] } })), /permutation/);
});

test('re-seal refuses an unlock answer that does not open layer 1', async () => {
  const built = await legacyBuild({ answers: ANSWERS, questions: QUESTIONS, unlockIndexes: UNLOCK, trapIndex: TRAP, finalMessage: 'x' });
  const { session } = await openLegacy(built);
  await assert.rejects(MV.resealVault(Object.assign({}, session, { unlockConcat: 'wrongwrong', uploads: [], seeds: [], finalMessage: 'y' })));
});

// ---------------------------------------------------------------------------
// Security properties
// ---------------------------------------------------------------------------
test('wrong answers, a filled-in red herring or a swapped gate never open the vault', async () => {
  const blob = await MV.packageZip(await MV.sealVault(basicSealArgs({ uploads: [], seeds: [] })));
  const wrong = recoverAnswers(); wrong[5] = 'accord';
  await assert.rejects(legacyRecover(blob, { gateAnswer1: ANSWERS[0], gateAnswer2: ANSWERS[1], answersByIndex: wrong }), /exhausted/);
  const trapFilled = recoverAnswers(); trapFilled[TRAP] = 'decoy';
  await assert.rejects(legacyRecover(blob, { gateAnswer1: ANSWERS[0], gateAnswer2: ANSWERS[1], answersByIndex: trapFilled }), /exhausted/);
  await assert.rejects(legacyRecover(blob, { gateAnswer1: ANSWERS[1], gateAnswer2: ANSWERS[0], answersByIndex: recoverAnswers() }));
});

test('tampering with any encrypted part is detected', async () => {
  const sealed = await MV.sealVault(basicSealArgs());
  const blob = await MV.packageZip(sealed);
  const unlockConcat = basicUnlock();
  const entries = await zipEntries(blob);
  await MV.verifyVaultZip(blob, { unlockConcat, permutedConcat: sealed.permutedConcat });

  const flip = (u8, at) => { const c = u8.slice(); c[at] ^= 0x01; return c; };
  const docName = sealed.files[0].filename;
  for (const [name, mutate] of [
    [docName, (e) => { e[docName] = flip(e[docName], 3); }],
    ['vault.meta', (e) => { e['vault.meta'] = flip(e['vault.meta'], 10); }],
    ['vault.enc', (e) => { const j = JSON.parse(dec.decode(e['vault.enc'])); j.ciphertext[5] ^= 1; e['vault.enc'] = enc.encode(JSON.stringify(j)); }],
    ['vault.json salt', (e) => { const j = JSON.parse(dec.decode(e['vault.json'])); j.fullSalt = MV.randomHex(16); e['vault.json'] = enc.encode(JSON.stringify(j)); }],
    ['vault.meta iv', (e) => { const j = JSON.parse(dec.decode(e['vault.json'])); j.vaultMetaIv[0] ^= 1; e['vault.json'] = enc.encode(JSON.stringify(j)); }],
  ]) {
    const copy = Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, v.slice()]));
    mutate(copy);
    await assert.rejects(MV.verifyVaultZip(await rezip(copy), { unlockConcat, permutedConcat: sealed.permutedConcat }), undefined, `tamper not detected: ${name}`);
  }
});

function basicUnlock() { return MV.normalizeAnswer(ANSWERS[0]) + MV.normalizeAnswer(ANSWERS[1]); }

test('decryptFile rejects content whose SHA-256 does not match vault.meta', async () => {
  const pc = 'some-permuted-concat';
  const { meta, ciphertext } = await MV.encryptFile(pc, PNG, 'a.png', 'image/png');
  assert.ok(bytesEqual(await MV.decryptFile(pc, meta, ciphertext), PNG));
  await assert.rejects(MV.decryptFile(pc, Object.assign({}, meta, { sha256: '00'.repeat(32) }), ciphertext), /Integrity check failed/);
  await assert.rejects(MV.decryptFile('other-answers', meta, ciphertext));
});

test('no answers, names or contents appear in plaintext anywhere in the ZIP', async () => {
  const args = basicSealArgs({
    uploads: [{ name: 'SECRET-FILENAME-XYZ.txt', mime: 'text/plain', bytes: enc.encode('SECRET-BODY-QWERTY') }],
    seeds: [{ name: 'SECRET-SEED-NAME.txt', content: 'SECRET-SEED-WORDS' }],
    finalMessage: 'SECRET-FINAL-MESSAGE',
  });
  const blob = await MV.packageZip(await MV.sealVault(args));
  const raw = new Uint8Array(await blob.arrayBuffer());
  const entries = await zipEntries(blob);
  const haystacks = [raw, ...Object.values(entries)].map(u8 => Buffer.from(u8).toString('latin1'));
  const needles = ['SECRET-FILENAME', 'SECRET-BODY', 'SECRET-SEED', 'SECRET-FINAL', 'image/png', ...ANSWERS.filter((_, i) => i > 1).map(a => a.toLowerCase())];
  for (const n of needles) for (const h of haystacks) assert.ok(!h.includes(n), `plaintext leak: ${n}`);

  const vj = JSON.parse(dec.decode(entries['vault.json']));
  assert.deepEqual(Object.keys(vj), ['version', 'created', 'instructions', 'fullSalt', 'layer1Salt', 'questionPrompts', 'vaultMetaIv', 'argonSettings']);
  assert.match(vj.fullSalt, /^[0-9a-f]{32}$/);
  assert.match(vj.layer1Salt, /^[0-9a-f]{32}$/);
  assert.deepEqual(vj.argonSettings, { time: 3, mem: 16384, parallelism: 1, type: 'Argon2id', hashLen: 32 });
  for (const name of Object.keys(entries)) assert.match(name, /^(vault\.(json|enc|meta)|[0-9a-f]{32}\.vaultdoc|README\.txt|Vault_Builder_Instructions\.txt)$/);
});

test('unicode answers, an empty vault and a 4-question vault all round-trip through v1.0.8 recovery', async () => {
  // 4 questions: 2 gates + 2 permuted, no red herring
  const answers = ['Zoë', 'São Paulo', 'Ñandú', '日本'];
  const normalized = answers.map(MV.normalizeAnswer);
  const payload = {
    questionList: answers.map((a, i) => ({ question: `Q${i}`, expectedLength: a.length, hintLetters: [], hintValues: [], spaceIndexes: [], custom: '', showLength: true, mcqEnabled: false, mcqOptions: null })),
    selectedL2Indices: [3, 2], remainingL2Indices: [], gateIndices: [0, 1],
  };
  const sealed = await MV.sealVault({
    unlockConcat: normalized[0] + normalized[1], layer1Payload: payload,
    gateAnswers: [normalized[0], normalized[1]], remainingAnswers: [], selectedAnswers: [normalized[3], normalized[2]],
    questionPrompts: ['Q0', 'Q1'], uploads: [], seeds: [], finalMessage: '',
  });
  const back = await legacyRecover(await MV.packageZip(sealed), {
    gateAnswer1: 'ZOË', gateAnswer2: 'são paulo', answersByIndex: { 0: 'zoë', 1: 'são paulo', 2: 'ñandú', 3: '日本' },
  });
  assert.equal(back.files.length, 0);
  assert.equal(back.finalMessage, '');
});

test('dedupeNames keeps uploads clear of reserved names and of each other', () => {
  const out = MV.dedupeNames([{ name: 'a.txt' }, { name: 'A.txt' }, { name: 'final-message.txt' }, { name: 'noext' }, { name: 'noext' }], ['final-message.txt']);
  assert.deepEqual(out.map(o => o.name), ['a.txt', 'A (1).txt', 'final-message (1).txt', 'noext', 'noext (1)']);
});

// ---------------------------------------------------------------------------
// Review follow-ups: empty files and exact content sorting
// ---------------------------------------------------------------------------
test('empty files seal, verify and decrypt (GCM output is just the 16-byte tag)', async () => {
  const pc = 'answers-for-empty';
  const { meta, ciphertext } = await MV.encryptFile(pc, new Uint8Array(0), 'empty.txt', 'text/plain');
  assert.equal(ciphertext.length, 16);
  assert.equal((await MV.decryptFile(pc, meta, ciphertext)).length, 0);
  const sealed = await MV.sealVault(basicSealArgs({ uploads: [{ name: 'empty.txt', mime: 'text/plain', bytes: new Uint8Array(0) }] }));
  const blob = await MV.packageZip(sealed);
  const v = await MV.verifyVaultZip(blob, { unlockConcat: basicUnlock(), permutedConcat: sealed.permutedConcat });
  assert.equal(v.files[0].bytes.length, 0);
});

function fakeDecrypted(entries) {
  return entries.map(([name, bytes, mime = 'text/plain']) => ({ meta: { originalName: name, mimeType: mime }, bytes: Uint8Array.from(bytes) }));
}

test('splitContents never mistakes an upload for a seed or the final message', () => {
  const utf16 = [0xff, 0xfe, 0x48, 0x00, 0x69, 0x00];
  // an uploaded wallet.txt (UTF-16) next to a seed that is also named wallet.txt
  const a = MV.splitContents(
    { seedFiles: [{ name: 'wallet.txt', content: 'seed words here' }] },
    fakeDecrypted([['wallet.txt', utf16], ['wallet.txt', enc.encode('seed words here')], ['final-message.txt', enc.encode('bye')]]));
  assert.deepEqual(a.seeds, [{ name: 'wallet.txt', content: 'seed words here' }]);
  assert.equal(a.finalMessage, 'bye');
  assert.equal(a.uploads.length, 1);
  assert.deepEqual(Array.from(a.uploads[0].bytes), utf16, 'upload bytes untouched');

  // no real final message: an uploaded final-message.txt with CRLF stays a byte-exact upload
  const crlf = enc.encode('Love, Dad\r\n');
  const b = MV.splitContents({ seedFiles: [] }, fakeDecrypted([['final-message.txt', crlf]]));
  assert.equal(b.finalMessage, '');
  assert.deepEqual(Array.from(b.uploads[0].bytes), Array.from(crlf));

  // a final-message.txt that is not last is an upload too
  const c = MV.splitContents({ seedFiles: [] }, fakeDecrypted([['final-message.txt', enc.encode('x')], ['photo.png', PNG, 'image/png']]));
  assert.equal(c.finalMessage, '');
  assert.equal(c.uploads.length, 2);

  // invalid UTF-8 named like a seed is not a seed
  const d = MV.splitContents({ seedFiles: [{ name: 's.txt', content: 'abc' }] }, fakeDecrypted([['s.txt', [0xc3, 0x28]]]));
  assert.deepEqual(d.seeds, [{ name: 's.txt', content: 'abc' }]);
  assert.equal(d.uploads.length, 1);
});

// ---------------------------------------------------------------------------
// Audit follow-ups: untrusted settings, names and plaintext prompts
// ---------------------------------------------------------------------------
test('Argon2 settings from vault.json are bounded (no CPU or memory bombs)', async () => {
  assert.deepEqual(MV.safeArgonSettings(undefined), MV.ARGON);
  assert.deepEqual(MV.safeArgonSettings({ time: 3, mem: 16384, parallelism: 1, hashLen: 32, type: 'Argon2id' }), { time: 3, mem: 16384, parallelism: 1, hashLen: 32 });
  for (const bad of [{ time: 1e9, mem: 16384, parallelism: 1, hashLen: 32 }, { time: 3, mem: 4194304, parallelism: 1, hashLen: 32 },
    { time: 3, mem: 16384, parallelism: 1, hashLen: 2 ** 31 }, { time: '3', mem: 16384, parallelism: 1, hashLen: 32 }, { time: 3, mem: 16384, parallelism: 64, hashLen: 32 }]) {
    assert.throws(() => MV.safeArgonSettings(bad), /unsupported Argon2/);
  }
  const sealed = await MV.sealVault(basicSealArgs());
  const tampered = Object.assign({}, sealed.vaultJson, { argonSettings: { time: 1e9, mem: 16384, parallelism: 1, type: 'Argon2id', hashLen: 32 } });
  await assert.rejects(MV.decryptLayer1(basicUnlock(), tampered, sealed.vaultEnc), /unsupported Argon2/);
});

test('names read from a vault are cleaned (no paths, controls or bidi tricks)', () => {
  const out = MV.splitContents({ seedFiles: [{ name: 'a/b‮txt.exe', content: 'x y z' }] }, fakeDecrypted([
    ['../../.config/autostart/evil.desktop', enc.encode('[Desktop Entry]')],
    ['..', enc.encode('dots')],
    ['report‮fdp.exe', enc.encode('pdf?')],
    ['a/b‮txt.exe', enc.encode('x y z')],
  ]));
  assert.deepEqual(out.uploads.map(u => u.name), ['.._.._.config_autostart_evil.desktop', 'file.bin', 'reportfdp.exe']);
  assert.deepEqual(out.seeds, [{ name: 'a_btxt.exe', content: 'x y z' }]);
});

test('re-saving takes the unlock prompts from the authenticated layer, not plaintext vault.json', async () => {
  const built = await legacyBuild({ answers: ANSWERS, questions: QUESTIONS, unlockIndexes: UNLOCK, trapIndex: TRAP, finalMessage: 'hi' });
  const { session } = await openLegacy(built);
  session.vaultJson = Object.assign({}, session.vaultJson, { questionPrompts: ['Type your bank password', 'And your PIN'] });
  const out = await MV.resealVault(Object.assign({}, session, { uploads: [], seeds: [], finalMessage: 'hi' }));
  assert.deepEqual(out.sealed.vaultJson.questionPrompts, [QUESTIONS[0], QUESTIONS[1]]);
});
