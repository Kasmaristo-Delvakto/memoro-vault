// Build a pool of 500 obscure, high-entropy characters from various Unicode blocks
function buildObscureCharset() {
  const ranges = [
    [0x3400, 0x4DBF],    // CJK Extension A
    [0x4E00, 0x9FFF],    // CJK Unified
    [0x2200, 0x22FF],    // Math symbols
    [0x2300, 0x23FF],    // Misc symbols
    [0x25A0, 0x25FF],    // Geometric shapes
    [0x1F0A0, 0x1F0FF],  // Playing cards
    [0x1F300, 0x1F5FF],  // Misc emoji
    [0x1F700, 0x1F77F],  // Alchemical symbols
    [0x1F780, 0x1F7FF],  // Geometric extensions
  ];

  const charset = [];

  for (const [start, end] of ranges) {
    for (let code = start; code <= end; code++) {
      try {
        const char = String.fromCodePoint(code);
        if (/[\u0000-\u007F]/.test(char)) continue; // skip ASCII
        charset.push(char);
        if (charset.length >= 500) return charset;
      } catch (e) { /* skip invalid chars */ }
    }
  }

  return charset;
}

const OBSCURE_CHARSET = buildObscureCharset();

// Generates a padding array using the obscure charset and a seed
function generateObscurePadding(count, seed) {
  const rand = seedrandom(seed);
  return Array.from({ length: count }, () =>
    OBSCURE_CHARSET[Math.floor(rand() * OBSCURE_CHARSET.length)]
  );
}

// Picks n unique, sorted indices from [0, l) using the seed
function chooseRealIndices(n, l, seed) {
  const rand = seedrandom(seed);
  const indices = new Set();
  while (indices.size < n) {
    indices.add(Math.floor(rand() * l));
  }
  return Array.from(indices).sort((a, b) => a - b);
}

// Collects mouse movement entropy, returns as a string when 200+ chars collected
function collectMouseEntropy(callback) {
  let entropy = "";
  function onMove(e) {
    entropy += `${e.clientX}${e.clientY}`;
    if (entropy.length > 200) {
      window.removeEventListener("mousemove", onMove);
      callback(entropy); // Return collected entropy
    }
  }
  window.addEventListener("mousemove", onMove);
}

// Attach globally for browser use
window.vaultEntropyUtils = {
  generateObscurePadding,
  chooseRealIndices,
  collectMouseEntropy
};
