const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Read version from package.json
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const version = pkg.version;
const baseDist = path.join(__dirname, '..', 'dist');
const distDir = path.join(baseDist, version);

// Run electron-builder
console.log(`🛠 Building Memoro Vault v${version}...`);
execSync('electron-builder', { stdio: 'inherit' });

// Create versioned output folder
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Move only top-level build files (not directories)
const filesToMove = fs.readdirSync(baseDist).filter(file => {
  const fullPath = path.join(baseDist, file);
  return fs.statSync(fullPath).isFile();
});

// Move files into versioned folder
filesToMove.forEach(file => {
  const oldPath = path.join(baseDist, file);
  const newPath = path.join(distDir, file);
  fs.renameSync(oldPath, newPath);
});

// Generate SHA-256 checksums
const output = [];
filesToMove.forEach(file => {
  const filePath = path.join(distDir, file);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  output.push(`${hash}  ${file}`);
});

// Save checksums
const checksumPath = path.join(distDir, 'checksum.txt');
fs.writeFileSync(checksumPath, output.join('\n') + '\n');
console.log(`✅ Checksums written to: ${checksumPath}`);
console.log(`✅ Build complete. Files saved to: dist/${version}`);