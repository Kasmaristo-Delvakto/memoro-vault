  // Toggle Setup-Questions styles + matrix by theme
  function applySetupQuestionsTheme(theme) {
    const cy = document.getElementById('theme-cypherpunk');
    const cl = document.getElementById('theme-clean');
    const isCypher = (theme === 'cypherpunk');

    // 1) Flip stylesheets
    if (cy) cy.disabled = !isCypher;
    if (cl) cl.disabled =  isCypher;

    // 2) Body attribute for CSS hooks
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

    // 3) Matrix control (expects window.SetupQuestionsMatrix)
    if (window.SetupQuestionsMatrix) {
      if (isCypher) SetupQuestionsMatrix.start();
      else SetupQuestionsMatrix.stop();
    }
  }

  // Read saved theme & preflip to avoid FOUC
  (function initSetupQuestionsTheme(){
    const saved = sessionStorage.getItem('theme') || 'cypherpunk';
    window.__savedSetupQuestionsTheme = saved;

    const cy = document.getElementById('theme-cypherpunk');
    const cl = document.getElementById('theme-clean');
    const isCypher = (saved === 'cypherpunk');
    if (cy) cy.disabled = !isCypher;
    if (cl) cl.disabled =  isCypher;
  })();

  // Ensure apply runs even if DOMContentLoaded already fired
  (function bootstrapSetupQuestionsTheme(){
    const apply = () => applySetupQuestionsTheme(window.__savedSetupQuestionsTheme || 'cypherpunk');
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', apply, { once: true });
    } else {
      apply();
    }
  })();
let questions = [];
let currentEditIndex = null;

const defaultQuestions = [
  "What is my full name?",
  "What is the name of my favorite childhood dog?",
  "What is my wife's maiden name?",
  "What city was I born in?",
  "In what city did my wife and I compete in our first Ironman?",
  "What is the name of my wife's favorite childhood dog?",
  "What is the first name of my wife's biological brother?",
  "What is the mascot of the 2nd high school I attended?",
  "What is my father's middle name?",
  "In what city did my wife and I go on our first date?",
  "Journey before... (complete the phrase)",
  "What was the name of my yellow Suzuki V-Strom 650 motorcycle?",
  "What is the name of my childhood best friend?",
  "Was my wife my first kiss? (y/n)",
  "Was I her first kiss? (y/n)",
  "Do I like mustard? (y/n)",
  "I play the guitar AND piano (t/f)",
  "My wife was a collegiate dancer for Auburn (t/f)",
  "We had our first child in 2019 (t/f)",
  "I have played league tennis (t/f)",
  "I played tennis in high school (t/f)",
  "My wife and I met in high school (t/f)",
  "My wife is left-handed (t/f)",
  "I am left-handed (t/f)",
  "I have travelled overseas AND am bilingual (t/f)"
];

function loadQuestions() {
  const vaultType = localStorage.getItem('selectedVaultType');
let numberOfQuestions;

// Handle Monero and Bitcoin variants
if (vaultType === 'monero') numberOfQuestions = 25;
else if (vaultType === 'monero-polyseed') numberOfQuestions = 16;
else if (vaultType === 'bitcoin') numberOfQuestions = 24;
else if (vaultType === 'bitcoin-legacy') numberOfQuestions = 12;
else {
  const customCount = parseInt(localStorage.getItem('customQuestionCount'));
  numberOfQuestions = isNaN(customCount) ? 12 : customCount;
}


  // Save it again just to ensure continuity
  localStorage.setItem('questionCount', numberOfQuestions);

  const savedQuestions = JSON.parse(localStorage.getItem('questions'));
  questions = (savedQuestions && savedQuestions.length >= numberOfQuestions)
    ? savedQuestions.slice(0, numberOfQuestions)
    : defaultQuestions.slice(0, numberOfQuestions);

  const questionList = document.getElementById('questionList');
  questionList.innerHTML = "";

  for (let i = 0; i < numberOfQuestions; i++) {
    const div = document.createElement('div');
    div.className = 'question-item';
    div.innerHTML = `
      <div class="question-text" id="question-${i}"><b>${i + 1}.</b> ${questions[i]}</div>
      <button class="edit-button" onclick="openModal(${i})">Edit</button>
      <input type="checkbox" class="unlock-checkbox" id="unlock-${i}" onchange="limitSelection()">
    `;
    questionList.appendChild(div);
  }
}

function openModal(index) {
  currentEditIndex = index;

  const input = document.getElementById('editInput');
  if (input) {
    input.value = questions[index] || '';
  }

  const dropdown = document.getElementById('categoryDropdown');
  if (dropdown) {
    dropdown.removeEventListener("change", populateSuggestions); // Prevent duplicate listeners
    dropdown.addEventListener("change", populateSuggestions);
  }

  document.getElementById('editModal').style.display = 'flex';
}


function closeModal() {
  document.getElementById('editModal').style.display = 'none';
  currentEditIndex = null;
}

function saveModalEdit() {
  const newQuestion = document.getElementById('editInput').value.trim();
  if (newQuestion && currentEditIndex !== null) {
    questions[currentEditIndex] = newQuestion;
    document.getElementById(`question-${currentEditIndex}`).innerHTML = `<b>${currentEditIndex + 1}.</b> ${newQuestion}`;
    localStorage.setItem('questions', JSON.stringify(questions));
  }
  closeModal();
}

function limitSelection() {
  const checkboxes = document.querySelectorAll('.unlock-checkbox');
  const checked = Array.from(checkboxes).filter(cb => cb.checked);
  if (checked.length >= 2) {
    checkboxes.forEach(cb => { if (!cb.checked) cb.disabled = true; });
  } else {
    checkboxes.forEach(cb => cb.disabled = false);
  }
}

function showDisclaimer() {
  const checkboxes = document.querySelectorAll('.unlock-checkbox');
  const selected = Array.from(checkboxes).filter(cb => cb.checked);
  if (selected.length !== 2) {
    showMessageModal('Selection Error', 'Please select exactly TWO unlock questions.');
    return;
  }
  document.getElementById('disclaimerModal').style.display = 'flex';
}

function proceedToAnswers() {
  const checkboxes = document.querySelectorAll('.unlock-checkbox');
  const selectedIndexes = [];
  checkboxes.forEach((cb, idx) => { if (cb.checked) selectedIndexes.push(idx); });

  localStorage.setItem('questions', JSON.stringify(questions));
  localStorage.setItem('unlockQuestions', JSON.stringify(selectedIndexes));

  window.location.href = "answer-questions.html";
}

function goBack() {
  window.history.back();
}

function showMessageModal(title, message) {
  document.getElementById('messageModalTitle').innerText = title;
  document.getElementById('messageModalText').innerText = message;
  document.getElementById('messageModal').style.display = 'flex';
}

function closeMessageModal() {
  document.getElementById('messageModal').style.display = 'none';
}

window.onload = loadQuestions;
  const suggestionBank = {
    home:[
  "What was the name of the first street you lived on?",
  "What color was your childhood home?",
  "What was the name of your childhood best friend?",
  "What was the name of your first neighborhood?",
  "What was the first park you remember playing in?",
  "What landmark was closest to your childhood home?",
  "What was the name of your first grade teacher?",
  "What was your favorite hiding place as a child?",
  "What tree or plant do you remember from your backyard?",
  "What was the number of your childhood house?",
  "What was your favorite game to play outside?",
  "Who lived across the street from you growing up?",
  "What kind of fence (or no fence) did your house have?",
  "What was the name of a nearby lake or river you visited?",
  "What was your childhood bedroom color?",
  "What was the nickname of your childhood home?",
  "What road did you take to school as a kid?",
  "What local business do you remember near your home?"
],
    family: [
  "What is your mother's maiden name?",
  "What was your grandfather's first name?",
  "What was your grandmother’s nickname for you?",
  "Which relative had the most unique hobby?",
  "What was the city your parents first met in?",
  "What was your sibling’s childhood nickname?",
  "What was your family dog’s name growing up?",
  "Where did your family go for reunions?",
  "What was your father’s first car?",
  "What was your mother’s favorite song?",
  "Who was the oldest cousin in your family?",
  "What tradition did your family have every year?",
  "What family recipe was handed down?",
  "What family member did you resemble most as a child?",
  "What state did your grandparents retire to?",
  "What was the middle name of your favorite aunt?",
  "What holiday was most celebrated in your family?",
  "Who had the loudest laugh in your family?"
],
    Pets: [
  "What was the name of your first pet?",
  "What species was your first pet?",
  "What was the nickname you called your first pet?",
  "What trick did your first pet know?",
  "Where did you get your first pet from?",
  "What was your pet’s favorite toy?",
  "What was your pet's favorite sleeping spot?",
  "What was the color of your first pet?",
  "What unusual habit did your pet have?",
  "What was the breed of your childhood dog or cat?",
  "What was your pet’s favorite treat?",
  "What was the pet’s vet’s name?",
  "Where did your pet like to hide?",
  "What was the most mischievous thing your pet did?",
  "What was the name of the pet you wished you had?"
],
    life: [
  "What was the first vacation you remember?",
  "What was your childhood home’s street number?",
  "What time did your school bus pick you up?",
  "What was the name of your childhood doctor?",
  "What chore did you hate the most growing up?",
  "What was your first broken bone or injury?",
  "What was the name of your kindergarten teacher?",
  "What was the first movie you saw in a theater?",
  "What was your favorite school subject?",
  "What was your bedtime routine as a child?",
  "What game did you play most at recess?",
  "What was your first Halloween costume?",
  "What was the first major news event you remember?",
  "What was your favorite childhood weekend activity?",
  "What was the name of your neighborhood or subdivision?"
],
    favorites: [
  "What was your favorite book growing up?",
  "What was your favorite movie as a teenager?",
  "What was your favorite band in high school?",
  "What was your favorite childhood toy?",
  "What was your favorite sports team as a kid?",
  "What was your favorite outdoor activity?",
  "What was your favorite indoor game?",
  "What was your favorite holiday tradition?",
  "What was your favorite TV show growing up?",
  "What was your favorite subject in school?",
  "What was your favorite place to visit as a child?",
  "What was your favorite restaurant when you were young?",
  "What was your favorite color in elementary school?",
  "What was your favorite cartoon character?",
  "What was your favorite video game growing up?"
],
    random: [
  "What was the name of your imaginary friend?",
  "What was your favorite hiding spot as a child?",
  "What was the first movie you remember seeing in a theater?",
  "What did you want to be when you grew up at age 5?",
  "What was your favorite board game growing up?",
  "What unusual pet did you want but never had?",
  "What was your favorite recess game?",
  "What costume did you wear for Halloween most often?",
  "What weird collection did you have as a kid?",
  "What was your favorite subject in elementary school?",
  "What fictional world did you wish was real?",
  "What was the first prize you ever won?",
  "What secret hiding place did you use as a kid?",
  "What song reminds you of your childhood?",
  "What superstition did you believe as a child?"
],
    school: [
  "What was the name of your elementary school?",
  "Who was your favorite high school teacher?",
  "What was your favorite subject in middle school?",
  "What sport did you play at school?",
  "What was your favorite school event?",
  "Who was your childhood best friend at school?",
  "What was the mascot of your school?",
  "What was the first book you remember reading for class?",
  "What song reminds you of your school days?",
  "What was your favorite field trip?",
  "What was the first language class you took?",
  "What award did you first win at school?",
  "Who was your first school crush?",
  "What was the name of your bus driver?",
  "What was the color of your locker?",
  "What elective class did you enjoy the most?",
  "What was your school’s rival team name?",
  "What lunch item did you always trade?"
],
    career: [
  "What was the name of your first boss?",
  "What was your very first job?",
  "Where did you earn your first paycheck?",
  "What was your dream job as a teenager?",
  "What company gave you your first job offer?",
  "What was your job title at your first job?",
  "What was the name of your favorite coworker at your first job?",
  "What tool or equipment did you first learn to use at work?",
  "What skill did you first learn on the job?",
  "What was the biggest mistake you made at your first job?",
  "What uniform did you wear at your first job?",
  "Where did you have your first job interview?",
  "What was the first career you seriously considered?",
  "What industry was your first job in?",
  "What was your first promotion at work?"
],
    travel: [
  "What was your first vacation destination?",
  "What was the first country you visited?",
  "What is your favorite national park?",
  "What was the name of the first hotel you stayed in?",
  "Which beach do you remember visiting first?",
  "Where did you go on your first solo trip?",
  "What city did you love visiting most as a child?",
  "What was the first flight number you remember taking?",
  "Where did you go for a childhood road trip?",
  "What was the name of the amusement park you visited?",
  "What mode of transport do you associate with your first trip?",
  "What’s the name of a memorable airport you flew through?",
  "Which relative’s house did you visit farthest away?",
  "What river cruise or boat ride do you remember?",
  "What was your favorite souvenir from a trip?"
],
  hobbies:[
  "What was your favorite childhood hobby?",
  "What hobby did you spend the most time on as a teenager?",
  "What instrument did you first learn to play?",
  "What was the first sport you participated in?",
  "What craft or art project did you enjoy as a kid?",
  "What was your favorite type of puzzle growing up?",
  "What collection did you start as a child?",
  "What board game did you always want to win?",
  "What was your favorite thing to build with Legos?",
  "What outdoor activity did you love most as a kid?",
  "What was your favorite arcade or video game growing up?",
  "What book series did you become obsessed with?",
  "What was your favorite science experiment you tried?",
  "What dance or performance hobby did you enjoy?",
  "What hobby have you always wanted to master?"
],
  special: [
  "What holiday holds the most meaning to you?",
  "What tradition is most important to you?",
  "What event in your life made you feel truly proud?",
  "What family heirloom means the most to you?",
  "What was the most memorable gift you ever received?",
  "What location holds a special place in your heart?",
  "What song reminds you of home?",
  "What was your happiest childhood memory?",
  "What teacher had the biggest impact on your life?",
  "What was the most meaningful piece of advice you received?",
  "What special trip do you cherish the most?",
  "What was your first major personal achievement?",
  "What keepsake have you held onto the longest?",
  "What moment made you feel most connected to your family?",
  "What book or story changed your perspective growing up?"
],
  };
  
  
  function populateSuggestions() {
    const category = document.getElementById('categoryDropdown').value;
    const listDiv = document.getElementById('suggestionsList');
    listDiv.innerHTML = '';
  
    if (category && suggestionBank[category]) {
      suggestionBank[category].forEach(q => {
        const btn = document.createElement('button');
        btn.textContent = q;
        btn.style.cssText = `
          display:block; width:100%; text-align:left; 
          background:#333; border:none; color:white; 
          padding:8px; margin-top:5px; border-radius:6px;
          font-size:15px; cursor:pointer;
        `;
        btn.onclick = () => {
          document.getElementById('editInput').value = q;
        };
        listDiv.appendChild(btn);
      });
    }
  }
  
  function saveEditedQuestion() {
    const newQuestion = document.getElementById('editInput').value.trim();
    if (newQuestion && currentEditIndex !== null) {
      questions[currentEditIndex] = newQuestion;
      document.getElementById(`question-${currentEditIndex}`).innerHTML = `<b>${currentEditIndex + 1}.</b> ${newQuestion}`;
      localStorage.setItem('questions', JSON.stringify(questions));
    }
    closeModal();
  }

  document.addEventListener("DOMContentLoaded", () => {
  loadQuestions();
  document.getElementById("categoryDropdown").addEventListener("change", populateSuggestions);
});

  const canvas = document.getElementById("matrixCanvas");
  const ctx = canvas.getContext("2d");

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890@$%&'.split('');
  const fontSize = 14;
  const columns = Math.floor(canvas.width / fontSize);
  const drops = Array(columns).fill(0);

/* Matrix rain controller for Setup Questions page */
(function () {
  const canvas = document.getElementById('matrixCanvas');
  if (!canvas) return; // safe if the canvas isn't on this page
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

  window.SetupQuestionsMatrix = {
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

