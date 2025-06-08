const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '../dist');

function findInstallerExe() {
  const files = fs.readdirSync(DIST_DIR);
  const installer = files.find(f => f.endsWith('.exe') && f.includes('Setup'));
  if (!installer) throw new Error("No setup .exe file found in /dist");
  return installer;
}

function generateSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

(async () => {
  try {
    const installerName = findInstallerExe();
    const installerPath = path.join(DIST_DIR, installerName);
    const hash = await generateSha256(installerPath);
    const outputPath = path.join(DIST_DIR, `${installerName}.sha256.txt`);
    const line = `SHA256 (${installerName}) = ${hash}`;
    fs.writeFileSync(outputPath, line + '\n');
    console.log(`[✓] Checksum for ${installerName} saved to ${outputPath}`);
  } catch (err) {
    console.error(`[✗] Failed to generate installer checksum:`, err);
    process.exit(1);
  }
})();
