import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, clearPlacesCache, findAlongRoute, parseElements, placeOnRoute, rankAlongRoute, thinAlong, routeSample } from '../js/places.js';
import { prepareTrip } from '../js/routing.js';
import { P, buildTrip, cityTrip } from './helpers/fixtures.js';
import { lngLatToTile } from '../js/tiles.js';
import { encodeTile } from './helpers/mvt.js';

const route = () => prepareTrip(cityTrip());
const OSM = { elements: [
  { type: 'node', id: 1, lat: 3.1502, lon: 101.705, tags: { amenity: 'fuel', name: 'Petronas Ampang', brand: 'Petronas' } },
  { type: 'way', id: 2, center: { lat: 3.1498, lon: 101.702 }, tags: { amenity: 'fuel', brand: 'Shell' } },
  { type: 'node', id: 3, lat: 3.17, lon: 101.75, tags: { amenity: 'fuel' } },
  { type: 'relation', id: 4, tags: { amenity: 'fuel' } },
] };

test('asks Overpass for the right kind of place along the line', () => {
  const q = buildQuery('fuel', [[101.7, 3.15], [101.71, 3.15]]);
  assert.match(q, /\[out:json\]/);
  assert.match(q, /nwr\["amenity"="fuel"\]\(around:1500,3\.15000,101\.70000,3\.15000,101\.71000\);/);
  assert.match(buildQuery('surau', [[101.7, 3.15]]), /"religion"="muslim"/);
  assert.match(buildQuery('rest', [[101.7, 3.15]]), /services\|rest_area/);
  assert.match(buildQuery('ev', [[101.7, 3.15]]), /charging_station/);
});

test('keeps long routes down to a reasonable request', () => {
  const long = prepareTrip(buildTrip([100.3, 5.4], [{ to: [101.7, 3.15], type: 1, street: 'E1', kph: 100 }]));
  const pts = routeSample(long, 0);
  assert.ok(pts.length >= 2 && pts.length <= 125, String(pts.length));
  assert.ok(buildQuery('fuel', pts).length < 6000);
});

test('search starts from where you are now', () => {
  const r = route();
  const pts = routeSample(r, 1500);
  assert.ok(pts[0][1] > P.a[1], 'skips the road already behind you');
});

test('reads places, using the brand when there is no name', () => {
  const places = parseElements(OSM, 'fuel');
  assert.equal(places.length, 3);
  assert.equal(places[0].name, 'Petronas Ampang');
  assert.equal(places[1].name, 'Shell');
  assert.equal(places[1].lat, 3.1498);
  assert.equal(places[2].name, '');
});

test('works out how far ahead and which side', () => {
  const r = route();
  const left = placeOnRoute(r, { lng: 101.705, lat: 3.1502 }, 0);
  assert.ok(left.ahead > 500 && left.ahead < 600, String(left.ahead));
  assert.ok(left.off > 15 && left.off < 30, String(left.off));
  assert.equal(left.side, 'left');
  assert.equal(placeOnRoute(r, { lng: 101.705, lat: 3.1498 }, 0).side, 'right');
  assert.equal(placeOnRoute(r, { lng: 101.705, lat: 3.15 }, 0).side, null);
});

test('only counts what is still ahead, nearest first', () => {
  const r = route();
  const places = parseElements(OSM, 'fuel');
  const ranked = rankAlongRoute(r, places, 0);
  assert.deepEqual(ranked.slice(0, 2).map((p) => p.name), ['Shell', 'Petronas Ampang']);
  assert.equal(ranked.length, 2, 'the one 4 km off the route is dropped');
  const later = rankAlongRoute(r, places.slice(0, 2), 800);
  for (const p of later) assert.ok(p.ahead >= 0);
  assert.ok(later.every((p) => p.along >= 800));
});

test('the same place mapped twice appears once', () => {
  const r = route();
  const a = { id: 'a', name: 'Shell', lng: 101.705, lat: 3.1501 };
  const b = { id: 'b', name: 'Shell', lng: 101.7051, lat: 3.1501 };
  const far = { id: 'c', name: 'Shell', lng: 101.709, lat: 3.1501 };
  assert.equal(rankAlongRoute(r, [a, b, far], 0).length, 2);
});

// The servers below are tested with the map tiles out of reach.
const noTiles = (fetchImpl) => (u, init) => (String(u).includes('.pbf') ? Promise.reject(new TypeError('no tiles')) : fetchImpl(u, init));

test('a server that goes quiet is abandoned, and left alone afterwards', async () => {
  clearPlacesCache();
  const r = route();
  const calls = [];
  const fetchImpl = noTiles((u, init) => {
    calls.push(u);
    if (u.includes('quiet')) return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    if (u.includes('b.test')) return Promise.reject(new TypeError('down'));
    return Promise.resolve(new Response(JSON.stringify(OSM)));
  });
  const servers = ['https://quiet.test/i', 'https://b.test/i', 'https://c.test/i'];
  const waits = { tile: 50, server: 40, search: 50, total: 2000 };
  const places = await findAlongRoute(r, 'fuel', 0, { fetchImpl, servers, waits });
  assert.ok(places.length >= 2);
  assert.deepEqual(calls, servers);
  await findAlongRoute(r, 'surau', 0, { fetchImpl, servers, waits });
  assert.deepEqual(calls.slice(3), ['https://c.test/i'], 'only the one that answered');
});

test('"OK" with a time-out note counts as no answer', async () => {
  clearPlacesCache();
  const r = route();
  const calls = [];
  const fetchImpl = noTiles(async (u) => {
    calls.push(u);
    if (u.includes('late')) return new Response(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out' }));
    return new Response(JSON.stringify(OSM));
  });
  const places = await findAlongRoute(r, 'fuel', 0, { fetchImpl, servers: ['https://late.test/i', 'https://b.test/i'] });
  assert.ok(places.length >= 2);
  assert.equal(calls.length, 2);
});

test('a server saying "too many requests" is not asked again straight away', async () => {
  clearPlacesCache();
  const r = route();
  let n = 0;
  const fetchImpl = noTiles(async (u) => {
    if (u.includes('busy')) { n++; return new Response('', { status: 429 }); }
    return new Response(JSON.stringify(OSM));
  });
  const servers = ['https://busy.test/i', 'https://b.test/i'];
  await findAlongRoute(r, 'fuel', 0, { fetchImpl, servers });
  await findAlongRoute(r, 'ev', 0, { fetchImpl, servers });
  await findAlongRoute(r, 'rest', 0, { fetchImpl, servers });
  assert.equal(n, 1);
});

test('nonsense from a server moves on to the next', async () => {
  clearPlacesCache();
  const fetchImpl = noTiles(async (u) => (u.includes('bad') ? new Response('<html>busy</html>') : new Response(JSON.stringify(OSM))));
  const places = await findAlongRoute(route(), 'fuel', 0, { fetchImpl, servers: ['https://bad.test/i', 'https://b.test/i'] });
  assert.ok(places.length >= 2);
});

test('with every Overpass server down, the search service is asked instead', async () => {
  clearPlacesCache();
  const urls = [];
  const fetchImpl = noTiles(async (u) => {
    urls.push(String(u));
    if (String(u).includes('over.test')) return new Response('', { status: 504 });
    return new Response(JSON.stringify({ features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [101.705, 3.1502] }, properties: { name: 'Petronas', osm_type: 'N', osm_id: 5, osm_key: 'amenity', osm_value: 'fuel' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [101.7051, 3.1503] }, properties: { name: 'Kedai Buku', osm_type: 'N', osm_id: 6, osm_key: 'shop', osm_value: 'books' } },
    ] }));
  });
  const places = await findAlongRoute(route(), 'fuel', 0, { fetchImpl, servers: ['https://over.test/i'] });
  assert.equal(places[0].name, 'Petronas');
  assert.equal(places.length, 1, 'the same place from several points counts once');
  const photon = urls.filter((u) => u.includes('photon'));
  assert.ok(photon.length >= 2 && photon.length <= 4, String(photon.length));
  assert.match(photon[0], /include=osm\.amenity\.fuel/);
  assert.match(photon[0], /lat=3\.\d+&lon=101\.\d+/);
});

test('the search service only offers mosques and surau as surau', async () => {
  clearPlacesCache();
  const fetchImpl = noTiles(async (u) => {
    if (String(u).includes('over.test')) return new Response('', { status: 504 });
    const worship = (name, id, lng) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, 3.1502] }, properties: { name, osm_type: 'N', osm_id: id, osm_key: 'amenity', osm_value: 'place_of_worship' } });
    return new Response(JSON.stringify({ features: [worship('Surau Al-Hidayah', 1, 101.705), worship('St Mary Church', 2, 101.7051), worship('Masjid Jamek', 3, 101.7052)] }));
  });
  const places = await findAlongRoute(route(), 'surau', 0, { fetchImpl, servers: ['https://over.test/i'] });
  assert.deepEqual(places.map((p) => p.name).sort(), ['Masjid Jamek', 'Surau Al-Hidayah']);
});

test('falls back to the next server, reusing results afterwards', async () => {
  clearPlacesCache();
  const r = route();
  const calls = [];
  const fetchImpl = noTiles(async (u, init) => {
    calls.push(u);
    assert.equal(init.method, 'POST');
    assert.match(init.body.toString(), /^data=/);
    if (u.includes('a.test')) return new Response('busy', { status: 429 });
    return new Response(JSON.stringify(OSM));
  });
  const servers = ['https://a.test/i', 'https://b.test/i'];
  const places = await findAlongRoute(r, 'fuel', 0, { fetchImpl, servers });
  assert.ok(places.length >= 2);
  assert.equal(calls.length, 2);
  await findAlongRoute(r, 'fuel', 200, { fetchImpl, servers });
  assert.equal(calls.length, 2, 'same route, no new request');
  await findAlongRoute(r, 'surau', 200, { fetchImpl, servers });
  assert.equal(calls.length, 3, 'different category, and the busy server is left alone');
});

test('reports failure when no server answers', async () => {
  clearPlacesCache();
  await assert.rejects(findAlongRoute(route(), 'ev', 0, {
    servers: ['https://a.test/i'],
    fetchImpl: async () => { throw new TypeError('offline'); },
  }));
  clearPlacesCache();
});

// A tile with a bit of everything, a few metres from the test route's first road.
const TILE_POIS = [
  { id: 11, lng: 101.7055, lat: 3.1502, props: { name: 'Petronas Tile', class: 'fuel', subclass: 'fuel', rank: 3 } },
  { id: 12, lng: 101.7056, lat: 3.1503, props: { name: 'Nasi Lemak', class: 'restaurant', subclass: 'restaurant' } },
  { id: 13, lng: 101.7057, lat: 3.1502, props: { name: 'Kopitiam', class: 'cafe', subclass: 'cafe' } },
  { id: 14, lng: 101.7058, lat: 3.1503, props: { name: 'Surau Al-Hidayah', class: 'place_of_worship', subclass: 'place_of_worship' } },
  { id: 15, lng: 101.7059, lat: 3.1502, props: { name: 'St Mary Church', class: 'place_of_worship', subclass: 'place_of_worship' } },
  { id: 16, lng: 101.7060, lat: 3.1503, props: { name: 'R&R Ampang', class: 'shop', subclass: 'convenience' } },
  { id: 17, lng: 101.7061, lat: 3.1502, props: { name: 'Kedai Buku', class: 'library', subclass: 'books' } },
  { id: 18, lng: 101.7062, lat: 3.1503, props: { class: 'fuel', subclass: 'fuel' } },
];

const tileServer = (log = []) => async (u) => {
  u = String(u);
  log.push(u);
  const m = u.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
  if (!m) throw new Error(`unexpected request to ${u}`);
  const [z, x, y] = m.slice(1).map(Number);
  const inside = TILE_POIS.filter((p) => {
    const [tx, ty] = lngLatToTile(p.lng, p.lat, z);
    return Math.floor(tx) === x && Math.floor(ty) === y;
  });
  return new Response(encodeTile({ z, x, y }, { transportation: [{ id: 1, lng: 101.7, lat: 3.15, props: { class: 'primary' } }], poi: inside }));
};

test('stops come from the map tiles, without bothering any other server', async () => {
  clearPlacesCache();
  const log = [];
  const r = route();
  const places = await findAlongRoute(r, 'fuel', 0, { fetchImpl: tileServer(log), tileUrl: 'https://map.test/{z}/{x}/{y}.pbf' });
  assert.deepEqual(places.map((p) => p.name), ['Petronas Tile', '']);
  assert.equal(places[0].category, 'fuel');
  assert.ok(Math.abs(places[0].lng - 101.7055) < 0.0001 && Math.abs(places[0].lat - 3.1502) < 0.0001);
  assert.ok(places[0].along > 0);
  assert.ok(log.every((u) => u.includes('map.test')));
  assert.ok(log.length >= 1 && log.length <= 40, String(log.length));
  // Asked again, nothing needs downloading.
  const before = log.length;
  await findAlongRoute(r, 'fuel', 100, { fetchImpl: tileServer(log), tileUrl: 'https://map.test/{z}/{x}/{y}.pbf' });
  assert.equal(log.length, before);
});

test('each kind of stop picks the right places out of a tile', async () => {
  const tileUrl = 'https://map.test/{z}/{x}/{y}.pbf';
  const names = async (category) => {
    clearPlacesCache();
    const fetchImpl = (u, init) => (String(u).includes('map.test') ? tileServer()(u, init) : Promise.reject(new TypeError('down')));
    const found = await findAlongRoute(route(), category, 0, { fetchImpl, tileUrl, servers: ['https://a.test/i'] }).catch(() => []);
    return found.map((p) => p.name).sort();
  };
  assert.deepEqual(await names('food'), ['Kopitiam', 'Nasi Lemak']);
  assert.deepEqual(await names('surau'), ['Surau Al-Hidayah']);
  assert.deepEqual(await names('rest'), ['R&R Ampang']);
});

test('results arrive as they are found, before the search has finished', async () => {
  clearPlacesCache();
  const seen = [];
  const r = route();
  const server = tileServer();
  let release;
  const held = new Promise((res) => { release = res; });
  let n = 0;
  const fetchImpl = async (u) => {
    const res = await server(u);
    if (++n > 6) await held;
    return res;
  };
  const pending = findAlongRoute(r, 'fuel', 0, { fetchImpl, tileUrl: 'https://map.test/{z}/{x}/{y}.pbf', onProgress: (list) => seen.push(list.length) });
  for (let i = 0; i < 50 && !seen.length; i++) await new Promise((res) => setTimeout(res, 10));
  assert.ok(seen.length, 'heard something while still searching');
  release();
  assert.ok((await pending).length >= 1);
});

test('a kind of stop the tiles may not hold still asks another server', async () => {
  clearPlacesCache();
  const calls = [];
  const server = tileServer();
  const fetchImpl = async (u, init) => {
    if (String(u).includes('map.test')) return server(u, init);
    calls.push(String(u));
    return new Response(JSON.stringify({ elements: [{ type: 'node', id: 1, lat: 3.1502, lon: 101.7055, tags: { amenity: 'charging_station', name: 'ChargEV' } }] }));
  };
  const found = await findAlongRoute(route(), 'ev', 0, { fetchImpl, tileUrl: 'https://map.test/{z}/{x}/{y}.pbf', servers: ['https://a.test/i'] });
  assert.deepEqual(found.map((p) => p.name), ['ChargEV']);
  assert.equal(calls.length, 1);
});

test('no answer about a kind the tiles may not hold is a failure, not "none"', async () => {
  clearPlacesCache();
  const server = tileServer();
  const fetchImpl = async (u, init) => (String(u).includes('map.test') ? server(u, init) : Promise.reject(new TypeError('down')));
  await assert.rejects(findAlongRoute(route(), 'ev', 0, { fetchImpl, tileUrl: 'https://map.test/{z}/{x}/{y}.pbf', servers: ['https://a.test/i'] }));
});

test('every service hanging forever still ends the search in good time', async () => {
  clearPlacesCache();
  // Doesn't even respond to being cancelled, the worst a phone's network can do.
  const fetchImpl = () => new Promise(() => {});
  const waits = { tile: 30, server: 30, search: 30, total: 300 };
  for (const category of ['fuel', 'ev', 'surau']) {
    const began = Date.now();
    await assert.rejects(findAlongRoute(route(), category, 0, { fetchImpl, servers: ['https://a.test/i', 'https://b.test/i'], waits }));
    assert.ok(Date.now() - began < 1000, `${category} took ${Date.now() - began} ms`);
    clearPlacesCache();
  }
});

test('running out of time keeps what was already found', async () => {
  clearPlacesCache();
  const server = tileServer();
  const [x, y] = lngLatToTile(TILE_POIS[0].lng, TILE_POIS[0].lat, 14).map(Math.floor);
  const fetchImpl = async (u) => (String(u).endsWith(`/14/${x}/${y}.pbf`) ? server(u) : new Promise(() => {}));
  const r = route();
  const places = await findAlongRoute(r, 'fuel', 0, { fetchImpl, tileUrl: 'https://map.test/{z}/{x}/{y}.pbf', servers: [], waits: { tile: 100, server: 30, search: 30, total: 60 } });
  assert.ok(places.length >= 1);
});

test('finding nothing in the tiles still asks elsewhere before saying there is none', async () => {
  clearPlacesCache();
  const calls = [];
  const empty = async (u) => {
    if (String(u).includes('map.test')) return new Response(new Uint8Array(0));
    calls.push(String(u));
    return new Response(JSON.stringify({ elements: [{ type: 'node', id: 1, lat: 3.1502, lon: 101.7055, tags: { amenity: 'place_of_worship', religion: 'muslim', name: 'Al-Hidayah' } }] }));
  };
  const found = await findAlongRoute(route(), 'surau', 0, { fetchImpl: empty, tileUrl: 'https://map.test/{z}/{x}/{y}.pbf', servers: ['https://a.test/i'] });
  assert.deepEqual(found.map((p) => p.name), ['Al-Hidayah']);
  assert.equal(calls.length, 1);
});

test('and if nothing else can be reached, the tiles\' answer of none still stands', async () => {
  clearPlacesCache();
  const fetchImpl = async (u) => {
    if (String(u).includes('map.test')) return new Response(new Uint8Array(0));
    throw new TypeError('down');
  };
  assert.deepEqual(await findAlongRoute(route(), 'fuel', 0, { fetchImpl, tileUrl: 'https://map.test/{z}/{x}/{y}.pbf', servers: ['https://a.test/i'] }), []);
});

test('leaving the panel ends the search straight away', async () => {
  clearPlacesCache();
  const ctrl = new AbortController();
  const pending = findAlongRoute(route(), 'fuel', 0, { signal: ctrl.signal, fetchImpl: () => new Promise(() => {}), servers: [] });
  ctrl.abort();
  await assert.rejects(pending, /cancelled/);
});

test('a long list is thinned so it still covers the whole way', () => {
  const near = Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, ahead: i * 50, off: i }));
  const far = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, ahead: 90000 + i * 100, off: i }));
  const out = thinAlong([...near, ...far], 40);
  assert.equal(out.length, 40);
  assert.equal(out.filter((p) => p.id.startsWith('f')).length, 5, 'nothing further along is lost');
  assert.deepEqual(out.map((p) => p.ahead), out.map((p) => p.ahead).sort((a, b) => a - b));
  assert.equal(thinAlong(far, 40), far);
});
