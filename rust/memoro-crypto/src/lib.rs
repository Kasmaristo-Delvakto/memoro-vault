use wasm_bindgen::prelude::*;
use aes_gcm::{Aes256Gcm, KeyInit, Key, Nonce};
use aes_gcm::aead::Aead;
use sha2::{Sha256, Digest};

// Argon2
use argon2::{Argon2, Algorithm, Version, Params};
use password_hash::Salt;
use base64::engine::general_purpose::STANDARD_NO_PAD;
use base64::Engine;

#[wasm_bindgen] 
extern "C" {
    // optionally add JS bindings here if calling into JS
}

#[wasm_bindgen]
pub fn sha256_hash(input: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(input);
    hasher.finalize().to_vec()
}

#[wasm_bindgen]
pub fn aes_gcm_encrypt(
    key_bytes: &[u8],
    nonce_bytes: &[u8],
    plaintext: &[u8]
) -> Result<Vec<u8>, JsValue> {
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
        .map_err(|_| JsValue::from_str("AES-GCM encryption failure"))
}

#[wasm_bindgen]
pub fn aes_gcm_decrypt(
    key_bytes: &[u8],
    nonce_bytes: &[u8],
    ciphertext: &[u8]
) -> Result<Vec<u8>, JsValue> {
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
        .map_err(|_| JsValue::from_str("AES-GCM decryption failure"))
}

/// Argon2id key derivation (Rust/WASM, no JS dependency)
#[wasm_bindgen]
pub fn argon2_derive(
    password: &[u8],
    salt: &[u8],
    time_cost: u32,
    mem_kib: u32,
    parallelism: u32,
    hash_len: u32
) -> Result<Vec<u8>, JsValue> {
    let params = Params::new(
        mem_kib,
        time_cost,
        parallelism,
        Some(hash_len as usize),
    ).map_err(|e| JsValue::from_str(&format!("Invalid Argon2 params: {:?}", e)))?;

    let a2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    // Convert salt bytes → base64 → Salt type
    let salt_b64 = STANDARD_NO_PAD.encode(salt);
    let salt = Salt::from_b64(&salt_b64)
        .map_err(|e| JsValue::from_str(&format!("Invalid salt: {:?}", e)))?;

    let mut out = vec![0u8; hash_len as usize];
    a2.hash_password_into(password, salt.as_str().as_bytes(), &mut out)
        .map_err(|e| JsValue::from_str(&format!("Argon2 derive error: {:?}", e)))?;

    Ok(out)
}
