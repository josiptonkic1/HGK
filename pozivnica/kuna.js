// Zlatna kuna od čestica: pri otvaranju se zlatna prašina stopi u kunu u skoku,
// zatim kuna "trči", čestice svjetlucaju, iza repa ostaje trag prašine i povremeno prijeđe odsjaj.
// Bez biblioteka - jedan <canvas>. Poštuje "smanji animacije" u postavkama uređaja.
(function () {
  // Stilizirani obris kune u skoku, okrenute udesno (koordinate 0-200 x 0-80):
  // lukom savijena leđa, uši, ispružene prednje i stražnje noge, čupav rep.
  var MARTEN =
    'M197 44 Q193 37 186 35 L183 24 L177 33 Q166 29 156 30 Q130 12 100 21 Q86 25 76 31 ' +
    'Q60 24 40 14 Q21 6 4 14 Q15 27 34 32 Q52 38 66 43 ' +
    'Q55 57 34 70 L45 75 Q66 61 87 51 Q118 46 150 48 ' +
    'Q166 58 183 76 L194 72 Q181 58 172 50 Q182 53 193 50 Z';
  var VB_W = 200;
  var VB_H = 80;
  var COLORS = ['#fff6d6', '#fbe3a1', '#f0c96f', '#d9a441', '#b8862f'];

  function samplePoints(count) {
    var S = 3;
    var c = document.createElement('canvas');
    c.width = VB_W * S;
    c.height = VB_H * S;
    var g = c.getContext('2d');
    g.scale(S, S);
    g.fill(new Path2D(MARTEN));
    var data = g.getImageData(0, 0, c.width, c.height).data;
    var W = c.width;
    var H = c.height;
    var inside = function (x, y) { return x >= 0 && y >= 0 && x < W && y < H && data[(y * W + x) * 4 + 3] > 128; };
    var edge = [];
    var fill = [];
    for (var y = 0; y < H; y += 2) {
      for (var x = 0; x < W; x += 2) {
        if (!inside(x, y)) continue;
        var d = 5;
        var isEdge = !inside(x + d, y) || !inside(x - d, y) || !inside(x, y + d) || !inside(x, y - d);
        (isEdge ? edge : fill).push([x / W, y / H]);
      }
    }
    // Rub gušće (jasan obris), unutrašnjost rjeđe (izgleda kao prašina).
    var shuffle = function (a) { for (var i = a.length - 1; i > 0; i--) { var j = (Math.random() * (i + 1)) | 0; var t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
    shuffle(edge);
    shuffle(fill);
    var nEdge = Math.min(edge.length, Math.round(count * 0.62));
    return edge.slice(0, nEdge).concat(fill.slice(0, count - nEdge));
  }

  function makeSprite(color) {
    var s = 32;
    var c = document.createElement('canvas');
    c.width = c.height = s;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.18, color);
    grd.addColorStop(0.45, color + '66');
    grd.addColorStop(1, color + '00');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    return c;
  }

  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };

  window.startGoldenMarten = function (logo) {
    if (!logo || !window.Path2D) return;
    var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var canvas = document.createElement('canvas');
    canvas.className = 'kuna-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    logo.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var sprites = COLORS.map(makeSprite);
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
      // Kuna u skoku preko broja "31." (gornji desni dio loga)
      box.w = Math.min(W * 0.62, H * 1.55);
      box.h = box.w * (VB_H / VB_W);
      box.x = W * 0.6 - box.w * 0.5;
      box.y = H * 0.07;
    }

    function build() {
      var count = Math.round(Math.min(1500, Math.max(650, W * 3.2)));
      particles = samplePoints(count).map(function (p) {
        return {
          nx: p[0],
          ny: p[1],
          size: 0.45 + Math.pow(Math.random(), 2.6) * 1.6,
          color: (Math.random() * COLORS.length) | 0,
          base: 0.45 + Math.random() * 0.55,
          tw: 1.5 + Math.random() * 3.5,
          ph: Math.random() * Math.PI * 2,
          // početak: prašina dolijeće slijeva
          sx: -0.25 - Math.random() * 0.9,
          sy: (Math.random() - 0.5) * 0.9,
          delay: p[0] * 0.7 + Math.random() * 0.55,
          dur: 1.1 + Math.random() * 0.8,
        };
      });
    }

    function emitDust(t) {
      // trag iza repa i uz leđa
      var nx = 0.02 + Math.random() * 0.35;
      var ny = 0.2 + Math.random() * 0.35 + (nx < 0.12 ? -0.05 : 0);
      dust.push({
        x: box.x + nx * box.w,
        y: box.y + ny * box.h,
        vx: -(12 + Math.random() * 38),
        vy: (Math.random() - 0.4) * 10,
        life: 0,
        max: 1.2 + Math.random() * 1.8,
        size: 0.4 + Math.random() * 1.4,
        color: (Math.random() * COLORS.length) | 0,
      });
    }

    var last = start;
    function frame(now) {
      if (!running) return;
      var t = (now - start) / 1000;
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      // trčanje: lagano poskakivanje, izmjena prednjih i stražnjih nogu
      var gait = reduced ? 0 : t * 7.5;
      var bob = Math.sin(gait) * box.h * 0.035;
      // odsjaj prelazi preko kune svakih 6 s
      var cyc = (t - 2.6) % 6;
      var shine = t > 2.6 && cyc < 1.3 ? -0.15 + (cyc / 1.3) * 1.3 : -9;

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        var tx = p.nx;
        var ty = p.ny;
        if (!reduced && p.ny > 0.62) {
          // noge: prednje (desno) i stražnje (lijevo) u suprotnoj fazi
          var leg = p.nx > 0.7 ? Math.sin(gait) : p.nx < 0.38 ? -Math.sin(gait) : 0;
          tx += leg * 0.018 * (p.ny - 0.6) * 4;
        }
        var x = box.x + tx * box.w;
        var y = box.y + ty * box.h + bob * (0.6 + p.nx * 0.4);
        var a = p.base;
        if (!reduced) {
          var k = Math.min(1, Math.max(0, (t - p.delay) / p.dur));
          if (k < 1) {
            var e = easeOut(k);
            x = box.x + (p.sx + (tx - p.sx) * e) * box.w;
            y = box.y + (p.sy + (ty - p.sy) * e) * box.h + Math.sin(k * Math.PI) * box.h * 0.25 * (p.sy > 0 ? 1 : -1);
            a *= Math.min(1, k * 2.5);
          }
          a *= 0.55 + 0.45 * Math.sin(t * p.tw + p.ph);
          var dsh = Math.abs(p.nx - shine);
          if (dsh < 0.09) a = Math.min(1.6, a + (1 - dsh / 0.09) * 0.9);
        }
        if (a <= 0.02) continue;
        var s = p.size * 3.6;
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(sprites[p.color], x - s / 2, y - s / 2, s, s);
      }

      if (!reduced) {
        if (t > 1.2) {
          var rate = 55 * dt;
          while (rate > 0) { if (Math.random() < rate) emitDust(t); rate -= 1; }
        }
        for (var j = dust.length - 1; j >= 0; j--) {
          var d = dust[j];
          d.life += dt;
          if (d.life > d.max) { dust.splice(j, 1); continue; }
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          d.vy += 4 * dt;
          var fade = 1 - d.life / d.max;
          var ds = d.size * 4;
          ctx.globalAlpha = fade * 0.8;
          ctx.drawImage(sprites[d.color], d.x - ds / 2, d.y - ds / 2, ds, ds);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (reduced && t > 0.1) return; // statična slika
      requestAnimationFrame(frame);
    }

    function restart() {
      layout();
      build();
    }

    restart();
    requestAnimationFrame(frame);

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var keep = performance.now() - start;
        restart();
        // nakon promjene veličine ne ponavljaj uvodno slijetanje
        if (keep > 3000) start = performance.now() - 4000;
        if (reduced) requestAnimationFrame(frame);
      }, 150);
    });

    // Štedi bateriju: animacija stoji kad stranica nije vidljiva.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { running = false; return; }
      if (!running) {
        running = true;
        last = performance.now();
        requestAnimationFrame(frame);
      }
    });
  };
})();
