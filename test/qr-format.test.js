import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import jsQR from 'jsqr';

const require = createRequire(import.meta.url);
await import('../pozivnica/zk-qr.js'); // isti kod kao u pregledniku, prijavljuje se na globalThis
const { ZKQR } = globalThis;

describe('QR kod pozivnice (bez poslužitelja)', () => {
  const guest = {
    firstName: 'Đurđica',
    lastName: 'Šimić-Čačić',
    companions: [{ firstName: 'Željko', lastName: 'Ćosić' }, { firstName: '', lastName: '' }],
  };

  test('ime, prezime i pratnja se zapisuju u kod i čitaju natrag (s kvačicama)', () => {
    const code = ZKQR.encode(guest);
    assert.match(code, /^ZK31:[A-Za-z0-9_-]+\.[0-9a-z]+$/, 'kod je čisti ASCII');
    const d = ZKQR.decode(code);
    assert.equal(d.fullName, 'Đurđica Šimić-Čačić');
    assert.deepEqual(d.companions.map((c) => c.fullName), ['Željko Ćosić']);
    assert.ok(d.issuedAt);
  });

  test('izmijenjen ili tuđi kod se odbija', () => {
    const code = ZKQR.encode(guest);
    const [head, sum] = code.split('.');
    const tampered = head.slice(0, -2) + (head.endsWith('A') ? 'BB' : 'AA') + '.' + sum;
    assert.throws(() => ZKQR.decode(tampered), /oštećen ili izmijenjen/);
    assert.throws(() => ZKQR.decode('https://primjer.hr'), /nije QR kod pozivnice/);
    assert.throws(() => ZKQR.decode(''), /nije QR kod pozivnice/);
  });

  test('ime i prezime su obavezni, i za pratnju', () => {
    assert.throws(() => ZKQR.encode({ firstName: 'Ana', lastName: ' ' }), /obavezni/);
    assert.throws(() => ZKQR.encode({ firstName: 'Ana', lastName: 'Anić', companions: [{ firstName: 'Samo' }] }), /pratnji/);
  });

  test('QR slika generirana kao na stranici pozivnice može se skenirati', () => {
    const qrcode = require('../mobile/node_modules/qrcode-generator/dist/qrcode.js');
    const code = ZKQR.encode({ ...guest, companions: [{ firstName: 'Ana', lastName: 'Horvat' }, { firstName: 'Marko', lastName: 'Marić' }, { firstName: 'Iva', lastName: 'Babić' }] });
    const qr = qrcode(0, 'M');
    qr.addData(code);
    qr.make();
    const n = qr.getModuleCount();
    const cell = 6;
    const margin = cell * 4;
    const size = n * cell + margin * 2;
    const px = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        for (let y = 0; y < cell; y++) {
          for (let x = 0; x < cell; x++) {
            const i = ((margin + r * cell + y) * size + margin + c * cell + x) * 4;
            px[i] = px[i + 1] = px[i + 2] = 0;
          }
        }
      }
    }
    const read = jsQR(px, size, size);
    assert.equal(read?.data, code);
    assert.equal(ZKQR.decode(read.data).companions.length, 3);
  });
});
