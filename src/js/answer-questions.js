  // Toggle Answer Questions page styles (and optional matrix)
  function applyAnswerQuestionsTheme(theme) {
    const cy = document.getElementById('theme-cypherpunk');
    const cl = document.getElementById('theme-clean');
    const isCypher = (theme === 'cypherpunk');

    // 1) Flip stylesheets
    if (cy) cy.disabled = !isCypher;
    if (cl) cl.disabled =  isCypher;

    // 2) Body attribute (CSS hooks)
    const setBodyAttr = () => {
      if (document.body) {
        document.body.setAttribute('data-theme', isCypher ? 'cypherpunk' : 'clean');
      }
    };
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', setBodyAttr, { once: true });
    } else {
      setBodyAttr();
    }

    // 3) Matrix background control (if AnswerQuestionsMatrix is defined)
    if (window.AnswerQuestionsMatrix) {
      if (isCypher) AnswerQuestionsMatrix.start();
      else AnswerQuestionsMatrix.stop();
    }
  }

  // Initialize early to avoid FOUC
  (function initAnswerQuestionsTheme(){
    const saved = sessionStorage.getItem('theme') || 'cypherpunk';
    window.__savedAnswerQuestionsTheme = saved;

    const cy = document.getElementById('theme-cypherpunk');
    const cl = document.getElementById('theme-clean');
    const isCypher = (saved === 'cypherpunk');
    if (cy) cy.disabled = !isCypher;
    if (cl) cl.disabled =  isCypher;
  })();

function openVaultDB(version = 2) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('memoroVaultDB', version);

    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('vaultFiles')) {
        db.createObjectStore('vaultFiles', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('vaultUserData')) {
        db.createObjectStore('vaultUserData', { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function handleFileStorageUpload(event) {
  const fileUpload = document.getElementById('fileUpload');
  const selectedFiles = Array.from(event.target.files);
  fileUpload.value = null; // ✅ allow re-uploading the same files

  if (selectedFiles.length === 0) return;

  const newFiles = selectedFiles.map(f => ({ file: f, id: crypto.randomUUID() }));
  const existingMeta = JSON.parse(localStorage.getItem('uploadedFileMeta') || '[]');
  const newMeta = [];
  const processedFiles = [];

  for (const { file, id } of newFiles) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      processedFiles.push({
        id,
        name: file.name,
        size: file.size,
        type: file.type,
        raw: arrayBuffer
      });
      newMeta.push({ id, name: file.name, size: file.size, type: file.type });
    } catch (err) {
      console.warn('File unreadable:', file.name, err);
    }
  }

  const combinedMeta = [...existingMeta, ...newMeta];

  openVaultDB().then(db => {
  const tx = db.transaction('vaultFiles', 'readwrite');
  const store = tx.objectStore('vaultFiles');
  for (const file of processedFiles) {
    store.put(file);
  }
  tx.oncomplete = () => {
    db.close();
    localStorage.setItem('uploadedFileMeta', JSON.stringify(combinedMeta));
    displayUploadedFiles();
  };
}).catch(async (err) => {
  if (err.name === 'NotFoundError' || err.message.includes('object store')) {
    indexedDB.deleteDatabase('memoroVaultDB'); // Clear broken DB
    showMessageModal("IndexedDB Reset", "A missing data store was detected. The vault database has been reset. Please try uploading your files again.");
  } else {
    showMessageModal("IndexedDB Error", "Unexpected error: " + err.message);
  }
});

}

function displayUploadedFiles() {
  const container = document.getElementById('uploadedFileList');
  const status = document.getElementById('fileUploadStatus');
  if (!container) return;
  container.innerHTML = '';

  const storedFiles = JSON.parse(localStorage.getItem('uploadedFileMeta') || '[]');

  storedFiles.forEach(file => {
    const entry = document.createElement('div');
    entry.classList.add('upload-entry');

    const fileLabel = document.createElement('span');
    fileLabel.classList.add('upload-label');
    fileLabel.textContent = `📄 ${file.name} (${Math.round(file.size / 1024)} KB)`;

    const removeBtn = document.createElement('button');
    removeBtn.classList.add('btn', 'btn-remove-upload');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';

    removeBtn.onclick = () => {
      const updatedMeta = storedFiles.filter(f => f.id !== file.id);
      localStorage.setItem('uploadedFileMeta', JSON.stringify(updatedMeta));

      const req = indexedDB.open('memoroVaultDB');
      req.onsuccess = function () {
        const db = req.result;
        const tx = db.transaction('vaultFiles', 'readwrite');
        const store = tx.objectStore('vaultFiles');
        store.delete(file.id);
        tx.oncomplete = () => {
          db.close();
          displayUploadedFiles(); // refresh
        };
      };
    };

    entry.appendChild(fileLabel);
    entry.appendChild(removeBtn);
    container.appendChild(entry);
  });

  // Update status label
  if (status) {
    const count = storedFiles.length;
    status.textContent = count === 0 ? 'No files uploaded' : `${count} file${count !== 1 ? 's' : ''} uploaded`;
  }
}

// Add this to your onload:
window.addEventListener('DOMContentLoaded', () => {
  const fileUpload = document.getElementById('fileUpload');
  if (fileUpload) fileUpload.addEventListener('change', handleFileStorageUpload);
  displayUploadedFiles();
});

  const savedQuestions = JSON.parse(localStorage.getItem('questions')) || [];
  let securityTimeout;
  let remainingTime = 1800; // 30 minutes in seconds
  
  function startSecurityTimer() {
  clearTimeout(securityTimeout);
  remainingTime = 1800; // Reset to 30 minutes
  updateCountdownDisplay();
  securityTimeout = setInterval(() => {
    remainingTime--;
    updateCountdownDisplay();
    if (remainingTime <= 0) {
      securelyClearSensitiveData();
      alert('Session expired for your security. Sensitive data has been cleared.');
      window.location.href = "dashboard.html";
    }
  }, 1000);
}

  function extendTimer() {
    remainingTime += 5; // Add 5 seconds for any user interaction
  }
  
  // Countdown clock display
  function updateCountdownDisplay() {
    const timerElement = document.getElementById('countdown');
    if (!timerElement) return;
    const minutes = Math.floor(remainingTime / 60);
    const seconds = remainingTime % 60;
    timerElement.textContent = `Sensitive Data Will Be Securely Erased In: ${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
  
  const defaultQuestions = [
    "What was the name of your childhood best friend?",
    "What was the street name where you grew up?",
    "What is your oldest sibling’s middle name?",
    "What was the name of your first pet?",
    "What city were you born in?",
    "What is the name of your favorite childhood teacher?",
    "What was the make of your first car?",
    "What is the middle name of one of your grandparents?",
    "What is the title of your favorite childhood book?",
    "What was the mascot of your high school?",
    "What was your favorite vacation spot as a kid?",
    "What was the name of your first boss?",
    "What was the color of your childhood bedroom walls?",
    "What was your childhood dream job?",
    "What’s the first concert you ever attended?",
    "What’s the name of your favorite stuffed animal or toy?",
    "What was the first videogame you remember playing?",
    "What was your childhood nickname?",
    "What is your mother's mother's maiden name?",
    "What is the name of the first street you lived on?",
    "What was your favorite childhood meal?",
    "What was your favorite cartoon growing up?",
    "Who was your favorite childhood hero?",
    "What is a weird family tradition you had growing up?"
  ];
  
  let activeHintIndex = null;
  let customHints = {};
  
  function loadQuestions() {
  const form = document.getElementById('answerForm');
  const numberOfQuestions = parseInt(localStorage.getItem('questionCount')) || 12;

  for (let i = 0; i < numberOfQuestions; i++) {
    const questionText = savedQuestions[i] || defaultQuestions[i];

    const block = document.createElement('div');
    block.className = 'question-block';
    block.innerHTML = `
  <div class="input-group" style="grid-column: 1 / 2;">
    <label><b>${i + 1}.</b> ${questionText}</label>
    <input type="text"
      id="answer-${i}"
      placeholder="Your answer"
      required
      oninput="forceLowercase(this); refreshHintModal(); updateEntropy(${i}); updateHintPreview(${i})"
      onpaste="handlePaste(event, ${i})"
    >
  </div>

  <!-- Hint Options -->
  <div style="display: flex; align-items: center;">
    <input type="checkbox"
      id="hint-options-${i}"
      onchange="if(this.checked) openHintModal(${i})"
    >
    <span style="line-height: 1;">Hint Options</span>
  </div>

  <!-- Red Herring -->
  <div style="display: flex; align-items: center; gap: 6px;">
    <label style="margin: 0;">
      <input type="checkbox"
        class="trap-checkbox"
        data-index="${i}"
      >
      Use as <strong class="red-herring">Red Herring</strong>
    </label>
    <span class="info-icon"
          onclick="event.stopPropagation(); document.getElementById('trapModal').style.display='flex';"
          title="What is a Red Herring?">ℹ</span>
  </div>

<!-- Recovery Preview row under Red Herring -->
<div class="recovery-preview-label-group" style="grid-column: 1 / span 2;">
  <span class="recovery-preview-label">Recovery Preview:</span>
  <span id="hint-preview-${i}" class="hint-preview-row"></span>
</div>
<span id="entropy-${i}" class="entropy-inline" style="grid-column: 3;">Entropy: 0.0 bits</span>

`;

    form.appendChild(block);
    updateEntropy(i); // Initialize entropy

    if (i === numberOfQuestions - 1) {
  attachTrapCheckboxHandlers();
}

  }
}

    function attachTrapCheckboxHandlers() {
  const checkboxes = document.querySelectorAll('.trap-checkbox');

  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const selectedIndex = parseInt(cb.dataset.index);

      // Prevent selecting a Layer 1 question as Red Herring
      if (selectedIndex < 2 && cb.checked) {
        cb.checked = false;
        showMessageModal(
          "Invalid Red Herring",
          "You cannot select one of the Layer 1 unlock questions as a red herring. Please choose a different question."
        );
        return;
      }

      if (cb.checked) {
        // Check if any other is already selected
        const alreadySelected = Array.from(checkboxes).find(other => other !== cb && other.checked);
        if (alreadySelected) {
          // ❌ Disallow second selection
          cb.checked = false;
          showMessageModal(
            "Only One Red Herring Allowed",
            "You can only select one question as the Red Herring."
          );
        }
      }
    });
  });
}

  function goBack() {
    window.history.back();
  }
  
  async function submitAnswers() {
  const answers = [];
  const normalizedAnswers = [];
  const spaceIndexesList = [];
  const seeds = [];
  const answerInputs = document.querySelectorAll('input[id^="answer-"]');
  const seedInputs = document.querySelectorAll('input[id^="seed-"]');
  const finalMessage = document.getElementById('finalMessage').value.trim();
  let trapIndex = -1;

  document.querySelectorAll('.trap-checkbox').forEach(cb => {
    if (cb.checked) trapIndex = parseInt(cb.dataset.index);
  });

  answerInputs.forEach(input => {
    const raw = input.value.trim();
    answers.push(raw);
    normalizedAnswers.push(raw.toLowerCase());

    const spaceIndexes = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === ' ') spaceIndexes.push(i);
    }
    spaceIndexesList.push(spaceIndexes);
  });

  seedInputs.forEach(input => seeds.push(input.value.trim()));

  const vaultType = localStorage.getItem('selectedVaultType');
  const isCryptoVault = !(vaultType === 'docs-only' || vaultType === 'crypto-docs');

  if (answers.some(a => a === '') || (isCryptoVault && seeds.some(s => s === ''))) {
    showMessageModal('Missing Information', 'Please fill in all answers' + (isCryptoVault ? ' and all seed words.' : '.'));
    return;
  }

  // Use bulkSeedPhrase if available
  const bulkSeed = JSON.parse(localStorage.getItem('bulkSeedPhrase') || '[]');
  const finalSeeds = bulkSeed.length > seeds.length ? bulkSeed : seeds;

  const unlockIndexes = JSON.parse(localStorage.getItem('unlockQuestions')) || [0, 1];
  const questionCount = parseInt(localStorage.getItem('questionCount')) || 12;
  const questions = JSON.parse(localStorage.getItem('questions')) || [];

  const req = indexedDB.open('memoroVaultDB', 2);

  req.onupgradeneeded = function (e) {
    const db = e.target.result;
    if (!db.objectStoreNames.contains('vaultUserData')) {
      db.createObjectStore('vaultUserData', { keyPath: 'id' });
    }
  };

  req.onsuccess = function () {
    const db = req.result;
    const tx = db.transaction('vaultUserData', 'readwrite');
    const store = tx.objectStore('vaultUserData');
    const finalTrapIndex = getSelectedTrapIndex();
if (finalTrapIndex >= 0) {
  if (!customHints[finalTrapIndex]) {
    customHints[finalTrapIndex] = { letters: [], custom: "", showLength: true };
  }
  customHints[finalTrapIndex].showLength = true;
}

    store.put({
      id: 'userData',
      answers,
      normalizedAnswers,
      spaceIndexes: spaceIndexesList,
      seeds: finalSeeds,
      hints: customHints,
      questions,
      questionCount,
      unlockIndexes,
      finalMessage,
      trapIndex
    });

    tx.oncomplete = () => {
      db.close();

      const namedSeedFiles = namedSeeds.map(seed => ({
        name: seed.name + ".txt",
        content: seed.content
      }));

      localStorage.setItem("namedSeedFiles", JSON.stringify(namedSeedFiles));
      localStorage.removeItem("namedSeeds"); // ✅ clear temp seed list after saving

      window.location.href = "build-vault.html";
    };
  };

  req.onerror = function () {
    showMessageModal("IndexedDB Error", "Failed to store user data.");
  };
}

  function forceLowercase(input) {
    input.value = input.value.toLowerCase();
  }
  
  function handlePaste(event, index) {
    event.preventDefault();
    const pasted = (event.clipboardData || window.clipboardData).getData('text');
    const input = document.getElementById(`answer-${index}`);
    input.value += pasted.toLowerCase();
    refreshHintModal();
  }
  
  function handleSeedPaste() {
  const textarea = document.getElementById('bulk-seed');
  const seeds = textarea.value.trim().toLowerCase().split(/\s+/);
  const totalSeeds = seeds.length;

  // Save pasted full phrase to localStorage
  localStorage.setItem('bulkSeedPhrase', JSON.stringify(seeds));

  // Autofill seed inputs attached to questions
  seeds.forEach((word, index) => {
    const input = document.getElementById(`seed-${index}`);
    if (input) input.value = word;
  });

  // Display overflow seeds if present
  const questionCount = parseInt(localStorage.getItem('questionCount')) || 12;
  const overflow = seeds.slice(questionCount);
  const extraContainer = document.getElementById('extraSeedsSection');
  extraContainer.innerHTML = '';

  if (overflow.length > 0) {
    const label = document.createElement('label');
    label.style = "font-size: 18px; color: #ccc;";
    label.textContent = `Extra Seed Words (${overflow.length}):`;
    extraContainer.appendChild(label);

    overflow.forEach((word) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = word;
      input.readOnly = true;
      input.style = `
        width: 100%; margin-top: 6px; padding: 10px;
        border-radius: 6px; background-color: #333; color: #eee;
        font-size: 16px; border: none;
      `;
      extraContainer.appendChild(input);
    });
  }
}

// Returns the currently selected Red Herring index, or -1 if none selected
function getSelectedTrapIndex() {
  let idx = -1;
  document.querySelectorAll('.trap-checkbox').forEach(cb => {
    if (cb.checked) idx = parseInt(cb.dataset.index);
  });
  return idx;
}

// Ensure Red Herring's showLength is ON unless the question is MCQ
function enforceRedHerringShowLength() {
  const trapIndex = getSelectedTrapIndex();
  if (trapIndex >= 0) {
    if (!customHints[trapIndex]) {
      customHints[trapIndex] = { letters: [], custom: "", showLength: true, mcqEnabled: false };
    }
    if (!customHints[trapIndex].mcqEnabled) {
      customHints[trapIndex].showLength = true;
    } else {
      customHints[trapIndex].showLength = false; // MCQ red herring: no length shown
    }
  }
}

function openHintModal(index) {
  activeHintIndex = index;

  // Show Hint modal + lock page scroll (centralized)
  const hintModal = document.getElementById('hintModal');
  if (hintModal) {
    hintModal.style.display = 'flex';
  }
  syncScrollLockWithModals(); // <-- lock now

  const trapIndex = getSelectedTrapIndex();
  const saved = customHints[index] || {};

  // ----- Length toggle -----
  const showLengthEl = document.getElementById('showLength');
  showLengthEl.checked = (typeof saved.showLength === 'boolean') ? saved.showLength : true;

  // If this is the Red Herring and NOT MCQ, force length ON + disable
  if (index === trapIndex && !saved.mcqEnabled) {
    showLengthEl.checked = true;
    showLengthEl.disabled = true;
  } else {
    showLengthEl.disabled = false;
  }

  // ----- Letters UI -----
  const numLettersEl = document.getElementById('numLetters');
  if (Array.isArray(saved.letters)) {
    numLettersEl.value = String(saved.letters.length || 0);
  }
  buildLetterSelectors();
  toggleLetterHintAvailability(showLengthEl.checked);
  showLengthEl.onchange = () => toggleLetterHintAvailability(showLengthEl.checked);

  // ----- MCQ wiring -----
  hydrateMcqFromSaved(saved); // keep only ONE definition of this function in the file

  const mcqEnabledEl = document.getElementById('mcqEnabled');
  const mcqConfigEl  = document.getElementById('mcqConfig');
  const mcqCountEl   = document.getElementById('mcqCount');

  // Single handler: allow toggle, but block + warn on L1 (unlock) questions
  mcqEnabledEl.onchange = (e) => {
    const tryingToEnable = !!e.target.checked;

    if (tryingToEnable && isGateIndex(index)) {
      // Revert and warn
      e.target.checked = false;
      if (mcqConfigEl) mcqConfigEl.style.display = 'none';
      if (typeof syncMcqUiEnabledState === 'function') syncMcqUiEnabledState(false);
      showMessageModal('MCQ not allowed',
        'Multiple-choice is disabled for Layer-1 unlock questions. Use length/letters or a free-text hint instead.');
      return;
    }

    // Non-L1 normal flow
    if (mcqConfigEl) mcqConfigEl.style.display = tryingToEnable ? 'block' : 'none';
    if (typeof syncMcqUiEnabledState === 'function') syncMcqUiEnabledState(tryingToEnable);
    if (tryingToEnable && typeof showMcqWarningOnce === 'function') showMcqWarningOnce();
  };

  // If MCQ was saved ON previously:
  if (mcqEnabledEl.checked) {
    if (isGateIndex(index)) {
      mcqEnabledEl.checked = false;
      if (mcqConfigEl) mcqConfigEl.style.display = 'none';
      if (typeof syncMcqUiEnabledState === 'function') syncMcqUiEnabledState(false);
      showMessageModal('MCQ not allowed',
        'Multiple-choice is disabled for Layer-1 unlock questions. Use length/letters or a free-text hint instead.');
    } else {
      if (mcqConfigEl) mcqConfigEl.style.display = 'block';
      if (typeof syncMcqUiEnabledState === 'function') syncMcqUiEnabledState(true);
      if (typeof showMcqWarningOnce === 'function') showMcqWarningOnce();
    }
  } else {
    if (mcqConfigEl) mcqConfigEl.style.display = 'none';
    if (typeof syncMcqUiEnabledState === 'function') syncMcqUiEnabledState(false);
  }

  // Keep existing decoy-resize behavior
  mcqCountEl.onchange = (e) => {
    const n = parseInt(e.target.value, 10) || 6;
    const current = Array.from(document.querySelectorAll('.mcq-decoy')).map(inp => inp.value);
    const resized = current.slice(0, Math.max(0, n - 1));
    while (resized.length < n - 1) resized.push('');
    renderMcqDecoyInputs(Math.max(5, n - 1), resized);
  };
}

  function toggleLetterHintAvailability(show) {
  const numLettersEl = document.getElementById('numLetters');
  const letterBox = document.getElementById('letterSelectors');
  const saveBtn = document.getElementById('hintSaveBtn');

  // If MCQ is enabled for the active question, letters UI should be disabled,
  // but the Save button must remain enabled.
  const mcqOn = !!document.getElementById('mcqEnabled')?.checked
             || !!customHints[activeHintIndex]?.mcqEnabled;

  // Letters controls are usable only when: NOT MCQ and showLength == true
  const lettersDisabled = mcqOn || !show;

  if (numLettersEl) numLettersEl.disabled = lettersDisabled;
  if (letterBox) {
    letterBox.querySelectorAll('select').forEach(s => s.disabled = lettersDisabled);
  }

  // IMPORTANT: Never disable Save here. Validation happens in saveCustomHint().
  if (saveBtn) saveBtn.disabled = false;
}


function syncMcqUiEnabledState(isEnabled) {
  const showLengthEl = document.getElementById('showLength');
  const numLettersEl = document.getElementById('numLetters');
  const letterBox = document.getElementById('letterSelectors');
  const mcqConfig = document.getElementById('mcqConfig');

  if (isEnabled) {
    if (showLengthEl) { showLengthEl.checked = false; showLengthEl.disabled = true; }
    if (numLettersEl) numLettersEl.disabled = true;
    if (letterBox) letterBox.querySelectorAll('select').forEach(s => s.disabled = true);
    if (mcqConfig) mcqConfig.style.display = '';
  } else {
    const trapIndex = getSelectedTrapIndex();
    const isTrap = (activeHintIndex === trapIndex);
    if (showLengthEl) showLengthEl.disabled = isTrap;
    if (!isTrap && showLengthEl?.checked) {
      if (numLettersEl) numLettersEl.disabled = false;
      if (letterBox) letterBox.querySelectorAll('select').forEach(s => s.disabled = false);
    }
    if (mcqConfig) mcqConfig.style.display = 'none';
  }
    // Always allow saving while editing MCQ
  const saveBtn = document.getElementById('hintSaveBtn');
  if (saveBtn) saveBtn.disabled = false;

}

function buildMcqCountDropdown() {
  const sel = document.getElementById('mcqCount');
  if (!sel) return;
  sel.innerHTML = '';
  for (let n = 6; n <= 12; n++) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = `${n} options`;
    sel.appendChild(opt);
  }
}

function renderMcqDecoyInputs(countMinusOne, savedDecoys = []) {
  const holder = document.getElementById('mcqOptions');
  if (!holder) return;
  holder.innerHTML = '';
  for (let i = 0; i < countMinusOne; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'input-group';
    wrap.innerHTML = `
      <label>Decoy ${i+1}</label>
      <input type="text" class="mcq-decoy" data-decoy-index="${i}"
             placeholder="convincing but wrong"
             value="${(savedDecoys[i]||'').replace(/"/g,'&quot;')}" />
    `;
    holder.appendChild(wrap);
  }
}

function hydrateMcqFromSaved(saved) {
  const idx = (typeof activeHintIndex === 'number') ? activeHintIndex : -1;

  // If this is L1 (unlock), never hydrate MCQ as ON (but do NOT hide the UI)
  if (isGateIndex(idx)) {
    saved = { ...(saved || {}), mcqEnabled: false, mcqOptions: [] };
  }

  const enabled = !!(saved && saved.mcqEnabled);
  const mcqEnabledEl = document.getElementById('mcqEnabled');
  if (mcqEnabledEl) mcqEnabledEl.checked = enabled;

  buildMcqCountDropdown();
  const sel = document.getElementById('mcqCount');

  // saved.mcqOptions: [correct, ...decoys] if present
  const savedOptions = Array.isArray(saved?.mcqOptions) ? saved.mcqOptions.slice() : [];

  // Prefill the correct option (prefer saved; else use the typed answer)
  const mcqCorrectEl = document.getElementById('mcqCorrect');
  if (mcqCorrectEl) {
    const typed = document.getElementById(`answer-${idx}`)?.value || '';
    mcqCorrectEl.value = savedOptions[0] || typed || '';
  }

  const decoys = savedOptions.length > 0 ? savedOptions.slice(1) : [];
  const n = Math.max(6, Math.min(12, (decoys.length + 1) || 6));
  if (sel) sel.value = String(n);
  renderMcqDecoyInputs(n - 1, decoys);

  if (typeof syncMcqUiEnabledState === 'function') syncMcqUiEnabledState(enabled);
}


function closeHintModal() {
  activeHintIndex = null;

  const hint = document.getElementById('hintModal');
  if (hint) hint.style.display = 'none';

  // existing cleanup
  const letterBox = document.getElementById('letterSelectors');
  if (letterBox) letterBox.innerHTML = '';
  const custom = document.getElementById('customHintText');
  if (custom) custom.value = '';
  const numSel = document.getElementById('numLetters');
  if (numSel) numSel.value = '0';
  const sl = document.getElementById('showLength');
  if (sl) sl.checked = true;

  syncScrollLockWithModals(); // <-- release if no other modals are open
}

  function buildLetterSelectors() {
  if (activeHintIndex === null) return;

  const container = document.getElementById('letterSelectors');
  container.innerHTML = '';

  const answerInput = document.getElementById(`answer-${activeHintIndex}`);
  const rawAnswer = answerInput ? answerInput.value.trim() : '';
  const cleanedAnswer = rawAnswer.replace(/\s+/g, '');

  const maxHints = Math.floor(cleanedAnswer.length * 0.5);
  const select = document.getElementById('numLetters');

  // Dynamically repopulate the dropdown if needed
  if (select.options.length !== maxHints + 1) {
    select.innerHTML = '';
    for (let i = 0; i <= maxHints; i++) {
      const option = document.createElement('option');
      option.value = i;
      option.textContent = i === 0
        ? "0 letters (only answer length)"
        : `${i} letter${i > 1 ? 's' : ''}`;
      select.appendChild(option);
    }
  }

  // Read selected number of letters
  let num = parseInt(select.value);
  if (num > maxHints) {
    num = maxHints;
    select.value = maxHints;
    showMessageModal('Warning', `You cannot reveal more than 50% of your answer's letters (Max ${maxHints}).`);
  }

  // Build selectors
  for (let i = 0; i < num; i++) {
    const letterSelect = document.createElement('select');
    letterSelect.id = `letter-select-${i}`;
    for (let j = 0; j < cleanedAnswer.length; j++) {
      const option = document.createElement('option');
      option.value = j + 1;
      option.textContent = `${cleanedAnswer[j]} (${j + 1})`;
      letterSelect.appendChild(option);
    }
    container.appendChild(letterSelect);
  }
}

function saveCustomHint() {
  if (activeHintIndex === null) return;

  const trapIndex = getSelectedTrapIndex();
  const requestedShowLength = document.getElementById('showLength').checked;

  const mcqEnabled = !!document.getElementById('mcqEnabled')?.checked;
  const customText = document.getElementById('customHintText').value.trim();

  // 🚫 Block saving MCQ on L1 with a warning (UI stays visible)
  if (mcqEnabled && isGateIndex(activeHintIndex)) {
    // snap the UI back off so the preview & state match the rule
    const mcqEnabledEl = document.getElementById('mcqEnabled');
    if (mcqEnabledEl) mcqEnabledEl.checked = false;
    const mcqConfigEl  = document.getElementById('mcqConfig');
    if (mcqConfigEl) mcqConfigEl.style.display = 'none';
    if (typeof syncMcqUiEnabledState === 'function') syncMcqUiEnabledState(false);

    showMessageModal('MCQ not allowed',
      'Multiple-choice is disabled for Layer-1 unlock questions. Please use letter/length hints or a free-text hint instead.');
    return;
  }

  // ----- MCQ path (non-L1) -----
  if (mcqEnabled) {
    const countSel = document.getElementById('mcqCount');
    const n = Math.max(6, Math.min(12, parseInt(countSel?.value || '6', 10)));

    const correctEl = document.getElementById('mcqCorrect');
    const correct = (correctEl?.value || '').trim();
    if (!correct) {
      showMessageModal('Missing correct option', 'Please enter the correct option for this question.');
      return;
    }

    const decoys = Array.from(document.querySelectorAll('.mcq-decoy'))
      .map(i => (i.value || '').trim())
      .filter(Boolean);

    if (decoys.length !== (n - 1)) {
      showMessageModal('MCQ needs more options', `Provide ${n - 1} decoy option${n-1>1?'s':''}.`);
      return;
    }

    const all = [correct, ...decoys];
    const uniq = new Set(all.map(s => s.toLowerCase()));
    if (uniq.size !== all.length) {
      showMessageModal('Duplicate options', 'Please ensure all options are unique.');
      return;
    }

    customHints[activeHintIndex] = {
      letters: [],
      custom: customText,
      showLength: false,
      mcqEnabled: true,
      mcqOptions: all
    };

    // Optionally mirror the main answer to the correct option
    const mainAnswer = document.getElementById(`answer-${activeHintIndex}`);
    if (mainAnswer) mainAnswer.value = correct;

    updateHintPreview(activeHintIndex);
    updateEntropy(activeHintIndex);
    closeHintModal();
    return;
  }

  // ----- Non-MCQ path (unchanged) -----
  const effectiveShowLength = (activeHintIndex === trapIndex) ? true : requestedShowLength;

  if (!effectiveShowLength) {
    customHints[activeHintIndex] = {
      letters: [],
      custom: customText,
      showLength: false,
      mcqEnabled: false
    };
    updateHintPreview(activeHintIndex);
    updateEntropy(activeHintIndex);
    closeHintModal();
    return;
  }

  const num = parseInt(document.getElementById('numLetters').value, 10);
  const indexes = [];
  const seen = new Set();
  let duplicateFound = false;

  for (let i = 0; i < num; i++) {
    const el = document.getElementById(`letter-select-${i}`);
    if (!el) continue;
    const value = parseInt(el.value, 10);
    if (seen.has(value)) { duplicateFound = true; break; }
    seen.add(value);
    indexes.push(value);
  }
  if (duplicateFound) {
    showMessageModal('Duplicate Letter Chosen', 'Please choose different letters for your hints.');
    return;
  }

  customHints[activeHintIndex] = {
    letters: indexes.sort((a, b) => a - b),
    custom: customText,
    showLength: effectiveShowLength,
    mcqEnabled: false
  };

  updateHintPreview(activeHintIndex);
  updateEntropy(activeHintIndex);
  closeHintModal();
}

function refreshHintModal() {
  const modal = document.getElementById('hintModal');
  if (!(modal && modal.style.display === 'flex')) return;

  if (typeof buildLetterSelectors === 'function') buildLetterSelectors();

  const mcqEnabledEl = document.getElementById('mcqEnabled');
  const mcqConfigEl  = document.getElementById('mcqConfig');
  if (!mcqEnabledEl || !mcqConfigEl) return;

  // reflect current UI
  mcqConfigEl.style.display = mcqEnabledEl.checked ? 'block' : 'none';
  if (typeof syncMcqUiEnabledState === 'function') {
    syncMcqUiEnabledState(mcqEnabledEl.checked);
  }

  // one stable handler: warn + revert on L1; otherwise normal flow + guidance modal
  mcqEnabledEl.onchange = (e) => {
    const on = !!e.target.checked;

    if (on && isGateIndex(activeHintIndex)) {
      e.target.checked = false;
      mcqConfigEl.style.display = 'none';
      if (typeof syncMcqUiEnabledState === 'function') syncMcqUiEnabledState(false);
      showMessageModal('MCQ not allowed',
        'Multiple-choice is disabled for Layer-1 unlock questions. Use length/letters or a free-text hint instead.');
      return;
    }

    mcqConfigEl.style.display = on ? 'block' : 'none';
    if (typeof syncMcqUiEnabledState === 'function') syncMcqUiEnabledState(on);
    if (on && typeof showMcqWarningOnce === 'function') showMcqWarningOnce();
  };

  // If it’s already ON and not L1, show the guidance once per session
  if (mcqEnabledEl.checked && !isGateIndex(activeHintIndex) && typeof showMcqWarningOnce === 'function') {
    showMcqWarningOnce();
  }
}
  
function showMessageModal(title, message, autoCloseMs) {
  const modal = document.getElementById('messageModal');
  modal.classList.remove('fade-out');
  document.getElementById('messageModalTitle').innerText = title;
  document.getElementById('messageModalText').innerText = message;
  modal.style.display = 'flex';
  syncScrollLockWithModals(); // lock while message modal is open

  if (autoCloseMs) {
    setTimeout(() => {
      modal.classList.add('fade-out');
      setTimeout(closeMessageModal, 500);
    }, autoCloseMs);
  }
}

function closeMessageModal() {
  const modal = document.getElementById('messageModal');
  modal.style.display = 'none';
  modal.classList.remove('fade-out');
  syncScrollLockWithModals(); // release if this was the last open modal
}
  
  function securelyClearSensitiveData() {
  localStorage.removeItem('userAnswers');
  localStorage.removeItem('userSeeds');
  localStorage.removeItem('userHints');
  localStorage.removeItem('finalMessage');
  localStorage.removeItem('namedSeeds'); // ✅ optional extra safety
}

  window.onload = () => {
  // Render the questions UI
  loadQuestions();

  // Start the 30‑minute security timer + initial countdown text
  startSecurityTimer();
  updateCountdownDisplay();

  // Attach Red Herring handlers (safe to call even though loadQuestions wires them)
  attachTrapCheckboxHandlers();

  // Refresh uploads list (the DOMContentLoaded listener for uploads is fine to keep)
  displayUploadedFiles();

  // Compute overall strength once the per‑question entropy rows exist
  calculateTotalEntropy();

  // (Optional) re-render saved named seeds list
  renderNamedSeeds();
};
/* Matrix rain controller for Answer Questions page */
(function () {
  // Works with either #matrixCanvas or #matrix
  const canvas = document.getElementById('matrixCanvas') || document.getElementById('matrix');
  if (!canvas) return; // safe if no canvas on this page

  const ctx = canvas.getContext('2d');
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890@$%&'.split('');
  const fontSize = 14;

  let columns = 0;
  let drops = [];
  let timer = null;

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    columns = Math.floor(canvas.width / fontSize);
    drops = Array(columns).fill(0);
  }

  function draw() {
    // trail
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // glyphs
    ctx.fillStyle = '#00ff99';
    ctx.font = `${fontSize}px monospace`;

    for (let i = 0; i < drops.length; i++) {
      const t = letters[(Math.random() * letters.length) | 0];
      ctx.fillText(t, i * fontSize, drops[i] * fontSize);
      drops[i]++;
      if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
    }
  }

  window.AnswerQuestionsMatrix = {
    start() {
      resize();
      window.addEventListener('resize', resize);
      if (!timer) timer = setInterval(draw, 66); // ~15 fps
      canvas.style.display = 'block';
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
      window.removeEventListener('resize', resize);
    }
  };
})();
(function bootstrapAnswerQuestionsTheme(){
  const apply = () => applyAnswerQuestionsTheme(window.__savedAnswerQuestionsTheme || 'cypherpunk');
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
})();
let namedSeeds = JSON.parse(localStorage.getItem("namedSeeds") || "[]");

function saveNamedSeed() {
  const nameInput = document.getElementById('newSeedName');
  const contentInput = document.getElementById('newSeedContent');
  const name = nameInput.value.trim();
  const content = contentInput.value.trim();

  if (!name || !content) {
    showMessageModal("Missing Info", "You must provide both a name and a seed phrase.");
    return;
  }

  const safeName = name.toLowerCase().replace(/[^a-z0-9]/gi, "_");

  namedSeeds.push({ name: safeName, content });
  localStorage.setItem("namedSeeds", JSON.stringify(namedSeeds));
  
  nameInput.value = "";
  contentInput.value = "";
  renderNamedSeeds();
}

function renderNamedSeeds() {
  const container = document.getElementById('namedSeedsList');
  container.innerHTML = "";

  namedSeeds.forEach((entry, index) => {
    const div = document.createElement("div");
    div.classList.add("seed-entry");
    div.innerHTML = `
      <strong>${entry.name}.txt</strong><br>
      <code>${entry.content.replace(/\s+/g, " ")}</code><br>
      <button class="button seed-remove-btn" onclick="deleteNamedSeed(${index})">Remove</button>
    `;
    container.appendChild(div);
  });
}

function deleteNamedSeed(index) {
  namedSeeds.splice(index, 1);
  localStorage.setItem("namedSeeds", JSON.stringify(namedSeeds));
  renderNamedSeeds();
}

window.addEventListener("DOMContentLoaded", renderNamedSeeds);

async function nukeEverything() {
  try {
    localStorage.clear();
    sessionStorage.clear();
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        indexedDB.deleteDatabase(db.name);
      }
    } else {
      indexedDB.deleteDatabase("memoroVaultVaultStorage");
      indexedDB.deleteDatabase("memoroVaultDB");
    }
    console.log("Memoro Vault: Local memory wiped.");
  } catch (err) {
    console.warn("Memoro Vault wipe failed:", err);
  }
}

function syncMcqUiEnabledState(isEnabled) {
  // If MCQ is enabled: hide/disable the length+letters UI
  const showLengthEl = document.getElementById('showLength');
  const numLettersEl = document.getElementById('numLetters');
  const letterBox = document.getElementById('letterSelectors');
  const mcqConfig = document.getElementById('mcqConfig');

  if (isEnabled) {
    if (showLengthEl) { showLengthEl.checked = false; showLengthEl.disabled = true; }
    if (numLettersEl) numLettersEl.disabled = true;
    if (letterBox) letterBox.querySelectorAll('select').forEach(s => s.disabled = true);
    if (mcqConfig) mcqConfig.style.display = '';
  } else {
    // Re-enable length + letter UI unless trap is selected (trap still disables)
    const trapIndex = getSelectedTrapIndex();
    const isTrap = (activeHintIndex === trapIndex);
    if (showLengthEl) showLengthEl.disabled = isTrap;
    if (!isTrap && showLengthEl?.checked) {
      if (numLettersEl) numLettersEl.disabled = false;
      if (letterBox) letterBox.querySelectorAll('select').forEach(s => s.disabled = false);
    }
    if (mcqConfig) mcqConfig.style.display = 'none';
  }
}

function buildMcqCountDropdown() {
  const sel = document.getElementById('mcqCount');
  if (!sel) return;
  sel.innerHTML = '';
  for (let n = 6; n <= 12; n++) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = `${n} options`;
    sel.appendChild(opt);
  }
}

function renderMcqDecoyInputs(countMinusOne, savedDecoys = []) {
  const holder = document.getElementById('mcqOptions');
  if (!holder) return;
  holder.innerHTML = '';
  for (let i = 0; i < countMinusOne; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'input-group';
    wrap.innerHTML = `
      <label>Decoy ${i+1}</label>
      <input type="text" class="mcq-decoy" data-decoy-index="${i}" placeholder="convincing but wrong" value="${(savedDecoys[i]||'').replace(/"/g,'&quot;')}" />
    `;
    holder.appendChild(wrap);
  }
}

function updateEntropy(index) {
  const input = document.getElementById(`answer-${index}`);
  const entropyDisplay = document.getElementById(`entropy-${index}`);
  if (!input || !entropyDisplay || typeof zxcvbn !== 'function') {
    console.warn('Entropy calc skipped — missing input or zxcvbn not loaded');
    return;
  }

  const answer = input.value.trim().toLowerCase();
  const hintObj = customHints[index] || { letters: [], showLength: true };

  // MCQ answers reduce to "one of N options"
if (hintObj.mcqEnabled) {
  const n = Math.max(2, Math.min(12, Array.isArray(hintObj.mcqOptions) ? hintObj.mcqOptions.length : 0));
  const baseEntropy = Math.log2(n);
  const effectiveEntropy = Math.max(0, baseEntropy); // no penalties; length/letters unused
  let color = '#ff3333';
  if (effectiveEntropy >= 40) color = '#00ff99';
  else if (effectiveEntropy >= 20) color = '#ffff00';
  entropyDisplay.textContent = `Entropy: ${effectiveEntropy.toFixed(1)} bits`;
  entropyDisplay.style.color = color;
  calculateTotalEntropy();
  return;
}

  // Base entropy from zxcvbn (or 1 bit for yes/no/true/false)
  const binaryAnswers = ['t', 'f', 'y', 'n', 'true', 'false', 'yes', 'no'];
  let baseEntropy;
  if (binaryAnswers.includes(answer)) {
    baseEntropy = 1;
  } else {
    const result = zxcvbn(answer);
    baseEntropy = Math.log2(result.guesses || 1);
  }

  // Penalties:
  // 1) Revealed letters (each ~ log2(26) bits leaked for lowercase model)
  const lettersRevealed = Array.isArray(hintObj.letters) ? hintObj.letters.length : 0;
  const lettersPenalty = lettersRevealed * Math.log2(26);

  // 2) Revealing exact length leaks a small amount of information.
  //    We conservatively bound this at log2(min(length, 20)) to avoid overcounting.
  const showLength = (typeof hintObj.showLength === 'boolean') ? hintObj.showLength : true;
  const lengthKnown = showLength ? answer.length : 0;
  const lengthPenalty = showLength
    ? Math.log2(Math.max(1, Math.min(lengthKnown, 20)))
    : 0;

  const effectiveEntropy = Math.max(0, baseEntropy - lettersPenalty - lengthPenalty);

  let color = '#ff3333';
  if (effectiveEntropy >= 40) color = '#00ff99';
  else if (effectiveEntropy >= 20) color = '#ffff00';

  entropyDisplay.textContent = `Entropy: ${effectiveEntropy.toFixed(1)} bits`;
  entropyDisplay.style.color = color;

  calculateTotalEntropy();
}

function calculateTotalEntropy() {
  const numberOfQuestions = parseInt(localStorage.getItem('questionCount')) || 12;
  let totalBits = 0;

  // Aggregate total entropy
  for (let i = 0; i < numberOfQuestions; i++) {
    const el = document.getElementById(`entropy-${i}`);
    if (el) {
      const match = el.textContent.match(/([\d.]+) bits/);
      if (match) totalBits += parseFloat(match[1]);
    }
  }

  // Display total entropy
  document.getElementById('totalEntropyBits').textContent = totalBits.toFixed(1);

  // Set strength label and color
  const assessment = document.getElementById('entropyAssessment');
  if (totalBits < 40) {
    assessment.textContent = 'Very Weak';
    assessment.style.color = '#ff3333';
  } else if (totalBits < 80) {
    assessment.textContent = 'Weak';
    assessment.style.color = '#ff9933';
  } else if (totalBits < 120) {
    assessment.textContent = 'Moderate';
    assessment.style.color = '#ffff00';
  } else if (totalBits < 180) {
    assessment.textContent = 'Strong';
    assessment.style.color = '#66ff66';
  } else {
    assessment.textContent = 'Very Strong';
    assessment.style.color = '#00ff99';
  }

  // Calculate and display total combinations
  const combos = Math.pow(2, totalBits);
  const totalCombinationsEl = document.getElementById('totalCombinations');
  if (combos <= 1) {
    totalCombinationsEl.textContent = "0";
  } else {
    const exp = Math.floor(Math.log10(combos));
    const base = combos / Math.pow(10, exp);
    totalCombinationsEl.textContent = `${base.toFixed(2)} × 10^${exp}`;
  }

  // Crack time calculation
  const guessesPerSecond = 1e12; // 1 trillion guesses/sec
  const seconds = combos / guessesPerSecond;
  const crackTimeEl = document.getElementById('estimatedCrackTime');

  let crackReadable;
  if (seconds < 1) {
    crackReadable = "Instantly crackable";
  } else if (seconds < 60) {
    crackReadable = `~${Math.ceil(seconds)} second${seconds > 1 ? 's' : ''}`;
  } else if (seconds < 3600) {
    crackReadable = `~${Math.ceil(seconds / 60)} minute${seconds >= 120 ? 's' : ''}`;
  } else if (seconds < 86400) {
    crackReadable = `~${Math.ceil(seconds / 3600)} hour${seconds >= 7200 ? 's' : ''}`;
  } else if (seconds < 31536000) {
    crackReadable = `~${Math.ceil(seconds / 86400)} day${seconds >= 172800 ? 's' : ''}`;
  } else if (seconds < 1e21) {
    const years = seconds / 31536000;
    crackReadable = `~${years.toFixed(1)} year${years > 1.1 ? 's' : ''}`;
  } else {
    crackReadable = `~${seconds.toExponential(2)} years`;
  }

  crackTimeEl.textContent = crackReadable;

  // Update tier banner
const tier = document.getElementById("crackabilityTier");
if (tier) {
  if (totalBits < 40) {
    tier.textContent = "⚠️ Crackable instantly — trivial for any attacker";
    tier.style.color = "#ff3333";
  } else if (totalBits < 80) {
    tier.textContent = "🔶 Vulnerable to distributed attacks (≤ 79 bits)";
    tier.style.color = "#ff9933";
  } else if (totalBits < 120) {
    tier.textContent = "🟡 Resistant to consumer + small-scale parallel attacks (≥ 80 bits)";
    tier.style.color = "#ffff66";
  } else if (totalBits < 180) {
    tier.textContent = "🟢 Strong even against enterprise GPU clusters (≥ 120 bits)";
    tier.style.color = "#66ff66";
  } else {
    tier.textContent = "🟢 Functionally immune to brute-force (≥ 180 bits)";
    tier.style.color = "#00ff99";
  }
}
}

window.addEventListener("DOMContentLoaded", calculateTotalEntropy);

function updateHintPreview(index) {
  const target = document.getElementById(`hint-preview-${index}`);
  if (!target) return;

  const inputEl = document.getElementById(`answer-${index}`);
  const raw = (inputEl?.value || "").trim();
  const show = (customHints[index]?.showLength ?? true);
  const letters = Array.isArray(customHints[index]?.letters) ? customHints[index].letters : [];
  const customText = (customHints[index]?.custom || "").trim();
// MCQ: show a simple preview line
if (customHints[index]?.mcqEnabled) {
  const howMany = (customHints[index].mcqOptions || []).length || '—';
  const customText = (customHints[index]?.custom || '').trim();
  target.innerHTML =
    `<div class="hint-custom-only">Multiple choice (${howMany} options)${
      customText ? ` — Hint: ${escapeHtml(customText)}` : ''
    }</div>`;
  return;
}

  // If length preview is OFF, match recover behavior: no map, only optional custom hint
  if (!show) {
    target.innerHTML = customText
      ? `<div class="hint-custom-only">Hint: ${escapeHtml(customText)}</div>`
      : `<div class="hint-none">(No length will be shown during recovery)</div>`;
    return;
  }

  // Build the exact same map Recover shows:
  // - underscores for unknown characters
  // - preserve spaces at their indices
  // - reveal selected letters by 1-based position in the "cleaned" answer (no spaces)
  const expectedLength = raw.length;                 // includes spaces (Recover counts positions incl. spaces)
  const spaceIndexes = [];                           // indices of ' ' in raw
  for (let i = 0; i < raw.length; i++) if (raw[i] === ' ') spaceIndexes.push(i);

  // Build hintValues by pulling characters from the *cleaned* string at the selected 1-based positions
  const cleaned = raw.replace(/\s+/g, '');
  const hintValues = letters.map(pos => {
    const idx = (pos|0) - 1;
    return (idx >= 0 && idx < cleaned.length) ? cleaned[idx] : undefined;
  });

  // Render map (this mirrors recover.html’s logic/shape). :contentReference[oaicite:0]{index=0}
  let rendered = '';
  let letterPos = 1;   // counts through cleaned answer (no spaces)
  let valueIndex = 0;

  for (let j = 0; j < expectedLength; j++) {
    if (spaceIndexes.includes(j)) {
      rendered += ' ';
    } else if (letters.includes(letterPos)) {
      const val = hintValues[valueIndex++];
      rendered += (val === undefined ? '_' : val);
      letterPos++;
    } else {
      rendered += '_';
      letterPos++;
    }
  }

  const spaced = rendered.split('').join(' ');

  target.innerHTML = `
    <div class="hint-preview-wrap" style="display:flex; gap:10px; align-items:center;">
      <code class="hint-preview-code" style="font-size:15px; white-space:pre;">${escapeHtml(spaced)}</code>
      ${customText ? `<div class="hint-custom-text" style="font-size:14px;">Hint: ${escapeHtml(customText)}</div>` : ''}
    </div>
  `;
}

// Keep previews in sync after saving Hint Options
const _origSaveCustomHint = saveCustomHint;
saveCustomHint = function() {
  const idx = activeHintIndex;
  _origSaveCustomHint();
  if (typeof idx === 'number') updateHintPreview(idx);
};

// Also refresh if Red Herring checkbox changes (it can force showLength)
document.addEventListener('change', (e) => {
  if (e.target && e.target.classList.contains('trap-checkbox')) {
    const idx = parseInt(e.target.dataset.index, 10);
    if (!isNaN(idx)) updateHintPreview(idx);
  }
});

// Utility for safely placing user text in HTML
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isGateIndex(idx) {
  const unlock = JSON.parse(localStorage.getItem('unlockQuestions') || '[0,1]');
  return unlock.includes(idx);
}

// Allow MCQ on gates: do NOT disable, only show the warning when toggled on.
function lockMcqIfGate() {
  const idx = typeof activeHintIndex === 'number' ? activeHintIndex : -1;
  const mcqEnabledEl = document.getElementById('mcqEnabled');
  const mcqConfigEl  = document.getElementById('mcqConfig');
  if (!mcqEnabledEl || !mcqConfigEl) return;

  // Always keep it enabled. If this is a gate, we simply rely on the warning modal.
  mcqEnabledEl.disabled = false;

  mcqEnabledEl.onchange = (e) => {
    const on = e.target.checked;
    mcqConfigEl.style.display = on ? 'block' : 'none';
    if (on) showMcqWarningOnce();
    // keep other UI in sync
    if (typeof syncMcqUiEnabledState === 'function') syncMcqUiEnabledState(on);
  };
}

function syncScrollLockWithModals() {
  // Consider any element with class="modal" as a lock trigger when visible
  const anyOpen = Array.from(document.querySelectorAll('.modal'))
    .some(m => getComputedStyle(m).display !== 'none');
  document.body.classList.toggle('modal-open', anyOpen);
}
