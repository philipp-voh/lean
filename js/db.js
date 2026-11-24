// IndexedDB 'lean': one connection, one transaction per call. A write resolves only once it is on disk.
import { DB_VERSION, VERSION } from './config.js';

const STORES = { meals: 'id', photos: 'mealId', drafts: 'id', weights: 'day', days: 'day', goals: 'from', settings: 'name' };
const NAMES = Object.keys(STORES);
const FULL = "Your iPhone is out of space. This change wasn't saved.";

let conn = null;

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb(name, version, upgrade) {
  const req = indexedDB.open(name, version);
  req.onupgradeneeded = e => upgrade(req.result, e.oldVersion);
  return request(req);
}

function upgrade(db, from) {
  if (from < 1) {
    for (const [name, keyPath] of Object.entries(STORES)) {
      const store = db.createObjectStore(name, { keyPath });
      if (name === 'meals') store.createIndex('day', 'day');
    }
  }
  // A later DB_VERSION adds its step here: if (from < 2) { ... }
}

async function connect() {
  if (conn) return conn;
  conn = await openDb('lean', DB_VERSION, upgrade);
  conn.onversionchange = () => reset();
  conn.onclose = () => { conn = null; };   // Safari closes connections now and then
  return conn;
}

function reset() {
  try { conn?.close(); } catch { /* already closed */ }
  conn = null;
}

function wrap(e) {
  if (e?.name !== 'QuotaExceededError') return e ?? new Error("Lean couldn't reach its storage. Try again.");
  return Object.assign(new Error(FULL), { kind: 'full', cause: e });
}

// Runs fn(transaction) and resolves with the result of the request fn returns, after the transaction completes.
async function tx(names, mode, fn, retry = true) {
  const db = await connect();
  let t;
  try { t = db.transaction(names, mode); }
  catch (e) {
    reset();
    if (retry && e.name === 'InvalidStateError') return tx(names, mode, fn, false);   // stale connection: reopen once
    throw wrap(e);
  }
  return new Promise((resolve, reject) => {
    let req;
    t.oncomplete = () => resolve(req?.result);
    t.onabort = () => { reset(); reject(wrap(t.error)); };
    try { req = fn(t); }
    catch (e) {
      try { t.abort(); } catch { /* already finished */ }
      reject(wrap(e));
    }
  });
}

export async function open() {
  const stored = (await indexedDB.databases?.() ?? []).find(d => d.name === 'lean')?.version ?? 0;
  if (stored > 0 && stored < DB_VERSION) await takeSnapshot(stored);
  return connect();
}

export const all = store => tx(store, 'readonly', t => t.objectStore(store).getAll());
export const get = (store, key) => tx(store, 'readonly', t => t.objectStore(store).get(key));
export const keys = store => tx(store, 'readonly', t => t.objectStore(store).getAllKeys());
export const put = (store, value) => tx(store, 'readwrite', t => { t.objectStore(store).put(value); });
export const del = (store, key) => tx(store, 'readwrite', t => { t.objectStore(store).delete(key); });

// One read-write transaction over all stores: either every change lands or none does.
export const write = fn => tx(NAMES, 'readwrite', t => {
  fn({
    put: (store, value) => t.objectStore(store).put(value),
    del: (store, key) => t.objectStore(store).delete(key),
    clear: store => t.objectStore(store).clear(),
  });
});

export async function persist() {
  if (!navigator.storage?.persist) return false;
  return (await navigator.storage.persisted()) || navigator.storage.persist();
}

// The copy taken before the last database upgrade, in the backup format, or null.
export async function snapshot() {
  const db = await openDb('lean-snapshot', 1, d => d.createObjectStore('snapshot'));
  try { return (await request(db.transaction('snapshot').objectStore('snapshot').get('last'))) ?? null; }
  finally { db.close(); }
}

// Runs in the new code before the upgrade, so it also covers iOS activating a new version on a cold start.
async function takeSnapshot(version) {
  const old = await openDb('lean', version, () => {});
  const read = name => old.objectStoreNames.contains(name) ? request(old.transaction(name).objectStore(name).getAll()) : [];
  const [meals, weights, days, goals, settings] = await Promise.all(['meals', 'weights', 'days', 'goals', 'settings'].map(read));
  old.close();
  const s = Object.fromEntries(settings.map(r => [r.name, r.value]));
  const data = {
    app: 'Lean', format: 1, createdAt: new Date().toISOString(), appVersion: VERSION, fromDbVersion: version,
    settings: { profile: s.profile ?? null, firstDay: s.firstDay ?? null }, goals, meals, weights, days,
  };
  const db = await openDb('lean-snapshot', 1, d => d.createObjectStore('snapshot'));
  try {
    await new Promise((resolve, reject) => {
      const t = db.transaction('snapshot', 'readwrite');
      t.objectStore('snapshot').put(data, 'last');
      t.oncomplete = resolve;
      t.onabort = () => reject(wrap(t.error));
    });
  } finally { db.close(); }
}
