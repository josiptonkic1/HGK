import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { EVENT } from './event.js';
import { computeStats } from './store.js';

const require = createRequire(import.meta.url);
const FONT_DIR = join(dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');

export const FILTERS = {
  all: 'Svi uzvanici',
  confirmed: 'Dolaze',
  declined: 'Ne dolaze',
  pending: 'Nisu odgovorili',
  checked_in: 'Došli (skenirani)',
};
const SECTION_ORDER = ['confirmed', 'declined', 'pending', 'checked_in'];
const STATUS_LABEL = { confirmed: 'Dolazi', declined: 'Ne dolazi', pending: 'Nije odgovorio' };

const fmt = new Intl.DateTimeFormat('hr-HR', {
  timeZone: 'Europe/Zagreb', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
export const formatDate = (iso) => (iso ? fmt.format(new Date(iso)) : '');

// Pratnja se ispisuje kao "Ime Prezime – pratnja".
export const companionLabel = (fullName) => `${fullName} – pratnja`;

// Pretvara pozivnice u retke po osobi (nositelj pa njegova pratnja).
export function personRows(invitations, filter = 'all') {
  const rows = [];
  for (const inv of invitations) {
    if (filter !== 'all' && filter !== 'checked_in' && inv.status !== filter) continue;
    const persons = inv.guests.length
      ? inv.guests
      : [{ id: null, fullName: inv.fullName, isCompanion: false, checkedInAt: null }];
    persons.forEach((p, idx) => {
      if (filter === 'checked_in' && !p.checkedInAt) return;
      rows.push({
        invitationId: inv.id,
        name: p.isCompanion ? companionLabel(p.fullName) : p.fullName,
        isCompanion: p.isCompanion,
        host: p.isCompanion ? inv.fullName : '',
        seat: inv.seatLabels?.[idx] || '',
        email: p.isCompanion ? '' : inv.email,
        status: STATUS_LABEL[inv.status],
        checkedIn: p.checkedInAt ? 'Da' : 'Ne',
        checkedInAt: formatDate(p.checkedInAt),
        respondedAt: formatDate(inv.respondedAt),
        source: { invite: 'Osobni link', open: 'Opći link', admin: 'Dodao admin' }[inv.source],
      });
    });
  }
  return rows;
}

const sectionsFor = (filter) => (filter === 'all' ? ['all', ...SECTION_ORDER] : [filter]);

function summaryLines(invitations) {
  const s = computeStats(invitations);
  return [
    ['Pozivnica u bazi', s.invitations],
    ['Dolaze – pozivnica / osoba', `${s.confirmedInvitations} / ${s.confirmedPersons}`],
    ['od toga pratnja', s.companions],
    ['Ne dolaze', s.declinedInvitations],
    ['Nisu odgovorili', s.pendingInvitations],
    ['Došli (skenirani) – osoba', s.checkedInPersons],
  ];
}

// ---------- Excel ----------

const COLUMNS = [
  { header: 'Rb.', key: 'rb', width: 6 },
  { header: 'Ime i prezime', key: 'name', width: 34 },
  { header: 'Pratnja od', key: 'host', width: 26 },
  { header: 'Mjesto', key: 'seat', width: 28 },
  { header: 'E-mail', key: 'email', width: 28 },
  { header: 'Status', key: 'status', width: 15 },
  { header: 'Odgovor', key: 'respondedAt', width: 18 },
  { header: 'Došao', key: 'checkedIn', width: 8 },
  { header: 'Vrijeme dolaska', key: 'checkedInAt', width: 18 },
  { header: 'Izvor', key: 'source', width: 14 },
];

export async function buildXlsx(invitations, filter = 'all') {
  const wb = new ExcelJS.Workbook();
  wb.creator = EVENT.organizer;
  wb.created = new Date();

  if (filter === 'all') {
    const ws = wb.addWorksheet('Sažetak');
    ws.columns = [{ width: 34 }, { width: 18 }];
    ws.addRow([`${EVENT.title} – popis uzvanika`]).font = { bold: true, size: 14 };
    ws.addRow([`Izrađeno: ${formatDate(new Date().toISOString())}`]);
    ws.addRow([]);
    for (const line of summaryLines(invitations)) ws.addRow(line);
  }

  for (const key of sectionsFor(filter)) {
    const ws = wb.addWorksheet(FILTERS[key].replace(/[\\/?*[\]:]/g, ''), {
      views: [{ state: 'frozen', ySplit: 1 }],
      properties: { outlineLevelRow: 1 },
    });
    ws.columns = COLUMNS;
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1611' } };
    ws.properties.outlineProperties = { summaryBelow: false };

    let rb = 0;
    for (const r of personRows(invitations, key)) {
      const row = ws.addRow({ ...r, rb: ++rb });
      if (r.isCompanion) {
        row.outlineLevel = 1; // pratnja se može sklopiti ispod nositelja
        row.getCell('name').font = { italic: true };
      }
    }
    ws.autoFilter = { from: 'A1', to: 'J1' };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- PDF ----------

const PDF_COLS = [
  { key: 'rb', label: 'Rb.', width: 32 },
  { key: 'name', label: 'Ime i prezime', width: 205 },
  { key: 'host', label: 'Pratnja od', width: 170 },
  { key: 'seat', label: 'Mjesto', width: 150 },
  { key: 'status', label: 'Status', width: 95 },
  { key: 'checkedInAt', label: 'Dolazak', width: 105 },
];

export function buildPdf(invitations, filter = 'all') {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, bufferPages: true, info: { Title: `${EVENT.title} – popis uzvanika` } });
  doc.registerFont('regular', join(FONT_DIR, 'DejaVuSans.ttf'));
  doc.registerFont('bold', join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const left = doc.page.margins.left;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;
  const GOLD = '#9a7430';

  doc.font('bold').fontSize(18).fillColor('#000').text(`${EVENT.title} – popis uzvanika`);
  doc.font('regular').fontSize(9).fillColor('#555').text(`Izrađeno: ${formatDate(new Date().toISOString())}   ·   Prikaz: ${FILTERS[filter]}`);
  doc.moveDown(0.6);
  doc.fillColor('#000');
  for (const [label, value] of summaryLines(invitations)) {
    doc.font('regular').fontSize(9).text(`${label}: `, { continued: true }).font('bold').text(String(value));
  }

  const drawHeader = () => {
    let x = left;
    const y = doc.y;
    doc.rect(left, y - 2, PDF_COLS.reduce((a, c) => a + c.width, 0), 16).fill('#1a1611');
    doc.font('bold').fontSize(8.5).fillColor('#fff');
    for (const c of PDF_COLS) {
      doc.text(c.label, x + 3, y + 2, { width: c.width - 6, lineBreak: false });
      x += c.width;
    }
    doc.fillColor('#000');
    doc.y = y + 18;
  };

  const ensureSpace = (h, withHeader) => {
    if (doc.y + h > bottom()) {
      doc.addPage();
      if (withHeader) drawHeader();
    }
  };

  for (const key of sectionsFor(filter)) {
    const rows = personRows(invitations, key);
    doc.moveDown(1);
    ensureSpace(60, false);
    doc.x = left;
    doc.font('bold').fontSize(13).fillColor(GOLD).text(`${FILTERS[key]} (${rows.length})`, left);
    doc.fillColor('#000');
    doc.moveDown(0.3);
    if (!rows.length) {
      doc.font('regular').fontSize(9).fillColor('#777').text('Nema osoba u ovoj kategoriji.', left);
      doc.fillColor('#000');
      continue;
    }
    drawHeader();
    let rb = 0;
    {
      for (const r of rows) {
        const cells = { ...r, rb: String(++rb) };
        doc.font('regular').fontSize(8.5);
        const h = Math.max(...PDF_COLS.map((c) => doc.heightOfString(String(cells[c.key] ?? ''), { width: c.width - 6 }))) + 5;
        ensureSpace(h, true);
        const y = doc.y;
        if (rb % 2 === 0) doc.rect(left, y - 1, PDF_COLS.reduce((a, c) => a + c.width, 0), h).fill('#f6f1e4').fillColor('#000');
        let x = left;
        for (const c of PDF_COLS) {
          doc.font(c.key === 'name' && !r.isCompanion ? 'bold' : 'regular').fontSize(8.5)
            .text(String(cells[c.key] ?? ''), x + 3, y + 1.5, { width: c.width - 6 });
          x += c.width;
        }
        doc.y = y + h;
      }
    }
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0; // inače pdfkit za podnožje otvara novu stranicu
    doc.font('regular').fontSize(8).fillColor('#888')
      .text(`${EVENT.organizer} · ${EVENT.title} · stranica ${i + 1}/${range.count}`, left, doc.page.height - 30, { lineBreak: false });
  }
  doc.end();
  return done;
}
