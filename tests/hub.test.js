// The shared hub: live trips, road reports, convoys and morning alerts, run here
// on an in-memory SQLite database in place of Cloudflare's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  CONVOY_MAX, CONVOY_MS, Hub, MEMBER_STALE_MS, REPORTS_PER_HOUR, REPORT_LIFE_MIN, SHARE_AFTER_MS, SHARE_QUIET_MS, TESTS_PER_DAY,
  cleanPos, cleanSubscription, commuteDue, commuteMessage, localNow, vapidHeader, vapidKeys,
} from '../server/hub.js';

function fakeState() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    storage: {
      sql: {
        exec(q, ...args) {
          if (!args.length && q.trim().split(';').filter((x) => x.trim()).length > 1) { db.exec(q); return []; }
          const st = db.prepare(q);
          if (/^\s*SELECT/i.test(q)) return st.all(...args).map((r) => ({ ...r }));
          st.run(...args);
          return [];
        },
      },
    },
  };
}

function hub({ env = {}, fetchImpl } = {}) {
  let now = Date.parse('2026-11-09T00:00:00Z'); // 8 am in Malaysia, a Monday
  const pushes = [];
  const fetched = [];
  const h = new Hub(fakeState(), env, {
    clock: () => now,
    fetchImpl: fetchImpl || (async (url, init) => {
      fetched.push(String(url));
      if (String(url).startsWith('https://api.tomtom.com/')) return new Response(JSON.stringify({ routes: [{ summary: { travelTimeInSeconds: 2700, historicTrafficTravelTimeInSeconds: 1800 } }] }));
      pushes.push({ url: String(url), init });
      return new Response(null, { status: 201 });
    }),
  });
  const call = async (path, body) => {
    const res = await h.fetch(new Request(`https://hub${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  return { h, call, pushes, fetched, tick: (ms) => { now += ms; }, now: () => now };
}

const POS = { lng: 101.7123, lat: 3.1579, heading: 90, speed: 12 };
const DEST = { name: 'Rumah <b>Mak</b>', lng: 101.75, lat: 3.2 };
const DEVICE = 'abcdefghjkmnpqrs';
const DEVICE2 = 'bbcdefghjkmnpqrs';
const DEVICE3 = 'cbcdefghjkmnpqrs';

test('a shared trip: started, followed, ended, then gone', async () => {
  const { call, tick } = hub();
  const start = await call('/share/start', { name: 'Ali', dest: DEST, pos: POS, eta: Date.parse('2026-11-09T00:30:00Z'), remaining: 9000 });
  assert.equal(start.status, 200);
  const { id, key } = start.body;
  assert.match(id, /^[a-z2-9]{10}$/);
  assert.equal(key.length, 22);

  let seen = await call(`/share?id=${id}`);
  assert.equal(seen.body.name, 'Ali');
  assert.equal(seen.body.dest.name, 'Rumah Mak', 'no markup kept');
  assert.deepEqual(seen.body.pos, { lng: 101.7123, lat: 3.1579, heading: 90, speed: 12 });
  assert.equal(seen.body.ended, false);

  assert.equal((await call('/share/update', { id, key: 'x'.repeat(22), pos: POS })).status, 404, 'only the sharer moves it');
  tick(10e3);
  const moved = await call('/share/update', { id, key, pos: { ...POS, lng: 101.72 }, remaining: 8000 });
  assert.equal(moved.body.watched, true, 'someone looked in the last minute');
  seen = await call(`/share?id=${id}`);
  assert.equal(seen.body.pos.lng, 101.72);
  assert.equal(seen.body.remaining, 8000);

  await call('/share/end', { id, key, arrived: true });
  seen = await call(`/share?id=${id}`);
  assert.equal(seen.body.ended, true);
  assert.equal(seen.body.arrived, true);
  assert.equal((await call('/share/update', { id, key, pos: POS })).status, 410);
  tick(SHARE_AFTER_MS + 1000);
  assert.equal((await call(`/share?id=${id}`)).status, 404);
  assert.equal((await call('/share?id=../../etc')).status, 404);
});

test('a shared trip that stops hearing from the phone says it has ended', async () => {
  const { call, tick } = hub();
  const { id } = (await call('/share/start', { name: 'Ali', dest: DEST, pos: POS })).body;
  tick(SHARE_QUIET_MS + 1000);
  const seen = await call(`/share?id=${id}`);
  assert.equal(seen.body.ended, true);
  assert.equal(seen.body.arrived, false);
});

test('only sensible positions are kept', () => {
  assert.equal(cleanPos({ lng: 200, lat: 3 }), null);
  assert.equal(cleanPos({ lng: '101', lat: 3 }), null);
  assert.deepEqual(cleanPos({ lng: 101.1234567, lat: 3.1, heading: 400, speed: -1 }), { lng: 101.123457, lat: 3.1, heading: null, speed: null });
});

test('road reports: added, seen nearby, confirmed, and cleared', async () => {
  const { call, tick } = hub();
  const one = await call('/reports/add', { kind: 'police', lng: 101.7, lat: 3.15, heading: 45, device: DEVICE });
  assert.equal(one.status, 200);
  // The same thing a little further on is the same report.
  const again = await call('/reports/add', { kind: 'police', lng: 101.7005, lat: 3.15, device: DEVICE2 });
  assert.equal(again.body.id, one.body.id);
  assert.equal(again.body.again, true);
  await call('/reports/add', { kind: 'jam', lng: 101.71, lat: 3.16, device: DEVICE });
  await call('/reports/add', { kind: 'hazard', lng: 103.5, lat: 1.5, device: DEVICE });

  let list = (await call('/reports?bbox=101.6,3.1,101.8,3.2')).body.reports;
  assert.deepEqual(list.map((r) => r.kind).sort(), ['jam', 'police']);
  assert.equal(list.find((r) => r.kind === 'police').up, 2);
  assert.equal((await call('/reports?bbox=100,1,104,5')).status, 400, 'too big an area');
  assert.equal((await call('/reports/add', { kind: 'aliens', lng: 101.7, lat: 3.15, device: DEVICE })).status, 400);

  // "Still there" keeps it going; two people saying it's gone clear it.
  const police = one.body.id;
  tick((REPORT_LIFE_MIN.police - 5) * 60e3);
  await call('/reports/vote', { id: police, still: true, device: DEVICE3 });
  tick(10 * 60e3);
  list = (await call('/reports?bbox=101.6,3.1,101.8,3.2')).body.reports;
  assert.ok(list.some((r) => r.id === police), 'kept going by the confirmation');
  assert.ok(!list.some((r) => r.kind === 'jam'), 'the jam was never confirmed and has gone');
  assert.equal((await call('/reports/vote', { id: police, still: false, device: DEVICE3 })).body.gone, false);
  assert.equal((await call('/reports/vote', { id: police, still: false, device: DEVICE3 })).body.gone, true);
  assert.equal((await call('/reports?bbox=101.6,3.1,101.8,3.2')).body.reports.length, 0);

  // Whoever reported something can take it back at once.
  const mine = (await call('/reports/add', { kind: 'jam', lng: 101.7, lat: 3.15, device: DEVICE })).body.id;
  assert.equal((await call('/reports/vote', { id: mine, still: false, device: DEVICE })).body.gone, true);
});

test('one phone can only report so much in an hour', async () => {
  const { call, tick } = hub();
  for (let i = 0; i < REPORTS_PER_HOUR; i++) {
    assert.equal((await call('/reports/add', { kind: 'hazard', lng: 101 + i * 0.01, lat: 3, device: DEVICE })).status, 200);
  }
  assert.equal((await call('/reports/add', { kind: 'hazard', lng: 102, lat: 3, device: DEVICE })).status, 429);
  tick(3600e3 + 1);
  assert.equal((await call('/reports/add', { kind: 'hazard', lng: 102, lat: 3, device: DEVICE })).status, 200);
});

test('a convoy: started, joined, everyone sees everyone, and it ends', async () => {
  const { call, tick } = hub();
  const lead = (await call('/convoy/start', { name: 'Ali', dest: DEST, pos: POS })).body;
  assert.match(lead.id, /^[a-z2-9]{10}$/);
  const peek = (await call(`/convoy?id=${lead.id}`)).body;
  assert.equal(peek.dest.name, 'Rumah Mak');
  assert.deepEqual(peek.members.map((m) => m.name), ['Ali']);
  assert.equal(peek.members[0].key, undefined, 'keys are never shown');

  const abu = (await call('/convoy/join', { id: lead.id, name: 'Abu', pos: { ...POS, lng: 101.71 } })).body;
  assert.equal(abu.members.length, 2);
  tick(5000);
  await call('/convoy/update', { id: lead.id, member: lead.member, key: lead.key, pos: { ...POS, lng: 101.73 }, remaining: 5000 });
  const seen = (await call('/convoy/update', { id: lead.id, member: abu.member, key: abu.key, pos: { ...POS, lng: 101.715 } })).body;
  const ali = seen.members.find((m) => m.name === 'Ali');
  assert.equal(ali.pos.lng, 101.73);
  assert.equal(ali.remaining, 5000);
  assert.equal(ali.key, undefined);
  assert.equal((await call('/convoy/update', { id: lead.id, member: abu.member, key: lead.key, pos: POS })).status, 404, 'only your own car');

  // Someone who hasn't been heard from in a while isn't drawn where they were.
  tick(MEMBER_STALE_MS + 1);
  const later = (await call('/convoy/update', { id: lead.id, member: abu.member, key: abu.key, pos: POS })).body;
  assert.equal(later.members.find((m) => m.name === 'Ali').pos, null);

  await call('/convoy/leave', { id: lead.id, member: abu.member, key: abu.key });
  assert.deepEqual((await call(`/convoy?id=${lead.id}`)).body.members.map((m) => m.name), ['Ali']);
  tick(CONVOY_MS + 1);
  assert.equal((await call(`/convoy?id=${lead.id}`)).status, 404);
  assert.equal((await call('/convoy/join', { id: lead.id, name: 'Late' })).status, 404);
});

test('a convoy has room for a dozen cars', async () => {
  const { call } = hub();
  const lead = (await call('/convoy/start', { name: 'Ali', dest: DEST, pos: POS })).body;
  for (let i = 1; i < CONVOY_MAX; i++) assert.equal((await call('/convoy/join', { id: lead.id, name: `Kawan ${i}` })).status, 200);
  assert.equal((await call('/convoy/join', { id: lead.id, name: 'One too many' })).status, 409);
});

test('morning alerts: due once, at the chosen local time, on the chosen days', () => {
  const at = (iso) => Date.parse(iso);
  assert.deepEqual(localNow(at('2026-11-08T23:30:00Z')), { day: '2026-11-09', weekday: 1, minutes: 450 });
  const c = { time: '07:30', days: '[1,2,3,4,5]', sent_day: null };
  assert.equal(commuteDue(c, at('2026-11-08T23:29:00Z')), false, '7:29');
  assert.equal(commuteDue(c, at('2026-11-08T23:30:00Z')), true, '7:30 on Monday');
  assert.equal(commuteDue(c, at('2026-11-08T23:44:00Z')), true, 'still due at 7:44');
  assert.equal(commuteDue(c, at('2026-11-08T23:45:00Z')), false, 'too late at 7:45');
  assert.equal(commuteDue({ ...c, sent_day: '2026-11-09' }, at('2026-11-08T23:35:00Z')), false, 'already sent today');
  assert.equal(commuteDue(c, at('2026-11-07T23:30:00Z')), false, 'Sunday');
});

test('morning alerts: what the message says', () => {
  const now = Date.parse('2026-11-09T00:00:00Z');
  const slow = commuteMessage({ travel: 2700, usual: 1800 }, now, 'ms');
  assert.equal(slow.title, 'Ke tempat kerja: 45 min');
  assert.match(slow.body, /^15 min lebih lama daripada biasa\. Bertolak sekarang, sampai lebih kurang 8:45 pg\.$/);
  assert.equal(slow.slow, true);
  assert.equal(slow.url, './?go=work');
  assert.match(commuteMessage({ travel: 1800, usual: 1850 }, now, 'en').body, /^About as usual\. .*8:30 am\.$/);
  assert.match(commuteMessage({ travel: 1200, usual: 1800 }, now, 'ms').body, /^Lebih lancar/);
  assert.equal(commuteMessage({ travel: 4000, usual: null }, now, 'en').title, 'To work: 1 hr 7 min');
});

test('notifications only ever go to real push services', () => {
  assert.ok(cleanSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }));
  assert.ok(cleanSubscription({ endpoint: 'https://web.push.apple.com/QGd' }));
  assert.ok(cleanSubscription({ endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/x' }));
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.example/x', 'https://fcm.googleapis.com:8443/x', 'https://u:p@fcm.googleapis.com/x', 'not a url']) {
    assert.equal(cleanSubscription({ endpoint: bad }), null, bad);
  }
});

test('the notification key is made once, kept, and signs in the way push services expect', async () => {
  let kept = null;
  const a = await vapidKeys(() => kept, (v) => { kept = v; });
  const b = await vapidKeys(() => kept, () => assert.fail('made again'));
  assert.equal(a.public, b.public);
  assert.equal(Buffer.from(a.public, 'base64url').length, 65, 'an uncompressed P-256 key');
  const header = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', b, Date.parse('2026-11-09T00:00:00Z'));
  const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, a.public);
  const [h, c, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.match(claims.sub, /^https:\/\//, 'a web address, never an email');
  const pub = await crypto.subtle.importKey('raw', Buffer.from(a.public, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${h}.${c}`)));
});

const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/phone-1' };
const HOME = { lng: 101.6, lat: 3.05 };
const WORK = { lng: 101.71, lat: 3.15 };

test('morning alerts: set, sent once on the morning, read by the phone, and switched off', async () => {
  const { call, pushes, fetched, tick } = hub({ env: { TOMTOM_API_KEY: 'k' } });
  assert.equal((await call('/commute/set', { sub: { endpoint: 'https://evil.example/x' }, home: HOME, work: WORK, time: '08:00', days: [1] })).status, 400);
  assert.equal((await call('/commute/set', { sub: SUB, home: HOME, work: HOME, time: '08:00', days: [1] })).status, 400, 'home is work');
  assert.equal((await call('/commute/set', { sub: SUB, home: HOME, work: WORK, time: '8am', days: [1] })).status, 400);
  const set = await call('/commute/set', { sub: SUB, home: HOME, work: WORK, time: '08:00', days: [1, 2, 3, 4, 5], lang: 'ms' });
  assert.equal(set.status, 200);
  const { id, key } = set.body;

  // 8:00 on Monday morning in Malaysia.
  assert.deepEqual(await (await call('/cron')).body, { due: 1, sent: 1 });
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].url, SUB.endpoint);
  assert.match(pushes[0].init.headers.Authorization, /^vapid t=.+, k=.+$/);
  assert.ok(fetched[0].includes('/calculateRoute/3.05000,101.60000:3.15000,101.71000/json?'), fetched[0]);
  assert.ok(!fetched[0].includes('ashraviin'), 'nothing about anyone goes to TomTom');
  const message = await call('/commute/message', SUB);
  assert.equal(message.body.title, 'Ke tempat kerja: 45 min');
  assert.equal((await call('/commute/message', { endpoint: 'https://fcm.googleapis.com/fcm/send/other' })).status, 404);

  tick(5 * 60e3);
  assert.deepEqual((await call('/cron')).body, { due: 0, sent: 0 }, 'once a morning');

  // A test whenever asked, a few times a day.
  for (let i = 0; i < TESTS_PER_DAY; i++) assert.equal((await call('/commute/test', { id, key })).status, 200);
  assert.equal((await call('/commute/test', { id, key })).status, 429);
  assert.equal((await call('/commute/test', { id, key: 'x'.repeat(22) })).status, 404);

  await call('/commute/off', { id, key });
  assert.equal((await call('/commute/test', { id, key })).status, 404);
});

test('morning alerts: "only when it\'s slow" stays quiet on a normal day; a phone that unsubscribed is forgotten', async () => {
  let travel = 1800;
  const pushed = [];
  let pushStatus = 201;
  const fetchImpl = async (url) => {
    if (String(url).startsWith('https://api.tomtom.com/')) return new Response(JSON.stringify({ routes: [{ summary: { travelTimeInSeconds: travel, historicTrafficTravelTimeInSeconds: 1800 } }] }));
    pushed.push(url);
    return new Response(null, { status: pushStatus });
  };
  const { call, tick } = hub({ env: { TOMTOM_API_KEY: 'k' }, fetchImpl });
  await call('/commute/set', { sub: SUB, home: HOME, work: WORK, time: '08:00', days: [0, 1, 2, 3, 4, 5, 6], slowOnly: true });
  assert.deepEqual((await call('/cron')).body, { due: 1, sent: 0 });
  assert.equal(pushed.length, 0);
  tick(86400e3);
  travel = 3000;
  pushStatus = 410;
  await call('/cron');
  assert.equal(pushed.length, 1);
  tick(86400e3);
  assert.deepEqual((await call('/cron')).body, { due: 0, sent: 0 }, 'forgotten');
});

test('morning alerts: one browser has one alert; setting it again replaces it', async () => {
  const { call, h } = hub({ env: { TOMTOM_API_KEY: 'k' } });
  const a = (await call('/commute/set', { sub: SUB, home: HOME, work: WORK, time: '08:00', days: [1] })).body;
  const b = (await call('/commute/set', { sub: SUB, home: HOME, work: WORK, time: '07:00', days: [1] })).body;
  assert.notEqual(a.id, b.id);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM commuters')[0].n, 1);
  const c = (await call('/commute/set', { id: b.id, key: b.key, sub: SUB, home: HOME, work: WORK, time: '06:45', days: [1] })).body;
  assert.equal(c.id, b.id, 'changing your own keeps it');
  assert.equal(h.rows('SELECT time FROM commuters')[0].time, '06:45');
});

test('without a traffic key, a test alert says so', async () => {
  const { call } = hub();
  const { id, key } = (await call('/commute/set', { sub: SUB, home: HOME, work: WORK, time: '08:00', days: [1] })).body;
  const r = await call('/commute/test', { id, key });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'no traffic key');
});

test('the hourly tidy removes what is over', async () => {
  const { call, h, tick } = hub();
  await call('/share/start', { name: 'A', dest: DEST, pos: POS });
  await call('/reports/add', { kind: 'jam', lng: 101.7, lat: 3.15, device: DEVICE });
  const c = (await call('/convoy/start', { name: 'A', dest: DEST, pos: POS })).body;
  await call('/convoy/join', { id: c.id, name: 'B' });
  tick(14 * 3600e3);
  await call('/cron');
  for (const table of ['shares', 'reports', 'convoys', 'members']) {
    assert.equal(h.rows(`SELECT COUNT(*) AS n FROM ${table}`)[0].n, 0, table);
  }
});

test('nonsense is turned away', async () => {
  const { h } = hub();
  const res = await h.fetch(new Request('https://hub/share/start', { method: 'POST', body: 'not json' }));
  assert.equal(res.status, 400);
  assert.equal((await h.fetch(new Request('https://hub/nothing'))).status, 404);
});
