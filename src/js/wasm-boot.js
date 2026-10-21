/* js/wasm-boot.js: loads the Rust/WASM crypto engine and exposes the helpers on window (ES module).
 * Moved out of an inline <script> so the Content-Security-Policy can forbid inline script. */
import init, {
  sha256_hash,
  aes_gcm_encrypt,
  aes_gcm_decrypt,
  argon2_derive
} from '../wasm/memoro_crypto.js';

// Expose Promise-friendly wrappers
window.initCryptoWasm = async () => {
  await init();
  window.sha256Hash       = (u8) => Promise.resolve(sha256_hash(u8));
  window.aesEncryptRust   = (k, n, p) => Promise.resolve(aes_gcm_encrypt(k, n, p));
  window.aesDecryptRust   = (k, n, c) => Promise.resolve(aes_gcm_decrypt(k, n, c));
  window.argon2DeriveRust = (pwdBytes, saltBytes, t, m, p, len) =>
    argon2_derive(pwdBytes, saltBytes, t, m, p, len);
};
