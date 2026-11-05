import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_BODIES, COLORS, DEFAULT_LOOKS, PRESETS, cleanVehicle, kmPerLitreToL100, l100ToKmPerLitre, levelAfter, rangeLeft, rangeWarning, reserveKm, tripPlan } from '../js/vehicle.js';

const car = cleanVehicle({ name: 'Myvi', kind: 'petrol', consumption: 6, range: 500, price: 2, level: 50 });
const ev = cleanVehicle({ name: 'eMas', kind: 'ev', consumption: 14, range: 400, level: 80 });

test('unit conversion', () => {
  assert.equal(kmPerLitreToL100(20), 5);
  assert.equal(l100ToKmPerLitre(5), 20);
  assert.equal(kmPerLitreToL100(0), null);
});

test('cleans what people type', () => {
  assert.equal(cleanVehicle({ kind: 'petrol' }), null);
  assert.equal(cleanVehicle(null), null);
  const v = cleanVehicle({ kind: 'weird', consumption: '6.5', range: 'abc', price: '-1', level: '250' });
  assert.equal(v.kind, 'petrol');
  assert.equal(v.consumption, 6.5);
  assert.equal(v.range, null);
  assert.equal(v.price, null);
  assert.equal(v.level, 100);
});

test('fuel used and cost on a trip', () => {
  const p = tripPlan(car, 100);
  assert.equal(p.used, 6);
  assert.equal(p.unit, 'L');
  assert.equal(p.cost, 12);
  assert.equal(tripPlan(ev, 100).unit, 'kWh');
  assert.equal(tripPlan(ev, 100).used, 14);
  assert.equal(tripPlan(ev, 100).cost, null);
});

test('range left follows the level and the drive', () => {
  assert.equal(rangeLeft(car), 250);
  assert.equal(rangeLeft(car, 100), 150);
  assert.equal(rangeLeft(cleanVehicle({ consumption: 6 })), null);
});

test('a comfortable trip', () => {
  const p = tripPlan(car, 100);
  assert.equal(p.status, 'enough');
  assert.equal(p.rangeAtEnd, 150);
  assert.equal(p.refillWithinKm, null);
});

test('a tight trip advises filling up on the way', () => {
  const p = tripPlan(car, 230);
  assert.equal(p.status, 'tight');
  assert.equal(p.refillWithinKm, 200);
});

test('a trip too long for the tank says where to stop by', () => {
  const p = tripPlan(car, 400);
  assert.equal(p.status, 'short');
  assert.ok(p.rangeAtEnd < 0);
  assert.equal(p.refillWithinKm, 250 - reserveKm(car));
  const nearly = tripPlan(cleanVehicle({ consumption: 6, range: 500, level: 5 }), 100);
  assert.equal(nearly.refillWithinKm, 0);
});

test('without a range, there is no refill advice but fuel is still worked out', () => {
  const p = tripPlan(cleanVehicle({ consumption: 6 }), 100);
  assert.equal(p.used, 6);
  assert.equal(p.status, 'unknown');
  assert.equal(p.refillWithinKm, null);
});

test('without a consumption figure, range advice still works', () => {
  const p = tripPlan(cleanVehicle({ range: 400, level: 100 }), 100);
  assert.equal(p.used, null);
  assert.equal(p.status, 'enough');
});

test('warnings during the drive', () => {
  assert.equal(rangeWarning(car, 100, 100), null, 'plenty left');
  const low = rangeWarning(car, 205, 100);
  assert.ok(low && !low.urgent);
  assert.equal(low.left, 45);
  const urgent = rangeWarning(car, 230, 100);
  assert.equal(urgent.urgent, true);
  assert.equal(rangeWarning(car, 205, 10), null, 'nearly there with enough to arrive');
  assert.equal(rangeWarning(car, 900, 10).left, 0);
  assert.equal(rangeWarning(cleanVehicle({ consumption: 6 }), 900, 10), null);
});

test('level carries over to the next trip', () => {
  assert.equal(levelAfter(car, 100), 30);
  assert.equal(levelAfter(car, 5000), 0);
  assert.equal(levelAfter(cleanVehicle({ consumption: 6, level: 40 }), 100), 40);
});

test('presets are usable', () => {
  for (const p of PRESETS) {
    assert.ok(CAR_BODIES.includes(p.body), `${p.name} has a shape`);
    if (!p.consumption && !p.range) continue;
    const v = cleanVehicle(p);
    assert.ok(v, p.name);
    assert.ok(v.consumption > 3 && v.consumption < 25, p.name);
    if (p.kind === 'ev') assert.ok(v.range >= 200, p.name);
  }
});

test('looks are complete', () => {
  assert.ok(COLORS.length >= 6);
  for (const c of COLORS) assert.match(c.hex, /^#[0-9A-F]{6}$/);
  assert.equal(DEFAULT_LOOKS.motorcycle.body, 'motorcycle');
  assert.ok(CAR_BODIES.includes(DEFAULT_LOOKS.car.body));
});
