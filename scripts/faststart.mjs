// "Faststart" za MP4: premješta moov atom ispred mdat (bez ponovnog kodiranja),
// da se video na mobitelu (posebno iPhone) može odmah početi puštati dok se ostatak učitava.
// Pokretanje: node scripts/faststart.mjs ulaz.mp4 [izlaz.mp4]
import { readFileSync, writeFileSync } from 'node:fs';

function topLevelAtoms(buf) {
  const atoms = [];
  let pos = 0;
  while (pos + 8 <= buf.length) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(pos + 8)); header = 16; }
    else if (size === 0) size = buf.length - pos;
    if (size < header || pos + size > buf.length) throw new Error(`Neispravan atom ${type} na ${pos}`);
    atoms.push({ type, start: pos, size, header });
    pos += size;
  }
  return atoms;
}

// Pomak svih chunk offseta (stco/co64) unutar moov-a za "delta" bajtova.
function patchChunkOffsets(moov, delta) {
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta', 'mvex']);
  let patched = 0;
  const walk = (start, end) => {
    let pos = start;
    while (pos + 8 <= end) {
      let size = moov.readUInt32BE(pos);
      const type = moov.toString('latin1', pos + 4, pos + 8);
      let header = 8;
      if (size === 1) { size = Number(moov.readBigUInt64BE(pos + 8)); header = 16; }
      if (size < header) break;
      if (CONTAINERS.has(type)) walk(pos + header, pos + size);
      else if (type === 'stco') {
        const n = moov.readUInt32BE(pos + 12);
        for (let i = 0; i < n; i++) {
          const o = pos + 16 + i * 4;
          const v = moov.readUInt32BE(o) + delta;
          if (v > 0xffffffff) throw new Error('Offset prevelik za stco');
          moov.writeUInt32BE(v, o);
        }
        patched += n;
      } else if (type === 'co64') {
        const n = moov.readUInt32BE(pos + 12);
        for (let i = 0; i < n; i++) {
          const o = pos + 16 + i * 8;
          moov.writeBigUInt64BE(moov.readBigUInt64BE(o) + BigInt(delta), o);
        }
        patched += n;
      }
      pos += size;
    }
  };
  walk(8, moov.length);
  return patched;
}

export function faststart(buf) {
  const atoms = topLevelAtoms(buf);
  const moovAtom = atoms.find((a) => a.type === 'moov');
  const mdatIdx = atoms.findIndex((a) => a.type === 'mdat');
  if (!moovAtom || mdatIdx < 0) throw new Error('Nije pronađen moov ili mdat');
  if (atoms.indexOf(moovAtom) < mdatIdx) return { buf, changed: false };
  const moov = Buffer.from(buf.subarray(moovAtom.start, moovAtom.start + moovAtom.size));
  // sve ispred mdat ostaje, moov ide odmah ispred mdat -> mdat (i podaci) se pomiču za veličinu moov-a
  const patched = patchChunkOffsets(moov, moov.length);
  const before = atoms.slice(0, mdatIdx).map((a) => buf.subarray(a.start, a.start + a.size));
  const after = atoms.slice(mdatIdx).filter((a) => a !== moovAtom).map((a) => buf.subarray(a.start, a.start + a.size));
  return { buf: Buffer.concat([...before, moov, ...after]), changed: true, patched };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const [input, output = input] = process.argv.slice(2);
  const res = faststart(readFileSync(input));
  if (!res.changed) console.log(`${input}: već je faststart`);
  else { writeFileSync(output, res.buf); console.log(`${input}: moov premješten na početak (${res.patched} offseta) -> ${output}`); }
}
