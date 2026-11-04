// Zlatna kuna od čestica preko loga "31. Zlatna kuna".
// Pri otvaranju zlatna prašina doleti i složi se u kunu, zatim kuna mirno svjetluca:
// čestice trepere, tijelo ima blagi zlatni sjaj, povremeno prijeđe odsjaj, a sitna prašina lebdi.
// Obris je izdvojen iz referentne slike kune (bitmapa 1 bit/piksel, base64).
// Bez biblioteka - jedan <canvas>. Poštuje "smanji animacije" u postavkama uređaja.
(function () {
  var MASK = { w: 212, h: 59, b64: 'AAAAAAAAAAAAAAAADwAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAMD/DwAAAAAAAAAAAPADAAAAAAAAAAAAAAAA8P//HwAAAAAAAAAAwH8AAAAAAAAAAAAAAAAA/////wEAAAAAAAAA/w8AAAAAAAAAAAAAAAD4////PwAAAAAAAAD4/wEAAAAAAAAAAAAAAOD/////DwAAAAAAAID/PwAAAAAAAAAAAAAAgP//////DwAAAAAAAPz/BwAAAAAAAAAAAAAA////////BwAAAAAA+P//AQAAAAAAAAAAAAD/////////DwAAAAD8//9/AAAAAAAAAAAAAPz/////////AwAAAOD///8PAAAAAAAAAAAA+P////////9/AAAAgP////8AAAAAAAAAAADA//////////8PAADA/////x8AAAAAAAAAAAD///////////8/APD//////wcAAAAAAAAAAP///////////////////////wAAAAAAAAAA/v//////////////////////DwAAAAAAAADw////////////////////////AQAAAAAAAMD///////////////////////9/AAAAAAAAAP7///////////////////////8fAAAAAAAA+P////////////////////////8DAAAAAADg/////////////////////////38AAAAAAAD+/////////////////////////wcAAAAAAPD/////////////////////////fwAAAAAA4P//////////////////////////DwAAAAAA////////////////////////////AAAAAAD+//////////////////////////8HAAAAAP///////////////////////////x8AAAAA/P//////////////////////////HwAAAADw//////////////////////////8BAAAAAID/////////////////////////DwAAAAAA4P////////////////////////8PAAAAAAD4/////////////////////////x8AAAAA4P//////////////////////////PwAAAADg////////////////////////////AAAAAAD///////////////////////////8BAAAAAPj//////////////////////////wMAAAAAwP//////////////////////////PwAAAAAA/v//////////////DwDg////////AwAAAADg//////////////8/AAD4//////8/AAAAAAD+//////////////8BAAAAAPz///8DAAAAAPD//////////////w8AAAAAgP///z8AAAAAAP//////////////fwAAAAAA+P///wMAAAAA4P//////////////AwAAAACA////fwAAAAAA+P////////////8HAAAAAADw/////w8AAAAA/v///////////x8AAAAAAAD//////wcAAADg/////////////wAAAAAAAPD//////wEAAAD8/////x8AwP//AwAAAAAAAP7/////fwAAAAD+/////wAAAAAAAAAAAAAAwP//////DwAAAAAA/P9/AAAAAAAAAAAAAAAA4P//////AQAAAADA//8DAAAAAAAAAAAAAAAAgP//////AAAAAAD4/x8AAAAAAAAAAAAAAAAAAAAA/P8fAAAAAAD//wAAAAAAAAAAAAAAAAAAAAAA/P8HAAAAAPD/BwAAAAAAAAAAAAAAAAAAAAAA//8AAAAAAP4fAAAAAAAAAAAAAAAAAAAAAADA/x8AAAAAgH8AAAAAAAAAAAAAAAAAAAAAAAD4/wEAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAD/PwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOD/AwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPw/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwP8BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAcAAA==' };
  var COLORS = ['#fff7dc', '#fde7a8', '#f3cf78', '#e0ad4c', '#c39136'];

  // Bitmapa -> canvas s obrisom (bijelo na prozirnom)
  function maskCanvas() {
    var bin = atob(MASK.b64);
    var c = document.createElement('canvas');
    c.width = MASK.w;
    c.height = MASK.h;
    var g = c.getContext('2d');
    var img = g.createImageData(MASK.w, MASK.h);
    for (var k = 0; k < MASK.w * MASK.h; k++) {
      if (bin.charCodeAt(k >> 3) & (1 << (k & 7))) {
        img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = img.data[k * 4 + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // Točke unutar obrisa; rub gušće (jasan, profinjen obris), unutrašnjost rjeđe (prašina).
  function samplePoints(mask, count) {
    var S = 4;
    var c = document.createElement('canvas');
    c.width = MASK.w * S;
    c.height = MASK.h * S;
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.filter = 'blur(1.5px)';
    g.drawImage(mask, 0, 0, c.width, c.height);
    var data = g.getImageData(0, 0, c.width, c.height).data;
    var W = c.width;
    var H = c.height;
    var inside = function (x, y) { return x >= 0 && y >= 0 && x < W && y < H && data[(y * W + x) * 4 + 3] > 127; };
    var edge = [];
    var fill = [];
    for (var y = 0; y < H; y += 2) {
      for (var x = 0; x < W; x += 2) {
        if (!inside(x, y)) continue;
        var d = 6;
        var isEdge = !inside(x + d, y) || !inside(x - d, y) || !inside(x, y + d) || !inside(x, y - d);
        (isEdge ? edge : fill).push([x / W, y / H]);
      }
    }
    var shuffle = function (a) { for (var i = a.length - 1; i > 0; i--) { var j = (Math.random() * (i + 1)) | 0; var t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
    shuffle(edge);
    shuffle(fill);
    var nEdge = Math.min(edge.length, Math.round(count * 0.68));
    return edge.slice(0, nEdge).concat(fill.slice(0, count - nEdge));
  }

  function makeSprite(color) {
    var s = 32;
    var c = document.createElement('canvas');
    c.width = c.height = s;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.16, color);
    grd.addColorStop(0.42, color + '55');
    grd.addColorStop(1, color + '00');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    return c;
  }

  // Zvjezdica s četiri kraka (za povremeno svjetlucanje)
  function makeStar() {
    var s = 64;
    var c = document.createElement('canvas');
    c.width = c.height = s;
    var g = c.getContext('2d');
    var h = s / 2;
    g.translate(h, h);
    for (var r = 0; r < 2; r++) {
      var grd = g.createLinearGradient(-h, 0, h, 0);
      grd.addColorStop(0, 'rgba(255,230,160,0)');
      grd.addColorStop(0.5, 'rgba(255,248,220,1)');
      grd.addColorStop(1, 'rgba(255,230,160,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(-h, 0);
      g.quadraticCurveTo(0, -1.6, h, 0);
      g.quadraticCurveTo(0, 1.6, -h, 0);
      g.fill();
      g.rotate(Math.PI / 2);
    }
    var core = g.createRadialGradient(0, 0, 0, 0, 0, h * 0.35);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.4, 'rgba(255,225,150,0.6)');
    core.addColorStop(1, 'rgba(255,210,120,0)');
    g.fillStyle = core;
    g.fillRect(-h, -h, s, s);
    return c;
  }

  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };

  window.startGoldenMarten = function (logo) {
    if (!logo) return;
    var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var canvas = document.createElement('canvas');
    canvas.className = 'kuna-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    logo.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var sprites = COLORS.map(makeSprite);
    var star = makeStar();
    var mask = maskCanvas();
    var glow = null; // zlatno obojeni obris za blagi sjaj tijela
    var dpr = 1;
    var W = 0;
    var H = 0;
    var box = { x: 0, y: 0, w: 0, h: 0 };
    var particles = [];
    var dust = [];
    var start = performance.now();
    var running = true;

    function layout() {
      var r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width;
      H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      // Na sredini loga, preko broja "31."
      var num = logo.querySelector('.num');
      var nr = num ? num.getBoundingClientRect() : r;
      var cy = (nr.top + nr.height * 0.5) - r.top;
      box.w = Math.min(W * 0.8, r.width);
      box.h = box.w * (MASK.h / MASK.w);
      box.x = (W - box.w) / 2;
      box.y = cy - box.h * 0.55;

      glow = document.createElement('canvas');
      glow.width = Math.max(1, Math.round(box.w * dpr));
      glow.height = Math.max(1, Math.round(box.h * dpr));
      var g = glow.getContext('2d');
      g.filter = 'blur(' + (1.2 * dpr) + 'px)';
      g.drawImage(mask, 0, 0, glow.width, glow.height);
      g.filter = 'none';
      g.globalCompositeOperation = 'source-in';
      var grd = g.createLinearGradient(0, 0, glow.width, glow.height);
      grd.addColorStop(0, '#f7e2a0');
      grd.addColorStop(0.45, '#c9973a');
      grd.addColorStop(0.7, '#f5d888');
      grd.addColorStop(1, '#b8862f');
      g.fillStyle = grd;
      g.fillRect(0, 0, glow.width, glow.height);
    }

    function build() {
      // Rijetka zlatna prašina: obris se nazire, nije ispunjen.
      var count = Math.round(Math.min(1100, Math.max(460, box.w * 3)));
      particles = samplePoints(mask, count).map(function (p) {
        var isStar = Math.random() < 0.05;
        return {
          star: isStar,
          nx: p[0],
          ny: p[1],
          size: isStar ? 2.2 + Math.random() * 2.6 : 0.35 + Math.pow(Math.random(), 3) * 1.25,
          color: (Math.random() * COLORS.length) | 0,
          base: 0.4 + Math.random() * 0.6,
          tw: 1.2 + Math.random() * 3.2,
          ph: Math.random() * Math.PI * 2,
          sx: -0.3 - Math.random() * 0.8,
          sy: (Math.random() - 0.5) * 1.6,
          delay: p[0] * 0.7 + Math.random() * 0.55,
          dur: 1.1 + Math.random() * 0.8,
        };
      });
    }

    // Sitna zlatna prašina koja se diže s kune i nestaje.
    function emitDust() {
      var p = particles[(Math.random() * particles.length) | 0];
      if (!p) return;
      dust.push({
        x: box.x + p.nx * box.w,
        y: box.y + p.ny * box.h,
        vx: (Math.random() - 0.5) * 8,
        vy: -(4 + Math.random() * 12),
        life: 0,
        max: 1.4 + Math.random() * 2,
        size: 0.35 + Math.random() * 1.1,
        color: (Math.random() * COLORS.length) | 0,
      });
    }

    var last = start;
    function frame(now) {
      if (!running) return;
      var t = reduced ? 10 : (now - start) / 1000;
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // blagi zlatni sjaj tijela kad se prašina složi
      // samo jedva vidljiv zlatni dašak ispod prašine (bez punog ispunjenja)
      var fillA = Math.min(1, Math.max(0, (t - 1.6) / 1.2)) * 0.035;
      if (fillA > 0 && glow) {
        ctx.globalAlpha = fillA;
        ctx.drawImage(glow, box.x, box.y, box.w, box.h);
      }

      ctx.globalCompositeOperation = 'lighter';
      // odsjaj prelazi preko kune svakih 6 s
      var cyc = (t - 2.8) % 6;
      var shine = !reduced && t > 2.8 && cyc < 1.5 ? -0.15 + (cyc / 1.5) * 1.3 : -9;

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        var x = box.x + p.nx * box.w;
        var y = box.y + p.ny * box.h;
        var a = p.base;
        var k = Math.min(1, Math.max(0, (t - p.delay) / p.dur));
        if (k < 1) {
          var e = easeOut(k);
          x = box.x + (p.sx + (p.nx - p.sx) * e) * box.w;
          y = box.y + (p.sy + (p.ny - p.sy) * e) * box.h + Math.sin(k * Math.PI) * box.h * 0.3 * (p.sy > 0 ? 1 : -1);
          a *= Math.min(1, k * 2.5);
        }
        var dsh = Math.abs(p.nx - shine);
        var boost = dsh < 0.1 ? 1 - dsh / 0.1 : 0;
        if (p.star) {
          // zvjezdica kratko bljesne pa se ugasi
          var tw = reduced ? 0.6 : Math.pow(Math.max(0, Math.sin(t * p.tw * 0.6 + p.ph)), 8);
          a *= Math.max(tw, boost);
          if (a <= 0.02) continue;
          var ss = p.size * 6 * (0.7 + 0.3 * tw);
          ctx.globalAlpha = Math.min(1, a);
          ctx.drawImage(star, x - ss / 2, y - ss / 2, ss, ss);
          continue;
        }
        if (!reduced) a *= 0.45 + 0.55 * Math.sin(t * p.tw + p.ph);
        if (boost) a = Math.min(1.6, a + boost * 0.9);
        if (a <= 0.02) continue;
        var s = p.size * 3.2;
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(sprites[p.color], x - s / 2, y - s / 2, s, s);
      }

      if (!reduced) {
        if (t > 1.8) {
          var rate = 22 * dt;
          while (rate > 0) { if (Math.random() < rate) emitDust(); rate -= 1; }
        }
        for (var j = dust.length - 1; j >= 0; j--) {
          var d = dust[j];
          d.life += dt;
          if (d.life > d.max) { dust.splice(j, 1); continue; }
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          var f = d.life / d.max;
          var ds = d.size * 3.6;
          ctx.globalAlpha = Math.sin(f * Math.PI) * 0.75;
          ctx.drawImage(sprites[d.color], d.x - ds / 2, d.y - ds / 2, ds, ds);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (reduced) return; // mirna, potpuno složena kuna
      requestAnimationFrame(frame);
    }

    layout();
    build();
    requestAnimationFrame(frame);

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var elapsed = performance.now() - start;
        layout();
        build();
        // nakon promjene veličine ne ponavljaj uvodno slijetanje
        if (elapsed > 3000) start = performance.now() - 4000;
        if (reduced) requestAnimationFrame(frame);
      }, 150);
    });

    // Štedi bateriju: animacija stoji kad stranica nije vidljiva.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { running = false; return; }
      if (!running && !reduced) {
        running = true;
        last = performance.now();
        requestAnimationFrame(frame);
      }
    });
  };
})();
