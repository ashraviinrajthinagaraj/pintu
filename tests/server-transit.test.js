// Trips by public transport, asked of Transitous through Pintu's server.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/worker.js';
import { agent, DAILY_LIMIT, forgetDailyCount, planUrl, trimPlan, underDailyLimit } from '../server/transit.js';
import { forgetCounts, PER_MINUTE } from '../server/tomtom.js';
import { klTrip, plan } from './helpers/transitous.js';

const PINTU = 'https://ashraviinrajthinagaraj.github.io';
const HOME = 'https://pintu.example.workers.dev';
const q = (o) => new URLSearchParams(o);

test('only a sensible question is passed on, with walking paths and a fair walk at each end', () => {
  const u = planUrl(q({ from: '3.1336,101.6862', to: '3.1579,101.7123', lang: 'ms' }));
  assert.equal(u.origin + u.pathname, 'https://api.transitous.org/api/v6/plan');
  assert.equal(u.searchParams.get('fromPlace'), '3.133600,101.686200');
  assert.equal(u.searchParams.get('toPlace'), '3.157900,101.712300');
  assert.equal(u.searchParams.get('language'), 'ms');
  assert.equal(u.searchParams.get('detailedTransfers'), 'true');
  assert.equal(u.searchParams.get('maxPreTransitTime'), '1200');
  assert.equal(u.searchParams.get('maxPostTransitTime'), '1200');
  assert.equal(u.searchParams.has('time'), false, 'now, unless a time is given');
  assert.equal(u.searchParams.has('arriveBy'), false);

  const later = planUrl(q({ from: '3.1,101.6', to: '1.28,103.86', time: new Date(Date.now() + 3600000).toISOString(), arriveBy: '1', cursor: 'LATER|1795136520', lang: 'xx' }));
  assert.equal(later.searchParams.get('arriveBy'), 'true');
  assert.equal(later.searchParams.get('pageCursor'), 'LATER|1795136520');
  assert.equal(later.searchParams.has('language'), false);
  assert.match(later.searchParams.get('time'), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

  for (const bad of [
    { from: '3.1,101.6' },
    { from: '3.1,101.6', to: '3.1,101.6' },
    { from: '91,101.6', to: '3.1,101.7' },
    { from: '3.1;101.6', to: '3.1,101.7' },
    { from: 'https://evil.example', to: '3.1,101.7' },
    { from: '3.1,101.6', to: '3.2,101.7', time: 'tomorrow-ish' },
    { from: '3.1,101.6', to: '3.2,101.7', time: '2031-01-01T00:00:00Z' },
    { from: '3.1,101.6', to: '3.2,101.7', cursor: 'x&debug=true' },
  ]) assert.equal(planUrl(q(bad)), null, JSON.stringify(bad));
});

test('every request says who is asking and how to reach them', () => {
  assert.equal(agent('0.10.20'), 'Pintu/0.10.20 (+https://github.com/ashraviinrajthinagaraj/pintu)');
  assert.equal(agent('<script>'), 'Pintu/web (+https://github.com/ashraviinrajthinagaraj/pintu)');
  assert.equal(agent(null), 'Pintu/web (+https://github.com/ashraviinrajthinagaraj/pintu)');
});

test('the answer is cut down to what Pintu shows', () => {
  const out = trimPlan(plan([klTrip(undefined, { live: true, late: 2 })]));
  assert.deepEqual(Object.keys(out), ['trips', 'walk', 'earlier', 'later']);
  assert.equal(out.earlier, 'EARLIER|1795134720');
  assert.equal(out.later, 'LATER|1795136520');
  assert.equal(out.walk, null);
  const [t] = out.trips;
  assert.deepEqual([t.start, t.end, t.seconds, t.transfers, t.legs.length], ['2026-11-20T00:32:00Z', '2026-11-20T00:52:00Z', 1200, 0, 3]);
  const [walk, lrt, last] = t.legs;
  assert.deepEqual(walk, {
    mode: 'WALK', from: { name: 'START', lat: 3.1336, lon: 101.6862, at: '2026-11-20T00:32:00Z', planned: null, track: undefined, cancelled: undefined },
    to: { name: 'KL SENTRAL - REDONE', lat: 3.13442, lon: 101.68625, at: '2026-11-20T00:33:00Z', planned: null, track: undefined, cancelled: undefined },
    start: '2026-11-20T00:32:00Z', end: '2026-11-20T00:33:00Z', planStart: undefined, planEnd: undefined, seconds: 60,
    line: walk.line, precision: 6, metres: 84,
  });
  assert.equal(lrt.mode, 'SUBWAY');
  assert.equal(lrt.name, 'KJL');
  assert.equal(lrt.long, 'LRT KELANA JAYA LINE');
  assert.equal(lrt.colour, 'd50032');
  assert.equal(lrt.toward, 'GOMBAK');
  assert.equal(lrt.live, true);
  assert.equal(lrt.start, '2026-11-20T00:35:00Z');
  assert.equal(lrt.planStart, '2026-11-20T00:33:00Z');
  assert.equal(lrt.from.track, '2');
  assert.deepEqual(lrt.stops.map((s) => s[0]), ['PASAR SENI', 'MASJID JAMEK', 'DANG WANGI', 'KAMPUNG BARU']);
  assert.equal(lrt.metres, undefined);
  // Nothing about where the data came from inside Transitous, or trip ids.
  assert.equal(JSON.stringify(out).includes('stop_times'), false);
  assert.equal(last.to.name, 'END');
  // A walk all the way, when that's an option too.
  assert.ok(trimPlan(plan([], { direct: [klTrip()] })).walk);
  assert.deepEqual(trimPlan({}), { trips: [], walk: null, earlier: null, later: null });
});

test('no more than the daily share is asked for', () => {
  forgetDailyCount();
  const day = Date.parse('2026-11-20T03:00:00Z');
  for (let i = 0; i < DAILY_LIMIT; i++) assert.ok(underDailyLimit(day));
  assert.equal(underDailyLimit(day), false);
  assert.ok(underDailyLimit(day + 86400000), 'a new day');
  forgetDailyCount();
});

function internet(answer) {
  const asked = [];
  globalThis.fetch = async (url, init = {}) => {
    asked.push({ url: String(url), init });
    return typeof answer === 'function' ? answer(String(url)) : answer;
  };
  return asked;
}
const ask = (path, { origin = PINTU, ip = '1.2.3.4' } = {}) => worker.fetch(new Request(`${HOME}${path}`, { headers: { ...(origin ? { origin } : {}), 'cf-connecting-ip': ip } }));

test('/transit: asks Transitous as Pintu, and answers the page with the trimmed trips', async () => {
  forgetCounts();
  forgetDailyCount();
  const asked = internet(() => new Response(JSON.stringify(plan()), { status: 200 }));
  const res = await ask('/transit?from=3.1336,101.6862&to=3.1579,101.7123&lang=en&v=0.10.20');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), PINTU);
  const body = await res.json();
  assert.equal(body.trips.length, 1);
  assert.equal(asked.length, 1);
  assert.match(asked[0].url, /^https:\/\/api\.transitous\.org\/api\/v6\/plan\?fromPlace=3\.133600%2C101\.686200&toPlace=3\.157900%2C101\.712300/);
  assert.equal(asked[0].init.headers['user-agent'], 'Pintu/0.10.20 (+https://github.com/ashraviinrajthinagaraj/pintu)');

  // Nowhere it knows: no trips, not a failure.
  internet(() => new Response('{"error":"no stops"}', { status: 422 }));
  assert.deepEqual(await (await ask('/transit?from=10,10&to=10.1,10.1')).json(), { trips: [], walk: null, earlier: null, later: null });
  internet(() => new Response('', { status: 503 }));
  assert.equal((await ask('/transit?from=3.1,101.6&to=3.2,101.7')).status, 502);
  internet(() => new Response('', { status: 429 }));
  assert.equal((await ask('/transit?from=3.1,101.6&to=3.2,101.7')).status, 429);
  internet(() => { throw new Error('down'); });
  assert.equal((await ask('/transit?from=3.1,101.6&to=3.2,101.7')).status, 502);
});

test('/transit: nothing passed on for a bad question, another site, or one phone asking too often', async () => {
  forgetCounts();
  forgetDailyCount();
  const asked = internet(() => new Response(JSON.stringify(plan()), { status: 200 }));
  assert.equal((await ask('/transit?from=3.1,101.6')).status, 400);
  assert.equal((await ask('/transit?from=3.1,101.6&to=3.2,101.7', { origin: 'https://evil.example' })).status, 403);
  assert.equal(asked.length, 0);
  for (let i = 0; i < PER_MINUTE.transit; i++) assert.equal((await ask('/transit?from=3.1,101.6&to=3.2,101.7', { ip: '9.9.9.9' })).status, 200);
  assert.equal((await ask('/transit?from=3.1,101.6&to=3.2,101.7', { ip: '9.9.9.9' })).status, 429);
  assert.equal((await ask('/transit?from=3.1,101.6&to=3.2,101.7', { ip: '8.8.8.8' })).status, 200, 'others are fine');
  forgetCounts();
  forgetDailyCount();
});
