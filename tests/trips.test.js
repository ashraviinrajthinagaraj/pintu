import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { CrawlClock, KEEP_MONTHS, MIN_KM, cleanTrip, forgetTrips, keptTrips, monthSummary, recordTrip, tripMonths } = await import('../js/trips.js');

const at = (y, m, d, h = 8) => new Date(y, m, d, h).getTime();

test('keeps a short line about each drive, and skips moving the car', () => {
  store.clear();
  assert.equal(recordTrip({ km: MIN_KM / 2, s: 60 }, at(2026, 10, 1)), false);
  assert.equal(recordTrip({ km: 12.34, s: 1500, slow: 300, cost: 1.4789, mode: 'car', to: 'Rumah' }, at(2026, 10, 1)), true);
  const [t] = keptTrips();
  assert.deepEqual(t, { at: at(2026, 10, 1), km: 12.3, s: 1500, slow: 300, cost: 1.48, mode: 'car', to: 'Rumah', l: null, g: null, w: false, from: '' });
  forgetTrips();
  assert.deepEqual(keptTrips(), []);
});

test('cleans what it keeps', () => {
  const t = cleanTrip({ at: 5, km: 'x', s: -3, slow: 900, cost: -1, mode: 'rocket', to: 'A'.repeat(200) });
  assert.equal(t.km, 0);
  assert.equal(t.s, 0);
  assert.equal(t.slow, 0, 'never more crawling than driving');
  assert.equal(t.cost, null);
  assert.equal(t.mode, 'car');
  assert.equal(t.to.length, 60);
  const kept = cleanTrip({ at: 5, km: 3, l: '0.84', g: 'ron95_budi95', w: 1, from: 'Rumah' });
  assert.deepEqual([kept.l, kept.g, kept.w, kept.from], [0.8, 'ron95_budi95', true, 'Rumah']);
  assert.equal(cleanTrip({ at: 5, km: 3, g: '<script>' }).g, null);
});

test('the drive just ended can be marked as work, but not one long gone', async () => {
  const { markLastTrip } = await import('../js/trips.js');
  forgetTrips();
  const now = at(2026, 10, 2);
  recordTrip({ km: 5, s: 600, slow: 0, cost: null, mode: 'car', to: 'Pejabat' }, now);
  assert.equal(markLastTrip({ w: true }, now + 60e3).w, true);
  assert.equal(keptTrips()[0].w, true);
  assert.equal(markLastTrip({ w: false }, now + 3600e3), null, 'an hour later is too late');
  forgetTrips();
});

test('only the last year or so is kept', () => {
  store.clear();
  recordTrip({ km: 5, s: 600 }, at(2025, 0, 10));
  recordTrip({ km: 6, s: 600 }, at(2025, 9, 20));
  recordTrip({ km: 7, s: 600 }, at(2026, 10, 8));
  const left = keptTrips().map((t) => t.km);
  assert.deepEqual(left, [6, 7], `kept ${KEEP_MONTHS} months`);
});

test('sums up a month, and compares it with the month before', () => {
  const trips = [
    cleanTrip({ at: at(2026, 9, 30), km: 20, s: 1800, slow: 100, cost: 2.4, to: 'Kerja' }),
    cleanTrip({ at: at(2026, 10, 1), km: 12, s: 1200, slow: 300, cost: 1.5, to: 'Kerja' }),
    cleanTrip({ at: at(2026, 10, 1, 18), km: 12.5, s: 1500, slow: 600, cost: 1.55, to: 'Rumah' }),
    cleanTrip({ at: at(2026, 10, 3), km: 80, s: 3600, slow: 0, cost: null, to: 'Ipoh' }),
    cleanTrip({ at: at(2026, 10, 4), km: 12, s: 1100, slow: 200, cost: 1.5, to: 'Kerja' }),
  ];
  const m = monthSummary(trips, 2026, 10);
  assert.equal(m.trips, 4);
  assert.equal(m.km, 116.5);
  assert.equal(m.seconds, 7400);
  assert.equal(m.slow, 1100);
  assert.equal(m.cost, 4.55);
  assert.equal(m.costAll, false, 'one trip had no price');
  assert.deepEqual(m.longest, { km: 80, to: 'Ipoh', at: at(2026, 10, 3) });
  assert.deepEqual(m.top, { name: 'Kerja', count: 2 });
  assert.equal(m.perDay.length, 30, 'November');
  assert.equal(m.perDay[0], 24.5);
  assert.equal(m.perDay[2], 80);
  assert.equal(m.prevKm, 20);

  const empty = monthSummary(trips, 2026, 11);
  assert.equal(empty.trips, 0);
  assert.equal(empty.cost, null);
  assert.equal(empty.top, null);
  assert.equal(empty.prevKm, 116.5);
  // January looks back at December of the year before.
  assert.equal(monthSummary([cleanTrip({ at: at(2025, 11, 31), km: 9, s: 60 })], 2026, 0).prevKm, 9);
});

test('lists the months that have trips, newest first', () => {
  const trips = [at(2026, 8, 1), at(2026, 10, 2), at(2026, 10, 9), at(2025, 11, 30)].map((a) => cleanTrip({ at: a, km: 3, s: 60 }));
  assert.deepEqual(tripMonths(trips), [{ year: 2026, month: 10 }, { year: 2026, month: 8 }, { year: 2025, month: 11 }]);
});

test('counts time spent crawling, but not lost signal', () => {
  const c = new CrawlClock();
  let t = 0;
  for (let i = 0; i < 10; i++) { c.add(t, 15); t += 1000; }
  assert.equal(c.slow, 0);
  for (let i = 0; i < 30; i++) { c.add(t, 1); t += 1000; }
  assert.equal(Math.round(c.slow), 30);
  t += 60000; // a tunnel
  c.add(t, 0);
  assert.equal(Math.round(c.slow), 30);
  c.add(t + 1000, null);
  assert.equal(Math.round(c.slow), 30, 'no speed, no guess');
  assert.equal(c.span, (t + 1000) / 1000, 'the drive took this long by the GPS clock');
  assert.equal(new CrawlClock().span, 0);
});
