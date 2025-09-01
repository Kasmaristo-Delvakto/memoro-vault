/* ---------------- MATRIX BACKGROUND ---------------- */
const Matrix = {
  interval:null, resizeHandler:null, running:false,
  start(){
    if(this.running) return;
    const c=document.getElementById('matrix'),ctx=c.getContext('2d');
    const letters="ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890@$%&".split('');
    const fontSize=14; let cols,drops;
    const resize=()=>{c.width=innerWidth;c.height=innerHeight;cols=Math.floor(c.width/fontSize);drops=Array(cols).fill(0)};
    const draw=()=>{ctx.fillStyle='rgba(0,0,0,0.15)';ctx.fillRect(0,0,c.width,c.height);
      ctx.fillStyle='#00ff99';ctx.font=fontSize+"px monospace";
      for(let i=0;i<drops.length;i++){const t=letters[Math.floor(Math.random()*letters.length)];
        ctx.fillText(t,i*fontSize,drops[i]*fontSize);
        if(drops[i]*fontSize>c.height&&Math.random()>0.975)drops[i]=0;
        drops[i]++;}};
    resize(); this.resizeHandler=resize; addEventListener('resize',resize);
    this.interval=setInterval(draw,66); this.running=true; c.style.display='block';
  },
  stop(){
    if(!this.running) return;
    clearInterval(this.interval); removeEventListener('resize',this.resizeHandler);
    const c=document.getElementById('matrix'); c.getContext('2d').clearRect(0,0,c.width,c.height);
    c.style.display='none'; this.running=false;
  }
};

/* ... keep Matrix object as-is ... */

/* ---------------- THEME SWITCHING (with fade) ---------------- */
const THEME_KEY = 'theme';
let previewFrom = null;
let choosing = false;
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let pendingPreview = null;

function applyTheme(theme){
  const cy = document.getElementById('theme-cypherpunk');
  const cl = document.getElementById('theme-clean');
  if(!cy || !cl) return;

  cy.disabled = theme !== 'cypherpunk';
  cl.disabled = theme !== 'clean';
  document.body.setAttribute('data-theme', theme);

  // matrix runs only on cypherpunk
  if(theme === 'cypherpunk'){ Matrix.start(); }
  else { Matrix.stop(); }
}

/* Smooth wrapper to avoid blinding switch */
function smoothApplyTheme(theme){
  const veil = document.getElementById('themeFade');
  if (veil) {
    // ensure CSS transition is linear 0.5s
    veil.style.transition = "opacity 0.5s linear";
    veil.classList.add('show');   // fade IN (0 → 1)

    // wait for fade-in to finish
    setTimeout(() => {
      applyTheme(theme);          // swap themes under cover
      // fade OUT back to normal
      setTimeout(() => veil.classList.remove('show'), 10);
    }, 500); // matches fade-in duration
  } else {
    applyTheme(theme);
  }
}

function previewTheme(theme){
  if(choosing) return;
  if(previewFrom == null) previewFrom = sessionStorage.getItem(THEME_KEY) || 'cypherpunk';
  smoothApplyTheme(theme);
}

function endPreview(){
  if(choosing) return;
  if(previewFrom != null){
    smoothApplyTheme(previewFrom);
    previewFrom = null;
  }
}

function chooseTheme(theme){
  choosing = true;
  previewFrom = null;
  sessionStorage.setItem(THEME_KEY, theme);
  smoothApplyTheme(theme);

  document.getElementById('themeModal').style.display='none';
  document.getElementById('startBtn').style.display='inline-block';

  setTimeout(()=>{ choosing=false; }, 200);
}

function handleThemeClick(theme){
  if(!isTouch){
    // Desktop: immediate choose
    chooseTheme(theme);
    return;
  }

  // Mobile: two-step
  if(pendingPreview === theme){
    // second tap → confirm
    chooseTheme(theme);
    pendingPreview = null;
  } else {
    // first tap → preview
    previewFrom = sessionStorage.getItem(THEME_KEY) || 'cypherpunk';
    smoothApplyTheme(theme);
    pendingPreview = theme;

    // auto-revert after 4s if no confirmation
    setTimeout(()=>{
      if(pendingPreview === theme){
        smoothApplyTheme(previewFrom);
        pendingPreview = null;
      }
    }, 4000);
  }
}

// cancel preview if tapped outside buttons
document.addEventListener('click', (e)=>{
  if(!isTouch) return;
  if(pendingPreview && !e.target.closest('.modal-buttons')){
    smoothApplyTheme(previewFrom);
    pendingPreview = null;
  }
});

/* ---------------- SAFETY MODAL ---------------- */
function showSafetyModal(){
  document.getElementById('safetyModal').style.display='flex';
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
  const saved = sessionStorage.getItem(THEME_KEY);
  if(saved){
    applyTheme(saved);
    document.getElementById('startBtn').style.display='inline-block';
  } else {
    applyTheme('cypherpunk'); // default
    document.getElementById('themeModal').style.display='flex';
  }
});