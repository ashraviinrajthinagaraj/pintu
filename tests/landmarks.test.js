import test from 'node:test';
import assert from 'node:assert/strict';
import { LANDMARK_MODELS, buildLandmark } from '../js/landmark-mesh.js';
import { LANDMARKS, RISE_FROM, RISE_TO, inView, modelMatrix, riseAt } from '../js/landmarks.js';

// Each vertex: position, normal, colour, glow, shine.
const vertices = (data) => Array.from({ length: data.length / 11 }, (_, i) => {
  const v = data.subarray(i * 11, i * 11 + 11);
  return { p: [v[0], v[1], v[2]], n: [v[3], v[4], v[5]], c: [v[6], v[7], v[8]], glow: v[9], shine: v[10] };
});

test('every statue builds into whole triangles, all of them facing somewhere', () => {
  for (const kind of Object.keys(LANDMARK_MODELS)) {
    const { data } = buildLandmark(kind);
    assert.equal(data.length % 33, 0, `${kind}: whole triangles`);
    assert.ok(data.length / 33 > 1000 && data.length / 33 < 12000, `${kind}: ${data.length / 33} triangles, enough for the shape and few enough for a phone`);
    for (const v of vertices(data)) {
      assert.ok(v.p.every(Number.isFinite));
      assert.ok(Math.abs(Math.hypot(...v.n) - 1) < 1e-3, `${kind}: a normal of length 1`);
    }
  }
  assert.equal(buildLandmark('nothing'), null);
});

test('the Statue of Liberty: the torch held high on her right, the tablet on her left, the right size', () => {
  const { data, top } = buildLandmark('liberty');
  const vs = vertices(data);
  // 46.05 m from her feet to the tip of the torch.
  assert.ok(Math.abs(top - 46.05) < 0.1, `torch tip at ${top}`);
  const highest = vs.reduce((a, v) => (v.p[2] > a.p[2] ? v : a));
  assert.ok(highest.p[0] > 4, 'the torch is up on her right');
  assert.ok(highest.glow > 0.3 && highest.c[0] > highest.c[2] * 3, 'and its flame is lit gold');
  // The head: 33.9 m to the top of it, with the crown's rays above that.
  const head = vs.filter((v) => Math.abs(v.p[0]) < 1.6 && Math.abs(v.p[1]) < 2 && v.p[2] > 28.5 && v.p[2] < 34.5);
  assert.ok(head.length > 100);
  assert.ok(vs.some((v) => v.p[2] > 34.5 && v.p[2] < 37 && Math.abs(v.p[0]) < 4), 'the rays of the crown');
  // The tablet, out on her left between hip and shoulder.
  assert.ok(vs.some((v) => v.p[0] < -6 && v.p[2] > 20 && v.p[2] < 27), 'the tablet');
  // The robe stands within the pedestal's top, about 16 m across.
  for (const v of vs.filter((w) => w.p[2] < 15)) assert.ok(Math.abs(v.p[0]) < 8 && Math.abs(v.p[1]) < 8);
  // She faces forward: her nose is in front of her.
  const face = vs.filter((v) => v.p[2] > 30 && v.p[2] < 32 && Math.abs(v.p[0]) < 0.4);
  assert.ok(Math.max(...face.map((v) => v.p[1])) > 1.8);
});

test('Lord Murugan: gold, 42.7 m, on a base, the vel upright in his right hand', () => {
  const { data, top } = buildLandmark('murugan');
  const vs = vertices(data);
  assert.ok(Math.abs(top - 42.7) < 0.1, `top at ${top}`);
  const figure = vs.filter((v) => v.p[2] > 3);
  const gold = figure.filter((v) => v.c[0] > v.c[2] * 4 && v.c[0] > 0.4);
  assert.ok(gold.length > figure.length * 0.9, 'gold all over');
  // The base is stone, under his feet.
  assert.ok(vs.filter((v) => v.p[2] < 2).every((v) => v.c[2] > 0.5));
  // The vel: a shaft from the base, its blade up beside his crown, on his right.
  const blade = vs.filter((v) => v.p[2] > 38 && v.p[0] > 4.5);
  assert.ok(blade.length > 50);
  assert.ok(vs.some((v) => v.p[0] > 6 && v.p[2] > 2 && v.p[2] < 3), 'the shaft stands on the base');
});

test('the statues rise with the buildings as you zoom in', () => {
  assert.equal(riseAt(RISE_FROM - 0.5), 0);
  assert.equal(riseAt(RISE_FROM), 0);
  assert.equal(riseAt((RISE_FROM + RISE_TO) / 2), 0.5);
  assert.equal(riseAt(RISE_TO), 1);
  assert.equal(riseAt(19), 1);
});

test('drawn only when on the map or just off its edge', () => {
  const liberty = LANDMARKS.find((l) => l.id === 'liberty');
  assert.equal(inView(liberty, [-74.05, 40.68, -74.04, 40.69]), true);
  assert.equal(inView(liberty, [-74.0444, 40.68, -74.03, 40.69]), true, 'just past the west edge');
  assert.equal(inView(liberty, [101.6, 3.1, 101.8, 3.3]), false);
});

test('placed where it stands, facing the way it faces, on top of its base', () => {
  const at = { x: 0.3, y: 0.4 };
  const metre = 1e-7;
  for (const lm of LANDMARKS) {
    const m = modelMatrix(at, metre, lm.facing, lm.base, 1);
    // A metre in front of the figure, in the map's units: Mercator's y runs south.
    const dx = m[4], dy = m[5];
    const bearing = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    assert.ok(Math.abs(bearing - lm.facing) < 1e-3, `${lm.id}: faces ${bearing}`);
    assert.ok(Math.abs(Math.hypot(dx, dy) - metre) < 1e-12, 'life size');
    // Its feet: on the spot, at the height of the base.
    assert.ok(Math.abs(m[12] - at.x) < 1e-7 && Math.abs(m[13] - at.y) < 1e-7);
    assert.ok(Math.abs(m[14] - lm.base * metre) < 1e-12);
    // Half risen, half as tall and its base half as high, as with the buildings.
    const half = modelMatrix(at, metre, lm.facing, lm.base, 0.5);
    assert.ok(Math.abs(half[10] - metre / 2) < 1e-12);
    assert.ok(Math.abs(half[14] - (lm.base * metre) / 2) < 1e-12);
  }
});

test('each landmark has its model, its place and a way it faces', () => {
  const ids = new Set();
  for (const lm of LANDMARKS) {
    assert.ok(!ids.has(lm.id));
    ids.add(lm.id);
    assert.ok(LANDMARK_MODELS[lm.model], lm.id);
    assert.ok(lm.facing >= 0 && lm.facing < 360);
    assert.ok(Math.abs(lm.at[0]) <= 180 && Math.abs(lm.at[1]) <= 85);
  }
  // On the pedestal's top, which the map's data puts at 47 m.
  assert.equal(LANDMARKS.find((l) => l.id === 'liberty').base, 47);
});
