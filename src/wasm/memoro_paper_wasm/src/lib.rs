use wasm_bindgen::prelude::*;
use aes_gcm::{Aes256Gcm, aead::{Aead, KeyInit}, Nonce};
use getrandom::getrandom;
use serde::{Serialize, Deserialize};
use hkdf::Hkdf;
use sha2::Sha256;
use blake3;
use hex;
use data_encoding::BASE32_NOPAD;
use sharks::{Sharks, Share};
use js_sys::Uint8Array;

// base64 0.22 requires the Engine trait in scope
use base64::Engine;
use base64::engine::general_purpose::STANDARD;

#[derive(Serialize, Deserialize)]
pub struct PaperMainDoc {
    pub version: u8,           // 1
    pub doc_id: String,        // 8 chars (base32)
    pub cipher: String,        // "AES-256-GCM"
    pub nonce_b64: String,     // 12 bytes b64
    pub ciphertext_b64: String,
    pub payload_len: u32,
    pub checksum_hex: String,  // blake3(ciphertext)
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PaperShard {
    pub shard_id: String,      // "hxxxxxxx"
    pub x: u8,                 // x-coordinate (u8 for transport)
    pub y_b64: String,         // share y bytes (base64 of raw bytes)
    pub text_fallback: String, // base32 grouped for manual entry
}

#[derive(Serialize, Deserialize)]
pub struct PaperBackup {
    pub main: PaperMainDoc,
    pub shards: Vec<PaperShard>,
    pub threshold: u8,
    pub total: u8,
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom(&mut b).expect("rng failed");
    b
}

fn base32_nopad(bytes: &[u8]) -> String {
    BASE32_NOPAD.encode(bytes)
}

fn to_b64(v: &[u8]) -> String {
    STANDARD.encode(v)
}

fn from_b64(s: &str) -> Vec<u8> {
    STANDARD.decode(s).expect("bad b64")
}

fn group_text_b32(s: &str, group: usize) -> String {
    s.as_bytes()
        .chunks(group)
        .map(|c| std::str::from_utf8(c).unwrap())
        .collect::<Vec<_>>()
        .join(" ")
}

// --- Share <-> bytes using sharks 0.5 conversions -----------------

// Serialize a sharks::Share to raw bytes (as defined by the crate).
fn share_to_bytes(s: &Share) -> Vec<u8> {
    Vec::<u8>::from(s) // impl From<&Share> for Vec<u8>
}

// Parse bytes back into a sharks::Share
fn bytes_to_share(b: &[u8]) -> Result<Share, &'static str> {
    core::convert::TryFrom::try_from(b) // impl TryFrom<&[u8]> for Share
}

#[wasm_bindgen]
pub fn generate_backup(payload_bytes: &[u8], threshold: u8, total: u8) -> JsValue {
    assert!(threshold >= 1 && total >= threshold && total <= 16);

    // 1) Generate random 32-byte key K; derive AEAD key via HKDF
    let k: [u8; 32] = random_bytes::<32>();
    let hk = Hkdf::<Sha256>::new(None, &k);
    let mut aead_key = [0u8; 32];
    hk.expand(b"memoro-paper-aead", &mut aead_key).expect("hkdf expand");

    // 2) Encrypt payload with AES-256-GCM
    let cipher = Aes256Gcm::new_from_slice(&aead_key).expect("aead key");
    let nonce = random_bytes::<12>();
    let nonce_ref = Nonce::from_slice(&nonce);
    let ciphertext = cipher.encrypt(nonce_ref, payload_bytes).expect("encrypt");

    // 3) Split K with Shamir k-of-n (sharks)
    let sharks = Sharks(threshold);
    let dealer = sharks.dealer(&k); // &[u8]
    let shares: Vec<Share> = dealer.take(total as usize).collect();

    // 4) Build Main Document
    let doc_id = &base32_nopad(&random_bytes::<5>())[..8];
    let checksum_hex = hex::encode(blake3::hash(&ciphertext).as_bytes());

    let main = PaperMainDoc {
        version: 1,
        doc_id: doc_id.to_string(),
        cipher: "AES-256-GCM".to_string(),
        nonce_b64: to_b64(&nonce),
        ciphertext_b64: to_b64(&ciphertext),
        payload_len: payload_bytes.len() as u32,
        checksum_hex,
    };

    // 5) Encode shards
    let shards_out: Vec<PaperShard> = shares
        .into_iter()
        .map(|s| {
            let bytes = share_to_bytes(&s);            // [x | y...]
            let shard_id = format!("h{}", &base32_nopad(&random_bytes::<5>())[..7]);
            let x = bytes[0];
            let y_b64 = to_b64(&bytes[1..]);          // store only y for compactness
            let tf = group_text_b32(&base32_nopad(&bytes), 8); // full share for manual entry
            PaperShard { shard_id, x, y_b64, text_fallback: tf }
        })
        .collect();

    let bundle = PaperBackup { main, shards: shards_out, threshold, total };

    // Return as a JSON string (no wasm-bindgen serde feature required)
    let json = serde_json::to_string(&bundle).expect("serde to json");
    JsValue::from_str(&json)
}

#[wasm_bindgen]
pub fn recover_payload(main_doc_json: &str, shards_json: &str) -> Result<Uint8Array, JsValue> {
    let main: PaperMainDoc = serde_json::from_str(main_doc_json)
        .map_err(|e| JsValue::from_str(&format!("bad main json: {}", e)))?;
    let shards_in: Vec<PaperShard> = serde_json::from_str(shards_json)
        .map_err(|e| JsValue::from_str(&format!("bad shards json: {}", e)))?;

    // Rebuild shares for sharks (recreate [x | y...] then TryFrom<&[u8]>)
    let mut shares: Vec<Share> = Vec::with_capacity(shards_in.len());
    for s in shards_in {
        let mut bytes = Vec::with_capacity(1 + 255);
        bytes.push(s.x);
        bytes.extend_from_slice(&from_b64(&s.y_b64));
        let share = bytes_to_share(&bytes).map_err(|_| JsValue::from_str("bad share bytes"))?;
        shares.push(share);
    }

    // Recover K using provided shares
    let sharks = Sharks(shares.len() as u8);
    let k_vec = sharks
        .recover(&shares)
        .map_err(|_| JsValue::from_str("recover failed"))?;

    // Derive AEAD key and decrypt
    let hk = Hkdf::<Sha256>::new(None, &k_vec);
    let mut aead_key = [0u8; 32];
    hk.expand(b"memoro-paper-aead", &mut aead_key)
        .map_err(|_| JsValue::from_str("hkdf expand"))?;

    let cipher = Aes256Gcm::new_from_slice(&aead_key).map_err(|_| JsValue::from_str("bad aead key"))?;
    let nonce = STANDARD.decode(&main.nonce_b64).map_err(|_| JsValue::from_str("bad nonce b64"))?;
    let ct = STANDARD.decode(&main.ciphertext_b64).map_err(|_| JsValue::from_str("bad ct b64"))?;

    // Optional integrity check
    let got = hex::encode(blake3::hash(&ct).as_bytes());
    if got != main.checksum_hex {
        return Err(JsValue::from_str("ciphertext checksum mismatch"));
    }

    let pt = cipher
        .decrypt(Nonce::from_slice(&nonce), ct.as_ref())
        .map_err(|_| JsValue::from_str("decrypt failed"))?;

    Ok(Uint8Array::from(pt.as_slice()))
}
