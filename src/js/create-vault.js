  // Toggle Create-Vault styles + matrix by theme
  function applyCreateVaultTheme(theme) {
    const cy = document.getElementById('theme-cypherpunk');
    const cl = document.getElementById('theme-clean');
    const isCypher = (theme === 'cypherpunk');

    // 1) Flip stylesheets (safe in <head>)
    if (cy) cy.disabled = !isCypher;
    if (cl) cl.disabled =  isCypher;

    // 2) Body attribute (for CSS hooks)
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

    // 3) Matrix control (expects window.CreateVaultMatrix)
    if (window.CreateVaultMatrix) {
      if (isCypher) CreateVaultMatrix.start();
      else CreateVaultMatrix.stop();
    }
  }

  // Read saved theme and pre-flip stylesheets early (avoid FOUC)
  (function initCreateVaultTheme(){
    const saved = sessionStorage.getItem('theme') || 'cypherpunk';
    window.__savedCreateVaultTheme = saved;

    const cy = document.getElementById('theme-cypherpunk');
    const cl = document.getElementById('theme-clean');
    const isCypher = (saved === 'cypherpunk');
    if (cy) cy.disabled = !isCypher;
    if (cl) cl.disabled =  isCypher;
  })();

  // Ensure apply runs even if DOMContentLoaded already fired
  (function bootstrapCreateVaultTheme(){
    const apply = () => applyCreateVaultTheme(window.__savedCreateVaultTheme || 'cypherpunk');
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', apply, { once: true });
    } else {
      apply();
    }
  })();

  // Matrix rain controller for Create Vault
(function(){
  const canvas = document.getElementById('matrix');
  const ctx = canvas.getContext('2d');
  const letters = "01ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%^&*";
  const fontSize = 14;
  let columns = 0, drops = [];
  let timer = null;

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    columns = Math.floor(canvas.width / fontSize);
    drops = Array(columns).fill(1);
  }

  function drawMatrix() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#00ff99';
    ctx.font = fontSize + "px monospace";

    for (let i = 0; i < drops.length; i++) {
      const text = letters[Math.floor(Math.random() * letters.length)];
      ctx.fillText(text, i * fontSize, drops[i] * fontSize);
      if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    }
  }

  window.CreateVaultMatrix = {
    start() {
      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);
      if (!timer) timer = setInterval(drawMatrix, 33);
      canvas.style.display = 'block';
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
    }
  };
})();

    function updateQuestionCount() {
      document.getElementById('questionCount').textContent = document.getElementById('questionSlider').value;
    }

    function startVaultSetup() {
      const questionCount = document.getElementById('questionSlider').value;
      localStorage.setItem('customQuestionCount', questionCount);
      window.location.href = "setup-questions.html";
    }

    function goBack() {
      window.history.back();
    }

    window.onload = () => {
      const saved = localStorage.getItem('customQuestionCount');
      if (saved) {
        document.getElementById('questionSlider').value = saved;
        updateQuestionCount();
      }
    };
