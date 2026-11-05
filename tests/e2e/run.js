// Full-app checks: drives Pintu in a real browser against stand-in map, search
// and routing services, with a scripted GPS.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { altTrip, buildTrip, cityTrip, P } from '../helpers/fixtures.js';
import { decodePolyline, cumulative, bearing } from '../../js/geo.js';

const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium, devices } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shots = process.env.SHOTS || path.join(root, 'tests/e2e/shots');
await (await import('node:fs/promises')).mkdir(shots, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const body = await readFile(path.join(root, p));
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}/`;

const stub = await readFile(path.join(root, 'tests/e2e/stub-maplibre.js'), 'utf8');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

const PHOTON = {
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: P.d }, properties: { name: 'Suria KLCC', street: 'Jalan Ampang', city: 'Kuala Lumpur', state: 'Wilayah Persekutuan Kuala Lumpur', countrycode: 'MY' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [101.71, 3.14] }, properties: { name: 'KLCC Park <b>x</b>', city: 'Kuala Lumpur', countrycode: 'MY' } },
  ],
};

async function newApp(browser, { viewport = { width: 390, height: 844 }, stadia = 401, voices = [{ lang: 'ms-MY', name: 'Malay' }, { lang: 'en-GB', name: 'British' }], routeResponse, storage, mapFail, sw = 'block', scale = 1, locale = 'ms-MY' } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, hasTouch: true, serviceWorkers: sw, locale, timezoneId: 'Asia/Kuala_Lumpur' });
  const log = { stadia: 0, fossgis: [], photon: [], errors: [], external: new Set() };
  ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const url = route.request().url();
    const host = new URL(url).hostname;
    log.external.add(host);
    if (/maplibre-gl\.js$/.test(url)) {
      if (mapFail) return route.abort();
      return route.fulfill({ contentType: 'text/javascript', headers: CORS, body: stub });
    }
    if (/maplibre-gl\.css$/.test(url)) return route.fulfill({ contentType: 'text/css', headers: CORS, body: '' });
    if (host.includes('fonts.')) return route.fulfill({ contentType: 'text/css', headers: CORS, body: '' });
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (host === 'api.stadiamaps.com') {
      log.stadia++;
      if (stadia === 'ok') return route.fulfill({ json: await currentRoutes(log, url, route), headers: CORS });
      return route.fulfill({ status: stadia, json: { error: 'unauthorized' }, headers: CORS });
    }
    if (host === 'valhalla1.openstreetmap.de') {
      const body = JSON.parse(new URL(url).searchParams.get('json'));
      log.fossgis.push(body);
      if (log.routeFail) return route.abort();
      const fn = routeResponse || ((b) => ({ trip: cityTrip(), alternates: b.alternates ? [{ trip: altTrip() }] : [] }));
      return route.fulfill({ json: fn(body, log.fossgis.length), headers: CORS });
    }
    if (host === 'photon.komoot.io') {
      log.photon.push(url);
      if (log.searchFail) return route.abort();
      const q = new URL(url).searchParams.get('q');
      if (url.includes('/reverse')) return route.fulfill({ json: { features: [PHOTON.features[0]] }, headers: CORS });
      return route.fulfill({ json: q === 'zzzz' ? { features: [] } : PHOTON, headers: CORS });
    }
    return route.abort();
  });
  async function currentRoutes() { return { trip: cityTrip(), alternates: [{ trip: altTrip() }] }; }

  await ctx.addInitScript(({ voices, storage }) => {
    // A GPS the test can steer, with exact timestamps.
    const gps = { cb: null, err: null, watches: 0, starts: 0 };
    window.__gps = gps;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition(cb, err) { gps.cb = cb; gps.err = err; gps.starts++; if (gps.last) setTimeout(() => cb(gps.last)); return ++gps.watches; },
      clearWatch() { gps.cb = null; },
      getCurrentPosition() {},
    } });
    gps.push = (lng, lat, o = {}) => {
      gps.last = { coords: { longitude: lng, latitude: lat, accuracy: o.accuracy ?? 10, speed: o.speed ?? null, heading: o.heading ?? null }, timestamp: o.time ?? Date.now() };
      gps.cb?.(gps.last);
    };
    gps.deny = () => gps.err?.({ code: 1 });

    // Voices the test chooses, and a record of everything said.
    window.__said = [];
    const vs = voices.map((v) => ({ ...v }));
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => vs,
      cancel() {},
      speak(u) { if (u.text.trim()) window.__said.push({ text: u.text, lang: u.lang, voice: u.voice?.name }); },
      addEventListener() {},
    } });

    window.__wake = { requests: 0, released: 0 };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
      request: async () => { window.__wake.requests++; return { release() { window.__wake.released++; }, addEventListener() {} }; },
    } });
    if (storage) for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, { voices, storage: storage || null });

  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) log.errors.push(`console: ${m.text()}`); });
  await page.goto(ORIGIN);
  await page.waitForFunction(() => window.__map?.ready || document.querySelector('#map-problem:not([hidden])'));
  return { ctx, page, log };
}

const vis = (page, sel) => page.locator(sel).isVisible();
const text = (page, sel) => page.locator(sel).innerText();
const said = (page) => page.evaluate(() => window.__said);

async function noOverflow(page, name) {
  const over = await page.evaluate(() => {
    const out = [];
    const W = innerWidth;
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('#map')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > W + 1 || r.left < -1)) out.push(`${el.tagName}#${el.id}.${el.className}`);
    }
    return [out.slice(0, 5), document.documentElement.scrollWidth > W];
  });
  assert.deepEqual(over[0], [], `${name}: elements outside the screen`);
  assert.equal(over[1], false, `${name}: page scrolls sideways`);
}

async function smallTargets(page, name, sels) {
  for (const sel of sels) {
    const box = await page.locator(sel).first().boundingBox();
    assert.ok(box && box.height >= 44 && box.width >= 44, `${name}: ${sel} is too small: ${JSON.stringify(box)}`);
  }
}

// Runs the fix along a prepared route at a steady speed, with exact timestamps.
async function driveTo(page, trip, { from = 0, to, kph = 40, t0 } = {}) {
  const coords = decodePolyline(trip.legs[0].shape);
  const cum = cumulative(coords);
  const v = kph / 3.6;
  const end = to ?? cum[cum.length - 1] + 1;
  const pts = [];
  let time = t0 ?? Date.now();
  for (let s = from; s <= end; s += v) {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] <= s) i++;
    const f = Math.min(1, (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1));
    pts.push([coords[i][0] + (coords[i + 1][0] - coords[i][0]) * f, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * f, bearing(coords[i], coords[i + 1]), time]);
    time += 1000;
  }
  await page.evaluate(({ pts, v }) => {
    for (const [lng, lat, heading, time] of pts) window.__gps.push(lng, lat, { speed: v, heading, time });
  }, { pts, v });
  return time;
}

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log(`ok   ${name}`); }
  catch (e) { results.push(['FAIL', name, e.message]); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`); }
}

async function toPreview(page) {
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat, { accuracy: 10 }), P.a);
  await page.click('#where');
  await page.fill('#search-input', 'klcc');
  await page.waitForSelector('#search-results .place');
  await page.locator('#search-results .place').first().click();
  await page.waitForSelector('.route-opt');
}

async function toNav(page, { simulate = false } = {}) {
  await toPreview(page);
  await page.click(simulate ? '#try-sim' : '#start');
  if (await page.locator('#safety').isVisible()) await page.click('#safety-ok');
  await page.waitForSelector('#nav-bar');
}

const browser = await chromium.launch();
const quiet = { storage: { 'pintu.safetySeen': 'true' } };

await check('opens to the idle sign with no errors, and asks for nothing yet', async () => {
  const { ctx, page, log } = await newApp(browser, { scale: 2 });
  assert.equal(await text(page, '#where-text'), 'Nak ke mana?');
  assert.equal(await page.evaluate(() => window.__gps.starts), 0, 'location must wait for a tap');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'ms');
  await noOverflow(page, 'idle');
  await smallTargets(page, 'idle', ['#where', '#btn-settings', '#btn-locate']);
  await page.screenshot({ path: `${shots}/1-idle.png` });
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('search: results, safe text, Malaysia region, near you', async () => {
  const { ctx, page, log } = await newApp(browser, { scale: 2 });
  await page.evaluate(([lng, lat]) => { window.__gps.last = null; }, P.a);
  await page.click('#where');
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat), P.a);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'search-input');
  await page.fill('#search-input', 'k');
  await page.waitForTimeout(450);
  assert.equal(log.photon.length, 0, 'one letter does not search');
  await page.fill('#search-input', 'klcc');
  await page.waitForSelector('#search-results .place');
  const url = new URL(log.photon.at(-1));
  assert.equal(url.searchParams.get('bbox'), '99.6,0.85,119.3,7.4');
  assert.equal(url.searchParams.get('lat'), '3.1500');
  assert.equal(await page.locator('#search-results b').count(), 0, 'place names are never treated as HTML');
  assert.match(await page.locator('#search-results .place').nth(1).innerText(), /<b>x<\/b>/);
  await noOverflow(page, 'search');
  await page.screenshot({ path: `${shots}/2-search.png` });
  await page.fill('#search-input', 'zzzz');
  await page.waitForFunction(() => /Tiada hasil/.test(document.getElementById('search-status').textContent));
  log.searchFail = true;
  await page.fill('#search-input', 'gagal');
  await page.waitForFunction(() => /Carian tak dapat/.test(document.getElementById('search-status').textContent));
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('debounced typing sends one search, not one per letter', async () => {
  const { ctx, page, log } = await newApp(browser);
  await page.click('#where');
  await page.locator('#search-input').pressSequentially('suria klcc', { delay: 40 });
  await page.waitForSelector('#search-results .place');
  await page.waitForTimeout(450);
  assert.equal(log.photon.length, 1, `searches sent: ${log.photon.length}`);
  await ctx.close();
});

await check('route preview: two routes, toll tag, falls back past the unregistered service', async () => {
  const { ctx, page, log } = await newApp(browser, { scale: 2 });
  await toPreview(page);
  assert.equal(await page.locator('.route-opt').count(), 2);
  assert.equal(log.stadia, 1);
  assert.equal(log.fossgis.length, 1);
  assert.equal(log.fossgis[0].costing, 'auto');
  assert.equal(log.fossgis[0].alternates, 2);
  assert.equal(await text(page, '#dest-name'), 'Suria KLCC');
  assert.match(await page.locator('.route-opt').nth(1).innerText(), /Tol/);
  assert.doesNotMatch(await page.locator('.route-opt').nth(0).innerText(), /Tol/);
  assert.match(await text(page, '#route-note'), /tanpa trafik/);
  await noOverflow(page, 'preview');
  await smallTargets(page, 'preview', ['#start', '#preview-back', '#mode-car', '.route-opt']);
  const fit = await page.evaluate(() => window.__mapCalls.filter((c) => c[0] === 'fitBounds').at(-1));
  assert.ok(fit[2].padding.bottom > 300, 'the route is framed clear of the sheet');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/3-preview.png` });
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('choosing another route, avoiding tolls, motorcycle mode', async () => {
  const { ctx, page, log } = await newApp(browser);
  await toPreview(page);
  await page.locator('.route-opt').nth(1).click();
  assert.equal(await page.locator('.route-opt').nth(1).getAttribute('aria-checked'), 'true');
  const before = log.fossgis.length;
  await page.click('.switch');
  await page.waitForFunction((n) => document.querySelectorAll('.route-opt').length === 2, before);
  await page.waitForTimeout(1400);
  assert.equal(log.fossgis.at(-1).costing_options.auto.use_tolls, 0);
  await page.click('#mode-moto');
  await page.waitForTimeout(1600);
  assert.equal(log.fossgis.at(-1).costing, 'motorcycle');
  assert.equal(log.fossgis.at(-1).costing_options, undefined);
  assert.equal(await vis(page, '#toll-wrap'), false, 'no toll switch for motorcycles');
  await page.waitForSelector('.route-opt');
  assert.doesNotMatch(await page.locator('#route-list').innerText(), /Tol/);
  await ctx.close();
});

await check('no location permission explains how to fix it', async () => {
  const { ctx, page } = await newApp(browser);
  await page.click('#where');
  await page.fill('#search-input', 'klcc');
  await page.waitForSelector('#search-results .place');
  await page.locator('#search-results .place').first().click();
  await page.evaluate(() => window.__gps.deny());
  await page.waitForFunction(() => /perlukan lokasi/.test(document.getElementById('route-status').textContent));
  assert.equal(await page.locator('#start').isDisabled(), true);
  await ctx.close();
});

await check('routing failure gives a clear message and retry works', async () => {
  const { ctx, page, log } = await newApp(browser);
  log.routeFail = true;
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat), P.a);
  await page.click('#where');
  await page.fill('#search-input', 'klcc');
  await page.waitForSelector('#search-results .place');
  await page.locator('#search-results .place').first().click();
  await page.waitForFunction(() => /Laluan tak dapat/.test(document.getElementById('route-status').textContent));
  assert.equal(await page.locator('#start').isDisabled(), true);
  log.routeFail = false;
  await page.locator('#route-status button').click();
  await page.waitForSelector('.route-opt');
  assert.equal(await page.locator('#start').isDisabled(), false);
  await ctx.close();
});

await check('no road to the destination is explained', async () => {
  const { ctx, page } = await newApp(browser, {
    routeResponse: () => { throw new Error('unused'); },
  });
  await page.route(/valhalla1/, (r) => r.fulfill({ status: 400, json: { error_code: 442, error: 'No path could be found' }, headers: CORS }));
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat), P.a);
  await page.click('#where');
  await page.fill('#search-input', 'klcc');
  await page.waitForSelector('#search-results .place');
  await page.locator('#search-results .place').first().click();
  await page.waitForFunction(() => /Tiada laluan jalan raya/.test(document.getElementById('route-status').textContent));
  await ctx.close();
});

await check('first trip shows the safety note once, and voice speaks Malay in order', async () => {
  const { ctx, page, log } = await newApp(browser, { scale: 2 });
  await toPreview(page);
  await page.click('#start');
  assert.equal(await vis(page, '#safety'), true);
  assert.equal(await vis(page, '#nav-bar'), false);
  await noOverflow(page, 'safety');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/4-safety.png` });
  await page.click('#safety-ok');
  await page.waitForSelector('#nav-bar');
  assert.equal(await page.evaluate(() => localStorage.getItem('pintu.safetySeen')), 'true');
  assert.equal(await page.evaluate(() => window.__wake.requests), 1, 'screen stays on');
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pintu.trip')).dest.name === 'Suria KLCC'));

  const trip = cityTrip();
  const t = await driveTo(page, trip, { to: 900 });
  await noOverflow(page, 'nav');
  await smallTargets(page, 'nav', ['#btn-end', '#btn-mute', '#sign']);
  await page.waitForTimeout(100);
  assert.match(await text(page, '#sign-action'), /Belok kanan/);
  assert.match(await text(page, '#sign-road'), /Jalan Tun Razak/);
  assert.match(await text(page, '#sign-distance'), /^\d+ m$/);
  assert.equal(await page.locator('#sign').evaluate((e) => e.classList.contains('blue')), true, 'blue on ordinary roads');
  assert.match(await text(page, '#eta-clock'), /^\d+ min$/);
  assert.match(await text(page, '#eta-rest'), /^[\d.]+ k?m, sampai \d+:\d\d (PG|PTG)$/);
  await page.screenshot({ path: `${shots}/5-nav-day.png` });

  await driveTo(page, trip, { from: 900, t0: t });
  await page.waitForSelector('#arrival:not([hidden])');
  await page.waitForTimeout(150);
  const words = (await said(page)).map((s) => s.text);
  assert.ok(words[0].startsWith('Terus sejauh'), words[0]);
  assert.ok(words.includes('Belok kanan ke Jalan Tun Razak.'), words.join(' | '));
  assert.ok(words.some((w) => w.startsWith('Dalam') && w.includes('belok kiri ke Jalan Pinang')), words.join(' | '));
  assert.equal(words.at(-1), 'Anda telah sampai.');
  assert.equal(new Set(words).size, words.length, 'nothing repeated');
  const first = (await said(page))[0];
  assert.equal(first.voice, 'Malay');
  assert.equal(first.lang, 'ms-MY');

  assert.equal(await text(page, '#arrival-title'), 'Dah sampai');
  assert.equal(await text(page, '#arrival-place'), 'Suria KLCC');
  assert.equal(await page.evaluate(() => localStorage.getItem('pintu.trip')), null, 'finished trip is forgotten');
  assert.equal(await page.evaluate(() => window.__wake.released), 1, 'screen can sleep again');
  await page.waitForTimeout(1700);
  await noOverflow(page, 'arrival');
  await page.screenshot({ path: `${shots}/7-arrival.png` });
  await page.click('#arrival-done');
  assert.equal(await vis(page, '#where'), true);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('toll expressway turns the sign green with its road number', async () => {
  const hw = buildTrip([101.5, 3.0], [
    { to: [101.53, 3.0], type: 1, street: 'Jalan Masuk', kph: 50 },
    { to: [101.6, 3.0], type: 25, street: ['E2', 'Lebuhraya Utara-Selatan'], kph: 110, toll: true, highway: true },
    { to: [101.61, 3.0], type: 20, street: 'Susur', kph: 60, toll: true, highway: true, sign: { exit_number_elements: [{ text: '223' }], exit_toward_elements: [{ text: 'Seremban' }] } },
  ], { has_toll: true });
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2, routeResponse: () => ({ trip: hw }) });
  await page.evaluate(() => window.__gps.push(101.5, 3.0));
  await page.click('#where');
  await page.fill('#search-input', 'klcc');
  await page.waitForSelector('#search-results .place');
  await page.locator('#search-results .place').first().click();
  await page.waitForSelector('.route-opt');
  await page.click('#start');
  await page.waitForSelector('#nav-bar');
  await driveTo(page, hw, { from: 0, to: 6000, kph: 100 });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#sign').evaluate((e) => e.classList.contains('blue')), false, 'green on expressway');
  assert.match(await text(page, '#sign-action'), /Keluar di susur 223/);
  assert.match(await text(page, '#sign-toward'), /Menuju Seremban/);
  await noOverflow(page, 'highway');
  await page.screenshot({ path: `${shots}/6-nav-highway.png` });
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('a wrong turn finds a new route, and keeps driving direction', async () => {
  const newTrip = buildTrip([101.704, 3.1525], [
    { to: [101.704, 3.1600], type: 1, street: 'Jalan Baru', kph: 40 },
    { to: P.d, type: 10, street: 'Jalan Pinang', kph: 40 },
  ]);
  const { ctx, page, log } = await newApp(browser, {
    ...quiet,
    routeResponse: (b, n) => (n === 1 ? { trip: cityTrip() } : { trip: newTrip }),
  });
  await toNav(page);
  const trip = cityTrip();
  let t = await driveTo(page, trip, { to: 440 });
  const before = log.fossgis.length;
  await page.evaluate(({ t }) => {
    for (let k = 1; k <= 12; k++) window.__gps.push(101.704, 3.15 + (k * 25) / 111000, { speed: 10, heading: 0, time: t + k * 1000 });
  }, { t });
  await page.waitForFunction(() => /laluan baharu/.test(document.getElementById('chips').textContent) || /Jalan Baru|Jalan Pinang/.test(document.getElementById('sign-road').textContent));
  await page.waitForFunction((n) => /Jalan Pinang/.test(document.getElementById('sign-road').textContent), before, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(({ t }) => window.__gps.push(101.704, 3.1530, { speed: 10, heading: 0, time: t + 14000 }), { t });
  await page.waitForTimeout(100);
  assert.equal(log.fossgis.length, before + 1, 'exactly one new route was requested');
  const req = log.fossgis.at(-1);
  assert.equal(req.locations[0].heading, 0);
  assert.equal(req.alternates, undefined);
  const words = (await said(page)).map((s) => s.text);
  assert.ok(words.includes('Mencari laluan baharu.'), words.join(' | '));
  assert.match(await text(page, '#sign-road'), /Jalan Pinang/);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('lost signal during a re-route keeps the trip going and keeps trying', async () => {
  const { ctx, page, log } = await newApp(browser, quiet);
  await toNav(page);
  const trip = cityTrip();
  const t = await driveTo(page, trip, { to: 440 });
  log.routeFail = true;
  await page.evaluate(({ t }) => {
    for (let k = 1; k <= 10; k++) window.__gps.push(101.704, 3.15 + (k * 25) / 111000, { speed: 10, heading: 0, time: t + k * 1000 });
  }, { t });
  await page.waitForFunction(() => /Masih mencuba/.test(document.getElementById('chips').textContent), null, { timeout: 45000 });
  assert.equal(await vis(page, '#nav-bar'), true);
  // Back on the road, the warning clears without a new route.
  await page.evaluate(({ t }) => window.__gps.push(101.7045, 3.15, { speed: 10, heading: 90, time: t + 12000 }), { t });
  await page.waitForTimeout(100);
  assert.doesNotMatch(await text(page, '#chips'), /Masih mencuba/);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('weak GPS is flagged', async () => {
  const { ctx, page } = await newApp(browser, quiet);
  await toNav(page);
  await page.evaluate(() => window.__gps.push(101.7, 3.15, { accuracy: 400, time: Date.now() }));
  await page.waitForFunction(() => /GPS lemah/.test(document.getElementById('chips').textContent));
  await ctx.close();
});

await check('losing GPS while moving is flagged, sitting at a light is not', async () => {
  for (const [speed, expected] of [[10, true], [0, false]]) {
    const { ctx, page } = await newApp(browser, quiet);
    await toNav(page);
    await page.evaluate((speed) => {
      window.__gps.push(101.7005, 3.15, { speed, heading: 90, time: Date.now() });
      const real = Date.now.bind(Date);
      Date.now = () => real() + 20000;
    }, speed);
    await page.waitForTimeout(5300);
    assert.equal(/Tiada isyarat GPS/.test(await text(page, '#chips')), expected, `speed ${speed}`);
    await ctx.close();
  }
});

await check('a second turn soon after shows on the sign', async () => {
  const quick = buildTrip(P.a, [
    { to: [101.7030, 3.15], type: 1, street: 'Jalan Satu', kph: 40 },
    { to: [101.7030, 3.1515], type: 10, street: 'Jalan Dua', kph: 30 },
    { to: [101.7060, 3.1515], type: 15, street: 'Jalan Tiga', kph: 40 },
  ]);
  const { ctx, page } = await newApp(browser, { ...quiet, scale: 2, routeResponse: () => ({ trip: quick }) });
  await toNav(page);
  await driveTo(page, quick, { to: 150 });
  await page.waitForTimeout(100);
  assert.equal(await vis(page, '#sign-then'), true);
  assert.match(await text(page, '#sign-then'), /Kemudian/);
  await page.screenshot({ path: `${shots}/5b-nav-then.png` });
  await ctx.close();
});

await check('ending takes two taps; a third party bump does not end the trip', async () => {
  const { ctx, page } = await newApp(browser, quiet);
  await toNav(page);
  await page.click('#btn-end');
  assert.equal(await vis(page, '#nav-bar'), true);
  assert.match(await text(page, '#btn-end'), /Tekan lagi/);
  await noOverflow(page, 'armed end');
  await page.waitForFunction(() => /^Tamat$/.test(document.getElementById('btn-end').textContent), null, { timeout: 5000 });
  await page.click('#btn-end');
  await page.click('#btn-end');
  assert.equal(await vis(page, '#where'), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('pintu.trip')), null);
  await ctx.close();
});

await check('phone back button: closes panels, never drops you out of a trip', async () => {
  const { ctx, page } = await newApp(browser, quiet);
  await page.click('#where');
  assert.equal(await vis(page, '#search'), true);
  await page.goBack();
  assert.equal(await vis(page, '#search'), false);
  assert.equal(await vis(page, '#where'), true);
  await toPreview(page);
  await page.goBack();
  assert.equal(await vis(page, '#preview'), false);
  assert.equal(await page.evaluate(() => window.__map.markers.length) <= 1, true, 'pin removed');
  await toNav(page);
  await page.goBack();
  await page.waitForTimeout(100);
  assert.equal(await vis(page, '#nav-bar'), true);
  assert.match(await text(page, '#toast'), /Tamat/);
  await ctx.close();
});

await check('an interrupted trip can be picked up after the app reopens', async () => {
  const { ctx, page, log } = await newApp(browser, quiet);
  await toNav(page);
  await driveTo(page, cityTrip(), { to: 300 });
  await page.reload();
  await page.waitForFunction(() => window.__map?.ready);
  assert.equal(await vis(page, '#resume'), true);
  assert.match(await text(page, '#resume-text'), /Sambung perjalanan ke Suria KLCC/);
  await noOverflow(page, 'resume');
  await page.screenshot({ path: `${shots}/8-resume.png` });
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat, { accuracy: 10 }), P.a);
  await page.click('#resume-yes');
  await page.waitForSelector('#nav-bar');
  assert.deepEqual(log.errors, []);
  await page.click('#btn-end');
  await page.click('#btn-end');
  await page.reload();
  await page.waitForFunction(() => window.__map?.ready);
  assert.equal(await vis(page, '#resume'), false);
  await ctx.close();
});

await check('an old interrupted trip is not offered', async () => {
  const { ctx, page } = await newApp(browser, { storage: { 'pintu.trip': { dest: { name: 'Lama', lng: 101, lat: 3 }, mode: 'car', at: Date.now() - 4 * 3600 * 1000 } } });
  assert.equal(await vis(page, '#resume'), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('pintu.trip')), null);
  await ctx.close();
});

await check('coming back to the app resumes guidance out loud', async () => {
  const { ctx, page } = await newApp(browser, quiet);
  await toNav(page);
  await driveTo(page, cityTrip(), { to: 300 });
  const startsBefore = await page.evaluate(() => window.__gps.starts);
  const wakesBefore = await page.evaluate(() => window.__wake.requests);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock?.install?.().catch?.(() => {});
  await page.evaluate(() => {
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + 60000;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__gps.starts), startsBefore + 1, 'GPS restarted');
  assert.equal(await page.evaluate(() => window.__wake.requests), wakesBefore + 1, 'screen lock taken again');
  assert.match(await text(page, '#toast'), /disambung semula/);
  const words = (await said(page)).map((s) => s.text);
  assert.match(words.at(-1), /belok kanan ke Jalan Tun Razak/);
  await ctx.close();
});

await check('mute silences guidance; the sign repeats on tap once back on', async () => {
  const { ctx, page } = await newApp(browser, quiet);
  await toNav(page);
  await page.click('#btn-mute');
  const n = (await said(page)).length;
  await driveTo(page, cityTrip(), { to: 1050 });
  await page.waitForTimeout(100);
  assert.equal((await said(page)).length, n, 'nothing said while muted');
  await page.click('#btn-mute');
  await page.click('#sign');
  await page.waitForTimeout(100);
  assert.equal((await said(page)).length, n + 1);
  await ctx.close();
});

await check('dragging the map stops following; recentre brings it back', async () => {
  const { ctx, page } = await newApp(browser, quiet);
  await toNav(page);
  await driveTo(page, cityTrip(), { to: 100 });
  assert.equal(await vis(page, '#btn-recenter'), false);
  await page.evaluate(() => window.__map._fire('dragstart', {}));
  assert.equal(await vis(page, '#btn-recenter'), true);
  const count = () => page.evaluate(() => window.__mapCalls.filter((c) => c[0] === 'easeTo').length);
  const n = await count();
  await driveTo(page, cityTrip(), { from: 100, to: 200 });
  assert.equal(await count(), n, 'map stays where you dragged it');
  await page.click('#btn-recenter');
  assert.equal(await vis(page, '#btn-recenter'), false);
  assert.equal(await count(), n + 1);
  await ctx.close();
});

await check('try without driving plays the whole trip and never saves it', async () => {
  const short = buildTrip(P.a, [
    { to: [101.7012, 3.15], type: 1, street: 'Jalan Satu', kph: 40 },
    { to: [101.7012, 3.1512], type: 15, street: 'Jalan Dua', kph: 40 },
  ]);
  const { ctx, page, log } = await newApp(browser, { ...quiet, routeResponse: () => ({ trip: short }) });
  await toPreview(page);
  await page.click('#try-sim');
  await page.waitForSelector('#nav-bar');
  assert.match(await text(page, '#chips'), /Simulasi/);
  assert.equal(await page.evaluate(() => localStorage.getItem('pintu.trip')), null);
  await page.waitForSelector('#arrival:not([hidden])', { timeout: 30000 });
  const words = (await said(page)).map((s) => s.text);
  assert.equal(words.at(-1), 'Anda telah sampai.');
  await page.click('#arrival-done');
  // You're put back where you really are.
  const pos = await page.evaluate(() => window.__map.markers[0].ll);
  assert.deepEqual(pos, P.a);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('English throughout, and the choice sticks', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2 });
  await page.click('#btn-settings');
  assert.equal(await vis(page, '#settings'), true);
  await noOverflow(page, 'settings');
  await page.screenshot({ path: `${shots}/9-settings.png` });
  await page.click('#lang-en');
  assert.equal(await text(page, '#settings-title'), 'Settings');
  await page.click('#voice-test');
  await page.waitForTimeout(80);
  assert.equal((await said(page)).at(-1).text, 'In 300 metres, turn left onto Jalan Ampang.');
  assert.equal((await said(page)).at(-1).voice, 'British');
  await page.click('#settings-back');
  assert.equal(await text(page, '#where-text'), 'Where to?');
  await toNav(page);
  await page.waitForTimeout(50);
  assert.match((await said(page)).at(-1).text, /^Continue for .*then turn right onto Jalan Tun Razak\.$/);
  assert.match(await text(page, '#sign-action'), /Turn right/);
  assert.match(await text(page, '#eta-rest'), /, arrive \d/);
  await page.reload();
  await page.waitForFunction(() => window.__map?.ready);
  assert.equal(await text(page, '#where-text'), 'Where to?');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('voice status is honest about what the phone has', async () => {
  for (const [voices, expected, sayer] of [
    [[{ lang: 'ms_MY', name: 'Malay' }], /ada suara Bahasa Melayu/, 'Malay'],
    [[{ lang: 'id-ID', name: 'Indonesian' }, { lang: 'en-US', name: 'US' }], /guna suara Indonesia/, 'Indonesian'],
    [[{ lang: 'en-US', name: 'US' }], /tiada suara Bahasa Melayu\. Bunyinya/, undefined],
  ]) {
    const { ctx, page } = await newApp(browser, { voices });
    await page.click('#btn-settings');
    assert.match(await text(page, '#voice-status'), expected);
    await page.click('#voice-test');
    await page.waitForTimeout(80);
    assert.equal((await said(page)).at(-1).voice, sayer);
    await ctx.close();
  }
});

await check('night colours, by clock and by choice', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2 });
  await page.click('#btn-settings');
  await page.click('#theme-night');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'night');
  assert.equal(await page.evaluate(() => window.__map.styleUrl), 'https://tiles.openfreemap.org/styles/dark');
  assert.deepEqual(await page.evaluate(() => window.__mapCalls.find((c) => c[0] === 'setStyle')[2]), { diff: false });
  await page.screenshot({ path: `${shots}/10-settings-night.png` });
  await page.click('#settings-back');
  await page.waitForTimeout(50);
  await toNav(page);
  await driveTo(page, cityTrip(), { to: 900 });
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${shots}/11-nav-night.png` });
  assert.ok(await page.evaluate(() => window.__map.layers.length === 5), 'route layers survive the style change');
  assert.deepEqual(log.errors, []);
  await ctx.close();

  // The clock decides on "auto".
  const c2 = await browser.newContext({ timezoneId: 'Asia/Kuala_Lumpur', serviceWorkers: 'block' });
  await c2.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => /maplibre-gl\.js/.test(r.request().url()) ? r.fulfill({ contentType: 'text/javascript', headers: CORS, body: stub }) : r.abort());
  const p2 = await c2.newPage();
  await p2.clock.setFixedTime(new Date('2026-11-05T21:00:00+08:00'));
  await p2.goto(ORIGIN);
  assert.equal(await p2.evaluate(() => document.documentElement.dataset.theme), 'night');
  await p2.clock.setFixedTime(new Date('2026-11-05T12:00:00+08:00'));
  await p2.reload();
  assert.equal(await p2.evaluate(() => document.documentElement.dataset.theme), 'day');
  await c2.close();
});

await check('recent places are kept on the phone and can be cleared', async () => {
  const { ctx, page } = await newApp(browser, quiet);
  await toPreview(page);
  await page.goBack();
  await page.click('#where');
  assert.equal(await vis(page, '#recents-wrap'), true);
  assert.match(await text(page, '#recents'), /Suria KLCC/);
  await page.click('#recents-clear');
  assert.equal(await vis(page, '#recents-wrap'), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('pintu.recents')), null);
  await ctx.close();
});

await check('press and hold on the map picks a place', async () => {
  const { ctx, page, log } = await newApp(browser, quiet);
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat), P.a);
  await page.evaluate(() => window.__map._fire('contextmenu', { lngLat: { lng: 101.718, lat: 3.16 } }));
  await page.waitForSelector('.route-opt');
  await page.waitForFunction(() => document.getElementById('dest-name').textContent === 'Suria KLCC');
  assert.equal(log.fossgis[0].locations[1].lat, 3.16);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('map failing to load says so, and retry recovers', async () => {
  const { ctx, page, log } = await newApp(browser, { mapFail: true });
  assert.equal(await vis(page, '#map-problem'), true);
  assert.match(await text(page, '#map-problem-text'), /Peta tak dapat/);
  assert.equal(await vis(page, '#where'), true, 'the rest of the app is still there');
  await ctx.close();
});

await check('works without browser storage', async () => {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => /maplibre-gl\.js/.test(r.request().url()) ? r.fulfill({ contentType: 'text/javascript', headers: CORS, body: stub }) : r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(ORIGIN);
  await page.waitForFunction(() => window.__map?.ready);
  assert.equal(await text(page, '#where-text'), 'Nak ke mana?');
  assert.deepEqual(errors, []);
  await ctx.close();
});

for (const [name, viewport] of [['small phone', { width: 320, height: 568 }], ['large phone', { width: 430, height: 932 }], ['landscape mount', { width: 844, height: 390 }]]) {
  await check(`fits on a ${name}`, async () => {
    const { ctx, page, log } = await newApp(browser, { ...quiet, viewport, scale: 2 });
    const tag = name.replace(' ', '-');
    await noOverflow(page, `${name} idle`);
    await page.screenshot({ path: `${shots}/fit-${tag}-1.png` });
    await toPreview(page);
    await noOverflow(page, `${name} preview`);
    const inView = await page.evaluate(() => { const r = document.getElementById('start').getBoundingClientRect(); const s = document.getElementById('preview'); return s.scrollHeight <= s.clientHeight + 1 || s.scrollTop >= 0; });
    assert.ok(inView);
    await page.locator('#start').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('#start').isVisible());
    await page.waitForTimeout(400);
    await page.evaluate(() => { document.getElementById('preview').scrollTop = 0; });
    const b = await page.locator('#start').boundingBox();
    assert.ok(b.y + b.height <= viewport.height + 1, `${name}: Start is below the screen`);
    await page.screenshot({ path: `${shots}/fit-${tag}-2.png` });
    await page.click('#start');
    await page.waitForSelector('#nav-bar');
    await driveTo(page, cityTrip(), { to: 900 });
    await page.waitForTimeout(100);
    await noOverflow(page, `${name} nav`);
    const overlap = await page.evaluate(() => {
      const a = document.getElementById('sign').getBoundingClientRect();
      const b = document.getElementById('nav-bar').getBoundingClientRect();
      return a.bottom > b.top && a.right > b.left && a.left < b.right;
    });
    assert.equal(overlap, false, 'sign and bottom bar overlap');
    await page.screenshot({ path: `${shots}/fit-${tag}-3.png` });
    assert.deepEqual(log.errors, []);
    await ctx.close();
  });
}

await check('long place and road names stay on screen', async () => {
  const long = 'Jalan Tun Dr Ismail Abdul Rahman Persiaran Tuanku Syed Sirajuddin Utama';
  const tr = buildTrip(P.a, [
    { to: P.b, type: 1, street: 'Jalan Satu', kph: 40 },
    { to: P.c, type: 10, street: [long], kph: 40, sign: { exit_toward_elements: [{ text: long }] } },
    { to: P.d, type: 15, street: long, kph: 40 },
  ]);
  const { ctx, page } = await newApp(browser, { ...quiet, viewport: { width: 320, height: 568 }, scale: 2, routeResponse: () => ({ trip: tr }) });
  await toNav(page);
  await driveTo(page, tr, { to: 1000 });
  await page.waitForTimeout(100);
  await noOverflow(page, 'long names');
  const sign = await page.locator('#sign').boundingBox();
  assert.ok(sign.height < 568 * 0.42, `sign takes ${sign.height}px`);
  await page.screenshot({ path: `${shots}/fit-long-names.png` });
  await ctx.close();
});

await check('installable, and opens with no signal once visited', async () => {
  const { ctx, page } = await newApp(browser, { sw: 'allow' });
  const manifest = await (await page.request.get(`${ORIGIN}manifest.webmanifest`)).json();
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  for (const icon of manifest.icons) assert.equal((await page.request.get(ORIGIN + icon.src)).status(), 200, icon.src);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => {
    const names = await caches.keys();
    for (const n of names) if (n.endsWith('-shell') && (await (await caches.open(n)).keys()).length >= 20) return true;
    return false;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  await page.reload();
  assert.equal(await text(page, '#where-text'), 'Nak ke mana?');
  await ctx.setOffline(false);
  // Search and routes must not be stored.
  const cached = await page.evaluate(async () => {
    const urls = [];
    for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) urls.push(r.url);
    return urls;
  });
  assert.ok(!cached.some((u) => /photon|valhalla|stadia/.test(u)), cached.join('\n'));
  await ctx.close();
});

await browser.close();
server.close();

const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
