/* js/actions.js: wires buttons and inputs declared in the HTML (classic script).
 *
 * Pages declare behaviour with data attributes instead of inline onclick="..." handlers, so the
 * Content-Security-Policy can forbid inline script entirely:
 *   data-action="name"      call window[name] (only names on the allowlist below)
 *   data-arg="value"        pass one string argument (data-arg-type="number" passes a number)
 *   data-pass-event         pass the DOM event first
 *   data-on="change|input"  event to listen for (default: click)
 *   data-href="page.html"   navigate within the app
 *   data-hide="elementId"   hide that element
 */
(function () {
  'use strict';

  // Functions pages may trigger from markup. Anything else is ignored, so even injected markup
  // could not reach other globals through a data-action attribute.
  const ALLOWED = new Set([
    // index
    'showSafetyModal', 'handleThemeClick', 'acceptSafety',
    // dashboard
    'handleVaultZip', 'promptOfflineWarning', 'openPaperDecrypt', 'goToHowItWorks', 'submitUnlock', 'cancelUnlock',
    'proceedAfterOfflineWarning', 'cancelOfflineWarning', 'closeMessageModal', 'confirmNo', 'confirmYes',
    'submitRename', 'cancelRename', 'startKeyCam', 'stopKeyCam', 'scanFromVideoOnce', 'closePaperDecrypt',
    'rebuildLiteFromPaper', 'toggleMenu', 'renameVault', 'deleteVault', 'openUnlockModal',
    // build-vault
    'preserveAndGoBack', 'retryDownload', 'closePostBuildModal',
    // recover
    'submitRecovery', 'donatePreferredCrypto', 'closePreview', 'closeRedHerringModal',
    // create-vault / setup-questions / answer-questions
    'updateQuestionCount', 'goBack', 'startVaultSetup', 'showDisclaimer', 'saveModalEdit', 'closeModal',
    'proceedToAnswers', 'openModal', 'limitSelection', 'saveNamedSeed', 'submitAnswers', 'startSecurityTimer',
    'buildLetterSelectors', 'saveCustomHint', 'closeHintModal',
  ]);

  function handle(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-action],[data-href],[data-hide]') : null;
    if (!el || (el.dataset.on || 'click') !== e.type) return;

    if (el.dataset.href) {
      if (/^[\w.-]+\.html$/.test(el.dataset.href)) window.location.href = el.dataset.href;
      return;
    }
    if (el.dataset.hide) {
      const target = document.getElementById(el.dataset.hide);
      if (target) target.style.display = 'none';
      return;
    }
    const name = el.dataset.action;
    const fn = ALLOWED.has(name) ? window[name] : null;
    if (typeof fn !== 'function') { console.warn('Memoro Vault: no handler for', name); return; }
    const args = [];
    if ('passEvent' in el.dataset) args.push(e);
    if ('arg' in el.dataset) args.push(el.dataset.argType === 'number' ? Number(el.dataset.arg) : el.dataset.arg);
    fn.apply(el, args);
  }

  for (const type of ['click', 'change', 'input']) document.addEventListener(type, handle);
})();
