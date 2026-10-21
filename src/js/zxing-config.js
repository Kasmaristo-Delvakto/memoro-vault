/* js/zxing-config.js: keep the ZXing barcode polyfill on local files only (classic script).
 * Moved out of an inline <script> so the Content-Security-Policy can forbid inline script. */
if (window.setZXingModuleOverrides) {
  window.setZXingModuleOverrides({
    locateFile: (filename /* e.g. zxing_reader.wasm */) => `./libs/reader/${filename}`
  });
}
if (window.prepareZXingModule) {
  window.prepareZXingModule({ overrides: { locateFile: f => `./libs/reader/${f}` } });
}
