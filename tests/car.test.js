import test from 'node:test';
import assert from 'node:assert/strict';
import { BODIES, FLOATS_PER_VERTEX, buildVehicle, hexToRgb } from '../js/car-mesh.js';
import { headingMatrix, multiply } from '../js/car-gl.js';

const read = (data) => {
  const out = [];
  for (let i = 0; i < data.length; i += FLOATS_PER_VERTEX) {
    out.push({ p: [data[i], data[i + 1], data[i + 2]], n: [data[i + 3], data[i + 4], data[i + 5]], c: [data[i + 6], data[i + 7], data[i + 8]], glow: data[i + 9], gloss: data[i + 10] });
  }
  return out;
};

for (const body of BODIES) {
  test(`${body}: sound geometry of a sensible size`, () => {
    const { data, length, width } = buildVehicle(body, '#C8202B');
    assert.equal(data.length % (FLOATS_PER_VERTEX * 3), 0, 'whole triangles');
    assert.ok(data.length / FLOATS_PER_VERTEX < 20000, `${data.length / FLOATS_PER_VERTEX} vertices`);
    const verts = read(data);
    let minY = 9, maxY = -9, minZ = 9, maxZ = -9, maxX = 0;
    for (const v of verts) {
      for (const x of [...v.p, ...v.n, ...v.c]) assert.ok(Number.isFinite(x));
      assert.ok(Math.abs(Math.hypot(...v.n) - 1) < 0.01, 'unit normal');
      minY = Math.min(minY, v.p[1]); maxY = Math.max(maxY, v.p[1]);
      minZ = Math.min(minZ, v.p[2]); maxZ = Math.max(maxZ, v.p[2]);
      maxX = Math.max(maxX, Math.abs(v.p[0]));
    }
    assert.ok(minY >= -0.1 && Math.abs(maxY - length) < 0.25, `length ${minY}..${maxY} of ${length}`);
    assert.ok(minZ >= -0.02 && minZ < 0.1, `sits on the ground: ${minZ}`);
    assert.ok(maxZ > 1 && maxZ < 2.1, `height ${maxZ}`);
    assert.ok(maxX <= width / 2 + 0.25, `width ${maxX} of ${width}`);
  });

  test(`${body}: shows the chosen colour, with lamps and windows`, () => {
    const verts = read(buildVehicle(body, '#C8202B').data);
    const paint = hexToRgb('#C8202B');
    const close = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 0.001);
    assert.ok(verts.filter((v) => close(v.c, paint)).length > 20, 'painted');
    assert.ok(verts.some((v) => v.glow > 0.5), 'lamps');
    assert.ok(verts.some((v) => Math.abs(v.gloss - 0.55) < 0.001), 'glass');
    const other = read(buildVehicle(body, '#1C4FA8').data);
    assert.ok(other.filter((v) => close(v.c, hexToRgb('#1C4FA8'))).length > 20);
  });
}

test('normals point outward on a car', () => {
  const { data, length } = buildVehicle('sedan', '#FFFFFF');
  const verts = read(data);
  const mid = [0, length / 2, 0.75];
  let out = 0, total = 0;
  for (const v of verts) {
    const d = [v.p[0] - mid[0], v.p[1] - mid[1], v.p[2] - mid[2]];
    if (d[0] * v.n[0] + d[1] * v.n[1] + d[2] * v.n[2] > 0) out++;
    total++;
  }
  assert.ok(out / total > 0.9, `${out} of ${total}`);
});

test('body shapes really differ', () => {
  const height = (body) => Math.max(...read(buildVehicle(body, '#FFFFFF').data).map((v) => v.p[2]));
  assert.ok(height('suv') > height('sedan') + 0.15);
  assert.ok(buildVehicle('pickup', '#FFFFFF').length > buildVehicle('hatchback', '#FFFFFF').length + 1);
});

test('unknown shapes fall back to a hatchback', () => {
  assert.equal(buildVehicle('spaceship', '#FFFFFF').length, buildVehicle('hatchback', '#FFFFFF').length);
});

test('colours convert from web hex', () => {
  const [r, g, b] = hexToRgb('#FF0080');
  assert.equal(r, 1);
  assert.equal(g, 0);
  assert.ok(b > 0.2 && b < 0.3);
});

test('matrix helpers', () => {
  const id = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const t = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1]);
  assert.deepEqual([...multiply(id, t)], [...t]);
  const east = headingMatrix(90);
  // Facing east, the car's front (local y) points east, and its right points south.
  assert.ok(Math.abs(east[3] - 1) < 1e-6 && Math.abs(east[4]) < 1e-6);
  assert.ok(Math.abs(east[0]) < 1e-6 && Math.abs(east[1] + 1) < 1e-6);
});
