import test from 'node:test';
import assert from 'node:assert/strict';
import { MALLS, fetchShops, mallFor, searchShops } from '../js/malls.js';
import { limitAt, parseSpeedLimits, prepareTrip } from '../js/routing.js';
import { describe, speech } from '../js/instructions.js';
import { Guidance, promptDistances } from '../js/guidance.js';
import { pointAt } from '../js/motion.js';
import { buildTrip, P } from './helpers/fixtures.js';

test('recognises a mall by name, and by being right there', () => {
  assert.equal(mallFor({ name: 'IOI City Mall', lng: 0, lat: 0 }).id, 'ioi-city');
  assert.equal(mallFor({ name: 'Uniqlo', detail: 'IOI City Mall, Putrajaya' }).id, 'ioi-city');
  assert.equal(mallFor({ name: 'Uniqlo', lng: 101.7150, lat: 2.9702 }).id, 'ioi-city');
  assert.equal(mallFor({ name: 'Suria KLCC', lng: 101.71, lat: 3.15 }), null);
  assert.equal(mallFor(null), null);
  for (const mall of MALLS) {
    assert.match(mall.map, /^https:/);
    assert.match(mall.directory, /^https:/);
  }
});

test('finds shops whichever way they\'re typed', () => {
  const shops = [{ name: 'UNIQLO', lot: 'G11-3' }, { name: "MCDONALD'S", lot: 'LG57-2' }, { name: 'BASKIN ROBBINS', lot: 'L1-74' }, { name: 'BASKIN ROBBINS', lot: 'L3-12' }];
  assert.deepEqual(searchShops(shops, 'uniq').map((s) => s.lot), ['G11-3']);
  assert.equal(searchShops(shops, 'robbins baskin').length, 2);
  assert.deepEqual(searchShops(shops, ''), []);
  assert.deepEqual(searchShops(shops, 'tiada'), []);
});

test('shops come through the server, and need it', async () => {
  const mall = MALLS[0];
  const out = await fetchShops(mall, { server: 'https://pintu.test', fetchImpl: async (u) => {
    assert.equal(u, 'https://pintu.test/mall?id=ioi-city');
    return new Response(JSON.stringify({ shops: [{ name: 'AEON', lot: '2AT1-2' }] }));
  } });
  assert.equal(out[0].name, 'AEON');
  await assert.rejects(fetchShops(mall, { server: null }));
  await assert.rejects(fetchShops(mall, { server: 'https://pintu.test', fetchImpl: async () => new Response('', { status: 502 }) }));
});

test('speed limits: only what is mapped, joined up where they agree', () => {
  const segs = parseSpeedLimits({ edges: [
    { length: 1, speed_limit: 60 },
    { length: 1, speed_limit: 60 },
    { length: 1 },
    { length: 1, speed_limit: 90 },
    { length: 1, speed_limit: 0 },
    { length: 1, speed_limit: 'unlimited' },
    { length: 1, speed_limit: 255 },
    { length: 0, speed_limit: 40 },
  ] }, 500);
  assert.deepEqual(segs, [{ from: 500, to: 2500, limit: 60 }, { from: 3500, to: 4500, limit: 90 }]);
  assert.equal(limitAt(segs, 500), 60);
  assert.equal(limitAt(segs, 2499), 60);
  assert.equal(limitAt(segs, 3000), null, 'unknown stays unknown');
  assert.equal(limitAt(segs, 4000), 90);
  assert.equal(limitAt(null, 10), null);
  assert.deepEqual(parseSpeedLimits({}), []);
});

test('says the walking instructions in both languages', () => {
  const lines = { 39: ['Guna lif', 'Take the lift'], 40: ['Guna tangga', 'Take the stairs'], 41: ['Guna eskalator', 'Take the escalator'], 42: ['Masuk ke bangunan', 'Enter the building'], 43: ['Keluar dari bangunan', 'Leave the building'] };
  for (const [type, [ms, en]] of Object.entries(lines)) {
    assert.equal(describe({ type: Number(type) }, 'ms').action, ms);
    assert.equal(describe({ type: Number(type) }, 'en').action, en);
  }
  assert.equal(speech({ kind: 'now', index: 0 }, [{ type: 39 }], 'ms'), 'Guna lif.');
});

const walkRoute = () => prepareTrip(buildTrip(P.a, [
  { to: [P.a[0] + 0.002, P.a[1]], type: 1, street: 'Laluan', kph: 5 },
  { to: [P.a[0] + 0.002, P.a[1] + 0.002], type: 10, street: 'Koridor', kph: 5 },
  { to: [P.a[0] + 0.002, P.a[1] + 0.003], type: 4, kph: 5 },
]));

test('on foot, instructions come close to the turn, not hundreds of metres out', () => {
  assert.deepEqual(promptDistances(1.4, true), { far: 60, now: 20 });
  assert.ok(promptDistances(1.4).far >= 300);
  const r = walkRoute();
  const g = new Guidance(r, { walking: true });
  const heard = [];
  for (let s = 0, t = 1000; s < r.maneuvers[1].beginDist + 2; s += 3, t += 2000) {
    const [lng, lat] = pointAt(r, s);
    for (const p of g.update({ lng, lat, accuracy: 15, speed: 1.4, time: t }).prompts) heard.push({ ...p, s });
  }
  const far = heard.find((p) => p.kind === 'far' && p.index === 1);
  assert.ok(far && far.distance <= 60, JSON.stringify(heard));
});

test('on foot, a wandering GPS among buildings isn\'t leaving the route', () => {
  const r = walkRoute();
  const walker = new Guidance(r, { walking: true });
  const driver = new Guidance(r);
  const off = { walker: false, driver: false };
  const at = (s, time) => {
    const [lng, lat] = pointAt(r, s);
    // About 60 metres to one side, for a good while.
    return { lng, lat: lat - 0.00054, accuracy: 30, speed: 1.2, time };
  };
  for (const g of [walker, driver]) {
    const [lng, lat] = pointAt(r, 5);
    g.update({ lng, lat, accuracy: 10, speed: 1.2, time: 1000 });
  }
  for (let i = 0; i < 12; i++) {
    const t = 2000 + i * 1000;
    if (walker.update(at(20, t)).offRoute) off.walker = true;
    if (driver.update(at(20, t)).offRoute) off.driver = true;
  }
  assert.equal(off.walker, false);
  assert.equal(off.driver, true, 'whereas a car that far off has left the road');
});

test('on foot, arriving means actually being there', () => {
  const r = walkRoute();
  const near = (g, s) => {
    const [lng, lat] = pointAt(r, s);
    return g.update({ lng, lat, accuracy: 10, speed: 1.2, time: 5000 + s }).arrived;
  };
  const walker = new Guidance(r, { walking: true });
  near(walker, r.length * 0.7);
  assert.equal(near(walker, r.length - 20), false);
  assert.equal(near(walker, r.length - 10), true);
  const driver = new Guidance(r);
  near(driver, r.length * 0.7);
  assert.equal(near(driver, r.length - 20), true);
});
