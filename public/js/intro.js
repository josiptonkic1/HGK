// Uvodni video (zlatna kuna) prije pozivnice i prijave.
// - preko cijelog ekrana: na uspravnom mobitelu koristi se uspravni video (/media/intro-portrait.mp4)
//   ako postoji; inače položeni video u sredini, a iza njega isti video povećan i zamućen (bez crnih traka)
// - jednom po posjetu (sessionStorage), gumb "Preskoči" i gumb za zvuk
// - na sporoj vezi ili ako se video ne može pokrenuti, odmah se prikazuje stranica
// - window.zkIntroDone je Promise koji se ispuni kad uvod završi (npr. za animaciju kune)
(function () {
  var KEY = 'zk31_intro_seen';
  var LANDSCAPE = '/media/intro.mp4';
  var PORTRAIT = '/media/intro-portrait.mp4';
  var resolveDone;
  window.zkIntroDone = new Promise(function (r) { resolveDone = r; });

  var seen = false;
  try { seen = sessionStorage.getItem(KEY) === '1'; } catch (e) { /* */ }
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (seen || reduced || /[?&]bez-uvoda\b/.test(location.search)) { resolveDone(); return; }

  var portrait = window.matchMedia && matchMedia('(orientation: portrait)').matches;

  var css =
    '#zk-intro{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;z-index:9999;background:#000;overflow:hidden;transition:opacity .6s ease}' +
    '#zk-intro.done{opacity:0;pointer-events:none}' +
    '#zk-intro video{position:absolute;inset:0;width:100%;height:100%}' +
    '#zk-intro .zk-bg{object-fit:cover;filter:blur(28px) brightness(.55) saturate(1.2);transform:scale(1.15)}' +
    '#zk-intro .zk-fg{object-fit:contain}' +
    '#zk-intro.full .zk-fg{object-fit:cover}' +
    '#zk-intro.full .zk-bg{display:none}' +
    '#zk-intro .zk-intro-btns{position:absolute;right:16px;bottom:calc(18px + env(safe-area-inset-bottom));display:flex;gap:10px;z-index:2}' +
    '#zk-intro button{font:600 14px Montserrat,Arial,sans-serif;color:#f2d892;background:rgba(0,0,0,.55);border:1px solid rgba(216,178,94,.6);border-radius:999px;padding:10px 16px;cursor:pointer;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}' +
    '#zk-intro button:hover{background:rgba(216,178,94,.18)}';
  var style = document.createElement('style');
  style.textContent = css;
  document.documentElement.appendChild(style);

  var ov = document.createElement('div');
  ov.id = 'zk-intro';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', 'Uvodna animacija – 31. Zlatna kuna');
  ov.innerHTML =
    '<video class="zk-bg" muted playsinline preload="auto" aria-hidden="true"></video>' +
    '<video class="zk-fg" muted playsinline preload="auto" aria-hidden="true"></video>' +
    '<div class="zk-intro-btns"><button type="button" data-sound>🔇 Zvuk</button><button type="button" data-skip>Preskoči ›</button></div>';
  // dodaje se na <html> odmah, prije nego što se stranica iscrta
  document.documentElement.appendChild(ov);
  var fg = ov.querySelector('.zk-fg');
  var bg = ov.querySelector('.zk-bg');

  var finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* */ }
    ov.classList.add('done');
    resolveDone();
    setTimeout(function () {
      try { fg.pause(); bg.pause(); } catch (e) { /* */ }
      ov.remove();
      style.remove();
    }, 650);
  }

  function play() {
    var p = fg.play();
    if (p && p.catch) p.catch(function () { finish(); });
    if (!ov.classList.contains('full')) bg.play().catch(function () {});
  }

  // položeni video: u sredini cijeli, iza njega zamućena kopija preko cijelog ekrana
  function useLandscape() {
    ov.classList.remove('full');
    fg.src = LANDSCAPE;
    bg.src = LANDSCAPE;
    play();
  }

  if (portrait) {
    // uspravni video ispunjava cijeli uspravni ekran; pušta se tek kad je učitan,
    // a ako ne postoji (404), mirno se prelazi na položeni video
    ov.classList.add('full');
    var onReady = function () { play(); };
    fg.addEventListener('canplay', onReady, { once: true });
    fg.addEventListener('error', function () {
      fg.removeEventListener('canplay', onReady);
      fg.addEventListener('error', finish);
      useLandscape();
    }, { once: true });
    fg.src = PORTRAIT;
  } else {
    fg.addEventListener('error', finish);
    useLandscape();
  }

  // pozadinska kopija prati glavni video
  fg.addEventListener('seeked', function () { bg.currentTime = fg.currentTime; });
  fg.addEventListener('ended', finish);
  ov.querySelector('[data-skip]').addEventListener('click', finish);
  ov.querySelector('[data-sound]').addEventListener('click', function () {
    fg.muted = !fg.muted;
    this.textContent = fg.muted ? '🔇 Zvuk' : '🔊 Zvuk';
    if (fg.paused) fg.play().catch(function () {});
  });
  document.addEventListener('keydown', function (e) {
    if (!finished && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) finish();
  });

  // ako se video ne pokrene brzo (spora veza, blokirano automatsko puštanje) - preskoči
  var started = false;
  fg.addEventListener('playing', function () { started = true; });
  setTimeout(function () { if (!started) finish(); }, 4000);
  // sigurnosno: najdulje 15 s
  setTimeout(finish, 15000);
})();
