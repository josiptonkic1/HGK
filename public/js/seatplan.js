// Tlocrt dvorane HNK Zagreb (pojednostavljen): parter, lože, balkon, galerija.
// Čisti modul bez DOM-a: koristi ga i poslužitelj (provjera mjesta, tekst u e-mailu)
// i preglednik (crtanje). Broj redova i sjedala mijenja se samo ovdje.
//
// Oznake mjesta: P-<red>-<sjedalo>, L-<loža>-<mjesto>, B-<red>-<sjedalo>, G-<red>-<sjedalo>.
// Sjedala se broje slijeva nadesno gledano prema pozornici.

export const VIEW = { width: 1000, height: 720 };
const C = { x: 500, y: -40 }; // središte lukova (iza pozornice)
const rad = (deg) => (deg * Math.PI) / 180;
const at = (r, deg) => ({ x: +(C.x - r * Math.sin(rad(deg))).toFixed(1), y: +(C.y + r * Math.cos(rad(deg))).toFixed(1) });

export const SECTIONS = [
  { key: 'P', name: 'Parter', rows: 16, r0: 200, step: 16, span: 40, seats: (row) => 16 + row },
  { key: 'L', name: 'Lože', boxes: 15, perBox: 4, r: 490, span: 84 },
  { key: 'B', name: 'Balkon', rows: 3, r0: 545, step: 20, span: 55, seats: (row) => 42 + 2 * row },
  { key: 'G', name: 'Galerija', rows: 3, r0: 635, step: 20, span: 45, seats: (row) => 48 + 2 * row },
];

let cache = null;

/** Sva mjesta: { id, section, row|box, n, x, y } */
export function allSeats() {
  if (cache) return cache;
  const out = [];
  for (const s of SECTIONS) {
    if (s.key === 'L') {
      const w = (2 * s.span) / s.boxes;
      for (let b = 1; b <= s.boxes; b++) {
        // loža 1 je lijevo (gledano prema pozornici) -> veći kut
        const mid = s.span - w * (b - 0.5);
        for (let n = 1; n <= s.perBox; n++) {
          const deg = mid + w * 0.36 - (w * 0.72 * (n - 1)) / (s.perBox - 1);
          out.push({ id: `L-${b}-${n}`, section: 'L', box: b, n, ...at(s.r, deg) });
        }
      }
      continue;
    }
    for (let row = 1; row <= s.rows; row++) {
      const count = s.seats(row);
      const r = s.r0 + (row - 1) * s.step;
      for (let n = 1; n <= count; n++) {
        const deg = s.span - (2 * s.span * (n - 1)) / (count - 1);
        out.push({ id: `${s.key}-${row}-${n}`, section: s.key, row, n, ...at(r, deg) });
      }
    }
  }
  cache = out;
  return out;
}

/** Obrisi loža za crtanje: { box, path, label:{x,y} } */
export function boxShapes() {
  const s = SECTIONS.find((x) => x.key === 'L');
  const w = (2 * s.span) / s.boxes;
  const shapes = [];
  for (let b = 1; b <= s.boxes; b++) {
    const a1 = s.span - w * (b - 1) - 0.6;
    const a2 = s.span - w * b + 0.6;
    const p = [at(s.r - 13, a1), at(s.r + 13, a1), at(s.r + 13, a2), at(s.r - 13, a2)];
    const path = `M${p[0].x},${p[0].y} L${p[1].x},${p[1].y} A${s.r + 13},${s.r + 13} 0 0 1 ${p[2].x},${p[2].y} L${p[3].x},${p[3].y} A${s.r - 13},${s.r - 13} 0 0 0 ${p[0].x},${p[0].y}Z`;
    shapes.push({ box: b, path, label: at(s.r + 24, (a1 + a2) / 2) });
  }
  return shapes;
}

/** Oznake redova uz lijevi rub sekcije (za crtanje) */
export function rowLabels() {
  const out = [];
  for (const s of SECTIONS) {
    if (!s.rows) continue;
    for (let row = 1; row <= s.rows; row++) {
      const r = s.r0 + (row - 1) * s.step;
      out.push({ text: s.key === 'P' ? String(row) : `${s.key === 'B' ? 'B' : 'G'}${row}`, ...at(r, s.span + 3.2) });
    }
  }
  return out;
}

const ID_RE = /^([PLBG])-(\d{1,2})-(\d{1,2})$/;
let ids = null;
export function isSeat(id) {
  if (!ids) ids = new Set(allSeats().map((s) => s.id));
  return ids.has(String(id));
}

/** "Parter, red 5, sjedalo 12" / "Loža 7, mjesto 2" */
export function seatLabel(id) {
  const m = String(id).match(ID_RE);
  if (!m || !isSeat(id)) return String(id);
  const [, k, a, b] = m;
  if (k === 'L') return `Loža ${a}, mjesto ${b}`;
  const name = SECTIONS.find((s) => s.key === k).name;
  return `${name}, red ${a}, sjedalo ${b}`;
}

export const totalSeats = () => allSeats().length;

/** SVG tlocrta kao tekst (bez DOM-a): koriste ga kartica Tlocrt i stranica /raspored */
export function svgMarkup({ titles = false } = {}) {
  const parts = [
    `<path class="sp-stage" d="M350,26 L650,26 L640,92 Q500,108 360,92 Z"/>`,
    `<text class="sp-stage-t" x="500" y="66">POZORNICA</text>`,
    ...boxShapes().map((b) => `<path class="sp-box" d="${b.path}"/><text class="sp-boxno" x="${b.label.x}" y="${b.label.y + 3}">${b.box}</text>`),
    ...rowLabels().map((r) => `<text class="sp-row" x="${r.x}" y="${r.y + 3}">${r.text}</text>`),
    '<text class="sp-sec" x="500" y="428">PARTER</text>',
    '<text class="sp-sec" x="500" y="573">BALKON</text>',
    '<text class="sp-sec" x="500" y="664">GALERIJA</text>',
    ...allSeats().map((s) => `<circle class="seat" data-seat="${s.id}" cx="${s.x}" cy="${s.y}" r="5.6">${titles ? '<title></title>' : ''}</circle>`),
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" class="seat-svg" viewBox="-30 0 ${VIEW.width + 60} ${VIEW.height - 40}" role="img" aria-label="Tlocrt dvorane HNK Zagreb">${parts.join('')}</svg>`;
}
