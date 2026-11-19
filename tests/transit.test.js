import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BACKOFF_MS, decodeFeed, FEED_EVERY_MS, KEEP_MS, WAIT_MS, LiveTransit, lineFeatures, loadTransit, forgetTransit, MIN_GAP_MS, MIN_ZOOM,
  overlaps, routeOf, stationFeatures, vehicleFeatures,
} from '../js/transit.js';

import { feed, vehicle } from './helpers/gtfs-rt.js';

test('a live feed read: each vehicle with its trip, route, place and time', () => {
  const buf = feed([
    vehicle({ id: '0', trip: 'weekday_U8210_U821002_0', route: 'U8210', lat: 3.23183298, lng: 101.676842, at: 1795108689, vid: 'WUW1664', plate: 'WUW1664' }),
    vehicle({ id: '1', trip: '2001', lat: 3.1343, lng: 101.6865, bearing: 274 }),
    // No fix: placed in the sea off Africa.
    vehicle({ id: '2', route: 'U3000', lat: 0, lng: 0 }),
  ]);
  const got = decodeFeed(buf.buffer);
  assert.equal(got.at, 1795108712000);
  assert.equal(got.vehicles.length, 2);
  const [a, b] = got.vehicles;
  assert.equal(a.id, 'WUW1664');
  assert.equal(a.trip, 'weekday_U8210_U821002_0');
  assert.equal(a.route, 'U8210');
  assert.ok(Math.abs(a.lat - 3.231833) < 1e-5 && Math.abs(a.lng - 101.676842) < 1e-4);
  assert.equal(a.at, 1795108689000);
  assert.equal(b.id, '1');       // no vehicle id of its own: the entity's
  assert.equal(b.route, '');
  assert.equal(b.trip, '2001');
  assert.equal(Math.round(b.bearing), 274);
  assert.equal(b.at, null);
});

test('an empty feed, as at night, and a broken one', () => {
  assert.deepEqual(decodeFeed(feed([])), { at: 1795108712000, vehicles: [] });
  const buf = feed([vehicle({ route: 'U3000', lat: 3.1, lng: 101.7 })]);
  assert.throws(() => decodeFeed(buf.subarray(0, buf.length - 5)), /cut short/);
});

test('a vehicle says its route, by route or, for KTM, by its trip', () => {
  const bus = { kind: 'bus', routes: { U3000: ['300', 'Terminal Maluri ~ Lebuh Ampang', '#006CFF'] } };
  const ktm = { kind: 'train', routes: { KC05_KB18: ['Seremban Line', 'KTM Batu Caves - Pulau Sebang/Tampin', '#3C5A9F'] }, trips: { 2001: 'KC05_KB18' } };
  assert.deepEqual(routeOf({ route: 'U3000' }, bus), { number: '300', name: 'Terminal Maluri ~ Lebuh Ampang', colour: '#006CFF' });
  assert.deepEqual(routeOf({ trip: '2001' }, ktm), { number: 'Seremban Line', name: 'KTM Batu Caves - Pulau Sebang/Tampin', colour: '#3C5A9F' });
  assert.deepEqual(routeOf({ route: 'NEW1' }, bus), { number: '', name: '', colour: '#1565C0' });
  // Not in the timetable, but its id is the number on the bus.
  assert.deepEqual(routeOf({ route: 'K10' }, { kind: 'bus', routes: {} }), { number: 'K10', name: '', colour: '#1565C0' });
  assert.deepEqual(routeOf({ route: '30000009' }, { kind: 'bus', routes: {} }), { number: '', name: '', colour: '#1565C0' });
  assert.deepEqual(routeOf({ trip: '9' }, ktm), { number: '', name: '', colour: '#3C5A9F' });
});

test('boxes that touch overlap; boxes apart do not', () => {
  assert.ok(overlaps([101, 3, 102, 4], [101.5, 3.5, 101.6, 3.6]));
  assert.ok(overlaps([101, 3, 102, 4], [102, 4, 103, 5]));
  assert.ok(!overlaps([101, 3, 102, 4], [103, 3, 104, 4]));
  assert.ok(!overlaps(null, [1, 1, 2, 2]));
});

const KL = [101.6, 3.05, 101.8, 3.2];
const FEEDS = [
  { id: 'rapid-bus-kl', kind: 'bus', url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl', box: [101.3, 2.8, 101.9, 3.4], routes: { U3000: ['300', 'Terminal Maluri ~ Lebuh Ampang', '#006CFF'] } },
  { id: 'ktmb', kind: 'train', url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb', box: [100.1, 1.4, 104.0, 6.7], routes: {}, trips: {} },
  { id: 'mybas-johor', kind: 'bus', url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-johor', box: [103.5, 1.3, 104.0, 1.7], routes: {} },
];

function setup({ fail = () => false } = {}) {
  let now = 1_800_000_000_000;
  const asked = [];
  const live = new LiveTransit({
    feeds: FEEDS,
    now: () => now,
    fetchImpl: async (url, opts) => {
      asked.push(url.split('/').pop());
      assert.equal(opts.cache, 'no-store');
      const code = fail(url);
      if (code) return new Response('', { status: code });
      return new Response(feed([vehicle({ route: 'U3000', lat: 3.15, lng: 101.7, at: Math.floor(now / 1000) - 20 })], Math.floor(now / 1000)));
    },
  });
  return { live, asked, tick: (ms) => { now += ms; }, at: () => now };
}

test('only the feeds the map is looking at are asked for, the oldest first, one every 16 s', async () => {
  const { live, asked, tick } = setup();
  assert.equal(await live.poll(KL, 13), true);
  assert.deepEqual(asked, ['prasarana?category=rapid-bus-kl']);
  // Too soon for anything.
  tick(MIN_GAP_MS - 1000);
  assert.equal(await live.poll(KL, 13), false);
  tick(1000);
  assert.equal(await live.poll(KL, 13), true);
  assert.deepEqual(asked, ['prasarana?category=rapid-bus-kl', 'ktmb']);
  // Both fresh: nothing until the first is 30 s old.
  tick(MIN_GAP_MS);
  assert.equal(await live.poll(KL, 13), true);
  assert.equal(asked.length, 3);
  assert.ok(MIN_GAP_MS * 2 >= FEED_EVERY_MS);
  // Johor Bahru's buses are never asked for from Kuala Lumpur.
  assert.ok(!asked.some((a) => a.includes('johor')));
  // Never more than four a minute, however long it runs.
  for (let i = 0; i < 40; i++) { tick(1000); await live.poll(KL, 13); }
  assert.ok(asked.length - 3 <= Math.ceil(40000 / MIN_GAP_MS));
});

test('nothing is asked for zoomed out, or with no view', async () => {
  const { live, asked } = setup();
  assert.equal(await live.poll(KL, MIN_ZOOM - 0.5), false);
  assert.equal(await live.poll(null, 14), false);
  assert.deepEqual(asked, []);
});

test('a refusal waits a good while before that feed is asked for again', async () => {
  const { live, asked, tick } = setup({ fail: (u) => (u.includes('ktmb') ? 429 : 0) });
  await live.poll(KL, 13);
  tick(MIN_GAP_MS);
  assert.equal(await live.poll(KL, 13), false);
  assert.deepEqual(asked, ['prasarana?category=rapid-bus-kl', 'ktmb']);
  for (let i = 0; i < 5; i++) { tick(MIN_GAP_MS); await live.poll(KL, 13); }
  const ktmAsks = asked.filter((a) => a === 'ktmb').length;
  assert.equal(ktmAsks, 1, 'not again within the wait');
  tick(BACKOFF_MS);
  await live.poll(KL, 13);
  await live.poll(KL, 13);
  tick(MIN_GAP_MS);
  await live.poll(KL, 13);
  assert.equal(asked.filter((a) => a === 'ktmb').length, 2);
});

test('an answer that never comes is given up on, and the next feed is asked for', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 1_800_000_000_000;
  const asked = [];
  const live = new LiveTransit({
    feeds: FEEDS,
    now: () => now,
    fetchImpl: (url, { signal }) => {
      asked.push(url.split('/').pop());
      if (asked.length > 1) return Promise.resolve(new Response(feed([])));
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    },
  });
  const first = live.poll(KL, 13);
  assert.equal(await live.poll(KL, 13), false, 'one at a time');
  t.mock.timers.tick(WAIT_MS);
  assert.equal(await first, false);
  now += MIN_GAP_MS;
  assert.equal(await live.poll(KL, 13), true);
  assert.deepEqual(asked, ['prasarana?category=rapid-bus-kl', 'ktmb']);
});

test('positions are kept for ten minutes, and a vehicle clock far in the future is not believed', async () => {
  const { live, tick, at } = setup();
  await live.poll(KL, 13);
  const [v] = live.vehicles();
  assert.equal(v.feed.id, 'rapid-bus-kl');
  assert.equal(v.at, Math.floor(at() / 1000) * 1000 - 20000);
  tick(KEEP_MS);
  assert.equal(live.vehicles().length, 0);

  const odd = new LiveTransit({
    feeds: FEEDS,
    now: at,
    fetchImpl: async () => new Response(feed([vehicle({ route: 'U3000', lat: 3.2, lng: 101.6, at: 1886017556 })], Math.floor(at() / 1000) - 5)),
  });
  await odd.poll(KL, 13);
  assert.equal(odd.vehicles()[0].at, Math.floor(at() / 1000) * 1000 - 5000);
});

test('on the map: vehicles in their route colour with a short number, lines and stations', () => {
  const v = { id: 'WUW1664', route: 'U3000', lat: 3.15, lng: 101.7, at: 1, feed: FEEDS[0] };
  const long = { id: 'x', route: 'B1', lat: 3.1, lng: 101.6, at: 1, feed: { ...FEEDS[0], routes: { B1: ['Sunway Line', 'BRT', '#21618C'] } } };
  const fc = vehicleFeatures([v, long]);
  assert.deepEqual(fc.features[0].properties, { k: 'bus', c: '#006CFF', n: '300', feed: 'rapid-bus-kl', id: 'WUW1664', at: 1 });
  assert.deepEqual(fc.features[0].geometry.coordinates, [101.7, 3.15]);
  assert.equal(fc.features[1].properties.n, '', 'too long to sit beside the dot');
  const data = { lines: [{ name: 'Ampang Line', colour: '#E57200', line: [[101.7, 3.1], [101.8, 3.2]] }], stations: [['Ampang', 3.15, 101.76, '#E57200']] };
  assert.deepEqual(lineFeatures(data).features[0].properties, { c: '#E57200', name: 'Ampang Line' });
  assert.deepEqual(stationFeatures(data).features[0].geometry.coordinates, [101.76, 3.15]);
});

test('the data file loads once, and only feeds on the data portal are kept', async () => {
  forgetTransit();
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response(JSON.stringify({
      lines: [{ id: 'AG', line: [[101.7, 3.1], [101.8, 3.2]] }, { id: 'bad', line: [] }],
      stations: [['A', 3.1, 101.7, '#000'], ['B', null, 1, '#000']],
      feeds: [FEEDS[0], { ...FEEDS[1], url: 'https://example.com/feed' }],
    }));
  };
  const data = await loadTransit({ fetchImpl });
  await loadTransit({ fetchImpl });
  assert.equal(calls, 1);
  assert.deepEqual([data.lines.length, data.stations.length, data.feeds.length], [1, 1, 1]);
  forgetTransit();
});

test('the data kept with the app, when there', { skip: !exists() }, () => {
  const data = JSON.parse(readFileSync(new URL('../data/transit.json', import.meta.url)));
  assert.match(data.source, /data\.gov\.my/);
  assert.ok(data.lines.length >= 6);
  for (const l of data.lines) {
    assert.match(l.colour, /^#[0-9A-F]{6}$/);
    for (const [lng, lat] of l.line) assert.ok(lng > 101 && lng < 102 && lat > 2.7 && lat < 3.5, l.id);
  }
  assert.ok(data.stations.length > 250);
  const ids = data.feeds.map((f) => f.id);
  for (const id of ['rapid-bus-kl', 'rapid-bus-mrtfeeder', 'ktmb']) assert.ok(ids.includes(id), id);
  for (const f of data.feeds) {
    assert.match(f.url, /^https:\/\/api\.data\.gov\.my\/gtfs-realtime\/vehicle-position\//);
    assert.ok(f.box[0] < f.box[2] && f.box[1] < f.box[3], f.id);
    assert.ok(Object.keys(f.routes).length > 0, f.id);
  }
  const kl = data.feeds.find((f) => f.id === 'rapid-bus-kl');
  assert.ok(overlaps(kl.box, KL));
  assert.ok(Object.keys(kl.routes).length > 80);
});

function exists() {
  try { readFileSync(new URL('../data/transit.json', import.meta.url)); return true; } catch { return false; }
}
