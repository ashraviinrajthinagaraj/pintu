import test from 'node:test';
import assert from 'node:assert/strict';
import { angleDiff, bearing, cumulative, decodePolyline, haversine, projectOnSegment, sliceFrom } from '../js/geo.js';
import { encodePolyline } from './helpers/fixtures.js';

test('decodes the published polyline example', () => {
  const c = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
  assert.deepEqual(c, [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
});

test('decodes precision 6 lines back to what went in', () => {
  const pts = [[101.711612, 3.157964], [101.7, 3.1], [101.937812, 2.725834]];
  assert.deepEqual(decodePolyline(encodePolyline(pts)), pts);
});

test('distance from KLCC to Seremban is about right', () => {
  const d = haversine([101.7116, 3.1579], [101.9378, 2.7258]);
  assert.ok(d > 53000 && d < 55000, String(d));
});

test('compass directions', () => {
  assert.ok(Math.abs(bearing([101, 3], [101, 4]) - 0) < 0.01);
  assert.ok(Math.abs(bearing([101, 3], [102, 3]) - 90) < 0.1);
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(10, 190), 180);
});

test('projection lands on the segment and clamps at its ends', () => {
  const a = [101.7, 3.15], b = [101.71, 3.15];
  const mid = projectOnSegment([101.705, 3.1505], a, b);
  assert.ok(Math.abs(mid.t - 0.5) < 0.001);
  assert.ok(mid.dist > 50 && mid.dist < 60);
  assert.equal(projectOnSegment([101.69, 3.15], a, b).t, 0);
  assert.equal(projectOnSegment([101.72, 3.15], a, b).t, 1);
});

test('the line ahead starts where you are', () => {
  const c = [[101.7, 3.15], [101.71, 3.15], [101.72, 3.15]];
  const cum = cumulative(c);
  const rest = sliceFrom(c, cum, cum[1] / 2);
  assert.equal(rest.length, 3);
  assert.ok(Math.abs(rest[0][0] - 101.705) < 1e-9);
  assert.equal(sliceFrom(c, cum, cum[2] + 5).length, 1);
});
