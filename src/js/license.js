// Expecting preload to expose window.mvLicense = { accept, decline } (optional).
// This file keeps everything local (fetches from the same folder).

async function loadLicense() {
  const out = document.getElementById("licenseText");

  // Try LICENSE, then LICENSE.txt (next to license.html)
  async function tryFetch(path) {
    try {
      const r = await fetch(path, { cache: "no-store" });
      if (r.ok) return await r.text();
    } catch (_) {}
    return null;
  }

  let text = await tryFetch("./LICENSE");
  if (!text) text = await tryFetch("./LICENSE.txt");

  out.textContent = text || "LICENSE file not found. Place LICENSE or LICENSE.txt next to license.html.";
}

function wireButtons() {
  const acceptBtn = document.getElementById("acceptBtn");
  const declineBtn = document.getElementById("declineBtn");

  acceptBtn.addEventListener("click", async () => {
    try { if (window.mvLicense?.accept) await window.mvLicense.accept(); } catch {}
    window.close();
  });

  declineBtn.addEventListener("click", async () => {
    try { if (window.mvLicense?.decline) await window.mvLicense.decline(); } catch {}
    window.close();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadLicense();
  wireButtons();
});
