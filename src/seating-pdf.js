// PDF rasporeda sjedenja: tlocrt sa zauzetim mjestima i uz njega popis "mjesto -> osoba",
// zatim potvrđeni bez mjesta i abecedni popis "osoba -> mjesto" (za hostese na ulazu).
import PDFDocument from 'pdfkit';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { EVENT } from './event.js';
import { formatDate } from './export.js';
import { VIEW, SECTIONS, allSeats, boxShapes, rowLabels, seatLabel } from '../public/js/seatplan.js';

const require = createRequire(import.meta.url);
const FONT_DIR = join(dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const GOLD = '#9a7430';
const FILL = '#d4ab52';

/** Osobe s mjestima: [{ seat, name, companion, host }] redom tlocrta + osobe bez mjesta */
export function seatingRows(invitations) {
  const bySeat = new Map();
  const unseated = [];
  for (const inv of invitations) {
    if (inv.status !== 'confirmed') continue;
    const people = inv.guests.length ? inv.guests : [{ fullName: inv.fullName, isCompanion: false }];
    people.forEach((p, i) => {
      const row = { name: p.fullName, companion: p.isCompanion, host: inv.fullName, seat: inv.seats[i] || null };
      if (row.seat) bySeat.set(row.seat, row);
      else unseated.push(row);
    });
  }
  const seated = allSeats().filter((s) => bySeat.has(s.id)).map((s) => ({ ...bySeat.get(s.id), info: s }));
  const byName = (a, b) => a.name.localeCompare(b.name, 'hr');
  return { seated, unseated: unseated.sort(byName), alphabetical: [...seated].sort(byName) };
}

const shortSeat = (s) => (s.section === 'L' ? `Loža ${s.box}, mj. ${s.n}` : `Red ${s.row}, sj. ${s.n}`);
const personText = (r) => (r.companion ? `${r.name} – pratnja` : r.name);

export function buildSeatingPdf(invitations) {
  const doc = new PDFDocument({ size: 'A3', layout: 'landscape', margin: 30, bufferPages: true, info: { Title: `${EVENT.title} – raspored sjedenja` } });
  doc.registerFont('regular', join(FONT_DIR, 'DejaVuSans.ttf'));
  doc.registerFont('bold', join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const M = 30;
  const W = doc.page.width;
  const H = doc.page.height;
  const BOTTOM = H - M - 18;
  const { seated, unseated, alphabetical } = seatingRows(invitations);
  const taken = new Set(seated.map((r) => r.info.id));
  const total = allSeats().length;

  // ---------- naslov ----------
  doc.font('bold').fontSize(18).fillColor('#000').text(`${EVENT.title} – raspored sjedenja`, M, M);
  doc.font('regular').fontSize(9).fillColor('#555')
    .text(`Izrađeno: ${formatDate(new Date().toISOString())}   ·   Zauzeto ${seated.length} od ${total} mjesta   ·   Potvrđeni bez mjesta: ${unseated.length}`, M, M + 24);

  // ---------- tlocrt (lijevo) ----------
  const planW = 740;
  const vb = { x: -30, y: 0, w: VIEW.width + 60, h: VIEW.height - 40 };
  const k = planW / vb.w;
  const ox = M - vb.x * k;
  const oy = M + 50;
  doc.save();
  doc.roundedRect(M, oy - 6, planW, vb.h * k + 12, 8).fill('#faf7f0');
  doc.restore();
  doc.save().translate(ox, oy).scale(k);
  doc.path('M350,26 L650,26 L640,92 Q500,108 360,92 Z').fillAndStroke('#efe3c4', GOLD);
  doc.font('bold').fontSize(16).fillColor(GOLD).text('POZORNICA', 350, 52, { width: 300, align: 'center', characterSpacing: 3 });
  for (const b of boxShapes()) {
    doc.path(b.path).lineWidth(1).strokeColor('#b9a988').stroke();
    doc.font('bold').fontSize(11).fillColor('#6b5a3e').text(String(b.box), b.label.x - 15, b.label.y - 5, { width: 30, align: 'center' });
  }
  for (const r of rowLabels()) doc.font('bold').fontSize(9).fillColor('#8a7a5e').text(r.text, r.x - 15, r.y - 4, { width: 30, align: 'center' });
  for (const [text, y] of [['PARTER', 420], ['BALKON', 565], ['GALERIJA', 656]]) {
    doc.font('bold').fontSize(12).fillColor('#b9a988').text(text, 400, y, { width: 200, align: 'center', characterSpacing: 4 });
  }
  for (const s of allSeats()) {
    doc.circle(s.x, s.y, 5.6).lineWidth(1);
    if (taken.has(s.id)) doc.fillAndStroke(FILL, '#7a5a1e');
    else doc.fillAndStroke('#ffffff', '#c9bda4');
  }
  doc.restore();

  // legenda ispod tlocrta
  const ly = oy + vb.h * k + 18;
  doc.circle(M + 6, ly + 5, 5).fillAndStroke(FILL, '#7a5a1e');
  doc.font('regular').fontSize(9).fillColor('#000').text('zauzeto', M + 16, ly);
  doc.circle(M + 76, ly + 5, 5).fillAndStroke('#ffffff', '#c9bda4');
  doc.fillColor('#000').text('slobodno', M + 86, ly);
  doc.fillColor('#555').text('Sjedala se broje slijeva nadesno gledano prema pozornici. Popis uz tlocrt je poredan po mjestima.', M + 160, ly);
  let sy = ly + 22;
  for (const s of SECTIONS) {
    const all = allSeats().filter((x) => x.section === s.key).length;
    const used = seated.filter((r) => r.info.section === s.key).length;
    doc.font('bold').fontSize(9).fillColor('#000').text(`${s.name}: `, M, sy, { continued: true }).font('regular').text(`${used} / ${all} zauzeto`);
    sy += 13;
  }

  // ---------- popis u stupcima ----------
  let cols = [{ x: M + planW + 24, w: W - M - (M + planW + 24) }];
  let ci = 0;
  let y = oy - 4;
  const fullPage = () => {
    doc.addPage();
    const w = (W - 2 * M - 2 * 18) / 3;
    cols = [0, 1, 2].map((i) => ({ x: M + i * (w + 18), w }));
    ci = 0;
    y = M;
  };
  let colTop = oy - 4; // vrh stupaca na trenutnoj stranici
  const topOf = () => colTop;
  // ako redak ne stane: sljedeći stupac, a nakon zadnjeg nova stranica s tri stupca
  const room = (h) => {
    if (y + h <= BOTTOM) return;
    if (ci + 1 < cols.length) { ci++; y = colTop; } else fullPage();
  };
  const heading = (text, size = 12) => {
    room(size + 26);
    if (y > topOf() + 2) y += 6;
    doc.font('bold').fontSize(size).fillColor(GOLD).text(text, cols[ci].x, y, { width: cols[ci].w, lineBreak: false });
    y += size + 6;
  };
  const line = (left, right, { bold = false, shade = false } = {}) => {
    room(11);
    const c = cols[ci];
    const lw = 82;
    if (shade) doc.rect(c.x - 2, y - 1.5, c.w + 4, 11).fill('#f6f1e4');
    doc.font('regular').fontSize(7.6).fillColor('#555').text(left, c.x, y, { width: lw - 4, lineBreak: false, ellipsis: true });
    doc.font(bold ? 'bold' : 'regular').fillColor('#000').text(right, c.x + lw, y, { width: c.w - lw, lineBreak: false, ellipsis: true });
    y += 11;
  };
  const newPageHook = () => { colTop = M; };
  doc.on('pageAdded', newPageHook);

  heading('Raspored po mjestima', 13);
  if (!seated.length) line('', 'Još nijedno mjesto nije dodijeljeno.');
  let sec = null;
  let alt = false;
  for (const r of seated) {
    if (r.info.section !== sec) {
      sec = r.info.section;
      heading(SECTIONS.find((s) => s.key === sec).name, 10.5);
      alt = false;
    }
    alt = !alt;
    line(shortSeat(r.info), personText(r), { bold: !r.companion, shade: alt });
  }

  if (unseated.length) {
    heading(`Potvrđeni bez mjesta (${unseated.length})`, 12);
    alt = false;
    for (const r of unseated) { alt = !alt; line('', r.companion ? `${personText(r)} (uz: ${r.host})` : personText(r), { bold: !r.companion, shade: alt }); }
  }

  // abecedno: osoba -> mjesto (nova stranica)
  if (alphabetical.length) {
    fullPage();
    doc.font('bold').fontSize(16).fillColor('#000').text(`${EVENT.title} – abecedni popis s mjestima`, M, y);
    y += 30;
    colTop = y;
    alt = false;
    for (const r of alphabetical) {
      alt = !alt;
      room(11);
      const c = cols[ci];
      if (alt) doc.rect(c.x - 2, y - 1.5, c.w + 4, 11).fill('#f6f1e4');
      const label = seatLabel(r.info.id);
      const lw = 150;
      doc.font(r.companion ? 'regular' : 'bold').fontSize(7.6).fillColor('#000').text(personText(r), c.x, y, { width: c.w - lw - 4, lineBreak: false, ellipsis: true });
      doc.font('regular').fillColor('#555').text(label, c.x + c.w - lw, y, { width: lw, align: 'right', lineBreak: false });
      y += 11;
    }
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0;
    doc.font('regular').fontSize(8).fillColor('#888')
      .text(`${EVENT.organizer} · ${EVENT.title} · raspored sjedenja · stranica ${i + 1}/${range.count}`, M, H - 22, { lineBreak: false });
  }
  doc.end();
  return done;
}
