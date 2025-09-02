/* ---------------- MATRIX BACKGROUND ---------------- */
const Matrix = {
  interval:null, resizeHandler:null, running:false,
  start(){
    if(this.running) return;
    const c=document.getElementById('matrix'); if(!c) return;
    const ctx=c.getContext('2d');
    const letters="ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890@$%&".split('');
    const fontSize=14; let cols,drops;
    const resize=()=>{ c.width=innerWidth; c.height=innerHeight; cols=Math.floor(c.width/fontSize); drops=Array(cols).fill(0); };
    const draw=()=>{ ctx.fillStyle='rgba(0,0,0,0.15)'; ctx.fillRect(0,0,c.width,c.height);
      ctx.fillStyle='#00ff99'; ctx.font=fontSize+"px monospace";
      for(let i=0;i<drops.length;i++){
        const t=letters[Math.floor(Math.random()*letters.length)];
        ctx.fillText(t,i*fontSize,drops[i]*fontSize);
        if(drops[i]*fontSize>c.height&&Math.random()>0.975) drops[i]=0;
        drops[i]++; } };
    resize(); this.resizeHandler=resize; addEventListener('resize',resize);
    this.interval=setInterval(draw,66); this.running=true; c.style.display='block';
  },
  stop(){
    if(!this.running) return;
    clearInterval(this.interval); removeEventListener('resize',this.resizeHandler);
    const c=document.getElementById('matrix'); if(c){ c.getContext('2d').clearRect(0,0,c.width,c.height); c.style.display='none'; }
    this.running=false;
  }
};

/* ---------------- THEME SWITCHING (with fade + two-tap on touch) ---------------- */
const THEME_KEY = 'theme';
const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints||0) > 0 || (navigator.msMaxTouchPoints||0) > 0;

let previewFrom = null;       // original theme before preview
let pendingPreview = null;    // 'cypherpunk' | 'clean' | null
let __themeRevertTimer = null;

function applyTheme(theme){
  const cy = document.getElementById('theme-cypherpunk');
  const cl = document.getElementById('theme-clean');
  if(!cy || !cl) return;

  cy.disabled = theme !== 'cypherpunk';
  cl.disabled = theme !== 'clean';
  document.body.setAttribute('data-theme', theme);

  // Matrix only on cypherpunk
  if(theme === 'cypherpunk') Matrix.start(); else Matrix.stop();
}

/* Smooth wrapper to avoid blinding switch (uses your #themeFade element / .show CSS) */
function smoothApplyTheme(theme){
  const veil = document.getElementById('themeFade');
  if (veil) {
    veil.style.transition = "opacity 0.5s linear";
    veil.classList.add('show');                // fade IN (0 → 1)
    setTimeout(() => {
      applyTheme(theme);                       // swap theme under cover
      setTimeout(() => veil.classList.remove('show'), 10); // fade OUT
    }, 500); // match the fade-in duration
  } else {
    applyTheme(theme);
  }
}

/* Persist + close modal + show Start */
function chooseTheme(theme){
  // persist to both stores so other pages see it
  sessionStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(THEME_KEY, theme);

  applyTheme(theme);

  // clean up UI
  resetConfirmUI();
  pendingPreview = null;
  clearTimeout(__themeRevertTimer);

  const modal = document.getElementById('themeModal');
  if (modal) modal.style.display='none';
  const startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.style.display='inline-block';
}

/* ---------- Confirm UI helpers ---------- */
function getThemeButton(theme){
  return document.querySelector(`.modal-buttons button[data-theme="${theme}"]`);
}
function resetConfirmUI(){
  document.querySelectorAll('.modal-buttons button').forEach(b=>{
    if (b.dataset.originalText) b.textContent = b.dataset.originalText;
    b.classList.remove('confirming');
    b.removeAttribute('aria-label');
  });
}
function setConfirmUI(theme){
  const target = getThemeButton(theme);
  if (!target) return;
  target.dataset.originalText = target.dataset.originalText || target.textContent;
  target.textContent = `Confirm`;
  target.classList.add('confirming'); // your CSS pulse can target this
  target.setAttribute('aria-label', `Tap again to confirm ${theme} theme`);
}

/* ---------- Main handler (hooked from HTML buttons) ---------- */
function handleThemeClick(theme){
  // If switching mid-flow, clear previous confirm immediately
  if (pendingPreview && pendingPreview !== theme) {
    clearTimeout(__themeRevertTimer);
    resetConfirmUI();
    pendingPreview = null;
  }

  if (!isTouch) {
    // Desktop/laptop: single click
    chooseTheme(theme);
    return;
  }

  // Touch: two taps (preview → confirm)
  if (pendingPreview === theme) {
    // second tap confirms
    chooseTheme(theme);
  } else {
    // first tap previews + shows "Confirm
    previewFrom = sessionStorage.getItem(THEME_KEY) || localStorage.getItem(THEME_KEY) || 'cypherpunk';
    smoothApplyTheme(theme);
    pendingPreview = theme;
    setConfirmUI(theme);

    // auto-revert if not confirmed
    clearTimeout(__themeRevertTimer);
    __themeRevertTimer = setTimeout(()=>{
      if (pendingPreview === theme) {
        resetConfirmUI();
        smoothApplyTheme(previewFrom);
        pendingPreview = null;
      }
    }, 6000);
  }
}

/* cancel preview if tapped outside buttons (touch only) */
document.addEventListener('click', (e)=>{
  if (!isTouch) return;
  if (pendingPreview && !e.target.closest('.modal-buttons')) {
    clearTimeout(__themeRevertTimer);
    resetConfirmUI();
    smoothApplyTheme(previewFrom);
    pendingPreview = null;
  }
});

/* ---------------- SAFETY MODAL ---------------- */
function showSafetyModal(){
  const m = document.getElementById('safetyModal');
  if (m) m.style.display='flex';
}

function typeWriterEffect(txt,el,delay=30,cb=null){
  let i=0; el.innerText="";
  (function t(){ if(i<txt.length){ el.innerText+=txt.charAt(i++); setTimeout(t,delay); }
                else if(cb) cb(); })();
}

function acceptSafety(){
  document.getElementById('safetyModal').style.display='none';
  document.getElementById('startBtn').style.display='none';
  typeWriterEffect('Welcome_to_Memoro_Vault',document.getElementById('mainText'),28,()=>{
    setTimeout(()=>location.href='dashboard.html',1000);
  });
}

/* ---------------- INITIAL BOOT ---------------- */
window.addEventListener('DOMContentLoaded',()=>{
  const saved = sessionStorage.getItem(THEME_KEY) || localStorage.getItem(THEME_KEY);
  if(saved){
    applyTheme(saved);
    const startBtn = document.getElementById('startBtn');
    if (startBtn) startBtn.style.display='inline-block';
  } else {
    applyTheme('cypherpunk'); // default
    const modal = document.getElementById('themeModal');
    if (modal) modal.style.display='flex';
  }
});

/* expose handler for inline onclick in index.html */
window.handleThemeClick = handleThemeClick;
