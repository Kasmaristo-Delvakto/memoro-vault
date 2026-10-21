# Changelog

## [1.1.0] - 2026-10-20

### Added
- **Vault editor.** After a vault is recovered, Open Vault Editor lets you add, rename and remove files, add or change seed phrases, rewrite the final message and save a new vault with the same questions and answers, without rebuilding it. Every save uses fresh salts, IVs, file IDs and a new hidden answer order, and the new ZIP is re-opened and verified file by file before you choose where to save it. Edits are marked as saved only after the file is confirmed on disk, so a cancelled save dialog keeps them. A new paper backup can be made in the same step.
- **In-app viewer** for images, PDFs (rendered by the bundled pdf.js with eval disabled), text, audio and video, shown straight from memory. Text files can be edited from the editor.
- Recovered files are listed with Open and Download buttons, and the final message is shown on the recovery screen.
- `npm test` (vault format, cross-version compatibility, entropy and tamper tests) and `npm run test:e2e` (full app flows in Electron, optionally against a 1.0.8 checkout).

### Security
- Layer-2 question selection, the hidden answer order and multiple-choice option order now use `crypto.getRandomValues` with unbiased sampling instead of `Math.random()` (the known limitation listed for 1.0.8).
- Every recovered file is checked against the SHA-256 recorded in `vault.meta`; newly built vaults are re-opened and fully decrypted before download.
- The recovery terminal no longer prints the answers or a SHA-256 prefix of them. That prefix could have let anyone who saw the screen test guesses without paying the Argon2id cost.
- All windows use an in-memory session, so answers, uploads and the unlock hand-off are never written to the browser profile on disk. On launch, the storage folders older versions left in the profile are overwritten (best effort) and deleted.
- Electron 25.3.1 → 44.9.2 (Chromium security fixes, including image decoders now used by the viewer). Release builds set Electron fuses (no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, app loaded only from `app.asar`).
- Each page also carries its Content-Security-Policy as a `<meta>` tag, and every window (including the license window) refuses pop-ups and navigation outside the app.
- User-supplied names and questions are rendered as text, never as HTML, on the dashboard, recovery page, question setup and paper-backup picker.
- Derived keys are zeroed after use, and decrypted file buffers are zeroed when you leave the recovery page.
- Pre-release audit fixes:
  - The paper-backup restore log rendered file names and QR header fields as HTML; it is now text only, and QR headers must have a 12-byte IV, a sane size and a hex SHA-256.
  - Hint letters from a vault are rendered as text with lengths capped.
  - Argon2 settings in `vault.json` are bounded (no CPU or memory bombs), and oversized archives are refused before they are unpacked.
  - File names read from a vault are cleaned of path separators, control and bidi characters.
  - Re-saving takes the unlock prompts from the encrypted question list instead of plaintext `vault.json`.
  - Request filtering is now an allowlist (app files, data: and blob: only) with host-name resolution disabled, and `file://host/` URLs are refused.
  - The generic external-link bridge was replaced by a fixed donation-page call; unused bridge methods were removed.
  - Saves ask before overwriting and are written atomically.
  - DevTools are disabled in release builds and shortcuts no longer register system-wide.
  - Closing the window from the recovery screen now runs the same wipe as leaving it, the unlock hand-off is deleted as soon as it is read, and the session-expiry wipe on the answers page now clears everything it should.
  - New vaults keep the red herring out of the hidden-order group, so the order adds the full 720 combinations.
  - 24 unused npm packages (with 9 known advisories) are no longer bundled into the app, along with unused legacy crypto files.
- Inline script is no longer allowed anywhere: every page's Content-Security-Policy drops `'unsafe-inline'` for scripts, inline `<script>` blocks moved into files, and buttons are wired through `js/actions.js` (which only calls an allowlist of functions) instead of `onclick` attributes. Even if some markup were ever injected, it could not run script. Together with the text-only rendering above, this resolves the DOM injection report in issue #4.

### Fixed
- Large vaults work with the in-memory storage. Data passes between pages in 16 MB pieces (one in-memory write is limited to roughly 128 MB), big vault parts stay out of the capped in-memory Blob storage, verification checks one file at a time, and every storage failure is reported instead of leaving Unlock or an upload waiting forever. Encrypted ZIP entries are now stored uncompressed, which makes saving large vaults much faster. Limits: 1.5 GB per file and 1.9 GB per vault, tested end to end with a 1 GB vault from 1.0.8.
- A red herring could be placed on one of the chosen unlock questions (only questions 1 and 2 were checked), which made the vault very hard to recover.
- The entropy meter counted the red herring's decoy answer toward vault strength even though that answer is blanked before key derivation.
- The final message was decrypted but never displayed on the recovery screen.

### Compatibility
- The vault format is unchanged. Vaults built or edited by 1.1.0 open in 1.0.8, and 1.0.8 vaults open and can be edited in 1.1.0.
- macOS builds need macOS 13 (Ventura) or later (Electron 44 requirement).

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

