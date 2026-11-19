import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIN_M, warnBefore, zoneAhead, zonesOnRoute } from '../js/wildlife.js';
import { cumulative } from '../js/geo.js';

const data = JSON.parse(readFileSync(new URL('../data/wildlife.json', import.meta.url)));
const zone = (id) => data.zones.find((z) => z.id === id);
const route = (coords) => ({ coords, cum: cumulative(coords) });

test('the roads kept: in Malaysia, each with its animal, a source and a line along the road', () => {
  assert.ok(data.zones.length >= 4);
  assert.match(data.source, /OpenStreetMap/);
  for (const z of data.zones) {
    assert.equal(z.animal, 'elephant');
    assert.ok(z.source.length && z.source.every((u) => u.startsWith('https://')), z.id);
    assert.ok(z.line.length > 50, z.id);
    for (const [lng, lat] of z.line) assert.ok(lng > 99 && lng < 120 && lat > 0.8 && lat < 7.5, z.id);
  }
  assert.ok(zone('gerik-jeli').km > 100 && zone('gerik-jeli').km < 140);
});

test('a route along Gerik–Jeli is on it from end to end; one that only crosses it is not', () => {
  const g = zone('gerik-jeli');
  // From 5 km west of Gerik, then the whole road.
  const r = route([[g.line[0][0] - 0.045, g.line[0][1]], ...g.line]);
  const on = zonesOnRoute(r, data.zones);
  assert.equal(on.length, 1);
  assert.equal(on[0].id, 'gerik-jeli');
  assert.equal(on[0].name, 'Gerik–Jeli');
  assert.ok(Math.abs(on[0].fromS - 5000) < 400, `starts ${on[0].fromS}`);
  assert.ok(Math.abs(on[0].toS - r.cum.at(-1)) < 100);
  // Across the road at right angles, at its middle: not along it.
  const [x, y] = g.line[200];
  assert.deepEqual(zonesOnRoute(route([[x, y - 0.02], [x, y + 0.02]]), data.zones), []);
  // Nowhere near any: KL.
  assert.deepEqual(zonesOnRoute(route([[101.70, 3.15], [101.72, 3.16]]), data.zones), []);
  assert.ok(MIN_M >= 500);
});

test('where two roads meet, one stretch', () => {
  // Kluang to Mersing, then on south towards Kota Tinggi: both roads meet in Mersing.
  const a = zone('kluang-mersing').line, b = zone('kota-tinggi-mersing').line;
  const on = zonesOnRoute(route([...a, ...[...b].reverse()]), data.zones);
  assert.equal(on.length, 1, JSON.stringify(on.map((z) => [z.id, Math.round(z.fromS), Math.round(z.toS)])));
});

test('said a minute and a half ahead, at least 2 km; shown while in it', () => {
  const stretches = [{ id: 'z', fromS: 10000, toS: 50000 }];
  assert.equal(warnBefore(10), 2000);
  assert.equal(warnBefore(30), 2700);
  assert.equal(zoneAhead(stretches, 7000, 25), null);
  assert.deepEqual(zoneAhead(stretches, 8000, 25), { zone: stretches[0], ahead: 2000, left: 40000 });
  assert.deepEqual(zoneAhead(stretches, 30000, 25), { zone: stretches[0], ahead: 0, left: 20000 });
  assert.equal(zoneAhead(stretches, 50001, 25), null, 'behind you');
});
