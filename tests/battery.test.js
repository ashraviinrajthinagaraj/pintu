import test from 'node:test';
import assert from 'node:assert/strict';
import { LOW, frameDue, saverOn, watchBattery } from '../js/battery.js';

test('auto saves only when the battery is low and not charging', () => {
  assert.equal(saverOn('on', null), true);
  assert.equal(saverOn('off', { level: 0.05, charging: false }), false);
  assert.equal(saverOn('auto', null), false, 'a phone that won\'t say');
  assert.equal(saverOn('auto', { level: LOW, charging: false }), true);
  assert.equal(saverOn('auto', { level: 0.1, charging: true }), false, 'plugged in');
  assert.equal(saverOn('auto', { level: 0.6, charging: false }), false);
});

test('thirty frames a second when saving, every frame otherwise', () => {
  let drawn = 0, last = -Infinity;
  for (let now = 0; now < 1000; now += 1000 / 60) {
    if (frameDue(now, last, true)) { drawn++; last = now; }
  }
  assert.ok(drawn >= 29 && drawn <= 31, String(drawn));
  assert.equal(frameDue(5, 0, false), true);
});

test('hears the battery change', async () => {
  const listeners = {};
  const battery = { level: 0.5, charging: true, addEventListener: (k, fn) => { listeners[k] = fn; } };
  const seen = [];
  await watchBattery((b) => seen.push(b), { getBattery: async () => battery });
  battery.level = 0.15;
  battery.charging = false;
  listeners.chargingchange();
  assert.deepEqual(seen, [{ level: 0.5, charging: true }, { level: 0.15, charging: false }]);
  assert.equal(await watchBattery(() => assert.fail('no battery'), {}), null);
  assert.equal(await watchBattery(() => {}, { getBattery: () => Promise.reject(new Error('blocked')) }), null);
});
