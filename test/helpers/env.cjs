// test/helpers/env.cjs: loads the real WASM crypto engine, zip.js and vault-core.js into Node
// so the format tests exercise exactly the code that ships in the app.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
let ready = null;

function load() {
  if (ready) return ready;
  ready = (async () => {
    const wasm = await import(path.join(SRC, 'wasm', 'memoro_crypto.js'));
    wasm.initSync({ module: fs.readFileSync(path.join(SRC, 'wasm', 'memoro_crypto_bg.wasm')) });
    globalThis.sha256Hash = (u8) => Promise.resolve(wasm.sha256_hash(u8));
    globalThis.aesEncryptRust = (k, n, p) => Promise.resolve(wasm.aes_gcm_encrypt(k, n, p));
    globalThis.aesDecryptRust = (k, n, c) => Promise.resolve(wasm.aes_gcm_decrypt(k, n, c));
    globalThis.argon2DeriveRust = (p, s, t, m, par, len) => wasm.argon2_derive(p, s, t, m, par, len);

    const zip = require(path.join(SRC, 'libs', 'zip.min.js'));
    zip.configure({ useWebWorkers: false });
    globalThis.zip = zip;

    require(path.join(SRC, 'js', 'vault-core.js'));
    return { wasm, zip, MV: globalThis.MemoroVaultCore };
  })();
  return ready;
}

module.exports = { load, SRC };
