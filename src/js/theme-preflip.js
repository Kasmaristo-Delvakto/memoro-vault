/* js/theme-preflip.js: switch to the saved theme's stylesheet before the page paints (classic
 * script, loaded right after the two theme <link>s). Replaces per-page inline scripts. */
(function () {
  'use strict';
  let saved = 'cypherpunk';
  try { saved = sessionStorage.getItem('theme') ?? localStorage.getItem('theme') ?? 'cypherpunk'; } catch (_) {}
  const isCypher = saved === 'cypherpunk';
  const cy = document.getElementById('theme-cypherpunk');
  const cl = document.getElementById('theme-clean');
  if (cy) cy.disabled = !isCypher;
  if (cl) cl.disabled = isCypher;
})();
