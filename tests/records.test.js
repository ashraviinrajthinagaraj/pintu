// BUDI95 litres, looking after the car, and the work mileage log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUDI_GRADE, DEFAULT_LIMIT_L, budiAfter, budiUsed, cleanBudi } from '../js/budi.js';
import { careDue, careToShow, cleanCare, daysUntil, markSeen, odometerNow } from '../js/car-care.js';
import { cleanRate, workCsv, workTotals, workTrips } from '../js/worklog.js';

const NOV = (day, h = 9) => new Date(2026, 10, day, h).getTime();

test('BUDI95: this month\'s drives on subsidised petrol, or your own figure plus drives since', () => {
  const trips = [
    { at: NOV(1), l: 10, g: BUDI_GRADE },
    { at: NOV(3), l: 12.5, g: BUDI_GRADE },
    { at: NOV(4), l: 9, g: 'ron97' },
    { at: new Date(2026, 9, 30).getTime(), l: 40, g: BUDI_GRADE },
    { at: NOV(8), l: 5, g: BUDI_GRADE },
  ];
  const now = NOV(9);
  const est = budiUsed(trips, null, now);
  assert.deepEqual([est.litres, est.limit, est.guessed], [27.5, DEFAULT_LIMIT_L, true]);
  const fixed = budiUsed(trips, { limit: 200, fixed: { month: '2026-11', litres: 150, at: NOV(5) } }, now);
  assert.equal(fixed.litres, 155, 'your 150 L, then the 5 L drive after it');
  assert.equal(fixed.near, false);
  assert.equal(budiAfter(fixed, 6).near, true, '161 of 200 is past 80%');
  assert.equal(budiAfter(fixed, 50).over, true);
  assert.equal(budiUsed(trips, { fixed: { month: '2026-10', litres: 290, at: NOV(1) } }, now).litres, 27.5, 'last month\'s figure is last month\'s');
  assert.equal(cleanBudi({ limit: -5 }).limit, DEFAULT_LIMIT_L);
});

test('the car: the odometer moves with each drive, and a service shows within 500 km', () => {
  const care = { odometer: 41000, odometerAt: NOV(1), serviceAt: 42000 };
  const trips = [{ at: NOV(2), km: 300 }, { at: NOV(3), km: 250, mode: 'motorcycle' }, { at: NOV(4), km: 260 }, { at: new Date(2026, 9, 1).getTime(), km: 900 }];
  assert.equal(odometerNow(care, trips), 41560);
  const due = careDue(care, trips, NOV(9));
  assert.deepEqual(due.map((d) => [d.kind, d.kmLeft, d.step]), [['service', 440, 'soon']]);
  assert.deepEqual(careDue({ ...care, serviceAt: 45000 }, trips, NOV(9)), []);
  assert.equal(careDue({ ...care, serviceAt: 41500 }, trips, NOV(9))[0].step, 'over');
});

test('road tax and insurance: reminded at 30, 7 and 1 days, each once', () => {
  const now = Date.parse('2026-11-10T01:00:00Z');
  assert.equal(daysUntil('2026-11-17', now), 7);
  const care = { roadTax: '2026-11-17', insurance: '2027-03-01' };
  const due = careToShow(care, [], now);
  assert.deepEqual(due.map((d) => [d.kind, d.days, d.step]), [['roadTax', 7, '7']]);
  const seen = markSeen(care, due);
  assert.deepEqual(careToShow(seen, [], now), [], 'once at 7 days');
  assert.equal(careToShow(seen, [], Date.parse('2026-11-16T01:00:00Z'))[0].step, '1', 'again the day before');
  assert.equal(careToShow(seen, [], Date.parse('2026-11-18T01:00:00Z'))[0].step, 'over');
  assert.equal(cleanCare({ roadTax: 'next week' }).roadTax, null);
  assert.equal(cleanCare({ odometer: -3 }).odometer, null);
});

test('work trips: the month\'s list, its claim, and a CSV a spreadsheet opens safely', () => {
  const trips = [
    { at: NOV(3, 9), km: 12.4, cost: 2.5, w: true, from: 'Rumah', to: 'Pejabat, Tingkat 3' },
    { at: NOV(3, 18), km: 12.6, cost: null, w: true, from: '', to: '=HYPERLINK("x")' },
    { at: NOV(4), km: 8, w: false, to: 'Pasar' },
    { at: new Date(2026, 9, 3).getTime(), km: 50, w: true, to: 'Ipoh' },
  ];
  const list = workTrips(trips, 2026, 10);
  assert.equal(list.length, 2);
  assert.deepEqual(workTotals(list, 0.6), { trips: 2, km: 25, claim: 15 });
  assert.equal(workTotals(list, 'abc').claim, null);
  assert.equal(cleanRate(50), null);
  const csv = workCsv(list, 0.6, ['Tarikh', 'Masa', 'Dari', 'Ke', 'km', 'Minyak RM', 'Tuntutan RM']);
  assert.ok(csv.startsWith('﻿Tarikh,Masa,Dari,Ke,km,Minyak RM,Tuntutan RM\r\n'));
  assert.match(csv, /2026-11-03,09:00,Rumah,"Pejabat, Tingkat 3",12\.4,2\.50,7\.44/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/, 'a name never runs as a formula');
  assert.match(csv, /,,,,25\.0,,15\.00\r\n$/);
});
