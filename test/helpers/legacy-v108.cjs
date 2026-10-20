// test/helpers/legacy-v108.cjs
//
// A line-by-line port of the v1.0.8 vault builder (build-vault.js) and of the v1.0.8 unlock +
// recovery path (dashboard.js submitUnlock, recover.js submitRecovery / decryptVaultDocs /
// decryptFinalMessage). It deliberately talks to the WASM engine directly and does NOT use
// vault-core.js, so it is an independent oracle for format compatibility:
//   * vaults written by the new code must open with legacyRecover (old installs keep working)
//   * vaults written by legacyBuild must open in the new code (old vaults stay editable)
'use strict';

const enc = new TextEncoder();
const dec = new TextDecoder();

function generateRandomHex(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length / 2));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToU8(hex) {
  return Uint8Array.from(hex.match(/.{1,2}/g).map(h => parseInt(h, 16)));
}
function deriveRawKeyBytes(password, saltHex, s) {
  s = s || { time: 3, mem: 16384, parallelism: 1, hashLen: 32 };
  return globalThis.argon2DeriveRust(enc.encode(password), hexToU8(saltHex), s.time, s.mem, s.parallelism, s.hashLen);
}
function generatePermutations(array) {
  if (array.length <= 1) return [array.slice()];
  const result = [];
  for (let i = 0; i < array.length; i++) {
    const current = array[i];
    const remaining = array.slice(0, i).concat(array.slice(i + 1));
    for (const perm of generatePermutations(remaining)) result.push([current, ...perm]);
  }
  return result;
}

/**
 * v1.0.8 build. `uploads` = [{name, type, raw:Uint8Array}], `seeds` = [{name, content}].
 * Returns { zipBlob, permutedConcat, unlockConcat, selectedL2Indices, remainingL2Indices, gateIndices }.
 */
async function legacyBuild({ answers, questions, unlockIndexes = [0, 1], trapIndex = -1, finalMessage = '', uploads = [], seeds = [] }) {
  const zip = globalThis.zip;
  const normalizedAnswers = answers.map((a, i) => (i === trapIndex ? '' : (a || '').trim().toLowerCase()));
  const unlockConcat = (answers[unlockIndexes[0]] || '').trim().toLowerCase() + (answers[unlockIndexes[1]] || '').trim().toLowerCase();
  const fullSalt = generateRandomHex(32);

  const allIndices = Array.from({ length: normalizedAnswers.length }, (_, i) => i);
  const gateIndices = [unlockIndexes[0], unlockIndexes[1]];
  const layer2Indices = allIndices.filter(i => !gateIndices.includes(i));
  const selectedL2Indices = layer2Indices.sort(() => Math.random() - 0.5).slice(0, 6);
  const remainingL2Indices = layer2Indices.filter(i => !selectedL2Indices.includes(i));

  // Layer 1
  const layer1Salt = generateRandomHex(32);
  const layer1KeyRaw = deriveRawKeyBytes(unlockConcat, layer1Salt);
  const questionList = answers.map((ans, i) => {
    const trimmed = (ans || '').trim();
    return {
      question: questions[i] || `Question ${i + 1}`,
      expectedLength: trimmed.length, hintLetters: [], hintValues: [], spaceIndexes: [],
      custom: '', showLength: true, mcqEnabled: false, mcqOptions: null,
    };
  });
  const iv1 = crypto.getRandomValues(new Uint8Array(12));
  const encData = await globalThis.aesEncryptRust(layer1KeyRaw, iv1, enc.encode(JSON.stringify({
    questionList, selectedL2Indices, remainingL2Indices, gateIndices,
  })));
  const vaultEncrypted = { ciphertext: Array.from(encData), iv: Array.from(iv1) };

  // Permutation + full key
  const perms = generatePermutations(selectedL2Indices.map(i => normalizedAnswers[i]));
  const finalPermutationUsed = perms[Math.floor(Math.random() * perms.length)];
  const permutedConcat = [
    normalizedAnswers[gateIndices[0]], normalizedAnswers[gateIndices[1]],
    ...remainingL2Indices.map(i => normalizedAnswers[i]),
    ...finalPermutationUsed,
  ].join('');
  const fullKeyRaw = deriveRawKeyBytes(permutedConcat, fullSalt);
  const vaultHashRaw = await globalThis.sha256Hash(enc.encode(permutedConcat));
  const vaultHash = Array.from(vaultHashRaw).map(b => b.toString(16).padStart(2, '0')).join('');

  const fileMeta = [];
  const encryptedFiles = [];
  async function encryptAndPushFile(buffer, name, mime) {
    const fileId = crypto.randomUUID().replace(/-/g, '');
    const internalFilename = fileId + '.vaultdoc';
    const fileSalt = new Uint8Array(await globalThis.sha256Hash(enc.encode(permutedConcat + fileId)));
    const rawKey = globalThis.argon2DeriveRust(enc.encode(permutedConcat + fileId), fileSalt, 3, 16384, 1, 32);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedBuffer = await globalThis.aesEncryptRust(rawKey, iv, buffer);
    const shaBuf = await globalThis.sha256Hash(buffer);
    fileMeta.push({
      id: fileId, filename: internalFilename, originalName: name, mimeType: mime,
      iv: Array.from(iv), sha256: Array.from(shaBuf).map(b => b.toString(16).padStart(2, '0')).join(''),
    });
    encryptedFiles.push({ filename: internalFilename, blob: new Blob([new Uint8Array(encryptedBuffer)]) });
  }
  for (const f of uploads) await encryptAndPushFile(new Uint8Array(f.raw), f.name, f.type);
  for (const s of seeds) await encryptAndPushFile(enc.encode(s.content), s.name, 'text/plain');
  if (finalMessage && finalMessage.trim()) await encryptAndPushFile(enc.encode(finalMessage.trim()), 'final-message.txt', 'text/plain');

  const iv3 = crypto.getRandomValues(new Uint8Array(12));
  const metaData = await globalThis.aesEncryptRust(fullKeyRaw, iv3, enc.encode(JSON.stringify({ files: fileMeta, seedFiles: seeds, vaultHash })));

  const writer = new zip.ZipWriter(new zip.BlobWriter('application/zip'));
  const addJSON = (name, data) => writer.add(name, new zip.TextReader(JSON.stringify(data, null, 2)));
  await addJSON('vault.json', {
    version: '1.0.8', created: new Date().toISOString(),
    instructions: 'Use recover.html to unlock this archive using your answers.',
    fullSalt, layer1Salt,
    questionPrompts: [questions[gateIndices[0]], questions[gateIndices[1]]],
    vaultMetaIv: Array.from(iv3),
    argonSettings: { time: 3, mem: 16384, parallelism: 1, type: 'Argon2id', hashLen: 32 },
  });
  await addJSON('vault.enc', vaultEncrypted);
  await writer.add('vault.meta', new zip.BlobReader(new Blob([new Uint8Array(metaData)])));
  for (const f of encryptedFiles) await writer.add(f.filename, new zip.BlobReader(f.blob));
  await writer.add('README.txt', new zip.TextReader('legacy readme'));
  const zipBlob = await writer.close();
  return { zipBlob, permutedConcat, unlockConcat, selectedL2Indices, remainingL2Indices, gateIndices, normalizedAnswers };
}

/**
 * v1.0.8 unlock (dashboard) + recover (recover.js). `answersByIndex` maps original question
 * index -> what the person types on the recover page (red herring left blank).
 * Returns { files:[{name, mime, bytes}], finalMessage, attempt, fullConcat, layer1 }.
 */
async function legacyRecover(zipBlob, { gateAnswer1, gateAnswer2, answersByIndex }) {
  const zip = globalThis.zip;
  const reader = new zip.ZipReader(new zip.BlobReader(zipBlob));
  const fileMap = {};
  for (const entry of await reader.getEntries()) {
    const b = await entry.getData(new zip.BlobWriter());
    fileMap[entry.filename] = b;
    fileMap[entry.filename.toLowerCase()] = b;
  }
  await reader.close();

  // dashboard.submitUnlock
  const vaultData = JSON.parse(await fileMap['vault.json'].text());
  const vaultEncJson = JSON.parse(await fileMap['vault.enc'].text());
  const answer1 = gateAnswer1.trim().toLowerCase();
  const answer2 = gateAnswer2.trim().toLowerCase();
  const l1KeyRaw = deriveRawKeyBytes(answer1 + answer2, vaultData.layer1Salt, vaultData.argonSettings);
  const decU8 = await globalThis.aesDecryptRust(l1KeyRaw, new Uint8Array(vaultEncJson.iv), new Uint8Array(vaultEncJson.ciphertext));
  const fullVaultData = JSON.parse(dec.decode(decU8));

  // recover.submitRecovery
  const argon = vaultData.argonSettings || { time: 3, mem: 16384, parallelism: 1, hashLen: 32 };
  const { selectedL2Indices = [], remainingL2Indices = [], gateIndices = [] } = fullVaultData;
  const userAnswerMap = {};
  for (const [k, v] of Object.entries(answersByIndex)) userAnswerMap[Number(k)] = (v || '').trim().toLowerCase();
  const permutations = generatePermutations(selectedL2Indices.map(idx => userAnswerMap[idx]));
  let attempt = 0, metaJson = null, finalFullConcat = '';
  for (const permuted of permutations) {
    attempt++;
    const resolved = [];
    gateIndices.forEach(idx => (resolved[idx] = userAnswerMap[idx]));
    remainingL2Indices.forEach(idx => (resolved[idx] = userAnswerMap[idx]));
    selectedL2Indices.forEach((origIdx, permIdx) => (resolved[origIdx] = permuted[permIdx]));
    const fullConcat = [
      ...gateIndices.map(i => resolved[i]),
      ...remainingL2Indices.map(i => resolved[i]),
      ...selectedL2Indices.map(i => resolved[i]),
    ].join('');
    try {
      const rawFullKey = deriveRawKeyBytes(fullConcat, vaultData.fullSalt, argon);
      const metaBuf = new Uint8Array(await fileMap['vault.meta'].arrayBuffer());
      const d = await globalThis.aesDecryptRust(rawFullKey, new Uint8Array(vaultData.vaultMetaIv), metaBuf);
      const parsed = JSON.parse(dec.decode(d));
      if (!parsed || !Array.isArray(parsed.files)) throw new Error('bad meta');
      metaJson = parsed;
      finalFullConcat = fullConcat;
      break;
    } catch { /* next permutation */ }
  }
  if (!metaJson) throw new Error('All permutations exhausted without success.');

  // decryptVaultDocs
  const files = [];
  for (const meta of metaJson.files) {
    const blob = fileMap[meta.filename] || fileMap[String(meta.filename).toLowerCase()];
    if (!blob) throw new Error('missing ' + meta.filename);
    const encrypted = new Uint8Array(await blob.arrayBuffer());
    const fileId = meta.filename.replace('.vaultdoc', '');
    const password = finalFullConcat + fileId;
    const fileSalt = new Uint8Array(await globalThis.sha256Hash(enc.encode(password)));
    const rawKey = globalThis.argon2DeriveRust(enc.encode(password), fileSalt, 3, 16384, 1, 32);
    const decBytes = await globalThis.aesDecryptRust(rawKey, new Uint8Array(meta.iv), encrypted);
    files.push({ name: meta.originalName || meta.filename, mime: meta.mimeType || 'application/octet-stream', bytes: new Uint8Array(decBytes) });
  }
  // decryptFinalMessage (first file named final-message.txt)
  const fm = files.find(f => f.name === 'final-message.txt');
  return {
    files,
    finalMessage: fm ? dec.decode(fm.bytes).trim() : '',
    attempt,
    fullConcat: finalFullConcat,
    layer1: fullVaultData,
    meta: metaJson,
    vaultJson: vaultData,
  };
}

module.exports = { legacyBuild, legacyRecover, generatePermutations };
