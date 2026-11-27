/**
 * Mock database: seeded on first load, persisted to localStorage under
 * 'expenseflow.mock.v1'. Every storage access is wrapped in try/catch and
 * falls back to memory (private mode, quota exceeded, Node tests).
 * The stored copy carries the seed version; a changed seed reseeds.
 */
import { buildSeed, SEED_VERSION } from './seed.js';
import { deepClone } from './util.js';

export const STORAGE_KEY = 'expenseflow.mock.v1';

let db = null;

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function load() {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.meta?.seedVersion !== SEED_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist(data) {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    // Quota exceeded or storage blocked: keep working from memory.
    return false;
  }
}

/** Another tab changed the data: drop the cached copy so the next request reloads it. */
if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) db = null;
  });
}

/** The current database (loading or seeding it on first use). Treat as read-only. */
export function getDb() {
  if (!db) {
    db = load();
    if (!db) {
      db = buildSeed(Date.now());
      persist(db);
    }
  }
  return db;
}

/**
 * Runs `fn` against a copy of the database and commits it only if `fn`
 * returns without throwing, so a failed request never leaves half a change.
 */
export function transact(fn) {
  const draft = deepClone(getDb());
  const result = fn(draft);
  db = draft;
  persist(db);
  return result;
}

/** Throws the data away and seeds it again. */
export function resetDb() {
  db = buildSeed(Date.now());
  persist(db);
  return db;
}
