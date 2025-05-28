# Changelog

## [1.0.3] - 2025-05-28

### Added
- Proof-of-Work (PoW) difficulty selection modal during vault creation, with options from 4 to 9 leading zeros and estimated mining times.
- Dynamic fallback PoW system on vault recovery if baked-in nonce is invalid.
- Difficulty escalation mechanism: recovery difficulty increases every 5 failed attempts.
- Recovery terminal overlay with visual mining output during PoW.
- "Vault Crack" animation before revealing the final recovery modal (screen shake, flash burst, and dust fade-in).
- Monero donation QR code and message displayed above the "Vault Recovered" section.
- Inline file preview system for text and image files.
- Download All as ZIP and Secure Wipe & Exit buttons in recovery modal.
- **Support for encrypted file uploads**: Users can now add sensitive documents, messages, or images to their vault (up to 250MB total).
- **Baked-in PoW nonce**: The final vault now includes a nonce tied to user answers + PoW salt, requiring correct re-mining for validation.
- **Per-file AES-GCM encryption**: Each uploaded document is encrypted individually and tied to Layer 2 decryption.

### Changed
- PoW explanation text rewritten in layman’s terms with contextual humor (e.g., “9 zeros = for whackos”).
- Vault recovery now resets and reloads the environment on each attempt to prevent stale state issues.
- Recovery failure triggers full UI wipe and PoW counter increment.
- Fingerprint mismatch now logs a warning instead of silently failing.
- Default vault type is now set to "Crypto + Sensitive Documents/Passwords".
- Updated styling for slider, checkboxes, dropdowns, and Matrix background across creation and recovery pages.

### Fixed
- Decryption key generation now correctly synchronizes between build and recovery phases using consistent input format.
- Answer validation failures now show user-friendly messages with toast notifications.
- Donation image and message no longer interfere with main modal styling.
- IndexedDB fallback now clears broken object stores if initialization fails, preventing persistent unlock issues.

---
