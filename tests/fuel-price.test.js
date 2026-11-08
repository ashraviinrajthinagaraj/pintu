import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { GRADES, cleanGrade, cleanPrices, defaultGrade, fetchFuelPrices, isStale, officialPrice, priced } = await import('../js/fuel-price.js');
const { cleanVehicle, tripPlan } = await import('../js/vehicle.js');

const WEEK = { date: '2026-11-06', prices: { ron95_budi95: 1.99, ron95: 2.6, ron97: 3.18, diesel: 2.87 } };

test('most people pay the subsidised RON95 price, or Peninsular diesel', () => {
  assert.equal(defaultGrade('petrol'), 'ron95_budi95');
  assert.equal(defaultGrade('diesel'), 'diesel');
  assert.equal(defaultGrade('ev'), null);
  assert.equal(cleanGrade('petrol', 'diesel'), 'ron95_budi95', 'a grade from the wrong fuel');
  assert.equal(cleanGrade('petrol', 'ron97'), 'ron97');
  assert.ok(GRADES.diesel.includes('diesel_eastmsia'));
  assert.equal(cleanVehicle({ kind: 'diesel', consumption: 8, grade: 'ron97' }).grade, 'diesel');
});

test('the official price fills in when you have not typed your own', () => {
  const myvi = cleanVehicle({ kind: 'petrol', consumption: 6 });
  assert.equal(officialPrice(WEEK, myvi), 1.99);
  const p = priced(myvi, WEEK);
  assert.equal(p.price, 1.99);
  assert.equal(p.priceFrom, 'official');
  assert.ok(Math.abs(tripPlan(p, 100).cost - 6 * 1.99) < 1e-9, 'RM 11.94 for 100 km');

  const own = priced(cleanVehicle({ kind: 'petrol', consumption: 6, price: 2.05 }), WEEK);
  assert.equal(own.price, 2.05);
  assert.equal(own.priceFrom, 'own');

  const ron97 = priced(cleanVehicle({ kind: 'petrol', consumption: 6, grade: 'ron97' }), WEEK);
  assert.equal(ron97.price, 3.18);

  // East Malaysia's diesel isn't in this week's list, so there's no price to guess with.
  const sabah = priced(cleanVehicle({ kind: 'diesel', consumption: 8, grade: 'diesel_eastmsia' }), WEEK);
  assert.equal(sabah.price, null);
  assert.equal(tripPlan(sabah, 100).cost, null);

  // An electric car has no pump price.
  assert.equal(priced(cleanVehicle({ kind: 'ev', consumption: 14 }), WEEK).price, null);
  assert.equal(priced(null, WEEK), null);
  assert.equal(priced(myvi, null).price, null);
});

test('checks what the server sends', () => {
  assert.equal(cleanPrices(null), null);
  assert.equal(cleanPrices({ prices: { ron95: 'x', diesel: 0 } }), null);
  assert.deepEqual(cleanPrices({ date: 'soon', prices: { ron95: 2.6, ron97: 99, petrol: 2 } }), { date: null, prices: { ron95: 2.6 } });
});

test('a price more than two weeks old is not this week\'s', () => {
  const now = Date.parse('2026-11-08T10:00:00+08:00');
  assert.equal(isStale(WEEK, now), false);
  assert.equal(isStale({ ...WEEK, date: '2026-10-16' }, now), true);
  assert.equal(isStale({ prices: WEEK.prices }, now), true);
});

test('asks the server at most twice a day, and keeps last week\'s if it can\'t answer', async () => {
  store.clear();
  let asked = 0;
  const answer = (body, ok = true) => async (url) => {
    asked++;
    assert.equal(url, 'https://server.example/fuel');
    if (!ok) throw new Error('offline');
    return new Response(JSON.stringify(body));
  };
  const t0 = Date.parse('2026-11-08T08:00:00+08:00');
  const got = await fetchFuelPrices({ server: 'https://server.example', fetchImpl: answer(WEEK), now: t0 });
  assert.equal(got.prices.ron95_budi95, 1.99);
  await fetchFuelPrices({ server: 'https://server.example', fetchImpl: answer(WEEK), now: t0 + 3600e3 });
  assert.equal(asked, 1, 'kept for the morning');
  const later = await fetchFuelPrices({ server: 'https://server.example', fetchImpl: answer(null, false), now: t0 + 13 * 3600e3 });
  assert.equal(asked, 2);
  assert.equal(later.prices.ron95_budi95, 1.99, 'the old price, rather than none');
  const bad = await fetchFuelPrices({ server: 'https://server.example', fetchImpl: answer({ error: 'no' }), now: t0 + 26 * 3600e3 });
  assert.equal(bad.prices.ron95_budi95, 1.99);
  store.clear();
  assert.equal(await fetchFuelPrices({ server: null, now: t0 }), null, 'no server, no price');
});
