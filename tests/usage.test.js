import test from 'node:test';
import assert from 'node:assert/strict';

// A stand-in for the phone's storage.
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { DAILY_CAP, countUse, overCap, usage } = await import('../js/usage.js');

test('counts this phone\'s TomTom requests by day and by month', () => {
  store.clear();
  const d1 = new Date(2026, 10, 8, 9), d2 = new Date(2026, 10, 9, 9), d3 = new Date(2026, 11, 1, 9);
  countUse(d1); countUse(d1); countUse(d1);
  assert.deepEqual(usage(d1), { today: 3, month: 3 });
  countUse(d2);
  assert.deepEqual(usage(d2), { today: 1, month: 4 }, 'a new day');
  assert.deepEqual(usage(d3), { today: 0, month: 0 }, 'a new month');
});

test('stops for the day at the limit', () => {
  store.clear();
  const d = new Date(2026, 10, 8, 9);
  for (let i = 0; i < DAILY_CAP - 1; i++) countUse(d);
  assert.equal(overCap(d), false);
  countUse(d);
  assert.equal(overCap(d), true);
  assert.equal(overCap(new Date(2026, 10, 9, 0, 1)), false, 'fine again tomorrow');
});
