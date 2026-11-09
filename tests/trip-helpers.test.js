// Where to rest, the Touch 'n Go check and the parking countdown.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { nextRest } = await import('../js/rest-stop.js');
const { afterTolls, cleanBalance, tngCheck } = await import('../js/tng.js');
const { WARN_MS, parkingLeft, warnDue } = await import('../js/parking-timer.js');

const MIN = 60e3;

test('points at the next R&R, or a lay-by if no R&R comes soon', () => {
  const soon = [{ id: 'close', kind: 'layby', along: 10200 }, { id: 'layby', kind: 'layby', along: 14000 }, { id: 'rnr', kind: 'rnr', along: 30000 }];
  assert.equal(nextRest(soon, 10000).id, 'rnr', 'an R&R 16 km past the lay-by is worth the wait; 200 m is too close to turn');
  const late = [{ id: 'layby', kind: 'layby', along: 5000 }, { id: 'rnr', kind: 'rnr', along: 40000 }];
  assert.equal(nextRest(late, 0).id, 'layby', 'one 35 km further isn\'t');
  assert.equal(nextRest(late, 41000), null, 'nothing left within 60 km');
  assert.equal(nextRest([], 0), null);
});

test('Touch \'n Go: enough, maybe not, or short by how much', () => {
  const plaza = (fare) => ({ fare, road: fare ? 'LDP' : null });
  assert.equal(tngCheck(null, [plaza(2.1)]), null, 'no balance typed');
  assert.equal(tngCheck({ rm: 50 }, []), null, 'no tolls');
  assert.equal(tngCheck({ rm: 50 }, [plaza(2.1), plaza(2)]).state, 'ok');
  const short = tngCheck({ rm: 3 }, [plaza(2.1), plaza(2)]);
  assert.equal(short.state, 'short');
  assert.equal(short.need, 1.1);
  assert.equal(tngCheck({ rm: 20 }, [plaza(2.1), plaza(null)]).state, 'maybe', 'an unknown fare on a low balance');
  assert.equal(tngCheck({ rm: 80 }, [plaza(2.1), plaza(null)]).state, 'ok');
  assert.equal(cleanBalance({ rm: -1 }), null);
  assert.equal(cleanBalance({ rm: 'abc' }), null);
  const after = afterTolls({ rm: 10, at: 1 }, [2.1, 2]);
  assert.equal(after.rm, 5.9);
  assert.equal(after.guessed, true);
  assert.equal(afterTolls({ rm: 1 }, [2.1]).rm, 0, 'never below nothing');
  assert.deepEqual(afterTolls({ rm: 10, at: 1 }, []), { rm: 10, at: 1, guessed: false }, 'nothing paid, nothing changed');
});

test('parking: the time left, and one reminder in the last ten minutes', () => {
  const now = 1_000_000;
  assert.equal(parkingLeft({}, now), null);
  const car = { paidUntil: now + 30 * MIN };
  assert.equal(parkingLeft(car, now), 30 * MIN);
  assert.equal(warnDue(car, now), false);
  assert.equal(warnDue(car, now + 30 * MIN - WARN_MS + 1), true);
  assert.equal(warnDue({ ...car, warned: true }, now + 25 * MIN), false, 'once');
  assert.equal(warnDue(car, now + 31 * MIN), false, 'over');
});
