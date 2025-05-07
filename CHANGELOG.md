
# Changelog

All notable changes to this project will be documented in this file.

## [1.0.2] - 2025-05-07
### Added
- Vault builder interface split into left terminal / right branding layout.
- Animated Memoro logo with pulsing glow effect.
- Fade-in buttons post-encryption: Back to Answers, Retry Download, Return to Dashboard.
- Humorous, anti-CBDC terminal lines with embedded donation links.

### Changed
- Replaced CryptoJS encryption with native Web Crypto API (AES-GCM + PBKDF2).
- Terminal logging upgraded to support HTML content (links, emojis, etc.).
- Enhanced UI feedback and style for dark terminal theme.

### Fixed
- Retry Download button now functions reliably after initial build.
- Hyperlink terminal text no longer flickers or disappears.
- Correctly displays action buttons after vault creation completes.

## [1.0.1] - 2025-05-03
### Added
- File-by-file AES encryption for individual `.vaultdoc` assets.
- Password-derived proof-of-work salt system for unlock protection.
- New .zip structure with `vault.json`, `vault.meta`, and README.txt.

### Changed
- Converted previous vault export to ZipWriter-based flat ZIP format.
- Increased vault file compatibility and tamper-resistance.

### Fixed
- Bug where seed phrase was revealed for document-only vaults.
- Issue syncing `questionCount` between setup and answer screens.

## [1.0.0] - 2025-04-30
### Initial Release
- Memoro Vault creation system (with full Q&A flow).
- 2-layer encryption with unlock key + full vault key derivation.
- IndexedDB support for encrypted file storage pre-build.
- Vaults support Monero, Bitcoin, or custom document-only setup.
