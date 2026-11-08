// Sharing a trip and driving together, against the real hub on an in-memory database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hub } from '../server/hub.js';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.location = { origin: 'https://ashraviinrajthinagaraj.github.io', pathname: '/pintu/' };
const { CONFIG } = await import('../js/config.js');
const { Convoy, SHARE_EVERY_MS, TripShare, convoyOrder, watchTrip } = await import('../js/together.js');
const { deviceCode } = await import('../js/hub.js');
const { keyBytes } = await import('../js/commute.js');

function useHub() {
  const db = new DatabaseSync(':memory:');
  const sql = {
    exec(q, ...args) {
      if (!args.length && q.trim().split(';').filter((x) => x.trim()).length > 1) { db.exec(q); return []; }
      const st = db.prepare(q);
      if (/^\s*SELECT/i.test(q)) return st.all(...args).map((r) => ({ ...r }));
      st.run(...args);
      return [];
    },
  };
  const hub = new Hub({ storage: { sql } }, {});
  const sent = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    assert.equal(u.origin, CONFIG.server, 'only ever Pintu\'s server');
    if (init.method === 'POST') assert.match(init.headers['content-type'], /^text\/plain/, 'plain text, so no preflight');
    sent.push({ path: u.pathname, body: init.body ? JSON.parse(init.body) : null });
    return hub.fetch(new Request(`https://hub${u.pathname}${u.search}`, { method: init.method || 'GET', body: init.body }));
  };
  return { hub, sent };
}

const FIX = { lng: 101.7, lat: 3.15, heading: 90, speed: 10, accuracy: 5 };
const DEST = { name: 'Rumah Mak', lng: 101.75, lat: 3.2, detail: 'not sent' };

test('a trip share: started, sent at most every 15 seconds, picked up after a restart, and ended', async () => {
  store.clear();
  const { sent } = useHub();
  const t0 = 1e12;
  const share = await new TripShare().start({ name: 'Ali', dest: DEST, fix: FIX, eta: Date.now() + 6e5, remaining: 5000 }, t0);
  assert.match(share.link, /^https:\/\/ashraviinrajthinagaraj\.github\.io\/pintu\/\?watch=[a-z2-9]{10}$/);
  assert.deepEqual(sent[0].body.dest, { name: 'Rumah Mak', lng: 101.75, lat: 3.2 }, 'only the name and place');
  assert.equal(sent[0].body.pos.accuracy, undefined);
  assert.equal(share.due(t0 + SHARE_EVERY_MS - 1), false);
  assert.equal(share.due(t0 + SHARE_EVERY_MS), true);
  await share.send({ fix: { ...FIX, lng: 101.71 }, eta: Date.now() + 5e5, remaining: 4000 }, t0 + SHARE_EVERY_MS);
  const seen = await watchTrip(share.id);
  assert.equal(seen.pos.lng, 101.71);
  assert.equal(seen.remaining, 4000);

  const again = TripShare.resume(t0 + 60e3);
  assert.equal(again.id, share.id, 'kept through a restart');
  assert.equal(TripShare.resume(t0 + 13 * 3600e3), null, 'but not for ever');
  await again.end(true);
  assert.equal(TripShare.resume(t0 + 60e3), null);
  assert.equal((await watchTrip(share.id)).arrived, true);
});

test('a convoy: started, joined, each hears the other, and left', async () => {
  store.clear();
  useHub();
  const ali = await Convoy.start({ name: 'Ali', dest: DEST, fix: FIX });
  assert.match(ali.link, /\?convoy=[a-z2-9]{10}$/);
  const peek = await Convoy.peek(ali.id);
  assert.deepEqual(peek.members.map((m) => m.name), ['Ali']);
  store.clear();
  const abu = await Convoy.join(ali.id, { name: 'Abu', fix: { ...FIX, lng: 101.69 } });
  assert.equal(Convoy.resume().member, abu.member, 'remembered on this phone');
  await ali.send({ fix: FIX, remaining: 3000 }, 1);
  await abu.send({ fix: { ...FIX, lng: 101.69 }, remaining: 3500 }, 1);
  assert.deepEqual(abu.others.map((m) => m.name), ['Ali']);
  const order = convoyOrder(abu.members, abu.member, 3500);
  assert.equal(order[0].name, 'Ali');
  assert.equal(order[0].gap, 500, 'Ali is half a kilometre ahead');
  await abu.leave();
  assert.equal(Convoy.resume(), null);
  await ali.send({ fix: FIX }, 2);
  assert.deepEqual(ali.others, []);
});

test('this phone\'s code is random, kept, and the right shape', () => {
  store.clear();
  const a = deviceCode();
  assert.match(a, /^[a-z2-9]{16}$/);
  assert.equal(deviceCode(), a);
});

test('the server\'s notification key turns into the bytes a browser wants', () => {
  const bytes = keyBytes('BJ2kwp0PRo_bVu5GaWWpNa5cmTypcYdD');
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes.length, 24);
  assert.equal(bytes[0], 0x04, 'an uncompressed point starts with 4');
});
