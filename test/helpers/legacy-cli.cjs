// test/helpers/legacy-cli.cjs: run the v1.0.8 builder or recovery oracle in a separate process.
//
// Large-vault tests use this so the multi-gigabyte buffers and WASM memory of building and
// checking a vault live in a short-lived process instead of the test runner.
//
//   node legacy-cli.cjs build   <out.zip> <raw-file> <MB> <answers.json>
//   node legacy-cli.cjs recover <vault.zip> <answers.json>
// Both print one line of JSON.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { load } = require('./env.cjs');
const { legacyBuild, legacyRecover } = require('./legacy-v108.cjs');

(async () => {
  await load();
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'build') {
    const [outZip, rawFile, mb, answersFile] = args;
    const spec = JSON.parse(fs.readFileSync(answersFile, 'utf8'));
    const raw = crypto.randomBytes(Number(mb) * 1024 * 1024);
    fs.writeFileSync(rawFile, raw);
    const built = await legacyBuild({
      answers: spec.answers, questions: spec.questions, unlockIndexes: spec.unlockIndexes, trapIndex: spec.trapIndex,
      finalMessage: spec.finalMessage, uploads: [{ name: spec.fileName, type: 'application/octet-stream', raw }],
    });
    fs.writeFileSync(outZip, Buffer.from(await built.zipBlob.arrayBuffer()));
    console.log(JSON.stringify({ sha256: crypto.createHash('sha256').update(raw).digest('hex'), size: raw.length }));
  } else if (cmd === 'recover') {
    const [zipFile, answersFile] = args;
    const spec = JSON.parse(fs.readFileSync(answersFile, 'utf8'));
    const answersByIndex = Object.fromEntries(spec.answers.map((a, i) => [i, i === spec.trapIndex ? '' : a]));
    const back = await legacyRecover(new Uint8Array(fs.readFileSync(zipFile)), {
      gateAnswer1: spec.answers[spec.unlockIndexes[0]], gateAnswer2: spec.answers[spec.unlockIndexes[1]], answersByIndex,
    });
    console.log(JSON.stringify({
      files: back.files.map(f => ({ name: f.name, size: f.bytes.length, sha256: crypto.createHash('sha256').update(f.bytes).digest('hex') })),
      finalMessage: back.finalMessage,
      selectedL2Indices: back.layer1.selectedL2Indices,
    }));
  } else {
    throw new Error('usage: legacy-cli.cjs build|recover ...');
  }
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
