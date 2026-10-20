Memoro Vault v1.1.0: Vault Editor and In-App Viewer
=====================================================

Summary
-------
Open a vault, change what is inside and save it again without rebuilding it from scratch. This release also adds a viewer for images, PDFs, text, audio and video, and a round of entropy and security hardening.

Vault editor
------------
- After recovery, choose Open Vault Editor to add, rename and remove files, add or edit seed phrases (hidden until you press Show) and rewrite the final message. Files can be dropped straight onto the editor.
- Saving lists your changes, seals a new vault with the same questions and answers, re-opens it and verifies every file, then asks where to save it. Edits count as saved only once the file is written.
- Every save uses fresh salts, IVs, file IDs and a new hidden answer order, so no salt, key or ciphertext is reused between versions.
- A new QR paper backup can be made as part of the save.
- Older copies still open with the same answers and keep their old contents, so replace every stored copy after saving.

Viewer
------
- Images, PDFs, text, audio and video open inside the app, straight from memory, with zoom for images and PDFs.

Security and entropy
--------------------
- All vault randomness now comes from crypto.getRandomValues with unbiased sampling (replacing Math.random for question selection, hidden order and multiple-choice order).
- Every recovered file is verified against its SHA-256; new vaults are fully re-opened and checked before download.
- The recovery screen no longer shows answers or a hash of them.
- App storage is kept in memory only, so nothing sensitive is written to the browser profile on disk. Leftover storage from older versions is overwritten and deleted on first launch.
- Electron upgraded from 25.3.1 to 44.9.2, with hardened fuses on release builds.
- Names and questions from vault files are always rendered as text.

Fixes
-----
- A red herring could be set on a chosen unlock question; this is now blocked.
- The entropy meter no longer counts the red herring's decoy answer.
- The final message now appears on the recovery screen.

Compatibility
-------------
- Same vault format as 1.0.8, in both directions.
- macOS builds require macOS 13 or later.
