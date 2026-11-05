// Everything Pintu remembers stays on this phone. Browser storage can be
// missing or blocked, and the app must keep working when it is.
const PREFIX = 'pintu.';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function save(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* keep going */ }
}

export function remove(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* keep going */ }
}
