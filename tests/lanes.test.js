import test from 'node:test';
import assert from 'node:assert/strict';
import { LANE_WIDTH, LaneScene, cruiseLane, laneOffset, laneTarget } from '../js/lanes.js';
import { fetchLaneCounts, parseLaneCounts, prepareTrip, resetRouting } from '../js/routing.js';
import { decodePolyline } from '../js/geo.js';
import { P, buildTrip, cityTrip } from './helpers/fixtures.js';

const lanes = [{ directions: 2 }, { directions: 2 }, { directions: 64, active: 64 }];
const withLanes = () => prepareTrip(buildTrip(P.a, [
  { to: P.b, type: 1, street: 'Jalan Ampang', kph: 40 },
  { to: P.c, type: 10, street: 'Jalan Tun Razak', kph: 50, lanes },
  { to: P.d, type: 15, street: 'Jalan Pinang', kph: 40 },
]));
const kinds = (fc) => fc.features.reduce((m, f) => { m[f.properties.k] = (m[f.properties.k] || 0) + 1; return m; }, {});

test('lane positions sit either side of the road centre', () => {
  assert.equal(laneOffset(0, 1), 0);
  assert.equal(laneOffset(0, 2), -LANE_WIDTH / 2);
  assert.equal(laneOffset(1, 2), LANE_WIDTH / 2);
  assert.equal(laneOffset(1, 3), 0);
  assert.equal(laneOffset(2, 3), LANE_WIDTH);
});

test('with no reason to move, keeps left of centre', () => {
  assert.equal(cruiseLane(1), 0);
  assert.equal(cruiseLane(2), 0);
  assert.equal(cruiseLane(3), 1);
  assert.equal(cruiseLane(4), 1);
});

test('mapped lane arrows decide the lane', () => {
  const t = laneTarget({ type: 10, lanes }, 3, null);
  assert.equal(t.source, 'data');
  assert.equal(t.index, 2);
  assert.equal(t.count, 3);
});

test('the nearest usable lane is chosen', () => {
  const m = { type: 10, lanes: [{ directions: 64, active: 64 }, { directions: 2 }, { directions: 2 }, { directions: 64, active: 64 }] };
  assert.equal(laneTarget(m, 4, 0).index, 0);
  assert.equal(laneTarget(m, 4, 3).index, 3);
});

test('without lane arrows, turns use the matching side', () => {
  assert.deepEqual([laneTarget({ type: 10 }, 3, null).index, laneTarget({ type: 10 }, 3, null).source], [2, 'estimate']);
  assert.equal(laneTarget({ type: 15 }, 3, null).index, 0);
  assert.equal(laneTarget({ type: 20 }, 2, null).index, 1);
  assert.equal(laneTarget({ type: 21 }, 2, null).index, 0);
  assert.equal(laneTarget({ type: 8 }, 3, null), null, 'straight on has no reason to move');
  assert.equal(laneTarget({ type: 10 }, 1, null), null, 'one lane has no choice');
});

test('lane counts read from the road data, merged into stretches', () => {
  const segs = parseLaneCounts({ edges: [
    { length: 0.2, lane_count: 3 }, { length: 0.1, lane_count: 3 }, { length: 0.3, lane_count: 2 }, { length: 0, lane_count: 5 }, { length: 0.1 },
  ] }, 100);
  assert.deepEqual(segs, [{ from: 100, to: 400, count: 3 }, { from: 400, to: 700, count: 2 }, { from: 700, to: 800, count: 1 }]);
  assert.deepEqual(parseLaneCounts({}), []);
  assert.equal(parseLaneCounts({ edges: [{ length: 1, lane_count: 40 }] })[0].count, 8);
});

test('asks for lane counts along the exact stretch, with fallback', async () => {
  resetRouting();
  const r = prepareTrip(cityTrip());
  const urls = [];
  const fetchImpl = async (u, init) => {
    urls.push({ u, init });
    if (u.startsWith('https://a.test')) return new Response('{}', { status: 401 });
    return new Response(JSON.stringify({ edges: [{ length: 0.5, lane_count: 3 }] }));
  };
  const providers = [
    { name: 'a', traceUrl: 'https://a.test/t', method: 'POST' },
    { name: 'b', traceUrl: 'https://b.test/t', method: 'GET' },
  ];
  const segs = await fetchLaneCounts(r, 500, 1500, { fetchImpl, providers });
  assert.equal(segs[0].count, 3);
  assert.ok(segs[0].from >= 500 && segs[0].from < 560, String(segs[0].from));
  const body = JSON.parse(decodeURIComponent(urls[1].u.split('json=')[1]));
  assert.equal(body.shape_match, 'edge_walk');
  assert.deepEqual(body.filters.attributes, ['edge.lane_count', 'edge.length', 'edge.speed_limit']);
  const line = decodePolyline(body.encoded_polyline);
  assert.ok(line.length >= 2);
  assert.ok(Math.abs(line[0][0] - 101.7045) < 0.002, String(line[0][0]));
  await assert.rejects(fetchLaneCounts(r, 0, 500, { fetchImpl: async () => { throw new TypeError('x'); }, providers: [providers[1]] }));
});

test('no lane information means no scene', () => {
  const s = new LaneScene(prepareTrip(cityTrip()));
  assert.equal(s.wantsToShow(100), false);
  assert.equal(s.update(100, 10), false);
  assert.equal(s.active, false);
});

test('a mapped junction shows lanes on approach only', () => {
  const r = withLanes();
  const s = new LaneScene(r);
  const turn = r.maneuvers[1].beginDist;
  assert.equal(s.countAt(turn - 600), 1);
  assert.equal(s.countAt(turn - 100), 3);
  assert.equal(s.countAt(turn + 100), 1);
  assert.equal(s.wantsToShow(turn - 600), false);
  assert.equal(s.wantsToShow(turn - 200), true);
  assert.equal(s.wantsToShow(turn + 100), false);
});

test('road lane counts show lanes anywhere they are known', () => {
  const r = prepareTrip(cityTrip());
  const s = new LaneScene(r, [{ from: 0, to: 700, count: 2 }]);
  assert.equal(s.wantsToShow(100), true);
  assert.equal(s.wantsToShow(680), false, 'about to run out');
  assert.equal(s.wantsToShow(800), false);
});

test('draws road, dividers, arrows, stop line and carpet, all valid geometry', () => {
  const r = withLanes();
  const s = new LaneScene(r);
  const turn = r.maneuvers[1].beginDist;
  assert.equal(s.update(turn - 150, 12), true);
  const k = kinds(s.features);
  assert.ok(k.road > 20, JSON.stringify(k));
  assert.ok(k.carpet > 20);
  assert.ok(k.chevron > 3);
  assert.equal(k.edge, 2, 'two road edges');
  assert.equal(k.divider, 2, 'three lanes have two dividers');
  assert.ok(k.arrow >= 2, 'the right lane is painted');
  assert.ok(k['arrow-dim'] >= 4, 'other lanes are painted too');
  assert.ok(k.paint >= 1, 'stop line');
  assert.ok(k['tint-best'] > 3);
  for (const f of s.features.features) {
    const pts = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates;
    for (const [lng, lat] of pts) {
      assert.ok(Number.isFinite(lng) && Number.isFinite(lat), f.properties.k);
      assert.ok(lng > 101.6 && lng < 101.8 && lat > 3.1 && lat < 3.2, `${lng},${lat}`);
    }
    if (f.geometry.type === 'Polygon') {
      const ring = f.geometry.coordinates[0];
      assert.deepEqual(ring[0], ring.at(-1), 'closed ring');
      assert.ok(ring.length >= 4);
    }
  }
  assert.ok(s.trimS > turn - 150);
});

test('the car moves smoothly into the wanted lane before the turn', () => {
  const r = withLanes();
  const s = new LaneScene(r, [{ from: 0, to: 3000, count: 3 }]);
  const turn = r.maneuvers[1].beginDist;
  s.update(300, 12);
  const start = s.lateralAt(300);
  assert.equal(start, laneOffset(1, 3), 'cruising in the middle');
  const wanted = laneOffset(2, 3);
  assert.ok(Math.abs(s.lateralAt(turn - 10) - wanted) < 0.01, `at the line: ${s.lateralAt(turn - 10)}`);
  let last = s.lateralAt(300), worst = 0;
  for (let at = 300; at < turn; at += 1) {
    const d = s.lateralAt(at);
    worst = Math.max(worst, Math.abs(d - last));
    last = d;
  }
  assert.ok(worst < 0.2, `largest sideways step per metre: ${worst}`);
  assert.ok(Math.abs(s.yawAt(turn - 80)) > 0 || Math.abs(s.yawAt(turn - 40)) > 0);
});

test('re-planning while moving never makes the car jump sideways', () => {
  const r = withLanes();
  const s = new LaneScene(r, [{ from: 0, to: 3000, count: 3 }]);
  const turn = r.maneuvers[1].beginDist;
  let last = null;
  for (let at = 200; at < turn + 200; at += 7) {
    s.update(at, 12);
    const d = s.lateralAt(at);
    if (last != null) assert.ok(Math.abs(d - last) < 1.3, `at ${at}: ${last} to ${d}`);
    last = d;
  }
});

test('stops drawing when the lanes end, and asks for a redraw once', () => {
  const r = prepareTrip(cityTrip());
  const s = new LaneScene(r, [{ from: 0, to: 600, count: 2 }]);
  assert.equal(s.update(100, 10), true);
  assert.equal(s.update(104, 10), false, 'small moves reuse the drawing');
  assert.equal(s.update(140, 10), true, 'further on, redraw');
  assert.equal(s.update(590, 10), true);
  assert.equal(s.active, false);
  assert.equal(s.features.features.length, 0);
  assert.equal(s.update(595, 10), false);
});

test('a lane count change breaks the dividers and keeps the car on the road', () => {
  const r = prepareTrip(cityTrip());
  const s = new LaneScene(r, [{ from: 0, to: 400, count: 3 }, { from: 400, to: 1000, count: 2 }]);
  s.update(300, 10);
  const k = kinds(s.features);
  assert.equal(k.divider, 3, 'two then one');
  assert.equal(k.edge, 4);
});
