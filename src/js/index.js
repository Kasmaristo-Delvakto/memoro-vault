function showSafetyModal() {
    document.getElementById('safetyModal').style.display = 'flex';
  }

  function typeWriterEffect(text, element, delay = 30, callback = null) {
    let i = 0;
    element.innerText = "";
    function type() {
      if (i < text.length) {
        element.innerText += text.charAt(i);
        i++;
        setTimeout(type, delay);
      } else if (callback) {
        callback();
      }
    }
    type();
  }

  function acceptSafety() {
    document.getElementById('safetyModal').style.display = 'none';
    const p = document.getElementById('mainText');
    const btn = document.getElementById('startBtn');
    btn.style.display = 'none';

    const message = `Asserting_Digital_Sovereignty...\nVerifying_Untampered_Interface.\nActivating_Memory-Based_Security...`;

    typeWriterEffect(message, p, 28, () => {
      setTimeout(() => window.location.href = "dashboard.html", 1000);
    });
  }

  // Delay + setInterval version (original timing but reliable start)
  window.addEventListener('load', () => {
    setTimeout(() => {
      const canvas = document.getElementById('matrix');
      const ctx = canvas.getContext('2d');
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890@$%&".split('');
      const fontSize = 14;
      let columns, drops;

      function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        columns = Math.floor(canvas.width / fontSize);
        drops = Array(columns).fill(0);
      }

      function drawMatrix() {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#00ff99';
        ctx.font = fontSize + "px monospace";

        for (let i = 0; i < drops.length; i++) {
          const text = letters[Math.floor(Math.random() * letters.length)];
          ctx.fillText(text, i * fontSize, drops[i] * fontSize);
          if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
            drops[i] = 0;
          }
          drops[i]++;
        }
      }

      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);
      setInterval(drawMatrix, 66); // ← original smooth speed
    }, 50); // short boot delay to fix first-frame race
  });

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