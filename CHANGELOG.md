# Changelog

## [1.0.8] - 2025-06-01

# Memoro Vault v1.0.8

**Release Date:** 2025-08-06

This update introduces significant cryptographic and usability improvements, strengthens the vault's resistance to attack, and prepares the platform for mobile use.

---

## Security and Cryptography

- **Eliminated Per-Answer Hashes**  
  No individual answer hashes are stored or exposed. Vault validation is now performed exclusively through full key derivation and successful decryption of the `vault.meta` file. This removes any attacker advantage from partial or incremental guesses.

- **Upgraded from PBKDF2 to Argon2id**  
  All key derivation has been migrated from PBKDF2 to Argon2id. Argon2id is a modern, memory-hard function designed to resist GPU and parallel brute-force attacks. This change significantly increases the computational cost for adversaries while remaining efficient for legitimate users.

- **Strict Answer and Order Verification**  
  Recovery requires all answers to be correct. Six Layer 2 answers must be provided in the original sequence, while remaining answers must be exactly correct but do not rely on order. Incorrect ordering or partial correctness results in complete failure, with no feedback or side-channel clues.

---

## Interface and Logic Enhancements

- **Restored Static Question Order**  
  The displayed question order now consistently reflects the order used during vault creation. This prevents mismatch issues and ensures character and letter hints are correctly aligned with their intended answers.

- **Fixed Hint Display Issues**  
  Character and letter hints now render reliably across vaults with up to 25 questions. Past inconsistencies with larger datasets have been resolved.

## Mobile Optimization

- **Reduced Argon2 Resource Usage**  
  Argon2 parameters have been tuned for compatibility with mobile devices. Vaults can now be recovered on modern mobile browsers without excessive memory usage or browser crashes.

- **Mobile Application in Development**  
  A standalone Memoro Vault mobile application is currently in progress. The app will offer full offline recovery, native file decryption, and cross-platform support.

---

## Documentation and Messaging

- **Updated README and Vault Message**  
  Instructions for loading the vault and recovering it have been clarified, using human-readable language intended for future users or family members. The README now reflects the design philosophy more accurately and directly.

