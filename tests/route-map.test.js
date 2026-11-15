import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareTrip } from '../js/routing.js';
import { buildTrip } from './helpers/fixtures.js';
import { clearOf, clearOfBoxes, labelSpots, pointAlong, trafficBar, trafficGradient } from '../js/route-labels.js';
import { firstInto, forgetStates, inFeature, loadStates, namesOf, shapesOf, stateAt, statesAlong, stretchIn } from '../js/states.js';
import { clearWeatherCache, checkRouteWeather, parseWarnings, placesIn, routeAreas } from '../js/weather.js';
import { haversine } from '../js/geo.js';

const statesFile = async () => JSON.parse(await readFile(new URL('../data/states.json', import.meta.url), 'utf8'));
const serveStates = (extra = async () => { throw new TypeError('offline'); }) => async (u) => {
  if (String(u).endsWith('data/states.json')) return new Response(JSON.stringify(await statesFile()));
  return extra(u);
};

/* ---------- Labels beside the routes ---------- */

const line = (pts) => pts;
// Two ways from A to B: one along the bottom, one bulging north in the middle.
const A = [101.60, 3.10], B = [101.80, 3.10];
const south = line([A, [101.65, 3.10], [101.70, 3.10], [101.75, 3.10], B]);
const north = line([A, [101.65, 3.10], [101.68, 3.16], [101.72, 3.16], [101.75, 3.10], B]);

test('a point a share of the way along a line', () => {
  assert.deepEqual(pointAlong([[0, 0], [1, 0]], 0), [0, 0]);
  assert.deepEqual(pointAlong([[0, 0], [1, 0]], 1), [1, 0]);
  const mid = pointAlong([[101, 3], [101.1, 3], [101.1, 3.1]], 0.5);
  assert.ok(Math.abs(mid[0] - 101.1) < 1e-3 && Math.abs(mid[1] - 3) < 1e-3, 'half the distance is about the corner');
  assert.equal(pointAlong([], 0.5), null);
});

test('each label goes where its route is clear of the others', () => {
  const [s, n] = labelSpots([south, north]);
  const gap = (p, other) => Math.min(...other.map((q) => haversine(p, q)));
  // The northern route's label is out on its bulge, well away from the southern route.
  assert.ok(n[1] > 3.14, `north label at ${n}`);
  assert.ok(gap(n, [[101.68, 3.10], [101.70, 3.10], [101.72, 3.10]]) > 4000);
  // And the two labels aren't on top of each other.
  assert.ok(haversine(s, n) > 3000);
  // One route alone: its label sits near the middle.
  const [only] = labelSpots([south]);
  assert.ok(Math.abs(only[0] - 101.70) < 0.02);
  // Nothing to place: nothing placed.
  assert.deepEqual(labelSpots([south, null]).map(Boolean), [true, false]);
});

test('a pin goes where no label is', () => {
  const pts = [[101.60, 3.1], [101.65, 3.1], [101.70, 3.1], [101.75, 3.1], [101.80, 3.1]];
  assert.deepEqual(clearOf(pts, []), [101.70, 3.1], 'the middle, with nothing in the way');
  assert.deepEqual(clearOf(pts, [[101.70, 3.1]]), [101.65, 3.1], 'off the label in the middle, a few km is clear enough');
  assert.deepEqual(clearOf(pts, [[101.60, 3.1], [101.80, 3.1]]), [101.70, 3.1]);
  assert.equal(clearOf([], []), null);
  // On the screen: away from a label's box.
  const px = [[0, 100], [50, 100], [100, 100], [150, 100], [200, 100]];
  assert.equal(clearOfBoxes(px, []), 2);
  assert.equal(clearOfBoxes(px, [[60, 20, 160, 110]]), 0, 'a label over the middle and right');
  assert.equal(clearOfBoxes(px, [[-50, 20, 50, 110], [150, 20, 250, 110]]), 2, 'labels at both ends');
  assert.equal(clearOfBoxes([], []), -1);
});

/* ---------- The traffic bar ---------- */

test('the traffic bar marks slow stretches and jams', () => {
  const traffic = {
    jams: [
      { start: 1000, end: 2000, delay: 30, speed: 40, kind: 'JAM' },          // slower than usual
      { start: 5000, end: 6000, delay: 200, speed: 20, kind: 'JAM' },         // at a crawl
      { start: 8000, end: 8100, delay: 0, speed: null, kind: 'ROAD_CLOSURE' }, // closed
      { start: 9000, end: 9500, delay: 0, speed: 60, kind: 'JAM' },           // nothing lost
    ],
  };
  const bar = trafficBar(10000, traffic);
  assert.deepEqual(bar.map((x) => x.level), ['slow', 'jam', 'jam']);
  assert.deepEqual([bar[0].from, bar[0].to], [0.1, 0.2]);
  assert.deepEqual(trafficBar(10000, null), []);
  assert.deepEqual(trafficBar(0, traffic), []);

  const colours = { clear: 'green', slow: 'orange', jam: 'red' };
  const css = trafficGradient(bar, colours);
  assert.match(css, /^linear-gradient\(90deg, green 0\.00% 10\.00%, orange 10\.00% 20\.00%, green 20\.00% 50\.00%, red 50\.00% 60\.00%/);
  assert.match(css, /green [\d.]+% 100%\)$/);
  assert.equal(trafficGradient([], colours), 'linear-gradient(90deg, green 0.00% 100%)');
});

/* ---------- States ---------- */

test('knows which state a place is in', async () => {
  forgetStates();
  const states = await loadStates({ fetchImpl: serveStates() });
  assert.equal(states.length, 16);
  const at = (lng, lat) => stateAt(states, lng, lat);
  assert.equal(at(101.6869, 3.1390), 'Kuala Lumpur');
  assert.equal(at(101.5183, 3.0733), 'Selangor');
  assert.equal(at(100.3327, 5.4164), 'Pulau Pinang');
  assert.equal(at(103.7414, 1.4927), 'Johor');
  assert.equal(at(102.2501, 2.1896), 'Melaka');
  assert.equal(at(101.0901, 4.5975), 'Perak');
  assert.equal(at(103.3260, 3.8077), 'Pahang');
  assert.equal(at(116.0735, 5.9804), 'Sabah');
  assert.equal(at(110.3593, 1.5535), 'Sarawak');
  assert.equal(at(103.8198, 1.3521), null, 'Singapore is not a state');
  assert.equal(at(104.5, 4.5), null, 'nor is the sea');
  assert.ok(inFeature(shapesOf(states, ['Kelantan'])[0], 102.2386, 6.1254), 'Kota Bharu is in Kelantan');
});

test('follows a route from state to state', async () => {
  forgetStates();
  const states = await loadStates({ fetchImpl: serveStates() });
  const route = prepareTrip(buildTrip([100.45, 5.35], [{ to: [101.69, 3.14], type: 1, street: 'Lebuhraya', kph: 100 }]));
  const entries = statesAlong(states, route);
  const names = namesOf(entries);
  assert.ok(names.includes('Perak') && names.includes('Selangor'), names.join(', '));
  assert.equal(names.at(-1), 'Kuala Lumpur');
  for (let i = 1; i < entries.length; i++) assert.ok(entries[i].s > entries[i - 1].s, 'in the order you reach them');
  const into = firstInto(entries, ['Selangor']);
  assert.equal(stateAt(states, into.lng, into.lat), 'Selangor');
  assert.equal(firstInto(entries, ['Sabah']), null);
  // The warned stretch: from going in to coming out, neighbouring warned states as one.
  const sel = stretchIn(entries, ['Selangor'], route.length);
  const kl = entries.find((e) => e.name === 'Kuala Lumpur');
  assert.deepEqual(sel, { from: into.s, to: kl.s });
  assert.deepEqual(stretchIn(entries, ['Selangor', 'Kuala Lumpur'], route.length), { from: into.s, to: route.length });
  assert.equal(stretchIn(entries, ['Sabah'], route.length), null);
  // Only what's still ahead.
  assert.ok(!namesOf(statesAlong(states, route, route.length - 2000)).includes('Perak'));
});

test('a state that can\'t be loaded is asked again next time', async () => {
  forgetStates();
  await assert.rejects(loadStates({ fetchImpl: async () => new Response('', { status: 503 }) }));
  assert.equal((await loadStates({ fetchImpl: serveStates() })).length, 16);
});

/* ---------- Official warnings, by state and district ---------- */

const MET_STORM = {
  warning_issue: { issued: '2026-11-15T15:30:00', title_bm: 'Amaran Ribut Petir', title_en: 'Thunderstorms Warning' },
  valid_from: '2026-11-15T15:00:00',
  valid_to: '2026-11-15T20:00:00',
  heading_en: 'THUNDERSTORMS WARNING',
  text_en: 'Thunderstorms, heavy rain and strong winds are expected over the states of Perlis • Kedah (Langkawi, Kubang Pasu and Kota Setar) • Penang • Selangor (Sepang, Kuala Langat and Sabak Bernam) • Negeri Sembilan (Seremban and Port Dickson) • Sarawak: Kuching, Sibu (Kanowit and Sibu) until 8:00 PM.',
  heading_bm: 'AMARAN RIBUT PETIR',
  text_bm: 'Ribut petir, hujan lebat dan angin kencang dijangka berlaku di negeri Perlis • Kedah (Langkawi, Kubang Pasu dan Kota Setar) • Pulau Pinang • Selangor (Sepang, Kuala Langat dan Sabak Bernam) sehingga 8:00 malam.',
};
const SEA = {
  warning_issue: { issued: '2026-11-15T13:00:00', title_bm: 'Amaran Angin Kencang dan Laut Bergelora', title_en: 'Strong Winds and Rough Seas Warning' },
  valid_from: '2026-11-15T12:00:00',
  valid_to: '2026-11-15T18:00:00',
  heading_en: 'SECOND CATEGORY WARNING ON STRONG WINDS AND ROUGH SEAS',
  text_en: 'THUNDERSTORMS WARNING Thunderstorms are expected over the waters of Perlis & Kedah • Penang • Selangor.',
};

test('reads the districts a warning names in each state', () => {
  const places = placesIn(MET_STORM.text_en);
  assert.deepEqual(places.Selangor, ['Sepang', 'Kuala Langat', 'Sabak Bernam']);
  assert.deepEqual(places['Negeri Sembilan'], ['Seremban', 'Port Dickson']);
  assert.deepEqual(places.Kedah, ['Langkawi', 'Kubang Pasu', 'Kota Setar']);
  assert.equal(places['Pulau Pinang'], undefined, 'named without districts: all of it');
  assert.deepEqual(placesIn('Hujan di Selangor (Sepang dan Klang).').Selangor, ['Sepang', 'Klang']);
  assert.deepEqual(placesIn(''), {});
});

test('a MET Malaysia storm warning keeps its title, states and districts; one at sea is left out', () => {
  const now = Date.parse('2026-11-15T16:00:00+08:00');
  const list = parseWarnings([MET_STORM, SEA], now);
  assert.equal(list.length, 1);
  const [w] = list;
  assert.deepEqual(w.title, { ms: 'Amaran Ribut Petir', en: 'Thunderstorms Warning' });
  assert.equal(w.storm, true);
  assert.ok(w.states.includes('Selangor') && w.states.includes('Pulau Pinang') && w.states.includes('Sarawak'));
  assert.deepEqual(w.places.Selangor, ['Sepang', 'Kuala Langat', 'Sabak Bernam']);
  assert.equal(w.until, Date.parse('2026-11-15T20:00:00+08:00'));
  assert.equal(parseWarnings([MET_STORM], Date.parse('2026-11-15T20:30:00+08:00')).length, 0, 'over by then');
});

test('the states on a route come from the boundaries, and from the search service without them', async () => {
  const route = prepareTrip(buildTrip([101.52, 3.07], [{ to: [101.69, 3.14], type: 1, street: 'Federal', kph: 80 }]));
  forgetStates();
  const withFile = await routeAreas(route, 0, { fetchImpl: serveStates() });
  assert.deepEqual(withFile.names, ['Selangor', 'Kuala Lumpur']);
  assert.equal(withFile.entries[0].name, 'Selangor');

  forgetStates();
  let asked = 0;
  const without = await routeAreas(route, 0, {
    fetchImpl: async (u) => {
      if (String(u).endsWith('data/states.json')) throw new TypeError('offline');
      asked++;
      return new Response(JSON.stringify({ features: [{ properties: { state: 'Selangor' } }] }));
    },
  });
  assert.deepEqual(without, { names: ['Selangor'], entries: null });
  assert.equal(asked, 4);
});

test('the route weather says where the route goes into each state', async () => {
  clearWeatherCache();
  forgetStates();
  const now = Date.parse('2026-11-15T16:00:00+08:00');
  const route = prepareTrip(buildTrip([101.52, 3.07], [{ to: [101.69, 3.14], type: 1, street: 'Federal', kph: 80 }]));
  const fetchImpl = serveStates(async (u) => {
    u = String(u);
    if (u.includes('data.gov.my')) return new Response(JSON.stringify([MET_STORM]));
    if (u.includes('open-meteo')) return new Response(JSON.stringify([]));
    throw new TypeError('unexpected');
  });
  const out = await checkRouteWeather(route, 0, { now, fetchImpl, server: null });
  assert.equal(out.warnings.length, 1);
  assert.deepEqual(namesOf(out.entries), ['Selangor', 'Kuala Lumpur']);
});
