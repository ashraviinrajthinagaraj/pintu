import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DriveWatch, DRIVE_BREAK_MS, JAM_AFTER_MS, JAM_LONG_MS, OVER_AGAIN_MS, OVER_HOLD_MS, OVER_LONG_MS, OVER_LONGER_MS,
  OVER_REPEAT_MS, PARKED_MS, QUIET_MS, RESTED_MS,
} from '../js/drive-watch.js';

// Drives along for a while at one speed, one second at a time, and gathers remarks.
function drive(watch, from, ms, state) {
  const said = [];
  for (let t = from; t < from + ms; t += 1000) {
    for (const moment of watch.update({ time: t, ...state })) said.push({ moment, at: t - from });
  }
  return said;
}
const names = (said) => said.map((s) => s.moment);

const OVER = { kmh: 110, limit: 90, roadKmh: 90 };
const FINE = { kmh: 85, limit: 90, roadKmh: 90 };
const CRAWL = { kmh: 6, limit: 90, roadKmh: 90 };

test('passing a slower car says nothing', () => {
  const said = drive(new DriveWatch(), 0, OVER_HOLD_MS - 1000, OVER);
  assert.deepEqual(said, []);
});

test('a little over the limit is left alone: speedometers read high', () => {
  assert.deepEqual(drive(new DriveWatch(), 0, 600000, { kmh: 95, limit: 90 }), []);
});

test('staying over the limit gets more serious the longer it lasts', () => {
  const said = drive(new DriveWatch(), 0, OVER_LONGER_MS + 1000, OVER);
  assert.deepEqual(names(said), ['overspeed', 'overspeed2', 'overspeed3']);
  assert.equal(said[0].at, OVER_HOLD_MS);
  assert.equal(said[1].at, OVER_LONG_MS);
  assert.equal(said[2].at, OVER_LONGER_MS);
});

test('the last warning comes back if it\'s still needed, but not constantly', () => {
  const said = drive(new DriveWatch(), 0, OVER_LONGER_MS + OVER_AGAIN_MS * 2 + 1000, OVER);
  assert.deepEqual(names(said), ['overspeed', 'overspeed2', 'overspeed3', 'overspeed3', 'overspeed3']);
});

test('dipping under for a moment doesn\'t start the count again', () => {
  const watch = new DriveWatch();
  const said = [
    ...drive(watch, 0, 20000, OVER),
    ...drive(watch, 20000, 3000, FINE),
    ...drive(watch, 23000, 12000, OVER),
  ];
  assert.deepEqual(names(said), ['overspeed', 'overspeed2'], 'thirty seconds or so, all told');
});

test('slowing down after a long stretch earns a kind word', () => {
  const watch = new DriveWatch();
  drive(watch, 0, OVER_LONG_MS + 1000, OVER);
  const later = drive(watch, OVER_LONG_MS + 1000, 8000, FINE);
  assert.deepEqual(names(later), ['slowed']);
});

test('a brief burst gets no praise for ending', () => {
  const watch = new DriveWatch();
  drive(watch, 0, 8000, OVER);
  assert.deepEqual(drive(watch, 8000, 30000, FINE), []);
});

test('short bursts don\'t nag: the first remark waits its turn', () => {
  const watch = new DriveWatch();
  let t = 0;
  const said = [];
  for (let i = 0; i < 4; i++) {
    said.push(...drive(watch, t, 6000, OVER));
    t += 6000;
    said.push(...drive(watch, t, 10000, FINE));
    t += 10000;
  }
  assert.deepEqual(names(said), ['overspeed']);
  said.push(...drive(watch, OVER_REPEAT_MS + 1000, 6000, OVER));
  assert.deepEqual(names(said), ['overspeed', 'overspeed']);
});

test('no limit known means nothing to say about speed', () => {
  assert.deepEqual(drive(new DriveWatch(), 0, 600000, { kmh: 150, limit: null, roadKmh: 90 }).filter((s) => /over/.test(s.moment)), []);
});

function rolling() {
  const watch = new DriveWatch();
  drive(watch, 0, 5000, FINE);
  return { watch, t: 5000 };
}

test('crawling for a while on a quick road is a jam', () => {
  const { watch, t } = rolling();
  const said = drive(watch, t, JAM_AFTER_MS + 2000, CRAWL);
  assert.deepEqual(names(said), ['jam']);
  assert.equal(said[0].at, JAM_AFTER_MS);
});

test('a long red light is not a jam', () => {
  const { watch, t } = rolling();
  assert.deepEqual(drive(watch, t, JAM_AFTER_MS - 5000, { ...CRAWL, kmh: 0 }), []);
  assert.deepEqual(drive(watch, t, 60000, FINE), []);
});

test('a slow lane is not a jam', () => {
  const { watch, t } = rolling();
  assert.deepEqual(drive(watch, t, 600000, { kmh: 12, limit: 30, roadKmh: 30 }), []);
});

test('leaving a car park is not a jam', () => {
  assert.deepEqual(drive(new DriveWatch(), 0, 400000, CRAWL), []);
});

test('sitting still for ages is a stop, not a jam', () => {
  const { watch, t } = rolling();
  assert.deepEqual(drive(watch, t, PARKED_MS + 600000, { ...CRAWL, kmh: 0 }), []);
});

test('stop-start traffic is still one jam, not several', () => {
  const { watch, t: from } = rolling();
  let t = from;
  const said = [];
  for (let i = 0; i < 30; i++) {
    said.push(...drive(watch, t, 8000, { ...CRAWL, kmh: 28 }));
    t += 8000;
    said.push(...drive(watch, t, 30000, CRAWL));
    t += 30000;
  }
  assert.deepEqual(names(said).filter((n) => n === 'jam'), ['jam']);
  assert.ok(!names(said).includes('jamClear'));
});

test('a jam gets a remark if it drags on, and when it finally clears', () => {
  const { watch, t } = rolling();
  const stuck = drive(watch, t, JAM_AFTER_MS + JAM_LONG_MS + 2000, CRAWL);
  assert.deepEqual(names(stuck), ['jam', 'jamLong']);
  const freed = drive(watch, t + JAM_AFTER_MS + JAM_LONG_MS + 2000, 30000, FINE);
  assert.deepEqual(names(freed), ['jamClear']);
});

test('near the turn or the end, a queue doesn\'t count as a jam yet', () => {
  const { watch, t } = rolling();
  assert.deepEqual(drive(watch, t, JAM_AFTER_MS + 60000, { ...CRAWL, nearEnd: true }), []);
  const turn = rolling();
  assert.deepEqual(drive(turn.watch, turn.t, JAM_AFTER_MS + 60000, { ...CRAWL, nearTurn: true }), []);
});

test('jams don\'t get remarks too often', () => {
  const { watch, t: from } = rolling();
  let t = from;
  const said = [];
  for (let i = 0; i < 2; i++) {
    said.push(...drive(watch, t, JAM_AFTER_MS + 1000, CRAWL));
    t += JAM_AFTER_MS + 1000;
    said.push(...drive(watch, t, 30000, FINE));
    t += 30000;
  }
  assert.deepEqual(names(said), ['jam', 'jamClear'], 'the second comes too soon after the first');
});

test('after two hours at the wheel, a reminder to rest', () => {
  const watch = new DriveWatch();
  const ms = DRIVE_BREAK_MS + 3600000 + 1000;
  const said = [];
  for (let t = 0; t < ms; t += 5000) said.push(...watch.update({ time: t, kmh: 80, limit: 90, roadKmh: 90 }));
  assert.deepEqual(said.filter((n) => n === 'longDrive'), ['longDrive', 'longDrive'], 'and again an hour later');
});

test('a proper rest starts the two hours again', () => {
  const watch = new DriveWatch();
  let t = 0;
  const go = (ms, kmh) => { const out = []; for (const end = t + ms; t < end; t += 5000) out.push(...watch.update({ time: t, kmh })); return out; };
  go(DRIVE_BREAK_MS - 600000, 80);
  go(RESTED_MS + 5000, 0);
  assert.deepEqual(go(DRIVE_BREAK_MS - 1200000, 80).filter((n) => n === 'longDrive'), []);
});

test('a long quiet stretch gets the odd remark', () => {
  const watch = new DriveWatch();
  const state = { kmh: 80, limit: 90, roadKmh: 90, clearAhead: 5000 };
  const said = names(drive(watch, 0, QUIET_MS + 2000, state));
  assert.deepEqual(said, ['quiet']);
});

test('being spoken to resets the quiet', () => {
  const watch = new DriveWatch();
  const state = { kmh: 80, limit: 90, roadKmh: 90, clearAhead: 5000 };
  drive(watch, 0, QUIET_MS - 5000, state);
  watch.heard(QUIET_MS - 5000);
  assert.deepEqual(drive(watch, QUIET_MS - 5000, 60000, state), []);
});

test('no chatting with a turn coming, or while crawling', () => {
  assert.deepEqual(drive(new DriveWatch(), 0, QUIET_MS + 2000, { kmh: 80, limit: 90, roadKmh: 90, clearAhead: 500 }), []);
  assert.deepEqual(names(drive(new DriveWatch(), 0, QUIET_MS + 2000, { kmh: 15, limit: 30, roadKmh: 30, clearAhead: 5000 })), []);
});

test('no speed reading says nothing and breaks nothing', () => {
  const watch = new DriveWatch();
  assert.deepEqual(watch.update({ time: 0, kmh: null, limit: 90 }), []);
  assert.deepEqual(watch.update({ time: 1000, kmh: undefined, limit: 90 }), []);
});

test('driving time carries on into the next trip, and a break is due at two hours in all', async () => {
  const { DriveWatch, DRIVE_BREAK_MS } = await import('../js/drive-watch.js');
  const w = new DriveWatch({ driving: DRIVE_BREAK_MS - 60000 });
  assert.equal(w.tired, false);
  let t = 0, said = [];
  for (let i = 0; i < 90; i++) { t += 1000; said.push(...w.update({ time: t, kmh: 80 })); }
  assert.equal(w.tired, true);
  assert.deepEqual(said.filter((k) => k === 'longDrive'), ['longDrive']);
});

test('already reminded on the last trip: tired at once, and not told again straight away', async () => {
  const { DriveWatch, DRIVE_BREAK_MS } = await import('../js/drive-watch.js');
  const w = new DriveWatch({ driving: DRIVE_BREAK_MS + 10 * 60000 });
  assert.equal(w.tired, true);
  let t = 0, said = [];
  for (let i = 0; i < 120; i++) { t += 1000; said.push(...w.update({ time: t, kmh: 80 })); }
  assert.deepEqual(said.filter((k) => k === 'longDrive'), []);
});

test('a proper rest clears it', async () => {
  const { DriveWatch, DRIVE_BREAK_MS, RESTED_MS } = await import('../js/drive-watch.js');
  const w = new DriveWatch({ driving: DRIVE_BREAK_MS + 60000 });
  let t = 0;
  for (; t <= RESTED_MS + 5000; t += 5000) w.update({ time: t, kmh: 0 });
  assert.equal(w.tired, false);
  assert.equal(w.driving, 0);
});
