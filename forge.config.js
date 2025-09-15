// forge.config.js
const path = require('path');
const fs = require('fs');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

const ENABLE_FUSES = process.env.FORGE_ENABLE_FUSES === '1';

module.exports = {
  packagerConfig: {
    asar: true,
    extraResources: [{ from: 'binaries', to: 'binaries', filter: ['**/*'] }],
    files: [
      'main.js',
      'preload.js',
      'src/**/*',
      'package.json',
      'src/LICENSE.txt',
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: { name: 'memoro', setupExe: 'memoro-win.exe', outputDirectory: 'binaries' },
    },
    { name: '@electron-forge/maker-zip', platforms: ['darwin'], config: { outputDirectory: 'binaries' } },
    { name: '@electron-forge/maker-deb', config: { outputDirectory: 'binaries' } },
    { name: '@electron-forge/maker-rpm', config: { outputDirectory: 'binaries' } },
    ...(fs.existsSync('node_modules/@electron-forge/maker-appimage')
      ? [{ name: '@electron-forge/maker-appimage', config: { outputDirectory: 'binaries' } }]
      : []),
  ],
  plugins: [
    ['@electron-forge/plugin-auto-unpack-natives', {}],
    ENABLE_FUSES && [
      '@electron-forge/plugin-fuses',
      {
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
      },
    ],
  ].filter(Boolean),
  hooks: {
    postMake: async (_forgeConfig, buildResult) => {
      const binariesDir = path.join(__dirname, 'binaries');
      if (!fs.existsSync(binariesDir)) fs.mkdirSync(binariesDir);
      for (const result of buildResult) {
        for (const artifact of result.artifacts) {
          const fileName = path.basename(artifact);
          const destPath = path.join(binariesDir, fileName);
          if (!fs.existsSync(destPath)) {
            fs.copyFileSync(artifact, destPath);
            console.log(`[copied] ${fileName} → binaries/`);
          }
        }
      }
    },
  },
};
