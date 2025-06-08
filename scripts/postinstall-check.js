const fs = require("fs");

const mustExist = [
  "src/assets/memoro-vault.ico",
  "src/LICENSE.txt",
  "binaries"
];

for (const path of mustExist) {
  if (!fs.existsSync(path)) {
    console.warn(`⚠ WARNING: Missing expected file or folder: ${path}`);
  }
}