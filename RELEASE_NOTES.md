Memoro Vault v1.0.8 — QR Paper Backup

Summary
-------
This release focuses on the physical backup workflow: producing a compact, scan-friendly QR PDF that contains an encrypted Lite ZIP of selected items (seeds, selected uploads, and optional final message).

Paper Backup (Lite ZIP → QR PDF)
--------------------------------
- Single-file QR PDF with three payload classes:
  - MVKEY: single-share file key (hex).
  - MVHDR: header block (version, IV, size, SHA-256 of plaintext Lite ZIP).
  - MVCT: ciphertext tiles (base64 chunks, 1200 characters per tile).
- Layout:
  - Three tiles per row, centered grid, ~300 DPI rendering with a 4-module quiet zone.
  - Per-page banner including build timestamp, version, ZIP byte size, and SHA-256 checksum.
  - EC(Q) for KEY/HEADER; EC(M) for CT tiles to balance density and reliability.
- Lite selection modal:
  - Choose seed files, specific uploads, and whether to include the final message.
  - Enforces a ~150 KiB raw cap to keep QR count manageable for scanning reliability.
- Encryption:
  - Lite ZIP encrypted with AES-GCM using a random 32-byte key and IV.
  - Plaintext SHA-256 included in MVHDR for integrity verification when reconstructing from QR.

Quality and Guidance
--------------------
- Improved scannability and consistency through centered layout and quiet zones.
- Clear post-build modal with optional paper backup step.
- Recommended practice: store both the full vault ZIP and the QR PDF redundantly (e.g., M-DISC, offline SSD, and cloud).

Known Limitation
----------------
- This release retains Math.random() for Layer 2 index selection and permutation choice. This is acceptable for v1.0.8 as published but will be reviewed in a future version for stronger unpredictability guarantees.

Notes
-----
- The QR paper backup is a supplemental, physical safeguard.
- Do not modify filenames or contents inside the vault ZIP; doing so will break recovery.
