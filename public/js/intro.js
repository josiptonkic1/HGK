// Uvodni video (zlatna kuna) prije pozivnice i prijave.
// - jednom po posjetu (sessionStorage), gumb "Preskoči" i gumb za zvuk
// - na sporoj vezi ili ako se video ne može pokrenuti, odmah se prikazuje stranica
// - window.zkIntroDone je Promise koji se ispuni kad uvod završi (npr. za animaciju kune)
(function () {
  var KEY = 'zk31_intro_seen';
  var resolveDone;
  window.zkIntroDone = new Promise(function (r) { resolveDone = r; });

  var seen = false;
  try { seen = sessionStorage.getItem(KEY) === '1'; } catch (e) { /* */ }
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (seen || reduced || /[?&]bez-uvoda\b/.test(location.search)) { resolveDone(); return; }

  var css =
    '#zk-intro{position:fixed;inset:0;z-index:9999;background:#000;display:flex;align-items:center;justify-content:center;transition:opacity .6s ease}' +
    '#zk-intro.done{opacity:0;pointer-events:none}' +
    '#zk-intro video{width:100%;height:100%;object-fit:contain;background:#000}' +
    '#zk-intro .zk-intro-btns{position:absolute;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));display:flex;gap:10px}' +
    '#zk-intro button{font:600 14px Montserrat,Arial,sans-serif;color:#f2d892;background:rgba(0,0,0,.55);border:1px solid rgba(216,178,94,.6);border-radius:999px;padding:9px 16px;cursor:pointer}' +
    '#zk-intro button:hover{background:rgba(216,178,94,.18)}';
  var style = document.createElement('style');
  style.textContent = css;
  document.documentElement.appendChild(style);

  var ov = document.createElement('div');
  ov.id = 'zk-intro';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', 'Uvodna animacija – 31. Zlatna kuna');
  ov.innerHTML =
    '<video src="/media/intro.mp4" autoplay muted playsinline preload="auto" aria-hidden="true"></video>' +
    '<div class="zk-intro-btns"><button type="button" data-sound>🔇 Zvuk</button><button type="button" data-skip>Preskoči ›</button></div>';
  // dodaje se na <html> odmah, prije nego što se stranica iscrta
  document.documentElement.appendChild(ov);
  var video = ov.querySelector('video');

  var finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* */ }
    ov.classList.add('done');
    resolveDone();
    setTimeout(function () {
      try { video.pause(); } catch (e) { /* */ }
      ov.remove();
      style.remove();
    }, 650);
  }

  video.addEventListener('ended', finish);
  video.addEventListener('error', finish);
  ov.querySelector('[data-skip]').addEventListener('click', finish);
  ov.querySelector('[data-sound]').addEventListener('click', function () {
    video.muted = !video.muted;
    this.textContent = video.muted ? '🔇 Zvuk' : '🔊 Zvuk';
    if (video.paused) video.play().catch(function () {});
  });
  document.addEventListener('keydown', function (e) {
    if (!finished && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) finish();
  });

  // ako se video ne pokrene brzo (spora veza, blokirano automatsko puštanje) - preskoči
  var started = false;
  video.addEventListener('playing', function () { started = true; });
  setTimeout(function () { if (!started) finish(); }, 3500);
  // sigurnosno: najdulje 15 s
  setTimeout(finish, 15000);
  var p = video.play && video.play();
  if (p && p.catch) p.catch(function () { finish(); });
})();
