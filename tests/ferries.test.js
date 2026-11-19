import test from 'node:test';
import assert from 'node:assert/strict';
import { ferryLegs, timetableSearch } from '../js/ferries.js';
import { prepareTrip } from '../js/routing.js';
import { buildTrip } from './helpers/fixtures.js';

// Kuala Perlis to Kuah: a drive to the jetty, the car ferry, and off the other side.
const langkawi = () => prepareTrip(buildTrip([100.129, 6.399], [
  { to: [100.125, 6.395], type: 1, street: 'Jalan Kuala Perlis', kph: 40 },
  { to: [99.86, 6.32], type: 28, street: 'Wantas RoRo', kph: 18, ferry: true },
  { to: [99.851, 6.317], type: 29, kph: 30 },
]));

test('the ferry on a route: its name, and how long on the water', () => {
  const legs = ferryLegs(langkawi());
  assert.equal(legs.length, 1);
  assert.equal(legs[0].name, 'Wantas RoRo');
  assert.ok(legs[0].km > 25 && legs[0].km < 35, `${legs[0].km} km`);
  assert.ok(Math.abs(legs[0].seconds - (legs[0].km / 18) * 3600) < 1);
  assert.ok(legs[0].at > 0);
  // No ferry, no legs; a ferry without a name still counts.
  assert.deepEqual(ferryLegs(prepareTrip(buildTrip([101.7, 3.15], [{ to: [101.71, 3.15], type: 1, street: 'Jalan Ampang' }]))), []);
  const unnamed = prepareTrip(buildTrip([100.129, 6.399], [{ to: [99.86, 6.32], type: 28, ferry: true }, { to: [99.851, 6.317], type: 29 }]));
  assert.equal(ferryLegs(unnamed)[0].name, '');
  assert.deepEqual(ferryLegs(null), []);
});

test('a search for when it sails', () => {
  assert.equal(timetableSearch('Wantas RoRo', 'jadual feri'), 'https://www.google.com/search?q=Wantas%20RoRo%20jadual%20feri');
  assert.match(timetableSearch('', 'ferry timetable'), /q=ferry%20ferry%20timetable$/);
});
