import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTrip } from '../js/routing.js';
import { buildTrip } from './helpers/fixtures.js';
import { haversine } from '../js/geo.js';
import { AFTER_M, BEFORE_M, arrowFor, slice, turnArrow, wantsArrow } from '../js/turn-arrow.js';

// East along one street, then a right turn south.
const A = [101.700, 3.150], B = [101.705, 3.150], C = [101.705, 3.146];
const trip = () => prepareTrip(buildTrip(A, [
  { to: B, type: 1, street: 'Jalan Ampang', kph: 40 },
  { to: C, type: 10, street: 'Jalan Tun Razak', kph: 40 },
]));

test('only turns get an arrow, not carrying on, starting or arriving', () => {
  for (const type of [9, 10, 11, 15, 18, 20, 26]) assert.equal(wantsArrow({ type }), true, `type ${type}`);
  for (const type of [0, 1, 2, 4, 5, 8, 22, 25]) assert.equal(wantsArrow({ type }), false, `type ${type}`);
  assert.equal(wantsArrow(null), false);
});

test('the arrow follows the route around the turn and points the way out', () => {
  const r = trip();
  const turn = r.maneuvers.find((m) => m.type === 10);
  const arrow = turnArrow(r, turn.beginDist);
  // From before the corner to after it, along the route.
  assert.ok(haversine(arrow.line[0], B) > BEFORE_M - 3 && haversine(arrow.line[0], B) < BEFORE_M + 3);
  assert.ok(arrow.line.some((p) => haversine(p, B) < 1), 'it goes round the corner itself');
  const end = arrow.line.at(-1);
  assert.ok(Math.abs(haversine(end, B) - AFTER_M) < 3);
  // The head sits at the end and points south (180°), the way the road goes.
  assert.deepEqual(arrow.end, end);
  assert.ok(Math.abs(arrow.bearing - 180) < 1, `${arrow.bearing}`);
  // Going east before the turn: 90°.
  assert.ok(Math.abs(turnArrow(r, 100).bearing - 90) < 1);
});

test('a slice is cut where it is asked, and nothing when it is empty', () => {
  const r = trip();
  const part = slice(r, 100, 200);
  assert.ok(Math.abs(haversine(part[0], part.at(-1)) - 100) < 2);
  assert.deepEqual(slice(r, 300, 300), []);
});

test('which turn: the next one once it is close, the one you are in until you are through', () => {
  const r = trip();
  const turn = r.maneuvers.findIndex((m) => m.type === 10);
  const at = r.maneuvers[turn].beginDist;
  const st = (s) => {
    let next = r.maneuvers.findIndex((m) => m.beginDist > s + 3);
    if (next < 0) next = r.maneuvers.length - 1;
    return { onRoute: true, s, nextIndex: next, currentIndex: Math.max(0, next - 1) };
  };
  assert.equal(arrowFor(r, st(at - 400), { within: 300 }), null, 'not yet: still far off');
  assert.deepEqual(arrowFor(r, st(at - 200)), { index: turn, at });
  assert.deepEqual(arrowFor(r, st(at + 10)), { index: turn, at }, 'still in the turn');
  assert.equal(arrowFor(r, st(at + AFTER_M + 5)), null, 'through it');
  assert.equal(arrowFor(r, { ...st(at - 50), onRoute: false }), null, 'off the route');
});
