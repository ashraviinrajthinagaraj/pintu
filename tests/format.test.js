import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtClock, fmtDistance, fmtDuration, sayDistance } from '../js/format.js';

test('distances on screen', () => {
  assert.equal(fmtDistance(4), '10 m');
  assert.equal(fmtDistance(84), '80 m');
  assert.equal(fmtDistance(312), '300 m');
  assert.equal(fmtDistance(980), '1 km');
  assert.equal(fmtDistance(1240), '1.2 km');
  assert.equal(fmtDistance(68400), '68 km');
});

test('distances out loud', () => {
  assert.equal(sayDistance(310, 'ms'), '300 meter');
  assert.equal(sayDistance(1000, 'ms'), '1 kilometer');
  assert.equal(sayDistance(310, 'en'), '300 metres');
  assert.equal(sayDistance(1000, 'en'), '1 kilometre');
  assert.equal(sayDistance(2500, 'en'), '2.5 kilometres');
});

test('durations', () => {
  assert.equal(fmtDuration(20, 'ms'), '1 min');
  assert.equal(fmtDuration(600, 'en'), '10 min');
  assert.equal(fmtDuration(4320, 'ms'), '1 j 12 min');
  assert.equal(fmtDuration(4320, 'en'), '1 hr 12 min');
  assert.equal(fmtDuration(7200, 'ms'), '2 j');
});

test('arrival time follows the language', () => {
  const d = new Date(2026, 10, 5, 15, 42);
  assert.equal(fmtClock(d, 'ms'), '3:42 PTG');
  assert.match(fmtClock(d, 'en'), /^3:42/);
});
