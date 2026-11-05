import test from 'node:test';
import assert from 'node:assert/strict';
import { closePrayer, parseMonth, prayerDuringTrip, PrayerTimes } from '../js/prayer.js';

// 5 Nov 2026 in Malaysia.
const at = (h, m = 0, day = 5) => new Date(2026, 10, day, h, m).getTime();
const secs = (ms) => Math.floor(ms / 1000);
const dayEntry = (day) => ({
  day,
  hijri: '1448-05-25',
  imsak: secs(at(5, 40, day)),
  fajr: secs(at(5, 50, day)),
  syuruk: secs(at(7, 5, day)),
  dhuha: secs(at(7, 30, day)),
  dhuhr: secs(at(13, 5, day)),
  asr: secs(at(16, 20, day)),
  maghrib: secs(at(19, 5, day)),
  isha: secs(at(20, 15, day)),
});
const month = { zone: 'WLY01', year: 2026, month: 'NOV', month_number: 11, last_updated: null, prayers: [dayEntry(4), dayEntry(5), dayEntry(6)] };
const data = parseMonth(month);

test('reads the schedule as times', () => {
  assert.equal(data.zone, 'WLY01');
  assert.equal(data.days[5].asr, at(16, 20));
  assert.equal(parseMonth({}), null);
  assert.equal(parseMonth({ prayers: [] }), null);
});

test('close means the next half hour', () => {
  assert.equal(closePrayer(data, at(15, 0)), null);
  const soon = closePrayer(data, at(16, 0));
  assert.equal(soon.name, 'asr');
  assert.equal(soon.state, 'soon');
  assert.equal(soon.minutes, 20);
});

test('or the last quarter hour', () => {
  const now = closePrayer(data, at(16, 25));
  assert.equal(now.name, 'asr');
  assert.equal(now.state, 'now');
  assert.equal(closePrayer(data, at(16, 40)), null);
});

test('syuruk is not treated as a prayer', () => {
  assert.equal(closePrayer(data, at(7, 0)), null);
});

test('just after midnight looks at the right day', () => {
  assert.equal(closePrayer(data, at(0, 10, 6)), null);
  assert.equal(closePrayer(data, at(5, 30, 6)).name, 'fajr');
});

test('finds a prayer that comes in during a trip', () => {
  const p = prayerDuringTrip(data, at(15, 30), 3600);
  assert.equal(p.name, 'asr');
  assert.equal(p.afterSeconds, 50 * 60);
  assert.equal(prayerDuringTrip(data, at(14, 0), 1800), null);
  assert.equal(prayerDuringTrip(data, at(21, 0), 10 * 3600).name, 'fajr');
});

test('another month gives nothing rather than wrong times', () => {
  assert.equal(closePrayer(data, new Date(2026, 11, 5, 16, 0).getTime()), null);
  assert.equal(prayerDuringTrip(data, new Date(2026, 11, 5, 15, 0).getTime(), 7200), null);
  assert.equal(closePrayer(null, at(16, 0)), null);
});

globalThis.localStorage ??= (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
})();

test('asks once, with a rough position, and reuses the answer nearby', async () => {
  localStorage.removeItem('pintu.solat');
  const urls = [];
  const fetchImpl = async (u) => { urls.push(u); return new Response(JSON.stringify(month)); };
  const p = new PrayerTimes({ fetchImpl });
  await p.update(3.15789, 101.71234, at(12));
  assert.equal(urls.length, 1);
  assert.equal(urls[0], 'https://api.waktusolat.app/v2/solat/gps/3.16/101.71');
  assert.equal(p.data.zone, 'WLY01');
  p.lastTry = 0;
  await p.update(3.2, 101.75, at(13));
  assert.equal(urls.length, 1, 'same area');
  p.lastTry = 0;
  await p.update(2.7, 101.9, at(14));
  assert.equal(urls.length, 2, 'new area');
});

test('remembers the schedule between visits', async () => {
  localStorage.removeItem('pintu.solat');
  const fetchImpl = async () => new Response(JSON.stringify(month));
  const a = new PrayerTimes({ fetchImpl });
  await a.update(3.15, 101.7, at(12));
  const b = new PrayerTimes({ fetchImpl: async () => { throw new Error('no network needed'); } });
  assert.equal(b.data.zone, 'WLY01');
});

test('failure outside Malaysia hides times and waits before asking again', async () => {
  localStorage.removeItem('pintu.solat');
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('{"message":"nope"}', { status: 404 }); };
  const p = new PrayerTimes({ fetchImpl });
  await p.update(1.3, 103.8, at(12));
  assert.equal(p.data, null);
  await p.update(1.3, 103.8, at(12, 1));
  assert.equal(calls, 1);
});
