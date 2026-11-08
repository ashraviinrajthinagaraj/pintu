// The server passing shared trips, reports, convoys and alerts on to the hub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker, { Hub } from '../server/worker.js';
import { forgetCounts, PER_MINUTE } from '../server/tomtom.js';

const PINTU = 'https://ashraviinrajthinagaraj.github.io';
const HOME = 'https://pintu.example.workers.dev';

function fakeHubBinding() {
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
  const asked = [];
  let hub = null;
  return {
    asked,
    idFromName: (name) => { asked.push(`id:${name}`); return name; },
    get: () => ({
      fetch: (req) => {
        asked.push(new URL(req.url).pathname);
        hub ||= new Hub({ storage: { sql } }, {});
        return hub.fetch(req);
      },
    }),
  };
}

const ask = (env, path, { method = 'GET', body, origin = PINTU, ip = '1.2.3.4' } = {}) => worker.fetch(new Request(`${HOME}${path}`, {
  method,
  headers: { ...(origin ? { origin } : {}), 'cf-connecting-ip': ip, ...(body ? { 'content-type': 'text/plain;charset=UTF-8' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}), env, { waitUntil() {} });

test('shares a trip through the hub, for Pintu\'s page only', async () => {
  forgetCounts();
  const HUB = fakeHubBinding();
  const env = { HUB };
  const start = await ask(env, '/share/start', { method: 'POST', body: { name: 'Ali', dest: { name: 'Rumah', lng: 101.7, lat: 3.1 }, pos: { lng: 101.6, lat: 3.0 } } });
  assert.equal(start.status, 200);
  assert.equal(start.headers.get('access-control-allow-origin'), PINTU);
  assert.equal(start.headers.get('cache-control'), 'no-store');
  const { id } = await start.json();
  const seen = await ask(env, `/share?id=${id}`);
  assert.equal((await seen.json()).name, 'Ali');
  assert.ok(HUB.asked.includes('id:pintu'), 'always the one hub');

  assert.equal((await ask(env, `/share?id=${id}`, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await ask(env, '/share/start')).status, 405, 'a GET to a POST');
  assert.equal((await ask(env, `/share?id=${id}`, { method: 'POST', body: {} })).status, 405, 'a POST to a GET');
});

test('says so when the hub isn\'t set up, and turns away floods and huge bodies', async () => {
  forgetCounts();
  assert.equal((await ask({}, '/reports?bbox=1,1,2,2')).status, 503);
  const env = { HUB: fakeHubBinding() };
  const big = await ask(env, '/reports/add', { method: 'POST', body: { kind: 'police', note: 'x'.repeat(30000) } });
  assert.equal(big.status, 413);
  forgetCounts();
  let last;
  for (let i = 0; i <= PER_MINUTE.hub; i++) last = await ask(env, '/reports?bbox=101,3,102,4', { ip: '9.9.9.9' });
  assert.equal(last.status, 429);
  assert.equal((await ask(env, '/reports?bbox=101,3,102,4', { ip: '8.8.8.8' })).status, 200, 'others carry on');
});

test('every five minutes, the hub sends what\'s due and tidies up', async () => {
  const HUB = fakeHubBinding();
  const waits = [];
  await worker.scheduled({}, { HUB }, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.ok(HUB.asked.includes('/cron'));
  await worker.scheduled({}, {}, { waitUntil: () => assert.fail('no hub, nothing to do') });
});
