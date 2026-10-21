/* js/paper-backup.js: Lite vault ZIP → single-file QR PDF (classic script).
 * Shared by the vault builder and the vault editor. Needs vault-core.js, jspdf and qrcode.
 *
 * 3-per-row, centered grid • max tile size
 * Clean banner • ~300 DPI QRs • Quiet zone • EC(Q) for KEY/HEADER
 * Tags: MVKEY|, MVHDR|, MVCT|
 */
(function () {
  'use strict';

  function bytesToBase64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }
  function chunkString(str, maxLen) {
    const out = [];
    for (let i = 0; i < str.length; i += maxLen) out.push(str.slice(i, i + maxLen));
    return out;
  }

  /**
   * Render a QR payload to a canvas sized for sharp printing.
   * - targetPt: side length in PDF points (72pt = 1 inch)
   * - ecLevel: "M" (default) or "Q"
   * - Adds a 4-module quiet zone around the code
   */
  async function qrcodeToCanvas(text, targetPt, ecLevel = 'M') {
    const TARGET_DPI = 300;
    const desiredPx = Math.max(256, Math.ceil(targetPt * (TARGET_DPI / 72)));

    // Case A: node-qrcode UMD
    if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
      const canvas = document.createElement('canvas');
      await window.QRCode.toCanvas(canvas, text, { errorCorrectionLevel: ecLevel, margin: 4, width: desiredPx });
      return canvas;
    }

    // Case B: qrcode-generator
    if (typeof window.qrcode === 'function') {
      const qr = window.qrcode(0, ecLevel);
      qr.addData(text);
      qr.make();

      const count = qr.getModuleCount();
      const pxPerModule = Math.max(4, Math.floor(desiredPx / count));
      const marginPx = 4 * pxPerModule; // quiet-zone in modules
      const size = count * pxPerModule + marginPx * 2;

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#000';
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.isDark(r, c)) ctx.fillRect(marginPx + c * pxPerModule, marginPx + r * pxPerModule, pxPerModule, pxPerModule);
        }
      }
      return canvas;
    }

    throw new Error('QR library not loaded (expected window.QRCode or window.qrcode).');
  }

  /**
   * Encrypts the Lite ZIP under a fresh random key and saves a printable QR PDF.
   * Pass `save(bytes, fileName)` to control saving (it should resolve to { fileName } once written,
   * or null when the person declines); without it the PDF is offered as a normal download.
   */
  async function buildPaperPdfFromLiteZip(liteZip, { fileName = 'memoro-lite-QR.pdf', save = null } = {}) {
    const MV = window.MemoroVaultCore;
    const liteBytes = liteZip instanceof Uint8Array ? liteZip : new Uint8Array(await liteZip.arrayBuffer());

    // 1) Random 32-byte file key + 2) encrypt the Lite ZIP (Rust AES-GCM)
    const keyBytes = MV.randomBytes(32);
    const ivBytes = MV.randomBytes(12);
    const ct = MV.toU8(await window.aesEncryptRust(keyBytes, ivBytes, liteBytes));

    // 3) Header: version + iv + size + SHA-256(plaintext)
    const shaHex = await MV.sha256Hex(liteBytes);
    const header = { v: 'mv-lite-v1', iv: Array.from(ivBytes), size: liteBytes.length, sha256: shaHex };
    const headerB64 = btoa(unescape(encodeURIComponent(JSON.stringify(header))));

    // 4) Recovery key (single share)
    const keyHex = MV.bytesToHex(keyBytes);

    // 5) Ciphertext into QR tiles
    const ctChunks = chunkString(bytesToBase64(ct), 324); // payload per tile (scanner-friendly)
    const total = ctChunks.length;

    const KEY_TAG = `MVKEY|${keyHex}`;
    const HEADER_TAG = `MVHDR|${headerB64}`;
    const CT_PREFIX = 'MVCT|';

    // 6) PDF layout (letter: 612×792pt)
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    const MARGIN = 24;    // page side/top/bottom margins
    const GAP = 12;       // gap between tiles
    const LABEL_PAD = 14; // space above each tile for label
    const BANNER_H = 72;  // banner block height

    const innerW = pageW - 2 * MARGIN;
    const cols = 3;
    const tile = Math.floor((innerW - GAP * (cols - 1)) / cols);
    const startX = MARGIN + Math.floor((innerW - (cols * tile + (cols - 1) * GAP)) / 2);

    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    function drawBanner(pageNum) {
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(11);
      pdf.text('Memoro Vault - Paper Backup', MARGIN, MARGIN + 12);
      pdf.setFontSize(10);
      pdf.text(`Built: ${stamp} | Version: ${MV.APP_VERSION} | Format: mv-lite-v1 | ZIP bytes: ${liteBytes.length}`, MARGIN, MARGIN + 28);
      pdf.text(`SHA-256 (ZIP): ${shaHex}`, MARGIN, MARGIN + 44);
      const pageLine = `Page ${pageNum} | Scan KEY and HEADER on page 1, then all CT tiles`;
      pdf.text(pageLine, pageW - MARGIN - pdf.getTextWidth(pageLine), MARGIN + 12);
    }

    async function drawTile(x, y, payload, label, ecLevel = 'M') {
      pdf.setFont('courier', 'bold');
      pdf.setFontSize(9);
      pdf.text(label, x + 2, y - 4); // just above the tile
      pdf.setFont('courier', 'normal');
      const canvas = await qrcodeToCanvas(payload, tile, ecLevel);
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, tile, tile);
    }

    // 7) Page rendering (3 columns)
    let ctIdx = 0;
    let pageNum = 1;
    drawBanner(pageNum);

    let x = startX;
    let y = MARGIN + BANNER_H + LABEL_PAD;
    const rowH = LABEL_PAD + tile;

    // First row: KEY | HEADER | CT 1 (if any)
    await drawTile(x, y, KEY_TAG, 'KEY', 'Q'); x += tile + GAP;
    await drawTile(x, y, HEADER_TAG, 'HEADER', 'Q'); x += tile + GAP;
    if (ctIdx < total) {
      await drawTile(x, y, `${CT_PREFIX}${ctIdx + 1}/${total}|${ctChunks[ctIdx]}`, `CT ${ctIdx + 1}/${total}`, 'M');
      ctIdx++;
    }

    x = startX; y += rowH + GAP;
    while (ctIdx < total) {
      if (y + tile + MARGIN > pageH) { // new page if next row won't fit
        pdf.addPage(); pageNum++;
        drawBanner(pageNum);
        x = startX; y = MARGIN + BANNER_H + LABEL_PAD;
      }
      for (let c = 0; c < cols && ctIdx < total; c++) {
        await drawTile(x, y, `${CT_PREFIX}${ctIdx + 1}/${total}|${ctChunks[ctIdx]}`, `CT ${ctIdx + 1}/${total}`, 'M');
        ctIdx++;
        x += tile + GAP;
      }
      x = startX; y += rowH + GAP;
    }

    MV.zeroize(keyBytes);
    const result = { tiles: total, pages: pageNum, sha256: shaHex, saved: true, fileName };
    if (typeof save === 'function') {
      const written = await save(new Uint8Array(pdf.output('arraybuffer')), fileName);
      result.saved = !!written;
      if (written && written.fileName) result.fileName = written.fileName;
    } else {
      pdf.save(fileName);
    }
    return result;
  }

  window.MemoroPaperBackup = Object.freeze({ buildPaperPdfFromLiteZip, qrcodeToCanvas });
  window.buildPaperPdfFromLiteZip = buildPaperPdfFromLiteZip; // kept for older callers
})();
