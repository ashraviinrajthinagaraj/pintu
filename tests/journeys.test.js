import test from 'node:test';
import assert from 'node:assert/strict';
import { trimPlan } from '../server/transit.js';
import {
  JourneyError, journeyCoords, journeyFeatures, kindOf, mergeTrips, placeName, planTrips, prepareTrips, summaryLegs, textOn,
} from '../js/journeys.js';
import { klTrip, pjTrip, plan } from './helpers/transitous.js';

// As the page gets it: through the server, then made ready.
const ready = (itineraries, ends = { from: 'KL Sentral', to: 'Suria KLCC' }, extra) => prepareTrips(trimPlan(plan(itineraries, extra)), ends);

test('stop names as people say them', () => {
  assert.equal(placeName('PJ347 KOMERSIAL SS2 (POH KONG)'), 'Komersial SS2 (Poh Kong)');
  assert.equal(placeName('KL SENTRAL - REDONE'), 'KL Sentral - Redone');
  assert.equal(placeName('JB SENTRAL'), 'JB Sentral');
  assert.equal(placeName('KL1102 MASJID AR-RAHMAN UM'), 'Masjid Ar-Rahman UM');
  assert.equal(placeName('Johor Bahru Checkpt'), 'Johor Bahru Checkpt');
  assert.equal(placeName('Bt Panjang Stn Exit A/Lrt'), 'Bt Panjang Stn Exit A/Lrt');
  assert.equal(placeName('MARINA BAY'), 'Marina Bay');
  // A name that is only a code stays a code.
  assert.equal(placeName('KJ15'), 'KJ15');
  assert.equal(placeName(''), '');
});

test('what each part of a trip is on', () => {
  assert.equal(kindOf('WALK'), 'walk');
  assert.equal(kindOf('BUS'), 'bus');
  assert.equal(kindOf('SUBWAY'), 'metro');
  assert.equal(kindOf('REGIONAL_RAIL'), 'train');
  assert.equal(kindOf('FERRY'), 'ferry');
  assert.equal(kindOf('SPACESHIP'), 'other');
  assert.equal(textOn('#FFC72C'), '#15191C');
  assert.equal(textOn('#D50032'), '#FFFFFF');
});

test('a trip made ready: your own start and end, the train with its colour, stops and lateness', () => {
  const { trips, earlier, later, walk } = ready([klTrip(undefined, { live: true, late: 3 })]);
  assert.equal(trips.length, 1);
  assert.equal(earlier, 'EARLIER|1795134720');
  assert.equal(later, 'LATER|1795136520');
  assert.equal(walk, null);
  const [t] = trips;
  assert.equal(t.start, Date.parse('2026-11-20T00:32:00Z'));
  assert.equal(t.seconds, 21 * 60);
  assert.equal(t.transfers, 0);
  assert.equal(t.walkSeconds, 300);
  const [w, lrt, w2] = t.legs;
  assert.equal(w.kind, 'walk');
  assert.equal(w.from.name, 'KL Sentral', 'START is where you are');
  assert.equal(w.to.name, 'KL Sentral - Redone');
  assert.equal(w.metres, 84);
  assert.equal(w2.to.name, 'Suria KLCC', 'END is where you are going');
  assert.equal(t.first, lrt);
  assert.deepEqual([lrt.kind, lrt.name, lrt.long, lrt.colour, lrt.text, lrt.toward], ['metro', 'KJL', 'LRT Kelana Jaya Line', '#D50032', '#FFFFFF', 'Gombak']);
  assert.equal(lrt.from.track, '2');
  assert.equal(lrt.live, true);
  assert.equal(lrt.late, 180);
  assert.deepEqual(lrt.stops.map((s) => s.name), ['Pasar Seni', 'Masjid Jamek', 'Dang Wangi', 'Kampung Baru']);
  assert.equal(lrt.coords.length, 6);
  assert.deepEqual(lrt.coords[0], [101.68625, 3.13442]);
  // Not live: no lateness to speak of.
  assert.equal(ready([klTrip()]).trips[0].first.late, null);
});

test('a line without its colour gets one: Singapore MRT by its line, others by what they are', () => {
  const sg = klTrip();
  Object.assign(sg.legs[1], { routeShortName: 'NS', displayName: 'NS', routeColor: '' });
  assert.equal(ready([sg]).trips[0].first.colour, '#D42E12');
  const bus = ready([pjTrip()]).trips[0];
  assert.equal(bus.first.kind, 'bus');
  assert.equal(bus.first.colour, '#1565C0');
  assert.equal(bus.first.from.name, 'Komersial SS2 (Poh Kong)');
  assert.equal(bus.transfers, 1);
  const ktm = klTrip();
  Object.assign(ktm.legs[1], { mode: 'TRAM', routeShortName: 'Port Klang Line', routeColor: 'dc2420', agencyName: 'Keretapi Tanah Melayu' });
  assert.equal(ready([ktm]).trips[0].first.kind, 'train', 'a KTM Komuter is a train, however it is filed');
  const pale = klTrip();
  pale.legs[1].routeColor = 'FFFFFF';
  assert.equal(ready([pale]).trips[0].first.colour, '#6B7280');
});

test('a summary keeps every ride and the walks worth mentioning', () => {
  const t = ready([pjTrip()]).trips[0];
  assert.deepEqual(summaryLegs(t).map((l) => l.name || `walk ${Math.round(l.seconds / 60)}`), ['walk 7', 'PJ05', 'walk 2', 'KJL', 'walk 13']);
  const k = ready([klTrip()]).trips[0];
  assert.deepEqual(summaryLegs(k).map((l) => l.name || 'walk'), ['KJL', 'walk'], 'a minute to the platform is left out');
});

test('more trips, earlier or later, are added in order without repeats', () => {
  const a = ready([klTrip('2026-11-20T00:32:00Z'), klTrip('2026-11-20T00:36:00Z')]).trips;
  const b = ready([klTrip('2026-11-20T00:36:00Z'), klTrip('2026-11-20T00:40:00Z')]).trips;
  const c = ready([klTrip('2026-11-20T00:28:00Z')]).trips;
  assert.deepEqual(mergeTrips(a, b).map((t) => new Date(t.start).toISOString().slice(11, 16)), ['00:32', '00:36', '00:40']);
  assert.deepEqual(mergeTrips(c, a).map((t) => new Date(t.start).toISOString().slice(11, 16)), ['00:28', '00:32', '00:36']);
});

test('on the map: walks dashed, rides in their colours, a dot where you get on and off', () => {
  const t = ready([pjTrip()]).trips[0];
  const fc = journeyFeatures(t);
  const lines = fc.features.filter((f) => f.geometry.type === 'LineString');
  const dots = fc.features.filter((f) => f.geometry.type === 'Point');
  assert.equal(lines.length, 5);
  assert.deepEqual(lines.map((f) => f.properties.walk), [true, false, true, false, true]);
  assert.deepEqual(lines.map((f) => f.properties.c), ['#8A96A3', '#1565C0', '#8A96A3', '#D50032', '#8A96A3']);
  assert.equal(dots.length, 4);
  assert.deepEqual(dots[0].geometry.coordinates, [101.62, 3.1201]);
  assert.ok(journeyCoords(t).length >= 10);
  assert.deepEqual(journeyFeatures(null).features, []);
});

test('asking the server: the question, and what goes wrong said plainly', async () => {
  const asked = [];
  const ok = async (url) => { asked.push(url); return new Response(JSON.stringify(trimPlan(plan()))); };
  const json = await planTrips({ server: 'https://s.example', from: { lat: 3.1336, lng: 101.6862 }, to: { lat: 3.1579, lng: 101.7123 }, lang: 'en', version: '0.10.20', fetchImpl: ok });
  assert.equal(json.trips.length, 1);
  const u = new URL(asked[0]);
  assert.equal(u.origin + u.pathname, 'https://s.example/transit');
  assert.deepEqual(Object.fromEntries(u.searchParams), { from: '3.133600,101.686200', to: '3.157900,101.712300', lang: 'en', v: '0.10.20' });

  await planTrips({ server: 'https://s.example', from: { lat: 3, lng: 101 }, to: { lat: 3.1, lng: 101.1 }, when: Date.parse('2026-11-20T10:00:00Z'), arriveBy: true, cursor: 'LATER|1', fetchImpl: ok });
  const v = new URL(asked[1]).searchParams;
  assert.equal(v.get('time'), '2026-11-20T10:00:00.000Z');
  assert.equal(v.get('arriveBy'), '1');
  assert.equal(v.get('cursor'), 'LATER|1');

  const code = (fetchImpl) => planTrips({ server: 'https://s.example', from: { lat: 3, lng: 101 }, to: { lat: 3.1, lng: 101.1 }, fetchImpl }).then(() => 'fine', (e) => (e instanceof JourneyError ? e.code : e.message));
  assert.equal(await code(async () => new Response('', { status: 429 })), 'busy');
  assert.equal(await code(async () => new Response('', { status: 502 })), 'unavailable');
  assert.equal(await code(async () => { throw new TypeError('Failed to fetch'); }), 'offline');
  assert.equal(await planTrips({ server: '' }).catch((e) => e.code), 'unavailable');
});
