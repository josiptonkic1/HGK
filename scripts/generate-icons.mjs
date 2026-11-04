// Generira PNG ikone web aplikacije (zlatni "31." na crnoj podlozi).
// Pokretanje: node scripts/generate-icons.mjs   (koristi pngjs iz devDependencies)
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'img');
mkdirSync(OUT, { recursive: true });

const GOLD = [[255, 241, 193], [240, 208, 128], [197, 149, 47], [245, 220, 142], [169, 122, 40]];
function gold(t) {
  const x = Math.min(Math.max(t, 0), 1) * (GOLD.length - 1);
  const i = Math.min(Math.floor(x), GOLD.length - 2);
  const f = x - i;
  return GOLD[i].map((c, k) => Math.round(c + (GOLD[i + 1][k] - c) * f));
}

function icon(size, { maskable = false } = {}) {
  const png = new PNG({ width: size, height: size });
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const k = a / 255;
    png.data[i] = Math.round(png.data[i] * (1 - k) + r * k);
    png.data[i + 1] = Math.round(png.data[i + 1] * (1 - k) + g * k);
    png.data[i + 2] = Math.round(png.data[i + 2] * (1 - k) + b * k);
    png.data[i + 3] = 255;
  };

  // pozadina: tamna s blagim zlatnim sjajem pri vrhu
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - size / 2) / size;
      const dy = (y - size * 0.25) / size;
      const glow = Math.max(0, 0.22 - Math.sqrt(dx * dx + dy * dy) * 0.45);
      set(x, y, [12 + glow * 160, 10 + glow * 120, 7 + glow * 50]);
    }
  }

  // sadržaj unutar sigurne zone (maskable: 80 %)
  const pad = size * (maskable ? 0.2 : 0.12);
  const area = size - pad * 2;
  const top = pad + area * 0.12;
  const h = area * 0.62;
  const t = h * 0.17; // debljina crte
  const w = h * 0.52;
  const gap = h * 0.12;
  const dot = t * 1.05;
  const total = w + gap + w * 0.55 + gap * 0.7 + dot;
  const left = pad + (area - total) / 2;

  const rect = (x0, y0, x1, y1) => {
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        // rubno zaglađivanje
        const cov = Math.min(1, x + 1 - x0, x1 - x) * Math.min(1, y + 1 - y0, y1 - y);
        if (cov > 0) set(x, y, gold((y - top) / h), Math.round(255 * Math.min(1, cov)));
      }
    }
  };

  // znamenka 3
  const x3 = left;
  rect(x3, top, x3 + w, top + t);
  rect(x3 + w * 0.25, top + h / 2 - t / 2, x3 + w, top + h / 2 + t / 2);
  rect(x3, top + h - t, x3 + w, top + h);
  rect(x3 + w - t, top, x3 + w, top + h);
  // znamenka 1
  const x1 = x3 + w + gap;
  const w1 = w * 0.55;
  rect(x1 + w1 - t, top, x1 + w1, top + h);
  rect(x1, top + t * 0.2, x1 + w1, top + t * 1.1);
  // točka
  const xd = x1 + w1 + gap * 0.7;
  rect(xd, top + h - dot, xd + dot, top + h);

  // natpis "ZLATNA KUNA" kao zlatna linija ispod
  const ly = top + h + area * 0.1;
  rect(left, ly, left + total, ly + Math.max(2, size * 0.012));

  return PNG.sync.write(png);
}

const files = [
  ['icon-192.png', icon(192)],
  ['icon-512.png', icon(512)],
  ['icon-maskable-512.png', icon(512, { maskable: true })],
  ['apple-touch-icon.png', icon(180)],
  ['favicon-32.png', icon(32)],
];
for (const [name, buf] of files) writeFileSync(join(OUT, name), buf);
console.log('Ikone generirane:', files.map(([n]) => n).join(', '));
