import test from 'node:test';
import assert from 'node:assert/strict';
import { Gps, MAX_LAG_MS } from '../js/location.js';

const fixAt = (timestamp) => {
  let got = null;
  const gps = new Gps((f) => { got = f; }, () => {});
  gps._handle({ coords: { longitude: 101.7, latitude: 3.15, accuracy: 5, speed: 10, heading: 90 }, timestamp });
  return got;
};

test('knows how late a fix arrived, so the arrow can make up for it', () => {
  const lag = fixAt(Date.now() - 400).lag;
  assert.ok(lag >= 400 && lag < 450, String(lag));
});

test('very late fixes are made up for only so far', () => {
  assert.equal(fixAt(Date.now() - 1800).lag, MAX_LAG_MS);
});

test('a phone clock that disagrees with GPS is left alone', () => {
  assert.equal(fixAt(Date.now() + 3000).lag, 0);
  assert.equal(fixAt(Date.now() - 60000).lag, 0);
});
