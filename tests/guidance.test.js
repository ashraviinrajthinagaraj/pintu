import test from 'node:test';
import assert from 'node:assert/strict';
import { Guidance, promptDistances } from '../js/guidance.js';
import { prepareTrip } from '../js/routing.js';
import { speech } from '../js/instructions.js';
import { bearing, haversine } from '../js/geo.js';
import { P, along, buildTrip, cityTrip, multiLeg } from './helpers/fixtures.js';

// Drives a route point by point at a steady speed and collects everything said.
function drive(route, { kph = 40, jitterM = 0, seed = 1, stopAt = Infinity, accuracy = 10, g = new Guidance(route), t0 = 1e6 } = {}) {
  const v = kph / 3.6;
  const said = [], states = [];
  let rnd = seed;
  const noise = () => { rnd = (rnd * 16807) % 2147483647; return (rnd / 2147483647 - 0.5) * 2; };
  let time = t0;
  for (let s = 0; s <= Math.min(route.length, stopAt) + 1; s += v) {
    let i = 0;
    while (i < route.cum.length - 2 && route.cum[i + 1] <= s) i++;
    const span = route.cum[i + 1] - route.cum[i] || 1;
    const t = Math.min(1, (s - route.cum[i]) / span);
    const a = route.coords[i], b = route.coords[i + 1];
    const lng = a[0] + (b[0] - a[0]) * t + (noise() * jitterM) / 111000;
    const lat = a[1] + (b[1] - a[1]) * t + (noise() * jitterM) / 111000;
    const st = g.update({ lng, lat, accuracy, speed: v, heading: bearing(a, b), time });
    states.push(st);
    for (const p of st.prompts) said.push({ ...p, s, text: speech(p, route.maneuvers, 'ms') });
    time += 1000;
    if (st.arrived) break;
  }
  return { said, states, g, time };
}

const city = () => prepareTrip(cityTrip());

test('follows the route from start to arrival', () => {
  const route = city();
  const { states } = drive(route);
  assert.equal(states[0].nextIndex, 1);
  assert.ok(states.some((s) => s.nextIndex === 2));
  assert.ok(states.some((s) => s.nextIndex === 3));
  assert.ok(states.at(-1).arrived);
  assert.ok(states.every((s) => !s.offRoute));
});

test('progress and time left only shrink on a clean drive', () => {
  const { states } = drive(city());
  for (let i = 1; i < states.length; i++) {
    assert.ok(states[i].remainingDistance <= states[i - 1].remainingDistance + 0.001);
    assert.ok(states[i].remainingTime <= states[i - 1].remainingTime + 0.001);
  }
  assert.ok(states[0].remainingTime > 100);
});

test('says each instruction once, in order, ahead of the turn', () => {
  const route = city();
  const { said } = drive(route);
  const texts = said.map((x) => x.text);
  assert.equal(said[0].kind, 'intro');
  assert.match(texts[0], /^Terus sejauh 1\.1 kilometer, kemudian belok kanan ke Jalan Tun Razak\.$/);
  assert.equal(texts.filter((t) => t.startsWith('Belok kanan ke Jalan Tun Razak')).length, 1);
  assert.equal(texts.filter((t) => t.startsWith('Belok kiri ke Jalan Pinang')).length, 1);
  assert.equal(texts.filter((t) => t === 'Anda telah sampai.').length, 1);
  assert.equal(new Set(texts).size, texts.length);

  // The "now" prompt arrives before the turn, not after it.
  const turn = route.maneuvers[1].beginDist;
  const now = said.find((x) => x.kind === 'now' && x.index === 1);
  assert.ok(now.s < turn && turn - now.s < 100, `${turn - now.s}`);
  const far = said.find((x) => x.kind === 'far' && x.index === 2);
  assert.ok(far && route.maneuvers[2].beginDist - far.s <= 300 + 12);
});

test('15 m of GPS wander causes no false alarms', () => {
  for (const seed of [1, 7, 42, 1234]) {
    const { states } = drive(city(), { jitterM: 15, seed, accuracy: 15 });
    assert.ok(states.every((s) => !s.offRoute), `seed ${seed}`);
    assert.ok(states.at(-1).arrived, `seed ${seed}`);
    for (let i = 1; i < states.length; i++) {
      assert.ok(states[i].s >= states[i - 1].s - 25.001, `seed ${seed} step ${i}`);
    }
  }
});

test('leaving the route is noticed within seconds, not on the first wobble', () => {
  const route = city();
  const { g, time } = drive(route, { stopAt: 500 });
  let t = time, flagged = null, last;
  const cur = [P.a[0] + 500 / 111000, P.a[1]];
  for (let k = 1; k <= 12; k++) {
    last = g.update({ lng: cur[0], lat: cur[1] + (k * 25) / 111000, accuracy: 10, speed: 11, heading: 0, time: t });
    if (last.offRoute && flagged == null) flagged = k;
    t += 1000;
  }
  assert.ok(flagged >= 6 && flagged <= 11, `flagged at step ${flagged}`);
  assert.deepEqual(last.prompts, []);
});

test('coming back to the route clears the alarm', () => {
  const route = city();
  const { g, time } = drive(route, { stopAt: 500 });
  let t = time;
  const lng = P.a[0] + 500 / 111000;
  for (let k = 1; k <= 8; k++) g.update({ lng, lat: P.a[1] + 0.001, accuracy: 10, speed: 2, heading: 0, time: t += 1000 });
  const back = g.update({ lng: lng + 40 / 111000, lat: P.a[1], accuracy: 10, speed: 8, heading: 90, time: t += 1000 });
  assert.equal(back.offRoute, false);
  assert.equal(back.onRoute, true);
});

test('driving against the route is treated as off route', () => {
  const route = city();
  const { g, time } = drive(route, { stopAt: 600 });
  let t = time, st;
  const flagged = [];
  for (let k = 0; k < 12; k++) {
    const lng = P.a[0] + (600 - k * 8) / 111000;
    st = g.update({ lng, lat: P.a[1], accuracy: 10, speed: 8, heading: 270, time: t += 1000 });
    flagged.push(st.offRoute);
  }
  assert.equal(flagged[3], false);
  assert.equal(st.offRoute, true);
});

test('starting in a car park away from the road is not "off route"', () => {
  const route = city();
  const g = new Guidance(route);
  for (let k = 0; k < 30; k++) {
    const st = g.update({ lng: P.a[0], lat: P.a[1] - 90 / 111000, accuracy: 15, speed: 0.5, heading: null, time: 1e6 + k * 1000 });
    assert.equal(st.offRoute, false);
  }
});

test('but driving away from a far start eventually is', () => {
  const route = city();
  const g = new Guidance(route);
  let t = 1e6, st;
  for (let k = 0; k < 40; k++) {
    st = g.update({ lng: P.a[0] - (k * 15) / 111000, lat: P.a[1] - 90 / 111000, accuracy: 15, speed: 10, heading: 270, time: t += 1000 });
  }
  assert.equal(st.offRoute, true);
});

test('poor GPS holds position instead of raising alarms', () => {
  const route = city();
  const { g, time, states } = drive(route, { stopAt: 400 });
  const before = states.at(-1).s;
  let t = time, st;
  for (let k = 0; k < 20; k++) {
    st = g.update({ lng: P.a[0] + 900 / 111000, lat: P.a[1] + 0.01, accuracy: 300, speed: 0, heading: null, time: t += 1000 });
  }
  assert.equal(st.offRoute, false);
  assert.equal(st.weak, true);
  assert.equal(st.s, before);
});

test('a GPS gap such as a tunnel picks up further along', () => {
  const route = city();
  const { g, time, states } = drive(route, { stopAt: 300 });
  assert.ok(states.at(-1).nextIndex === 1);
  const mid = along(P.b, P.c, 0.5);
  const st = g.update({ lng: mid[0], lat: mid[1], accuracy: 10, speed: 13, heading: 0, time: time + 90000 });
  assert.equal(st.onRoute, true);
  assert.equal(st.nextIndex, 2);
});

test('a road that doubles back does not jump ahead', () => {
  const start = [101.7, 3.15], turn = [101.71, 3.15], end = [101.7003, 3.1503];
  const route = prepareTrip(buildTrip(start, [
    { to: turn, type: 1, street: 'Out', kph: 40 },
    { to: end, type: 12, street: 'Back', kph: 40 },
  ]));
  const { states } = drive(route);
  // On the way out the app must still be counting toward the U-turn.
  const halfway = states[Math.floor(states.findIndex((s) => s.nextIndex === 2) / 2)];
  assert.equal(halfway.nextIndex, 1);
  assert.ok(states.at(-1).arrived);
  assert.ok(states.every((s) => !s.offRoute));
});

test('passing the destination at the first moment does not count as arrival', () => {
  const route = city();
  const g = new Guidance(route);
  const st = g.update({ lng: P.a[0], lat: P.a[1], accuracy: 10, speed: 0, heading: null, time: 1e6 });
  assert.equal(st.arrived, false);
});

test('highway speed gives earlier warnings', () => {
  assert.ok(promptDistances(30).far >= 2000);
  assert.ok(promptDistances(30).now > promptDistances(10).now * 3);
  const route = prepareTrip(buildTrip([101.5, 3.0], [
    { to: [101.6, 3.0], type: 1, street: ['E2', 'Lebuhraya Utara-Selatan'], kph: 110, highway: true },
    { to: [101.61, 3.0], type: 20, street: 'Susur', kph: 60, sign: { exit_toward_elements: [{ text: 'Seremban' }] } },
  ]));
  const { said } = drive(route, { kph: 110 });
  const far = said.find((x) => x.kind === 'far' && x.index === 1);
  assert.ok(far, 'early warning');
  assert.ok(route.maneuvers[1].beginDist - far.s > 1900);
  const now = said.find((x) => x.kind === 'now' && x.index === 1);
  assert.ok(route.maneuvers[1].beginDist - now.s > 200);
});

test('two quick turns are joined into one sentence', () => {
  const route = prepareTrip(buildTrip(P.a, [
    { to: P.b, type: 1, street: 'Satu', kph: 40 },
    { to: [101.7100, 3.1508], type: 10, street: 'Dua', kph: 30 },
    { to: [101.7180, 3.1508], type: 15, street: 'Tiga', kph: 40 },
  ]));
  const { said } = drive(route);
  const joined = said.find((x) => x.kind === 'now' && x.index === 1);
  assert.equal(joined.text, 'Belok kanan ke Dua, kemudian belok kiri.');
});

test('asks to continue after a turn onto a long road', () => {
  const route = prepareTrip(buildTrip(P.a, [
    { to: P.b, type: 1, street: 'Satu', kph: 40 },
    { to: [101.7100, 3.2], type: 10, street: 'Panjang', kph: 80 },
    { to: [101.72, 3.2], type: 15, street: 'Akhir', kph: 40 },
  ]));
  const { said } = drive(route, { kph: 40 });
  const cont = said.find((x) => x.kind === 'continue');
  assert.ok(cont && /^Terus sejauh/.test(cont.text), JSON.stringify(said.map((s) => s.text)));
});

test('repeat says the current instruction again', () => {
  const route = city();
  const { g } = drive(route, { stopAt: 300 });
  const p = g.repeat();
  assert.equal(p.kind, 'repeat');
  assert.match(speech(p, route.maneuvers, 'ms'), /^Dalam .* belok kanan ke Jalan Tun Razak\.$/);
});

test('total time matches the summary at the start', () => {
  const route = city();
  const { states } = drive(route);
  assert.ok(Math.abs(states[0].remainingTime - route.time) < 15);
  assert.ok(Math.abs(states[0].remainingDistance - route.length) < 15);
  assert.ok(haversine(states.at(-1).snapped, P.d) < 30);
});

test('a stop on the way: announced, reached once, and the trip carries on', () => {
  const route = prepareTrip(multiLeg());
  const { said, states } = drive(route);
  const reached = states.filter((s) => s.stopReached != null);
  assert.equal(reached.length, 1);
  const words = said.map((x) => x.text);
  assert.ok(words.some((w) => /Hentian di sebelah kiri/.test(w)), words.join(' | '));
  assert.ok(words.includes('Anda telah sampai di hentian.'), words.join(' | '));
  assert.equal(words.filter((w) => w === 'Anda telah sampai.').length, 1);
  assert.equal(words.at(-1), 'Anda telah sampai.');
  const atStop = states.findIndex((s) => s.stopReached != null);
  assert.equal(states[atStop].arrived, false);
  assert.ok(states.at(-1).arrived);
  const after = states[atStop + 2].next;
  assert.equal(after.type, 15, 'next instruction is the turn after the stop');
});

test('the stop itself does not hint at the road beyond it', () => {
  const route = prepareTrip(multiLeg());
  const { states } = drive(route);
  const beforeStop = states.find((s) => s.next.isStop);
  assert.equal(beforeStop.then, null);
});
