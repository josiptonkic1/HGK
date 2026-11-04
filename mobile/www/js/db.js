// Lokalna baza na mobitelu (IndexedDB). Podaci ostaju u aplikaciji dok se ne obrišu.
// Zapis = jedna pozivnica: nositelj + pratnja + vrijeme preuzimanja.
const DB_NAME = 'zlatna-kuna-31';
const STORE = 'pozivnice';

let dbPromise;
function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      s.createIndex('key', 'key', { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const req2p = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// Ključ za usporedbu imena: bez velikih slova, kvačica i viška razmaka.
export function nameKey(s) {
  return String(s ?? '').toLowerCase().replace(/đ/g, 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export const all = () => run('readonly', (s) => req2p(s.getAll()));
export const get = (id) => run('readonly', (s) => req2p(s.get(id)));
export const findByName = (fullName) => run('readonly', (s) => req2p(s.index('key').getAll(nameKey(fullName))));
export const remove = (id) => run('readwrite', (s) => req2p(s.delete(id)));
export const clear = () => run('readwrite', (s) => req2p(s.clear()));

export function save(rec) {
  const now = new Date().toISOString();
  const data = {
    ...rec,
    fullName: `${rec.firstName} ${rec.lastName}`.trim(),
    key: nameKey(`${rec.firstName} ${rec.lastName}`),
    companions: (rec.companions || []).map((c) => ({ firstName: c.firstName, lastName: c.lastName, fullName: `${c.firstName} ${c.lastName}`.trim() })),
    createdAt: rec.createdAt || now,
    updatedAt: now,
  };
  if (data.id == null) delete data.id;
  return run('readwrite', (s) => req2p(s.put(data))).then((id) => ({ ...data, id }));
}
