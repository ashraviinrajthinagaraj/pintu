// Traffic lights, speed bumps and railway crossings on your road.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTrip } from '../js/routing.js';
import { countLights, featureAhead, featuresOnRoute, parseFeatures, warnDistance } from '../js/road-features.js';
import { alongQuery, alongRoute, parseAlong } from '../js/along.js';
import { cityTrip, along, P } from './helpers/fixtures.js';

const node = (id, [lng, lat], tags) => ({ type: 'node', id, lat, lon: lng, tags });
const route = () => prepareTrip(cityTrip());

test('knows a light, a bump and a crossing, and ignores the rest', () => {
  const found = parseFeatures({ elements: [
    node(1, P.a, { highway: 'traffic_signals' }),
    node(2, P.a, { highway: 'traffic_signals', traffic_signals: 'emergency' }),
    node(3, P.a, { traffic_calming: 'hump' }),
    node(4, P.a, { traffic_calming: 'rumble_strip' }),
    node(5, P.a, { railway: 'level_crossing' }),
    node(6, P.a, { railway: 'crossing' }),
    { type: 'node', id: 7, tags: { highway: 'traffic_signals' } },
  ] });
  assert.deepEqual(found.map((f) => [f.id, f.kind]), [['node/1', 'light'], ['node/3', 'bump'], ['node/5', 'rail']]);
});

test('counts a junction\'s lights once, and only those on your road', () => {
  const r = route();
  const p = (f) => along(P.a, P.b, f);
  const placed = featuresOnRoute(r, [
    { id: 'a', kind: 'light', lng: p(0.3)[0], lat: p(0.3)[1] },
    { id: 'b', kind: 'light', lng: p(0.3)[0] + 0.0003, lat: p(0.3)[1] },     // the same junction, another approach
    { id: 'c', kind: 'light', lng: p(0.3)[0], lat: p(0.3)[1] + 0.001 },      // a side street, 110 m off
    { id: 'd', kind: 'bump', lng: p(0.6)[0], lat: p(0.6)[1] },
    { id: 'e', kind: 'light', lng: p(0.8)[0], lat: p(0.8)[1] },
  ]);
  assert.deepEqual(placed.map((f) => f.id), ['a', 'd', 'e']);
  assert.equal(countLights(placed), 2);
});

test('warns nearer for a bump than for a crossing, and further at speed', () => {
  assert.ok(warnDistance('bump', 10) < warnDistance('light', 10));
  assert.ok(warnDistance('light', 10) < warnDistance('rail', 10));
  assert.ok(warnDistance('light', 25) > warnDistance('light', 5));
  const placed = [
    { id: 1, kind: 'light', along: 300 },
    { id: 2, kind: 'rail', along: 700 },
  ];
  assert.equal(featureAhead(placed, 0, 10), null, '300 m away is too far ahead to mention in town');
  assert.equal(featureAhead(placed, 200, 10).feature.id, 1);
  assert.equal(featureAhead(placed, 320, 25).feature.id, 2, 'a crossing is said from further away');
  assert.equal(featureAhead(placed, 320, 25, { light: true, bump: true, rail: false }), null, 'switched off');
  assert.equal(featureAhead(placed, 800, 10), null, 'all behind you');
});

test('comes in the routes\' own request', () => {
  const r = route();
  assert.match(alongQuery([r]), /traffic_signals[\s\S]*traffic_calming[\s\S]*level_crossing/);
  assert.doesNotMatch(alongQuery([r], { features: false }), /traffic_signals/);
  const found = parseAlong({ elements: [node(1, along(P.a, P.b, 0.5), { highway: 'traffic_signals' })] });
  assert.equal(found.features.length, 1);
  assert.equal(alongRoute(r, found).features.length, 1);
});
