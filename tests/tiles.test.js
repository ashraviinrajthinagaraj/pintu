import test from 'node:test';
import assert from 'node:assert/strict';
import { lngLatToTile, readPlaces, tileAddress, tileToLngLat, tilesAlongRoute } from '../js/tiles.js';
import { prepareTrip } from '../js/routing.js';
import { encodeTile } from './helpers/mvt.js';
import { P, buildTrip, cityTrip } from './helpers/fixtures.js';

test('tile numbers and positions on the Earth agree', () => {
  const [x, y] = lngLatToTile(101.7, 3.15);
  assert.ok(x > 0 && y > 0);
  const [lng, lat] = tileToLngLat(x, y);
  assert.ok(Math.abs(lng - 101.7) < 1e-9 && Math.abs(lat - 3.15) < 1e-9);
  // A well-known one: the middle of the map.
  assert.deepEqual(tileToLngLat(2 ** 13, 2 ** 13), [0, 0]);
});

test('reads the places out of a tile, and ignores the other layers', () => {
  const [fx, fy] = lngLatToTile(101.7055, 3.1502);
  const tile = { z: 14, x: Math.floor(fx), y: Math.floor(fy) };
  const bytes = encodeTile(tile, {
    transportation: [{ id: 5, lng: 101.7055, lat: 3.1502, props: { class: 'primary', name: 'Not a place' } }],
    poi: [
      { id: 7, lng: 101.7055, lat: 3.1502, props: { name: 'Petronas', class: 'fuel', subclass: 'fuel', rank: 4 } },
      { id: 2 ** 40, lng: 101.7056, lat: 3.1503, props: { 'name:latin': 'Masjid Jamek', class: 'place_of_worship', subclass: 'place_of_worship' } },
      { lng: 101.7057, lat: 3.1504, props: { class: 'fuel', subclass: 'fuel' } },
    ],
  });
  const places = readPlaces(bytes.buffer, tile);
  assert.equal(places.length, 3);
  assert.equal(places[0].name, 'Petronas');
  assert.equal(places[0].class, 'fuel');
  assert.ok(Math.abs(places[0].lng - 101.7055) < 0.0001 && Math.abs(places[0].lat - 3.1502) < 0.0001);
  assert.equal(places[1].name, 'Masjid Jamek');
  assert.equal(places[1].id, `t${2 ** 40}`);
  assert.equal(places[2].name, '');
  assert.notEqual(places[2].id, places[0].id);
});

test('an empty or layerless tile simply has no places', () => {
  assert.deepEqual(readPlaces(new ArrayBuffer(0), { z: 14, x: 1, y: 1 }), []);
  const bytes = encodeTile({ z: 14, x: 1, y: 1 }, { water: [] });
  assert.deepEqual(readPlaces(bytes, { z: 14, x: 1, y: 1 }), []);
});

test('finds the tiles a route runs through, the nearest first', () => {
  const r = prepareTrip(cityTrip());
  const tiles = tilesAlongRoute(r, 0, r.length, 1000);
  assert.ok(tiles.length >= 1 && tiles.length <= 20, String(tiles.length));
  const [sx, sy] = lngLatToTile(...P.a);
  assert.ok(tiles.slice(0, 4).some((t) => t.x === Math.floor(sx) && t.y === Math.floor(sy)), 'the start is near the front');
  const keys = tiles.map((t) => `${t.x}/${t.y}`);
  assert.equal(new Set(keys).size, keys.length, 'no tile twice');
  assert.equal(tileAddress('https://a.test/{z}/{x}/{y}.pbf', { z: 14, x: 3, y: 9 }), 'https://a.test/14/3/9.pbf');
});

test('a very long route asks for a limited number of tiles', () => {
  const r = prepareTrip(buildTrip([100.3, 5.4], [{ to: [103.0, 2.0], type: 1, street: 'Lebuhraya', kph: 100 }]));
  const tiles = tilesAlongRoute(r, 0, 200000, 1500);
  assert.equal(tiles.length, 200);
  const near = tilesAlongRoute(r, 0, 30000, 1000);
  assert.ok(near.length < 60, String(near.length));
});
