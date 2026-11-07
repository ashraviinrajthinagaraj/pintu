import test from 'node:test';
import assert from 'node:assert/strict';
import { NEARBY, NEARBY_ORDER, findNearby, nearbyQuery, parseNearby, rankNearby } from '../js/nearby.js';
import { kindLabel } from '../js/kinds.js';
import { clearPlacesCache } from '../js/places.js';
import { tilesAround } from '../js/parking.js';
import { encodeTile } from './helpers/mvt.js';

const here = { lng: 101.7, lat: 3.15 };
const at = (dx, props) => ({ lng: here.lng + dx, lat: here.lat, props });
const TILE_URL = 'https://t.test/{z}/{x}/{y}.pbf';

function tileServer(features) {
  const asked = [];
  const fetchImpl = async (url, init) => {
    asked.push(String(url));
    if (String(url).startsWith('https://t.test/')) {
      const [, x, y] = String(url).match(/14\/(\d+)\/(\d+)/).map(Number);
      return new Response(encodeTile({ z: 14, x, y }, { poi: features.map((f, i) => ({ id: i + 1, ...f })) }));
    }
    return fetchImpl.overpass ? fetchImpl.overpass(init) : new Response('', { status: 500 });
  };
  fetchImpl.asked = asked;
  return fetchImpl;
}

test('five kinds of place, each with what to look for', () => {
  assert.deepEqual(NEARBY_ORDER, ['sights', 'food', 'fuel', 'ev', 'hotel']);
  for (const c of NEARBY_ORDER) {
    assert.match(nearbyQuery(c, here), /around:\d+,3\.15000,101\.70000\)/);
    assert.equal(typeof NEARBY[c].tile, 'function');
  }
  assert.equal(NEARBY.hotel.tile({ name: 'Hotel A', class: 'lodging', subclass: 'hotel' }), true);
  assert.equal(NEARBY.hotel.tile({ name: '', class: 'lodging', subclass: 'hotel' }), false, 'a place to stay needs a name to be chosen');
  assert.equal(NEARBY.sights.tile({ name: 'Muzium', class: 'museum', subclass: 'museum' }), true);
  assert.equal(NEARBY.sights.tile({ name: 'Kedai', class: 'shop', subclass: 'convenience' }), false);
  assert.equal(NEARBY.food.tile({ name: 'Nasi Kandar', class: 'restaurant', subclass: 'restaurant' }), true);
  assert.equal(NEARBY.fuel.tile({ name: '', class: 'fuel', subclass: 'fuel' }), true);
});

test('closest first, each once, and none too far', () => {
  const list = rankNearby([
    { id: 'b', name: 'B', lng: here.lng + 0.02, lat: here.lat },
    { id: 'a', name: 'A', lng: here.lng + 0.001, lat: here.lat },
    { id: 'a2', name: 'A', lng: here.lng + 0.0015, lat: here.lat },
    { id: 'far', name: 'Far', lng: here.lng + 0.2, lat: here.lat },
  ], here, 5000);
  assert.deepEqual(list.map((p) => p.id), ['a', 'b']);
  assert.ok(list[0].distance > 100 && list[0].distance < 120);
});

test('enough in the tiles means nothing else is asked', async () => {
  clearPlacesCache();
  const fetchImpl = tileServer(Array.from({ length: 10 }, (_, i) => at(0.001 * (i + 1), { name: `Restoran ${i}`, class: 'restaurant', subclass: 'restaurant' })));
  const list = await findNearby(here, 'food', { fetchImpl, tileUrl: TILE_URL, servers: ['https://o.test/a'] });
  assert.equal(list[0].name, 'Restoran 0');
  assert.equal(list[0].kind, 'restaurant');
  assert.ok(fetchImpl.asked.every((u) => u.startsWith('https://t.test/')));
  assert.ok(fetchImpl.asked.length <= tilesAround(here.lng, here.lat, 2500).length);
});

test('few in the tiles: OpenStreetMap fills in, further out', async () => {
  clearPlacesCache();
  const fetchImpl = tileServer([at(0.001, { name: 'Muzium Kecil', class: 'museum', subclass: 'museum' })]);
  fetchImpl.overpass = async (init) => {
    assert.match(decodeURIComponent(String(init.body)), /tourism/);
    return new Response(JSON.stringify({ elements: [
      { type: 'way', id: 7, center: { lat: here.lat, lon: here.lng + 0.03 }, tags: { tourism: 'museum', name: 'Muzium Negara' } },
      { type: 'node', id: 8, lat: here.lat, lon: here.lng + 0.001, tags: { tourism: 'museum', name: 'Muzium Kecil' } },
    ] }));
  };
  const list = await findNearby(here, 'sights', { fetchImpl, tileUrl: TILE_URL, servers: ['https://o.test/a'] });
  assert.deepEqual(list.map((p) => p.name), ['Muzium Kecil', 'Muzium Negara']);
  clearPlacesCache();
});

test('nothing answering at all is an error, not an empty list', async () => {
  clearPlacesCache();
  const down = async () => new Response('', { status: 500 });
  await assert.rejects(findNearby(here, 'fuel', { fetchImpl: down, tileUrl: TILE_URL, servers: ['https://o.test/a', 'https://o.test/b'] }));
  clearPlacesCache();
});

test('tiles that answer with nothing, and no backup: an honest empty list', async () => {
  clearPlacesCache();
  const fetchImpl = tileServer([]);
  const list = await findNearby(here, 'ev', { fetchImpl, tileUrl: TILE_URL, servers: ['https://o.test/a', 'https://o.test/b'] });
  assert.deepEqual(list, []);
  clearPlacesCache();
});

test('OpenStreetMap places are read with a name, a kind and a position', () => {
  const list = parseNearby({ elements: [
    { type: 'node', id: 1, lat: 3.1, lon: 101.6, tags: { amenity: 'fuel', brand: 'Petronas' } },
    { type: 'way', id: 2, center: { lat: 3.2, lon: 101.7 }, tags: { tourism: 'hotel', name: 'Hotel Seri' } },
    { type: 'node', id: 3, tags: {} },
  ] });
  assert.deepEqual(list.map((p) => [p.id, p.name, p.kind]), [['node/1', 'Petronas', 'fuel'], ['way/2', 'Hotel Seri', 'hotel']]);
});

test('what a place is, in both languages', () => {
  assert.equal(kindLabel('museum', 'ms'), 'Muzium');
  assert.equal(kindLabel('museum', 'en'), 'Museum');
  assert.equal(kindLabel(['place_of_worship', 'mosque'], 'ms'), 'Rumah ibadat');
  assert.equal(kindLabel('dentist', 'en'), 'Dentist', 'a word it doesn\'t know is tidied up');
  assert.equal(kindLabel('dentist', 'ms'), '', 'rather than an English word in Malay');
  assert.equal(kindLabel('', 'en'), '');
  assert.equal(kindLabel(undefined, 'ms'), '');
});
