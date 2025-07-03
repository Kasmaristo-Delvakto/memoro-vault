use wasm_bindgen::prelude::*;
use pbkdf2::pbkdf2;
use aes_gcm::{Aes256Gcm, KeyInit, Key, Nonce};
use aes_gcm::aead::Aead;
use sha2::{Sha256, Digest};
use hmac::Hmac;

// --- Add this! ---
#[wasm_bindgen] 
extern "C" {
    // optionally add JS bindings here if calling into JS
}

// --- Add this wrapper! ---
#[wasm_bindgen]
pub fn sha256_hash(input: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(input);
    hasher.finalize().to_vec()
}

#[wasm_bindgen]
pub fn derive_key(password: &[u8], salt: &[u8], iterations: u32) -> Vec<u8> {
    let mut key = [0u8; 32];
    let _ = pbkdf2::<Hmac<Sha256>>(password, salt, iterations, &mut key);
    key.to_vec()
}

#[wasm_bindgen]
pub fn aes_gcm_encrypt(key_bytes: &[u8], nonce_bytes: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, JsValue> {
    if key_bytes.len() != 32 {
        return Err(JsValue::from_str("Key must be 32 bytes (256-bit)"));
    }
    if nonce_bytes.len() != 12 {
        return Err(JsValue::from_str("Nonce must be 12 bytes (96-bit)"));
    }

    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher.encrypt(nonce, plaintext)
        .map_err(|e| JsValue::from_str(&format!("Encrypt error: {:?}", e)))
}

#[wasm_bindgen]
pub fn aes_gcm_decrypt(key_bytes: &[u8], nonce_bytes: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, JsValue> {
    if key_bytes.len() != 32 {
        return Err(JsValue::from_str("Key must be 32 bytes (256-bit)"));
    }
    if nonce_bytes.len() != 12 {
        return Err(JsValue::from_str("Nonce must be 12 bytes (96-bit)"));
    }

    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher.decrypt(nonce, ciphertext)
        .map_err(|e| JsValue::from_str(&format!("Decrypt error: {:?}", e)))
}
