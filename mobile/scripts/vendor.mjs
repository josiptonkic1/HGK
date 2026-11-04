// Kopira biblioteke, fontove i stil u:
//   ../pozivnica/vendor  (stranica pozivnice na GitHub Pages)
//   ./www/vendor         (Android aplikacija)
// Pokretanje: npm run vendor   (iz mape mobile)
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(MOBILE, '..');
const pkgDir = (name) => {
  const dir = join(MOBILE, 'node_modules', ...name.split('/'));
  if (!existsSync(dir)) throw new Error(`Paket ${name} nije instaliran - pokrenite "npm install" u mapi mobile.`);
  return dir;
};

const TARGETS = {
  invite: join(ROOT, 'pozivnica', 'vendor'),
  app: join(MOBILE, 'www', 'vendor'),
};
for (const dir of Object.values(TARGETS)) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'fonts'), { recursive: true });
}
const copy = (from, to, targets) => targets.forEach((t) => copyFileSync(from, join(TARGETS[t], to)));
const BOTH = ['invite', 'app'];

// --- fontovi (samo latin i latin-ext, dovoljno za hrvatski) ---
const FONTS = [['montserrat', [600, 700]], ['raleway', [300, 400, 600]]];
let css = '';
for (const [family, weights] of FONTS) {
  const dir = pkgDir(`@fontsource/${family}`);
  for (const w of weights) {
    const src = readFileSync(join(dir, `${w}.css`), 'utf8');
    for (const block of src.match(/@font-face\s*{[^}]+}/g) || []) {
      if (!/-latin-(ext-)?\d/.test(block)) continue;
      css += block.replace(/url\(\.\/files\/([^)]+)\)/g, (m, file) => {
        copy(join(dir, 'files', file), join('fonts', file), BOTH);
        return `url(fonts/${file})`;
      }) + '\n';
    }
  }
}
BOTH.forEach((t) => writeFileSync(join(TARGETS[t], 'fonts.css'), css));

// --- zajednički stil i slike iz web aplikacije ---
copy(join(ROOT, 'public', 'css', 'style.css'), 'style.css', BOTH);
copy(join(ROOT, 'public', 'img', 'hgk.svg'), 'hgk.svg', BOTH);
copy(join(ROOT, 'public', 'img', 'favicon-32.png'), 'favicon-32.png', BOTH);
copy(join(pkgDir('qrcode-generator'), 'dist', 'qrcode.js'), 'qrcode.js', BOTH);

// --- samo aplikacija ---
copy(join(ROOT, 'pozivnica', 'zk-qr.js'), 'zk-qr.js', ['app']);
copy(join(pkgDir('html5-qrcode'), 'html5-qrcode.min.js'), 'html5-qrcode.min.js', ['app']);
copy(join(pkgDir('exceljs'), 'dist', 'exceljs.min.js'), 'exceljs.min.js', ['app']);
copy(join(pkgDir('pdfkit'), 'js', 'pdfkit.standalone.js'), 'pdfkit.standalone.js', ['app']);
copy(join(pkgDir('dejavu-fonts-ttf'), 'ttf', 'DejaVuSans.ttf'), join('fonts', 'DejaVuSans.ttf'), ['app']);
copy(join(pkgDir('dejavu-fonts-ttf'), 'ttf', 'DejaVuSans-Bold.ttf'), join('fonts', 'DejaVuSans-Bold.ttf'), ['app']);

console.log('Vendor datoteke kopirane u:', Object.values(TARGETS).join(', '));
