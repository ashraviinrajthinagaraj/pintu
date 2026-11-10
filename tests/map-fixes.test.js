// Drivers' fixes to the map, and traffic lights learned from stops.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTrip } from '../js/routing.js';
import { cityTrip } from './helpers/fixtures.js';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { marksBox, markCameras, markFeatures, withMarks } = await import('../js/marks.js');
const { DAYS_TO_ASK, StopWatch, lightsToAsk, rememberStop, settleSpot } = await import('../js/stop-learn.js');

test('asks about the area around the routes, unless it\'s too big', () => {
  const box = marksBox([prepareTrip(cityTrip())]).split(',').map(Number);
  const [w, s, e, n] = box;
  assert.ok(w < 101.7 && e > 101.7 && s < 3.15 && n > 3.15);
  const far = { coords: [[100, 1], [110, 6]] };
  assert.equal(marksBox([far]), null);
  assert.equal(marksBox([]), null);
});

test('drivers\' fixes: a missing light put in, a gone camera taken out, a mistaken fix undone', () => {
  const features = [
    { id: 'node/1', kind: 'light', lng: 101.7, lat: 3.15 },
    { id: 'node/2', kind: 'bump', lng: 101.71, lat: 3.15 },
    { id: 'node/3', kind: 'rail', lng: 101.72, lat: 3.15 },
  ];
  const marks = [
    { id: 9, kind: 'light', action: 'add', lng: 101.705, lat: 3.151 },
    { id: 10, kind: 'bump', action: 'gone', lng: 101.71001, lat: 3.15001, ref: null },
    { id: 11, kind: 'light', action: 'add', lng: 101.8, lat: 3.2 },
    { id: 12, kind: 'light', action: 'gone', lng: 101.8, lat: 3.2, ref: 'mark/11' },
    { id: 13, kind: 'camera', action: 'gone', lng: 101.73, lat: 3.15, ref: 'node/40' },
  ];
  assert.deepEqual(markFeatures(features, marks).map((f) => f.id), ['node/1', 'mark/9', 'node/3']);
  const cams = markCameras([{ id: 'node/40', lng: 101.73, lat: 3.15, limit: 90 }, { id: 'node/41', lng: 101.74, lat: 3.15, limit: null }], marks);
  assert.deepEqual(cams.map((c) => c.id), ['node/41']);
  assert.deepEqual(withMarks(features, [], ['light']).length, 3, 'nothing to change');
});

test('a red light: stopped a while, then away without stopping again', () => {
  const w = new StopWatch();
  let t = 0, x = 101.7;
  const at = (speed, dx = 0) => { t += 1000; x += dx; return w.note({ time: t, speed, lng: x, lat: 3.15, road: 'Jalan Ampang' }); };
  for (let i = 0; i < 40; i++) assert.equal(at(0), null);
  let found = null;
  for (let i = 0; i < 20 && !found; i++) found = at(10, 0.0001);      // ~11 m a second
  assert.ok(found, 'counted once 150 m on');
  assert.equal(found.road, 'Jalan Ampang');

  // Stop-and-go: stopping again close by is a jam.
  const jam = new StopWatch();
  t = 0; x = 101.7;
  const go = (speed, dx = 0) => { t += 1000; x += dx; return jam.note({ time: t, speed, lng: x, lat: 3.15 }); };
  for (let i = 0; i < 30; i++) go(0);
  for (let i = 0; i < 5; i++) go(5, 0.00005);
  for (let i = 0; i < 30; i++) go(0);
  let any = null;
  for (let i = 0; i < 3; i++) any = any || go(5, 0.00005);
  assert.equal(any, null);

  // Too short (a slow give-way) or too long (parked) isn't a light either.
  const brief = new StopWatch();
  t = 0; x = 101.7;
  for (let i = 0; i < 5; i++) brief.note({ time: (t += 1000), speed: 0, lng: x, lat: 3.15 });
  let none = null;
  for (let i = 0; i < 30; i++) none = none || brief.note({ time: (t += 1000), speed: 10, lng: (x += 0.0001), lat: 3.15 });
  assert.equal(none, null);
});

test('the same spot on three days is worth asking about, unless a light is known there', () => {
  let spots = [];
  const stop = { lng: 101.7, lat: 3.15, road: 'Jalan Ampang' };
  const day = (n) => Date.parse(`2026-11-0${n}T01:00:00Z`);
  spots = rememberStop(spots, { ...stop, at: day(1) }, day(1));
  spots = rememberStop(spots, { ...stop, lng: 101.70005, at: day(1) }, day(1));
  spots = rememberStop(spots, { ...stop, at: day(2) }, day(2));
  assert.equal(spots.length, 1);
  assert.equal(lightsToAsk(spots, []).length, 0, 'two days isn\'t enough');
  spots = rememberStop(spots, { ...stop, at: day(3) }, day(3));
  assert.equal(spots[0].days.length, DAYS_TO_ASK);
  assert.equal(lightsToAsk(spots, []).length, 1);
  assert.equal(lightsToAsk(spots, [{ lng: 101.7003, lat: 3.15 }]).length, 0, 'the map has a light there');
  assert.equal(lightsToAsk(spots, [], () => false).length, 0, 'not on this trip');
  assert.equal(lightsToAsk(settleSpot(spots, spots[0]), []).length, 0, 'asked once');
});
