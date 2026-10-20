/* js/file-viewer.js: in-app viewer for decrypted vault files (ES module).
 *
 * Everything stays in memory: files are shown from blob: URLs that are revoked as soon as the
 * viewer closes. Nothing is ever rendered as HTML. Images go through <img> (SVG scripts never run
 * there), PDFs are drawn onto canvases by the bundled pdf.js with eval disabled, text goes into
 * textContent, audio/video use the native players.
 */

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|ya?ml|log|ini|cfg|conf|toml|asc|pem|pub|eml|tex|js|ts|py|rb|go|rs|java|c|h|cpp|sh|bat|ps1|sql|html?|css|svg)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i;
const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|mov)$/i;
const MAX_TEXT_PREVIEW = 2 * 1024 * 1024;

/** Detects image/PDF types from the first bytes, so a missing or wrong MIME type still previews. */
export function sniffMime(bytes) {
  const b = bytes || new Uint8Array(0);
  const starts = (...sig) => sig.every((v, i) => b[i] === v);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (starts(0x42, 0x4d)) return 'image/bmp';
  if (starts(0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
  return '';
}

/** 'image' | 'pdf' | 'text' | 'audio' | 'video' | 'other' */
export function fileKind(name, mime, bytes) {
  const n = String(name || '');
  const m = String(mime || '').toLowerCase();
  const sniffed = sniffMime(bytes);
  if (sniffed === 'application/pdf' || m === 'application/pdf' || /\.pdf$/i.test(n)) return 'pdf';
  if (sniffed.startsWith('image/') || /\.svg$/i.test(n) || m === 'image/svg+xml') return 'image';
  if (m.startsWith('image/') || IMAGE_EXT.test(n)) return 'image';
  if (m.startsWith('audio/') || AUDIO_EXT.test(n)) return 'audio';
  if (m.startsWith('video/') || VIDEO_EXT.test(n)) return 'video';
  if (m.startsWith('text/') || /json|xml|csv|yaml|javascript/.test(m) || TEXT_EXT.test(n)) return 'text';
  return 'other';
}

/** MIME type to use for a display blob (never text/html, so nothing can render as a page). */
function displayMime(kind, name, mime, bytes) {
  const sniffed = sniffMime(bytes);
  if (kind === 'image') {
    if (/\.svg$/i.test(name) || mime === 'image/svg+xml') return 'image/svg+xml';
    return sniffed || (String(mime).startsWith('image/') ? mime : 'image/png');
  }
  if (kind === 'audio' || kind === 'video') return String(mime || '') || (kind === 'audio' ? 'audio/mpeg' : 'video/mp4');
  return 'application/octet-stream';
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Small DOM builder: text only, never innerHTML. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Saves bytes through the normal download dialog. */
export function downloadBytes(bytes, name, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
  const a = h('a', { href: url, download: name || 'file.bin' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------------------------------------------------------------------------
// Viewer state (one viewer at a time)
// ---------------------------------------------------------------------------
let current = null; // { root, urls:Set, pdf, observer, onKey }

function ensurePdfJs() {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error('PDF viewer library is not loaded.');
  if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
  return lib;
}

export function closeViewer() {
  if (!current) return;
  const c = current;
  current = null;
  try { c.observer?.disconnect(); } catch (_) {}
  try { c.pdf?.destroy(); } catch (_) {}
  for (const u of c.urls) URL.revokeObjectURL(u);
  document.removeEventListener('keydown', c.onKey, true);
  // Media elements keep decoded data alive until their source is cleared
  c.root.querySelectorAll('audio,video,img').forEach(m => { try { m.removeAttribute('src'); m.load?.(); } catch (_) {} });
  c.root.querySelectorAll('canvas').forEach(cv => { cv.width = 0; cv.height = 0; });
  c.root.remove();
  if (typeof c.onClose === 'function') c.onClose();
}

/**
 * @param {object} file  { name, mime, bytes:Uint8Array }
 * @param {object} [opts]
 * @param {function} [opts.onSaveBytes] (newBytes) => void; enables editing for plain UTF-8 text files
 * @param {function} [opts.onClose]
 */
export async function openViewer(file, opts = {}) {
  closeViewer();
  const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes || []);
  const name = String(file.name || 'file');
  const kind = fileKind(name, file.mime, bytes);
  const urls = new Set();
  const blobUrl = (type) => { const u = URL.createObjectURL(new Blob([bytes], { type })); urls.add(u); return u; };

  const title = h('div', { class: 'mv-viewer-title' },
    h('span', { class: 'mv-viewer-name', text: name }),
    h('span', { class: 'mv-viewer-meta', text: `${kindLabel(kind)} · ${formatBytes(bytes.length)}` }));
  const tools = h('div', { class: 'mv-viewer-tools' });
  const body = h('div', { class: `mv-viewer-body mv-kind-${kind}`, tabindex: '0' });
  const closeBtn = h('button', { class: 'mv-btn', type: 'button', text: 'Close', onclick: () => closeViewer() });
  let liveBytes = bytes; // replaced when text is edited in place
  const dlBtn = h('button', { class: 'mv-btn', type: 'button', text: 'Download', onclick: () => downloadBytes(liveBytes, name, file.mime) });
  const root = h('div', { class: 'mv-viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Viewing ${name}` },
    h('div', { class: 'mv-viewer-panel' },
      h('div', { class: 'mv-viewer-head' }, title, h('div', { class: 'mv-viewer-actions' }, tools, dlBtn, closeBtn)),
      body));

  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeViewer(); } };
  document.addEventListener('keydown', onKey, true);
  current = { root, urls, pdf: null, observer: null, onKey, onClose: opts.onClose };
  document.body.appendChild(root);

  try {
    if (kind === 'image') renderImage(body, tools, blobUrl(displayMime(kind, name, file.mime, bytes)), name);
    else if (kind === 'pdf') await renderPdf(body, tools, bytes);
    else if (kind === 'text') {
      renderText(body, tools, bytes, opts.onSaveBytes && ((b) => {
        liveBytes = b;
        opts.onSaveBytes(b);
      }));
    }
    else if (kind === 'audio') body.appendChild(h('audio', { controls: true, src: blobUrl(displayMime(kind, name, file.mime, bytes)), class: 'mv-media' }));
    else if (kind === 'video') body.appendChild(h('video', { controls: true, src: blobUrl(displayMime(kind, name, file.mime, bytes)), class: 'mv-media' }));
    else {
      body.appendChild(h('div', { class: 'mv-viewer-empty' },
        h('p', { text: 'Memoro Vault cannot display this file type. You can still download it.' })));
    }
  } catch (err) {
    console.error('viewer:', err);
    body.replaceChildren(h('div', { class: 'mv-viewer-empty' },
      h('p', { text: `This file could not be displayed (${err.message || err}). You can still download it.` })));
  }
  body.focus();
  return kind;
}

function kindLabel(kind) {
  return { image: 'Image', pdf: 'PDF', text: 'Text', audio: 'Audio', video: 'Video', other: 'File' }[kind] || 'File';
}

function renderImage(body, tools, url, name) {
  let zoom = 0; // 0 = fit to window
  const img = h('img', { src: url, alt: name, class: 'mv-image mv-fit', draggable: 'false' });
  const label = h('span', { class: 'mv-zoom-label', text: '' });
  const apply = () => {
    img.classList.toggle('mv-fit', zoom === 0);
    img.style.width = zoom === 0 ? '' : `${Math.round(img.naturalWidth * zoom)}px`;
    const shown = zoom === 0 ? img.clientWidth / (img.naturalWidth || 1) : zoom;
    label.textContent = `${Math.round(shown * 100)}%${zoom === 0 ? ' (fit)' : ''}`;
  };
  img.addEventListener('load', apply);
  const step = (dir) => {
    const base = zoom === 0 ? Math.min(1, (body.clientWidth - 24) / (img.naturalWidth || 1)) : zoom;
    zoom = Math.min(8, Math.max(0.1, base * (dir > 0 ? 1.25 : 0.8)));
    apply();
  };
  tools.append(
    h('button', { class: 'mv-btn mv-btn-sm', type: 'button', text: '−', title: 'Zoom out', onclick: () => step(-1) }),
    label,
    h('button', { class: 'mv-btn mv-btn-sm', type: 'button', text: '+', title: 'Zoom in', onclick: () => step(1) }),
    h('button', { class: 'mv-btn mv-btn-sm', type: 'button', text: 'Fit', title: 'Fit to window', onclick: () => { zoom = 0; apply(); } }),
    h('button', { class: 'mv-btn mv-btn-sm', type: 'button', text: '100%', onclick: () => { zoom = 1; apply(); } }));
  img.addEventListener('error', () => {
    body.replaceChildren(h('div', { class: 'mv-viewer-empty' }, h('p', { text: 'This image could not be decoded. You can still download it.' })));
  });
  body.appendChild(img);
}

async function renderPdf(body, tools, bytes) {
  const lib = ensurePdfJs();
  // pdf.js transfers the buffer to its worker, so hand it a copy
  const task = lib.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
    // Standard PDF fonts (Times, Helvetica...) are not embedded in most files; pdf.js draws them
    // with installed system fonts since the app ships no font data of its own.
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  if (!current) { pdf.destroy(); return; }
  current.pdf = pdf;

  let scale = 1.25;
  const pages = h('div', { class: 'mv-pdf-pages' });
  const label = h('span', { class: 'mv-zoom-label', text: `${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'} · 125%` });
  body.appendChild(pages);

  const first = await pdf.getPage(1);
  const base = first.getViewport({ scale: 1 });
  const slots = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const slot = h('div', { class: 'mv-pdf-page', 'data-page': String(i) }, h('span', { class: 'mv-pdf-num', text: `Page ${i}` }));
    pages.appendChild(slot);
    slots.push(slot);
  }

  const rendered = new Map(); // page -> scale it was drawn at
  async function draw(slot) {
    const n = Number(slot.dataset.page);
    if (rendered.get(n) === scale || !current || current.pdf !== pdf) return;
    rendered.set(n, scale);
    const page = await pdf.getPage(n);
    const ratio = window.devicePixelRatio || 1;
    const vp = page.getViewport({ scale: scale * ratio });
    const canvas = h('canvas', { class: 'mv-pdf-canvas' });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = `${Math.floor(vp.width / ratio)}px`;
    canvas.style.height = `${Math.floor(vp.height / ratio)}px`;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    const old = slot.querySelector('canvas');
    if (old) { old.width = 0; old.height = 0; old.remove(); }
    slot.appendChild(canvas);
  }
  function sizeSlots() {
    for (const s of slots) {
      s.style.width = `${Math.floor(base.width * scale)}px`;
      s.style.minHeight = `${Math.floor(base.height * scale)}px`;
    }
  }
  sizeSlots();

  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) draw(e.target).catch(err => console.warn('pdf page:', err));
  }, { root: body, rootMargin: '600px 0px' });
  slots.forEach(s => observer.observe(s));
  current.observer = observer;

  const rezoom = (factor) => {
    scale = Math.min(4, Math.max(0.5, scale * factor));
    label.textContent = `${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'} · ${Math.round(scale * 100)}%`;
    sizeSlots();
    slots.forEach(s => { observer.unobserve(s); observer.observe(s); });
  };
  tools.append(
    h('button', { class: 'mv-btn mv-btn-sm', type: 'button', text: '−', title: 'Zoom out', onclick: () => rezoom(0.8) }),
    label,
    h('button', { class: 'mv-btn mv-btn-sm', type: 'button', text: '+', title: 'Zoom in', onclick: () => rezoom(1.25) }));
}

/**
 * Decodes text for display. Only exact UTF-8 (optionally with a BOM) is editable, and the BOM and
 * line endings are remembered so saving an edit changes nothing but the edited characters.
 */
function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), editable: false };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), editable: false };
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const rest = bom ? bytes.subarray(3) : bytes;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(rest);
    const eol = text.includes('\r\n') ? '\r\n' : (/\r(?!\n)/.test(text) ? '\r' : '\n');
    return { text, editable: true, bom, eol };
  } catch (_) {
    return { text: new TextDecoder().decode(rest), editable: false };
  }
}

function renderText(body, tools, bytes, onSaveBytes) {
  const truncated = bytes.length > MAX_TEXT_PREVIEW;
  const decoded = decodeText(truncated ? bytes.subarray(0, MAX_TEXT_PREVIEW) : bytes);
  let text = decoded.text;
  const pre = h('pre', { class: 'mv-text', text });
  body.appendChild(pre);
  if (truncated) body.appendChild(h('p', { class: 'mv-note', text: `Showing the first ${formatBytes(MAX_TEXT_PREVIEW)}. Download the file to see all of it.` }));

  if (typeof onSaveBytes === 'function' && !truncated && decoded.editable) {
    const editBtn = h('button', { class: 'mv-btn mv-btn-sm', type: 'button', text: 'Edit text' });
    editBtn.addEventListener('click', () => {
      const area = h('textarea', { class: 'mv-text-edit', spellcheck: 'false' });
      area.value = text; // textareas report every line break as \n
      const save = h('button', { class: 'mv-btn mv-btn-primary mv-btn-sm', type: 'button', text: 'Keep changes' });
      const cancel = h('button', { class: 'mv-btn mv-btn-sm', type: 'button', text: 'Cancel' });
      const done = () => { body.replaceChildren(pre); tools.replaceChildren(editBtn); };
      cancel.addEventListener('click', done);
      save.addEventListener('click', () => {
        const edited = area.value;
        if (edited !== text.replace(/\r\n?/g, '\n')) {
          text = decoded.eol === '\n' ? edited : edited.replace(/\n/g, decoded.eol);
          const encoded = new TextEncoder().encode(text);
          const out = new Uint8Array((decoded.bom ? 3 : 0) + encoded.length);
          if (decoded.bom) out.set([0xef, 0xbb, 0xbf]);
          out.set(encoded, decoded.bom ? 3 : 0);
          onSaveBytes(out);
          pre.textContent = text;
        }
        done();
      });
      body.replaceChildren(area);
      tools.replaceChildren(save, cancel);
      area.focus();
    });
    tools.appendChild(editBtn);
  }
}
