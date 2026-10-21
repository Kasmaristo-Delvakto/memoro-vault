/* js/idb-chunks.js: large byte arrays in IndexedDB, stored as 16 MB pieces (classic script).
 *
 * The app keeps its storage in memory, where Chromium refuses any single IndexedDB write larger
 * than roughly 128 MB (the transaction aborts). Vault files and uploads can be far bigger, so they
 * are written as separate small records, one transaction each, and every abort is reported as an
 * error instead of leaving the caller waiting forever.
 */
(function (root) {
  'use strict';

  const CHUNK = 16 * 1024 * 1024;

  /** Resolves when the transaction commits; rejects on abort (quota, size limit, anything). */
  function done(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('Saving to memory was interrupted.'));
    });
  }

  function chunkKey(base, i) {
    return `${base}#chunk${i}`;
  }

  /** Writes bytes as pieces under keys "<base>#chunk<i>"; returns { chunks, size } to store with the caller's record. */
  async function putBytes(db, storeName, keyPath, base, bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const chunks = Math.ceil(u8.length / CHUNK);
    for (let i = 0; i < chunks; i++) {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put({ [keyPath]: chunkKey(base, i), chunk: u8.slice(i * CHUNK, (i + 1) * CHUNK).buffer });
      await done(tx);
    }
    return { chunks, size: u8.length };
  }

  /** Reads the pieces written by putBytes back into one Uint8Array. */
  async function getBytes(db, storeName, base, info) {
    const out = new Uint8Array(info.size);
    for (let i = 0; i < info.chunks; i++) {
      const rec = await new Promise((resolve, reject) => {
        const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(chunkKey(base, i));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Could not read from memory.'));
      });
      if (!rec || !rec.chunk) throw new Error('Part of the stored data is missing.');
      out.set(new Uint8Array(rec.chunk), i * CHUNK);
    }
    return out;
  }

  /** Deletes the pieces written by putBytes (best effort, never throws). */
  async function deleteBytes(db, storeName, base, info) {
    if (!info || !info.chunks) return;
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (let i = 0; i < info.chunks; i++) store.delete(chunkKey(base, i));
      await done(tx);
    } catch (_) { /* nothing left to clean */ }
  }

  /** Puts one small record and waits for the commit (or rejects on abort). */
  async function putRecord(db, storeName, record) {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(record);
    await done(tx);
  }

  root.MemoroChunks = Object.freeze({ CHUNK, done, putBytes, getBytes, deleteBytes, putRecord });
})(typeof window !== 'undefined' ? window : globalThis);
