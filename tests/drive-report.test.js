import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveReport, driveScore, monthDriving } from '../js/drive-report.js';
import { cleanTrip } from '../js/trips.js';

// A drive from speeds in km/h, one a second, with the limit where it's known.
function drive(speeds, { limit = 60, accuracy = 8, every = 1000 } = {}) {
  const r = new DriveReport();
  speeds.forEach((kmh, i) => r.add({ time: 1e6 + i * every, speed: kmh / 3.6, accuracy, limit }));
  return r.result;
}
const steady = (kmh, s) => Array(s).fill(kmh);
const ramp = (from, to, perS) => {
  const out = [];
  for (let v = from; perS > 0 ? v <= to : v >= to; v += perS) out.push(v);
  return out;
};

test('a calm drive: no sudden braking or starts, within the limit, full marks', () => {
  const r = drive([...ramp(0, 60, 5), ...steady(58, 120), ...ramp(58, 0, -6), ...steady(0, 5)]);
  assert.deepEqual([r.brakes, r.starts, r.overS], [0, 0, 0]);
  assert.equal(r.score, 100);
  assert.equal(r.topKmh, 58, 'a single reading isn\'t a top speed');
});

test('a sudden stop and a sharp start are each counted once', () => {
  const r = drive([...steady(70, 20), ...ramp(70, 0, -14), ...steady(0, 6), ...ramp(0, 60, 14), ...steady(60, 20)]);
  assert.equal(r.brakes, 1);
  assert.equal(r.starts, 1);
  assert.equal(r.score, 100 - 8 - 4);
  // Slowing hard from walking pace isn't a sudden stop.
  assert.equal(drive([...steady(15, 10), ...ramp(15, 0, -15), ...steady(0, 5)]).brakes, 0);
});

test('one odd GPS reading, or a gap in the signal, is not a sudden stop', () => {
  assert.equal(drive([...steady(80, 10), 40, ...steady(80, 10)]).brakes, 0);
  assert.equal(drive([...steady(80, 10), 0, ...steady(80, 10)]).brakes, 0);
  // Rough fixes are left out.
  assert.equal(drive([...steady(80, 10), ...ramp(80, 0, -20)], { accuracy: 80 }).brakes, 0);
  // Fixes far apart: lost signal, nothing judged across it.
  const r = new DriveReport();
  r.add({ time: 0, speed: 25, accuracy: 5 });
  r.add({ time: 1000, speed: 25, accuracy: 5 });
  r.add({ time: 2000, speed: 25, accuracy: 5 });
  r.add({ time: 12000, speed: 0, accuracy: 5 });
  r.add({ time: 13000, speed: 0, accuracy: 5 });
  assert.equal(r.result.brakes, 0);
});

test('time over the limit counts only where the limit is known, and by more than 5 km/h', () => {
  const r = drive([...steady(64, 60), ...steady(80, 120)], { limit: 60 });
  assert.equal(r.overS, 120);
  assert.equal(r.limitedS, 179);
  assert.equal(r.score, 100 - Math.round((120 / 179) * 100 > 40 ? 40 : (120 / 179) * 100));
  const unknown = drive(steady(120, 60), { limit: null });
  assert.deepEqual([unknown.overS, unknown.limitedS, unknown.score], [0, 0, 100]);
});

test('the mark never goes below nothing, and the month averages it', () => {
  assert.equal(driveScore({ brakes: 20 }), 0);
  assert.equal(driveScore({ overS: 30, limitedS: 30 }), 100, 'too little known to judge');
  const trips = [{ sc: 90, b: 1, a: 0, o: 60 }, { sc: 70, b: 2, a: 1, o: 0 }, { km: 3 }];
  assert.deepEqual(monthDriving(trips), { trips: 2, score: 80, brakes: 3, starts: 1, overS: 60 });
  assert.equal(monthDriving([{ km: 2 }]), null);
  // Kept with the trip's line, and only when there is one.
  assert.deepEqual([cleanTrip({ at: 1, km: 2, s: 9, b: 2, a: 1, o: 61.4, sc: 77 }).sc, cleanTrip({ at: 1, km: 2, s: 9, sc: 120 }).sc], [77, 100]);
  assert.equal('sc' in cleanTrip({ at: 1, km: 2, s: 9 }), false);
});
