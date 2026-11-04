// Izvoz popisa u Excel i PDF na samom mobitelu + dijeljenje (WhatsApp, e-mail, Drive...).
/* global ExcelJS, PDFDocument */

const fmt = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (iso) => (iso ? fmt.format(new Date(iso)) : '');
const SOURCE = { qr: 'QR kod', rucno: 'Ručni unos', popis: 'Popis pozvanih' };

export const SECTIONS = {
  arrived: 'Došli (preuzeli pozivnicu)',
  missing: 'Pozvani, nisu došli',
  all: 'Svi',
};

// Redak po osobi: nositelj pa njegova pratnja ("Ime Prezime – pratnja").
export function personRows(records, section) {
  const list = records
    .filter((r) => section === 'all' || (section === 'arrived' ? r.arrivedAt : !r.arrivedAt && r.invited))
    .sort((a, b) => (section === 'arrived' ? (a.arrivedAt || '').localeCompare(b.arrivedAt || '') : 0) || a.lastName.localeCompare(b.lastName, 'hr') || a.firstName.localeCompare(b.firstName, 'hr'));
  const rows = [];
  for (const r of list) {
    const base = { invited: r.invited ? 'Da' : 'Ne', source: SOURCE[r.source] || '', arrivedAt: fmtDate(r.arrivedAt) };
    rows.push({ ...base, name: r.fullName, host: '', isCompanion: false });
    for (const c of r.companions || []) rows.push({ ...base, name: `${c.fullName} – pratnja`, host: r.fullName, isCompanion: true });
  }
  return rows;
}

function summary(records) {
  const arrived = records.filter((r) => r.arrivedAt);
  const persons = (list) => list.reduce((a, r) => a + 1 + (r.companions?.length || 0), 0);
  return [
    ['Preuzetih pozivnica', arrived.length],
    ['Došlo osoba (s pratnjom)', persons(arrived)],
    ['Na popisu pozvanih', records.filter((r) => r.invited).length],
    ['Pozvani, nisu došli', records.filter((r) => r.invited && !r.arrivedAt).length],
  ];
}

const COLUMNS = [
  { header: 'Rb.', key: 'rb', width: 6 },
  { header: 'Ime i prezime', key: 'name', width: 34 },
  { header: 'Pratnja od', key: 'host', width: 26 },
  { header: 'Vrijeme dolaska', key: 'arrivedAt', width: 18 },
  { header: 'Na popisu pozvanih', key: 'invited', width: 18 },
  { header: 'Izvor', key: 'source', width: 16 },
];

export async function buildXlsx(records, title) {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const s = wb.addWorksheet('Sažetak');
  s.columns = [{ width: 32 }, { width: 14 }];
  s.addRow([`${title} – popis uzvanika`]).font = { bold: true, size: 14 };
  s.addRow([`Izrađeno: ${fmtDate(new Date().toISOString())}`]);
  s.addRow([]);
  summary(records).forEach((l) => s.addRow(l));

  for (const [key, label] of Object.entries(SECTIONS)) {
    const ws = wb.addWorksheet(label.replace(/[\\/?*[\]:]/g, '').slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = COLUMNS;
    const h = ws.getRow(1);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1611' } };
    let rb = 0;
    for (const r of personRows(records, key)) {
      const row = ws.addRow({ ...r, rb: ++rb });
      if (r.isCompanion) {
        row.outlineLevel = 1;
        row.getCell('name').font = { italic: true };
      }
    }
    ws.autoFilter = { from: 'A1', to: 'F1' };
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

let fontCache;
async function fonts() {
  fontCache ??= Promise.all(['vendor/fonts/DejaVuSans.ttf', 'vendor/fonts/DejaVuSans-Bold.ttf'].map((u) => fetch(u).then((r) => r.arrayBuffer())));
  return fontCache;
}

export async function buildPdf(records, title) {
  const [regular, bold] = await fonts();
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `${title} – popis uzvanika` } });
  doc.registerFont('regular', regular);
  doc.registerFont('bold', bold);
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', resolve));

  const left = doc.page.margins.left;
  const COLS = [
    { key: 'rb', label: 'Rb.', width: 30 },
    { key: 'name', label: 'Ime i prezime', width: 190 },
    { key: 'host', label: 'Pratnja od', width: 140 },
    { key: 'arrivedAt', label: 'Dolazak', width: 95 },
    { key: 'invited', label: 'Na popisu', width: 60 },
  ];
  const width = COLS.reduce((a, c) => a + c.width, 0);
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;
  const GOLD = '#9a7430';

  doc.font('bold').fontSize(17).text(`${title} – popis uzvanika`);
  doc.font('regular').fontSize(9).fillColor('#555').text(`Izrađeno: ${fmtDate(new Date().toISOString())}`).fillColor('#000');
  doc.moveDown(0.5);
  for (const [l, v] of summary(records)) doc.font('regular').fontSize(9).text(`${l}: `, { continued: true }).font('bold').text(String(v));

  const header = () => {
    const y = doc.y;
    doc.rect(left, y - 2, width, 16).fill('#1a1611');
    let x = left;
    doc.font('bold').fontSize(8.5).fillColor('#fff');
    for (const c of COLS) { doc.text(c.label, x + 3, y + 2, { width: c.width - 6, lineBreak: false }); x += c.width; }
    doc.fillColor('#000');
    doc.y = y + 18;
  };

  for (const [key, label] of Object.entries(SECTIONS)) {
    if (key === 'all') continue; // PDF: došli + nisu došli
    const rows = personRows(records, key);
    doc.moveDown(1);
    if (doc.y + 60 > bottom()) doc.addPage();
    doc.font('bold').fontSize(13).fillColor(GOLD).text(`${label} (${rows.length})`, left).fillColor('#000');
    doc.moveDown(0.3);
    if (!rows.length) {
      doc.font('regular').fontSize(9).fillColor('#777').text('Nema osoba u ovoj kategoriji.', left).fillColor('#000');
      continue;
    }
    header();
    rows.forEach((r, i) => {
      const cells = { ...r, rb: String(i + 1) };
      doc.font('regular').fontSize(8.5);
      const h = Math.max(...COLS.map((c) => doc.heightOfString(String(cells[c.key] ?? ''), { width: c.width - 6 }))) + 5;
      if (doc.y + h > bottom()) { doc.addPage(); header(); }
      const y = doc.y;
      if (i % 2) doc.rect(left, y - 1, width, h).fill('#f6f1e4').fillColor('#000');
      let x = left;
      for (const c of COLS) {
        doc.font(c.key === 'name' && !r.isCompanion ? 'bold' : 'regular').fontSize(8.5).text(String(cells[c.key] ?? ''), x + 3, y + 1.5, { width: c.width - 6 });
        x += c.width;
      }
      doc.y = y + h;
    });
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0;
    doc.font('regular').fontSize(8).fillColor('#888').text(`${title} · stranica ${i + 1}/${range.count}`, left, doc.page.height - 28, { lineBreak: false });
  }
  doc.end();
  await done;
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Na mobitelu: spremi u privremenu mapu i otvori izbornik "Podijeli". U pregledniku: preuzimanje.
export async function shareFile(bytes, filename, mime) {
  const cap = window.Capacitor;
  if (cap?.isNativePlatform?.()) {
    const { uri } = await cap.nativePromise('Filesystem', 'writeFile', { path: filename, data: toBase64(bytes), directory: 'CACHE' });
    await cap.nativePromise('Share', 'share', { title: filename, files: [uri], dialogTitle: 'Podijeli ili spremi' });
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function shareText(text, title) {
  const cap = window.Capacitor;
  if (cap?.isNativePlatform?.()) return cap.nativePromise('Share', 'share', { title, text, dialogTitle: title });
  if (navigator.share) return navigator.share({ title, text });
  await navigator.clipboard?.writeText(text);
}
