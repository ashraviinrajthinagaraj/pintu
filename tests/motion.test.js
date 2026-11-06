import test from 'node:test';
import assert from 'node:assert/strict';
import { Motion, pointAt, turnToward } from '../js/motion.js';
import { prepareTrip } from '../js/routing.js';
import { angleDiff, haversine } from '../js/geo.js';
import { P, cityTrip } from './helpers/fixtures.js';

const route = () => prepareTrip(cityTrip());

// One GPS fix a second, sixty frames a second.
function run(m, r, { seconds, v, startS = 0, t0 = 1e6, onFrame }) {
  let now = t0;
  for (let sec = 0; sec < seconds; sec++) {
    m.onRoute(startS + v * sec, v, now);
    for (let f = 0; f < 60; f++) {
      now += 1000 / 60;
      onFrame?.(m.frame(now), now);
    }
  }
  return now;
}

test('turning takes the short way round', () => {
  assert.ok(Math.abs(turnToward(350, 10, 0.5) - 0) < 1e-9);
  assert.ok(Math.abs(turnToward(10, 350, 0.5) - 0) < 1e-9);
  assert.equal(turnToward(90, 90, 0.5), 90);
});

test('finds points along the route', () => {
  const r = route();
  assert.deepEqual(pointAt(r, 0), P.a);
  const end = pointAt(r, r.length);
  assert.ok(haversine(end, P.d) < 1);
  assert.ok(haversine(pointAt(r, 500), P.a) > 490 && haversine(pointAt(r, 500), P.a) < 510);
});

test('the arrow glides: every frame moves about the same small amount', () => {
  const r = route();
  const m = new Motion();
  m.setRoute(r);
  const v = 14;
  const steps = [];
  let last = null;
  run(m, r, { seconds: 20, v, onFrame: (pose) => {
    if (last != null) steps.push(pose.s - last);
    last = pose.s;
  } });
  const settled = steps.slice(120);
  const expected = v / 60;
  for (const step of settled) {
    assert.ok(step >= 0, 'never backwards');
    assert.ok(step < expected * 2, `no hops: ${step} vs ${expected}`);
  }
  const worst = Math.max(...settled) - Math.min(...settled);
  assert.ok(worst < expected, `steady pace: varied by ${worst}`);
});

test('stays close to where GPS says you are', () => {
  const r = route();
  const m = new Motion();
  m.setRoute(r);
  const v = 14;
  let t0 = 1e6;
  const gaps = [];
  for (let sec = 0; sec < 30; sec++) {
    const s = v * sec;
    m.onRoute(s, v, t0);
    for (let f = 0; f < 60; f++) {
      t0 += 1000 / 60;
      const pose = m.frame(t0);
      gaps.push(Math.abs(pose.s - (s + (v * (f + 1)) / 60)));
    }
  }
  assert.ok(Math.max(...gaps.slice(180)) < v * 0.4, `lag ${Math.max(...gaps.slice(180))} m`);
});

test('stops when you stop, and does not creep back on GPS wobble', () => {
  const r = route();
  const m = new Motion();
  m.setRoute(r);
  let now = run(m, r, { seconds: 10, v: 10 });
  const s0 = m.frame(now).s;
  for (let k = 0; k < 8; k++) {
    m.onRoute(s0 - 6, 0, now);
    for (let f = 0; f < 60; f++) { now += 1000 / 60; m.frame(now); }
  }
  const after = m.frame(now).s;
  assert.ok(after >= s0 - 0.01, `moved back ${s0 - after}`);
  assert.ok(after <= s0 + 15, `kept going to ${after}`);
});

test('losing GPS: glides briefly, then waits instead of driving on', () => {
  const r = route();
  const m = new Motion();
  m.setRoute(r);
  let now = run(m, r, { seconds: 5, v: 15 });
  const at = (ms) => { let p; for (let t = 0; t < ms; t += 1000 / 60) { now += 1000 / 60; p = m.frame(now); } return p.s; };
  const a = at(4000);
  const b = at(4000);
  assert.ok(Math.abs(b - a) < 0.5, `still moving: ${b - a}`);
});

test('a big correction jumps straight there', () => {
  const r = route();
  const m = new Motion();
  m.setRoute(r);
  let now = run(m, r, { seconds: 3, v: 10 });
  m.onRoute(1500, 10, now);
  now += 16;
  assert.ok(m.frame(now).s > 1490);
});

test('corners turn gradually with no sudden swing', () => {
  const r = route();
  const m = new Motion();
  m.setRoute(r);
  const turnAt = r.maneuvers[1].beginDist;
  let last = null, worst = 0;
  run(m, r, { seconds: 40, v: 11, startS: turnAt - 200, onFrame: (pose) => {
    if (last != null && pose.heading != null) worst = Math.max(worst, angleDiff(pose.heading, last));
    if (pose.heading != null) last = pose.heading;
  } });
  assert.ok(worst < 6, `largest change in one frame: ${worst} degrees`);
  assert.ok(Math.abs(last - 0) < 15 || Math.abs(last - 90) < 15);
});

test('off the route it eases toward each fix', () => {
  const m = new Motion();
  m.offRoute(101.7, 3.15, 90, 10, 1e6);
  let now = 1e6;
  now += 16;
  const a = m.frame(now);
  assert.ok(Math.abs(a.lng - 101.7) < 1e-3);
  m.offRoute(101.7005, 3.15, 90, 10, now + 1000);
  let prev = a.lng, biggest = 0;
  for (let f = 0; f < 90; f++) {
    now += 1000 / 60;
    const p = m.frame(now);
    biggest = Math.max(biggest, Math.abs(p.lng - prev));
    prev = p.lng;
  }
  assert.ok(prev > 101.7003, String(prev));
  assert.ok(biggest < 0.00005, `largest step ${biggest}`);
});

test('a deliberate jump lands at once, facing along the new road', () => {
  const r = route();
  const m = new Motion();
  m.setRoute(r);
  const end = run(m, r, { seconds: 3, v: 10 });
  m.jump(1500, end);
  const pose = m.frame(end + 16);
  assert.ok(Math.abs(pose.s - 1500) < 1, String(pose.s));
  const road = pointAt(r, 1500);
  assert.ok(haversine([pose.lng, pose.lat], road) < 2);
  const on = pointAt(r, 1520);
  const want = (Math.atan2(on[0] - road[0], on[1] - road[1]) * 180) / Math.PI;
  assert.ok(angleDiff(pose.heading, (want + 360) % 360) < 3);
  // And backwards just the same, with no gliding through everything between.
  m.jump(100, end + 32);
  assert.ok(Math.abs(m.frame(end + 48).s - 100) < 1);
});
