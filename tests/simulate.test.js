import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulatedDrive } from '../js/location.js';
import { prepareTrip } from '../js/routing.js';
import { haversine } from '../js/geo.js';
import { pointAt } from '../js/motion.js';
import { cityTrip } from './helpers/fixtures.js';

const route = () => prepareTrip(cityTrip());

function driver(options) {
  const fixes = [];
  const sim = new SimulatedDrive(route(), (f) => fixes.push(f), options);
  return { sim, fixes };
}

test('a faster drive covers more road and keeps its clock in step', () => {
  const slow = driver({ factor: 1 });
  const fast = driver({ factor: 30 });
  for (let i = 0; i < 8; i++) { slow.sim._tick(); fast.sim._tick(); }
  assert.ok(fast.sim.s > slow.sim.s * 20, `${fast.sim.s} vs ${slow.sim.s}`);
  assert.ok(fast.fixes.at(-1).time - fast.fixes[0].time > (slow.fixes.at(-1).time - slow.fixes[0].time) * 20);
  assert.equal(fast.fixes.at(-1).motionSpeed, fast.fixes.at(-1).speed * 30);
});

test('speed can change on the way', () => {
  const { sim } = driver({ factor: 1 });
  sim._tick();
  const a = sim.s;
  sim.setFactor(10);
  sim._tick();
  assert.ok(sim.s - a > a * 5, `${sim.s - a} after ${a}`);
});

test('pausing stops the car, and resuming carries on from there', () => {
  const { sim, fixes } = driver({ factor: 4 });
  sim._tick(); sim._tick(); sim._tick();
  const here = sim.s - 2;
  sim.pause(here);
  assert.equal(sim.s, here, 'stops where the car appeared to be, not where it was heading');
  assert.equal(fixes.at(-1).speed, 0);
  assert.equal(fixes.at(-1).motionSpeed, 0);
  const n = fixes.length;
  sim._tick(); sim._tick();
  assert.equal(fixes.length, n, 'nothing moves while paused');
  sim.resume();
  sim._tick(); sim._tick();
  assert.ok(sim.s > here);
  assert.ok(fixes.at(-1).speed > 0);
});

test('going anywhere along the route, forward or back', () => {
  const { sim, fixes } = driver({ factor: 4 });
  const r = sim.route;
  sim.seek(1500);
  assert.ok(haversine([fixes.at(-1).lng, fixes.at(-1).lat], pointAt(r, 1500)) < 1);
  sim.seek(200);
  assert.ok(haversine([fixes.at(-1).lng, fixes.at(-1).lat], pointAt(r, 200)) < 1);
  sim.seek(-50);
  assert.equal(sim.s, 0);
  sim.seek(r.length + 500);
  assert.equal(sim.s, r.length);
});

test('a finger on the line holds the car until it lets go', () => {
  const { sim, fixes } = driver({ factor: 4 });
  sim.held = true;
  sim.seek(500);
  assert.equal(fixes.at(-1).motionSpeed, 0);
  const n = fixes.length;
  sim._tick();
  assert.equal(fixes.length, n);
  assert.equal(sim.s, 500);
  sim.held = false;
  sim._tick();
  assert.ok(sim.s > 500);
});

test('a new route carries on from its beginning', () => {
  const { sim } = driver({ factor: 4 });
  sim._tick(); sim._tick();
  const other = route();
  sim.setRoute(other);
  assert.equal(sim.route, other);
  assert.equal(sim.s, 0);
});

test('stops at the end of the road', () => {
  const { sim } = driver({ factor: 30, intervalMs: 250 });
  sim.timer = setInterval(() => {}, 100000);
  for (let i = 0; i < 5000 && sim.timer; i++) sim._tick();
  assert.equal(sim.s, sim.route.length);
  assert.equal(sim.timer, null);
});
