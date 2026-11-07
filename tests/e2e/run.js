// Full-app checks: drives Pintu in a real browser against stand-in map, search
// and routing services, with a scripted GPS.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { altTrip, buildTrip, cityTrip, multiLeg, P } from '../helpers/fixtures.js';
import { bearing } from '../../js/geo.js';
import { prepareTrip } from '../../js/routing.js';
import { speech } from '../../js/instructions.js';
import { pointAt } from '../../js/motion.js';
import { lngLatToTile } from '../../js/tiles.js';
import { encodeTile } from '../helpers/mvt.js';

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

const OVERPASS = { elements: [
  { type: 'node', id: 1, lat: 3.1502, lon: 101.7055, tags: { amenity: 'fuel', name: 'Petronas Ampang', brand: 'Petronas' } },
  { type: 'way', id: 2, center: { lat: 3.1548, lon: 101.7102 }, tags: { amenity: 'fuel', brand: 'Shell' } },
] };

function solatMonth(times) {
  const d = new Date();
  const secs = (ms) => Math.floor(ms / 1000);
  const far = secs(Date.now() + 40 * 86400000);
  return {
    zone: 'WLY01', year: d.getFullYear(), month: 'X', month_number: d.getMonth() + 1,
    prayers: [{ day: d.getDate(), hijri: 'x', imsak: far, fajr: far, syuruk: far, dhuha: far, dhuhr: far, asr: far, maghrib: far, isha: far, ...Object.fromEntries(Object.entries(times).map(([k, v]) => [k, secs(v)])) }],
  };
}

async function newApp(browser, { humanVoices = true, realAudio = false, tiles, hangAll = false, forecast, warnings, appServer, photonFeatures, url: startUrl, viewport = { width: 390, height: 844 }, stadia = 401, voices = [{ lang: 'ms-MY', name: 'Malay' }, { lang: 'en-GB', name: 'British' }], routeResponse, storage, mapFail, sw = 'block', scale = 1, locale = 'ms-MY', overpass = OVERPASS, solat } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, hasTouch: true, serviceWorkers: sw, locale, timezoneId: 'Asia/Kuala_Lumpur' });
  const log = { stadia: 0, fossgis: [], photon: [], overpass: [], solat: [], trace: [], tiles: [], forecast: [], warnings: 0, server: [], errors: [], external: new Set() };
  // Never the real server: a stand-in if the test wants one, and otherwise as if there were none.
  await ctx.route('**/js/config.js', async (route) => {
    const original = await readFile(path.join(root, 'js/config.js'), 'utf8');
    const server = appServer ? "'https://pintu.test'" : 'null';
    const config = original.replace(/server: [^,]+,/, `server: ${server},`).replace(/humanVoices: [^,]+,/, `humanVoices: ${humanVoices},`);
    route.fulfill({ contentType: 'text/javascript', body: config });
  });
  ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const url = route.request().url();
    const host = new URL(url).hostname;
    log.external.add(host);
    if (/maplibre-gl\.js$/.test(url)) {
      if (mapFail) return route.abort();
      return route.fulfill({ contentType: 'text/javascript', headers: CORS, body: stub });
    }
    if (/maplibre-gl\.css$/.test(url)) return route.fulfill({ contentType: 'text/css', headers: CORS, body: '' });
    if (host === 'pintu.test') {
      log.server.push(url);
      const answer = appServer ? await appServer(new URL(url)) : null;
      if (!answer) return route.fulfill({ status: 502, json: { error: 'unavailable' }, headers: CORS });
      if (answer.__status) return route.fulfill({ status: answer.__status, json: answer.__json || { error: 'refused' }, headers: CORS });
      if (answer.__encoded) return route.fulfill({ status: 200, body: answer.__encoded, contentType: 'application/vnd.pintu.audio+base64', headers: CORS });
      if (answer.__audio) return route.fulfill({ status: 200, body: Buffer.from(answer.__audio), contentType: answer.__type || 'audio/mpeg', headers: CORS });
      return route.fulfill({ json: answer, headers: CORS });
    }
    if (host === 'api.open-meteo.com') {
      log.forecast.push(url);
      return forecast ? route.fulfill({ json: forecast(url), headers: CORS }) : route.abort();
    }
    if (host === 'api.data.gov.my') {
      log.warnings++;
      return warnings ? route.fulfill({ json: warnings(), headers: CORS }) : route.abort();
    }
    // Everything a stop search asks goes silent, and stays silent.
    if (hangAll && (url.endsWith('.pbf') || host.includes('overpass') || host === 'ovp.dresel.systems' || url.includes('include='))) return undefined;
    const tile = url.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
    if (tile && tiles) {
      log.tiles.push(url);
      const [z, x, y] = tile.slice(1).map(Number);
      const poi = tiles.filter((p) => {
        const [tx, ty] = lngLatToTile(p.lng, p.lat, z);
        return Math.floor(tx) === x && Math.floor(ty) === y;
      });
      return route.fulfill({ body: Buffer.from(encodeTile({ z, x, y }, { poi })), headers: CORS, contentType: 'application/x-protobuf' });
    }
    if (host === 'overpass-api.de' || host === 'overpass.private.coffee' || host === 'ovp.dresel.systems') {
      log.overpass.push(route.request().postData());
      if (log.overpassFail) return route.abort();
      return route.fulfill({ json: overpass, headers: CORS });
    }
    if (host === 'api.waktusolat.app') {
      log.solat.push(url);
      if (!solat) return route.fulfill({ status: 404, json: { message: 'none' }, headers: CORS });
      return route.fulfill({ json: solatMonth(solat), headers: CORS });
    }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (host === 'api.stadiamaps.com') {
      log.stadia++;
      if (stadia === 'ok') return route.fulfill({ json: await currentRoutes(log, url, route), headers: CORS });
      return route.fulfill({ status: stadia, json: { error: 'unauthorized' }, headers: CORS });
    }
    if (host === 'valhalla1.openstreetmap.de' && url.includes('/trace_attributes')) {
      log.trace.push(url);
      return route.fulfill({ json: log.laneCounts || { edges: [] }, headers: CORS });
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
      if (url.includes('include=')) {
        log.photonStops = (log.photonStops || 0) + 1;
        if (log.photonStopsFail) return route.abort();
        return route.fulfill({ json: { features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [101.7055, 3.1503] }, properties: { name: 'Stesen Dari Photon', osm_type: 'N', osm_id: 9, osm_key: 'amenity', osm_value: 'fuel' } }] }, headers: CORS });
      }
      return route.fulfill({ json: q === 'zzzz' ? { features: [] } : (photonFeatures ? { features: photonFeatures } : PHOTON), headers: CORS });
    }
    return route.abort();
  });
  async function currentRoutes() { return { trip: cityTrip(), alternates: [{ trip: altTrip() }] }; }

  await ctx.addInitScript(({ voices, storage, realAudio }) => {
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
      speak(u) { if (u.text.trim()) window.__said.push({ text: u.text, lang: u.lang, voice: u.voice?.name, pitch: u.pitch, rate: u.rate }); },
      addEventListener() {},
    } });

    // Recordings played, and whether the phone allows it.
    window.__played = [];
    window.__audioBlocked = false;
    if (!realAudio) {
      window.Audio = class {
        constructor() { this.paused = true; this.ended = false; this.onerror = null; }
        play() {
          if (window.__audioBlocked) return Promise.reject(new Error('blocked'));
          if (!String(this.src).startsWith('data:')) window.__played.push(this.src);
          this.paused = false;
          this.ended = false;
          // As long as the test says a recording lasts, and then it ends.
          const src = this.src;
          setTimeout(() => {
            if (this.src !== src || this.paused) return;
            this.paused = true;
            this.ended = true;
            this.onended?.();
          }, window.__clipMs ?? 10);
          return Promise.resolve();
        }
        pause() { this.paused = true; }
      };
    }

    window.__wake = { requests: 0, released: 0 };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
      request: async () => { window.__wake.requests++; return { release() { window.__wake.released++; }, addEventListener() {} }; },
    } });
    if (storage) for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, { voices, storage: storage || null, realAudio });

  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) log.errors.push(`console: ${m.text()}`); });
  await page.goto(startUrl || ORIGIN);
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
  const { coords, cum } = prepareTrip(trip);
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

const puckAt = (page) => page.evaluate(() => window.__map.markers.find((m) => m.el.className === 'puck')?.ll);

const results = [];
async function check(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
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
  assert.equal(await vis(page, '#preview-strip'), false, 'no trip line when there is nothing to mark');
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
  const count = () => page.evaluate(() => window.__map.jumpCount);
  await page.waitForTimeout(50);
  const n = await count();
  await driveTo(page, cityTrip(), { from: 100, to: 200 });
  await page.waitForTimeout(300);
  assert.equal(await count(), n, 'map stays where you dragged it');
  await page.click('#btn-recenter');
  assert.equal(await vis(page, '#btn-recenter'), false);
  await page.waitForTimeout(100);
  assert.ok(await count() > n, 'following again');
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
  await page.waitForFunction(([lng, lat]) => {
    const ll = window.__map.markers.find((m) => m.el.className === 'puck').ll;
    return Math.abs(ll[0] - lng) < 0.0002 && Math.abs(ll[1] - lat) < 0.0002;
  }, P.a);
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
  // From day first: if the clock already says night, nothing would change.
  await page.click('#theme-day');
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
  assert.ok(await page.evaluate(() => ['pintu-route', 'pintu-3d', 'pintu-lane-road', 'pintu-car'].every((id) => window.__map.getLayer(id))), 'route, building, lane and car layers survive the style change');
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

await check('the arrow glides between GPS fixes instead of hopping', async () => {
  const { ctx, page } = await newApp(browser, quiet);
  await toNav(page);
  const v = 14;
  const samples = await page.evaluate(async ({ v }) => {
    const puck = () => window.__map.markers.find((m) => m.el.className === 'puck').ll;
    const out = [];
    const startJumps = window.__map.jumpCount;
    const started = performance.now();
    let sent = 0;
    await new Promise((resolve) => {
      const tick = (now) => {
        const elapsed = now - started;
        if (elapsed >= sent * 1000) {
          const s = sent * v;
          const lng = 101.7 + (s + 300) / 111000;
          window.__gps.push(lng, 3.15, { speed: v, heading: 90, time: Date.now() });
          sent++;
        }
        out.push(puck()[0]);
        if (elapsed < 3000) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    return { lngs: out, jumps: window.__map.jumpCount - startJumps };
  }, { v });
  const m = samples.lngs.map((x) => (x - 101.7) * 111000);
  const later = m.slice(Math.floor(m.length / 3));
  const distinct = new Set(later.map((x) => x.toFixed(2))).size;
  assert.ok(distinct > later.length * 0.6, `positions per frame: ${distinct} of ${later.length}`);
  let worst = 0;
  for (let i = 1; i < later.length; i++) worst = Math.max(worst, Math.abs(later[i] - later[i - 1]));
  assert.ok(worst < v * 0.45, `largest hop ${worst.toFixed(1)} m at ${v} m/s`);
  assert.ok(samples.jumps >= 20, `camera moved ${samples.jumps} times in 3 s`);
  await ctx.close();
});

await check('speed shows in km/h', async () => {
  const { ctx, page } = await newApp(browser, quiet);
  await toNav(page);
  await page.evaluate(() => window.__gps.push(101.701, 3.15, { speed: 25, heading: 90, time: Date.now() }));
  await page.waitForTimeout(50);
  assert.equal(await text(page, '#speed-value'), '90');
  assert.equal(await text(page, '#speed span'), 'km/j');
  await ctx.close();
});

await check('3D switch: starts tilted with buildings, flattens, and stays as you left it', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2 });
  await toNav(page);
  await driveTo(page, cityTrip(), { to: 300 });
  await page.waitForFunction(() => window.__map.lastJump && window.__map.lastJump.pitch > 50);
  assert.equal(await text(page, '#btn-3d'), '3D');
  const layer = await page.evaluate(() => window.__map.getLayer('pintu-3d'));
  assert.equal(layer.type, 'fill-extrusion');
  assert.equal(layer['source-layer'], 'building');
  await page.click('#btn-3d');
  assert.equal(await text(page, '#btn-3d'), '2D');
  assert.equal(await page.evaluate(() => window.__map.layout['pintu-3d']), 'none');
  await page.waitForFunction(() => window.__map.lastJump.pitch < 3);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pintu.settings')).view3d), false);
  await page.click('#btn-end');
  await page.click('#btn-end');
  assert.equal(await text(page, '#btn-3d-idle'), '2D');
  await page.click('#btn-3d-idle');
  assert.equal(await page.evaluate(() => window.__map.layout['pintu-3d']), 'visible');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('route line goes above every road, not just the first label', async () => {
  const { ctx, page } = await newApp(browser, quiet);
  await page.waitForFunction(() => window.__map.getLayer('pintu-route'));
  // The stub refuses any insertion point except the label after the last road.
  assert.ok(await page.evaluate(() => window.__map.layers.length) > 7);
  await ctx.close();
});

await check('lane arrows show near the turn, with the right lane marked', async () => {
  const lanes = [{ directions: 2 }, { directions: 2 }, { directions: 64, active: 64 }, { directions: 66, valid: 64 }];
  const tr = buildTrip(P.a, [
    { to: P.b, type: 1, street: 'Jalan Ampang', kph: 40 },
    { to: P.c, type: 10, street: 'Jalan Tun Razak', kph: 50, lanes },
    { to: P.d, type: 15, street: 'Jalan Pinang', kph: 40 },
  ]);
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2, routeResponse: () => ({ trip: tr }) });
  await toNav(page);
  assert.equal(log.fossgis[0].turn_lanes, true);
  await driveTo(page, tr, { to: 200 });
  await page.waitForTimeout(50);
  assert.equal(await vis(page, '#lanes'), false, 'too far away to matter');
  await driveTo(page, tr, { from: 200, to: 800 });
  await page.waitForTimeout(50);
  assert.equal(await vis(page, '#lanes'), true);
  assert.equal(await page.locator('#lanes .lane').count(), 4);
  assert.equal(await page.locator('#lanes .lane.best').count(), 1);
  assert.equal(await page.locator('#lanes .lane.ok').count(), 1);
  assert.equal(await page.locator('#lanes .lane.other').count(), 2);
  assert.ok(await page.locator('#lanes .lane').nth(2).evaluate((e) => e.classList.contains('best')));
  await noOverflow(page, 'lanes');
  await page.screenshot({ path: `${shots}/12-nav-lanes.png` });
  // Past the turn, the next one has no lane data.
  await driveTo(page, tr, { from: 800, to: 1300 });
  await page.waitForTimeout(50);
  assert.equal(await vis(page, '#lanes'), false);
  await ctx.close();
});

await check('your vehicle shows on the map in the shape and colour you pick', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2 });
  const pose = () => page.evaluate(() => window.__map.getLayer('pintu-car').source.pose());
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat, { heading: 90, speed: 0 }), P.a);
  await page.click('#btn-locate');
  await page.waitForFunction(() => window.__map.getLayer('pintu-car').source.pose());
  assert.equal((await pose()).body, 'hatchback');
  assert.equal(await page.locator('.puck').evaluate((e) => e.style.visibility), 'hidden', 'the car replaces the arrow');

  await page.click('#btn-settings');
  await page.click('#set-vehicle-open');
  assert.equal(await page.locator('#veh-bodies button').count(), 5);
  assert.equal(await page.locator('#veh-colors button').count(), 8);
  await page.locator('#veh-bodies button', { hasText: 'SUV' }).click();
  await page.locator('#veh-colors button[aria-label="Merah"]').click();
  assert.equal(await page.locator('#veh-colors button[aria-label="Merah"]').getAttribute('aria-checked'), 'true');
  await noOverflow(page, 'vehicle look');
  await page.screenshot({ path: `${shots}/14b-vehicle-look.png` });
  await page.click('#veh-save');
  await page.waitForFunction(() => document.getElementById('vehicle').hidden);
  await page.waitForFunction(() => window.__map.getLayer('pintu-car').source.pose()?.body === 'suv');
  assert.equal((await pose()).color, '#C4202A');
  assert.equal(await page.evaluate(() => localStorage.getItem('pintu.vehicles')), '{}', 'a look alone adds no fuel figures');

  // A chosen model sets the shape.
  await page.click('#set-vehicle-open');
  await page.selectOption('#veh-preset', { label: 'Toyota Hilux' });
  assert.equal(await page.locator('#veh-bodies button[aria-checked="true"]').innerText(), 'Pikap');
  await page.click('#veh-save');
  await page.waitForFunction(() => window.__map.getLayer('pintu-car').source.pose()?.body === 'pickup');
  await page.click('#settings-back');

  await page.reload();
  await page.waitForFunction(() => window.__map?.ready);
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat, { heading: 90 }), P.a);
  await page.click('#btn-locate');
  await page.waitForFunction(() => window.__map.getLayer('pintu-car').source.pose()?.body === 'pickup');

  // In 2D you get the arrow back.
  await page.click('#btn-3d-idle');
  assert.equal(await page.locator('.puck').evaluate((e) => e.style.visibility), 'visible');
  assert.equal(await pose(), null);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('motorcycle mode rides a motorcycle', async () => {
  const { ctx, page } = await newApp(browser, quiet);
  await toPreview(page);
  await page.click('#mode-moto');
  await page.waitForFunction(() => window.__map.getLayer('pintu-car').source.pose()?.body === 'motorcycle');
  await page.click('#plan-fuel-edit');
  assert.equal(await page.locator('#veh-body-field').isVisible(), false);
  assert.equal(await page.locator('#veh-preset-field').isVisible(), false);
  assert.equal(await text(page, '#veh-title'), 'Motosikal saya');
  await ctx.close();
});

const laneTrip = () => buildTrip(P.a, [
  { to: P.b, type: 1, street: 'Jalan Ampang', kph: 40 },
  { to: P.c, type: 10, street: 'Jalan Tun Razak', kph: 50 },
  { to: P.d, type: 15, street: 'Jalan Pinang', kph: 40 },
]);

await check('lane view: road lane counts draw the lanes, and the camera moves in', async () => {
  const tr = laneTrip();
  const { ctx, page, log } = await newApp(browser, { ...quiet, routeResponse: () => ({ trip: tr }) });
  log.laneCounts = { edges: [{ length: 30, lane_count: 3 }] };
  await toNav(page);
  await driveTo(page, tr, { to: 200 });
  await page.waitForFunction(() => window.__map.getSource('pintu-lanes')?.data?.features?.length > 50, null, { timeout: 8000 });
  assert.ok(log.trace.length >= 1, 'asked for lane counts');
  assert.equal(log.trace.length, 1, 'one request for this stretch');
  const body = JSON.parse(new URL(log.trace[0]).searchParams.get('json'));
  assert.deepEqual(body.filters.attributes, ['edge.lane_count', 'edge.length', 'edge.speed_limit']);
  const f = await page.evaluate(() => window.__map.getSource('pintu-lanes').data.features.reduce((m, x) => { m[x.properties.k] = (m[x.properties.k] || 0) + 1; return m; }, {}));
  assert.equal(f.divider, 2);
  assert.ok(f.road > 20 && f.carpet > 20);
  await driveTo(page, tr, { from: 200, to: 300 });
  await page.waitForFunction(() => window.__map.lastJump?.zoom > 18, null, { timeout: 8000 });
  assert.match(await text(page, '#toast'), /bukan lorong sebenar/, 'says the car does not show your actual lane');
  assert.ok(await page.evaluate(() => window.__map.lastJump.pitch) > 55);
  assert.equal(await page.evaluate(() => localStorage.getItem('pintu.laneNoteSeen')), 'true');
  // Lane view needs 3D.
  await page.click('#btn-3d');
  await driveTo(page, tr, { from: 300, to: 320 });
  await page.waitForFunction(() => window.__map.getSource('pintu-lanes').data.features.length === 0);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('lane view: the car moves over into the lane the turn needs', async () => {
  const lanes = [{ directions: 2 }, { directions: 2 }, { directions: 64, active: 64 }];
  const tr = buildTrip(P.a, [
    { to: P.b, type: 1, street: 'Jalan Ampang', kph: 40 },
    { to: P.c, type: 10, street: 'Jalan Tun Razak', kph: 50, lanes },
    { to: P.d, type: 15, street: 'Jalan Pinang', kph: 40 },
  ]);
  const { ctx, page } = await newApp(browser, { ...quiet, scale: 2, routeResponse: () => ({ trip: tr }) });
  await toNav(page);
  const t = await driveTo(page, tr, { to: 1050 });
  await page.waitForFunction(() => window.__map.getSource('pintu-lanes')?.data?.features?.length > 20);
  await page.waitForTimeout(1200);
  // Heading east with the right lane wanted: the car's south of the road's centre.
  await page.waitForFunction(() => window.__map.getLayer('pintu-car').source.pose().lat < 3.14998, null, { timeout: 6000 });
  const words = (await said(page)).map((x) => x.text);
  assert.ok(words.some((w) => /Guna lorong paling kanan\./.test(w)), words.join(' | '));
  assert.equal(await page.locator('#lanes .lane.best').count(), 1);
  await noOverflow(page, 'lane view');
  await page.screenshot({ path: `${shots}/17-lane-view.png` });
  await ctx.close();
});

await check('no lane data at all leaves the normal view untouched', async () => {
  const { ctx, page, log } = await newApp(browser, quiet);
  await toNav(page);
  await driveTo(page, cityTrip(), { to: 300 });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__map.getSource('pintu-lanes').data.features.length), 0);
  assert.ok(await page.evaluate(() => window.__map.lastJump.zoom) < 18);
  assert.equal(await page.evaluate(() => localStorage.getItem('pintu.laneNoteSeen')), null);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('stops: searches along the route, adds one, routes through it', async () => {
  const { ctx, page, log } = await newApp(browser, {
    ...quiet, scale: 2,
    routeResponse: (b) => (b.locations.length === 3 ? { trip: multiLeg() } : { trip: cityTrip(), alternates: b.alternates ? [{ trip: altTrip() }] : [] }),
  });
  await toPreview(page);
  assert.equal(await page.locator('.route-opt').count(), 2);
  await page.click('#add-stop');
  await page.waitForSelector('#stops-list .place');
  assert.match(decodeURIComponent(log.overpass[0]), /"amenity"="fuel"/);
  assert.match(decodeURIComponent(log.overpass[0].replace(/\+/g, ' ')), /around:1500,3\.15000,101\.70000/);
  assert.equal(await page.locator('.cat').count(), 5);
  const first = await page.locator('#stops-list .place').first().innerText();
  assert.match(first, /Petronas Ampang/);
  assert.match(first, /lagi, sampai \d+:\d\d/);
  assert.match(first, /ke kiri laluan/);
  assert.ok(await page.evaluate(() => document.querySelectorAll('.map-pin').length) >= 2, 'pins on the map');
  await noOverflow(page, 'stops');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/13-stops.png` });
  await page.locator('#stops-list .place').nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('.stop-row').length === 1);
  await page.waitForSelector('.route-opt');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.map-pin:not(.is-stop)').length), 0, 'choices cleared');
  await page.waitForFunction(() => document.querySelectorAll('.map-pin.is-stop').length === 1);
  const req = log.fossgis.at(-1);
  assert.equal(req.locations.length, 3);
  assert.equal(req.locations[1].lat, 3.1548);
  assert.equal(req.alternates, undefined);
  assert.equal(await page.locator('.route-opt').count(), 1, 'one route once there is a stop');
  assert.match(await text(page, '#plan-stops'), /Shell/);
  assert.deepEqual(log.errors, []);

  // Drive it: the stop is announced, reached, then guidance carries on.
  await page.click('#start');
  await page.waitForSelector('#nav-bar');
  const trip = multiLeg();
  const t1 = await driveTo(page, trip, { to: 1500 });
  await page.waitForTimeout(50);
  assert.match(await text(page, '#sign-action'), /Hentian di sebelah kiri/);
  await page.locator('#btn-add-stop').waitFor();
  const t2 = await driveTo(page, trip, { from: 1500, to: 1800, t0: t1 });
  await page.waitForTimeout(50);
  const words = (await said(page)).map((x) => x.text);
  assert.ok(words.includes('Anda telah sampai di hentian.'), words.join(' | '));
  assert.equal(await vis(page, '#nav-bar'), true);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.map-pin.is-stop').length), 0);
  await driveTo(page, trip, { from: 1800, t0: t2 });
  await page.waitForSelector('#arrival:not([hidden])');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('adding a stop while driving re-routes straight away', async () => {
  const { ctx, page, log } = await newApp(browser, {
    ...quiet,
    routeResponse: (b) => (b.locations.length === 3 ? { trip: buildTrip(P.a, [{ to: [101.7055, 3.15], type: 1, street: 'Jalan Ampang', kph: 40 }, { to: P.d, type: 15, street: 'Jalan Baru', kph: 10 }]) } : { trip: cityTrip() }),
  });
  await toNav(page);
  await driveTo(page, cityTrip(), { to: 200 });
  await page.click('#btn-add-stop');
  await page.waitForSelector('#stops-list .place');
  assert.equal(await vis(page, '#nav-bar'), true);
  await page.locator('#stops-list .place').first().click();
  await page.waitForFunction(() => /Hentian ditambah/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
  const req = log.fossgis.at(-1);
  assert.equal(req.locations.length, 3);
  assert.equal(await vis(page, '#stops'), false);
  assert.equal(await vis(page, '#nav-bar'), true);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('stops: nothing found, and failure, are both explained', async () => {
  const empty = await newApp(browser, { ...quiet, overpass: { elements: [] } });
  await toPreview(empty.page);
  await empty.page.click('#add-stop');
  await empty.page.waitForFunction(() => /Tiada dijumpai/.test(document.getElementById('stops-status').textContent));
  await empty.ctx.close();
  const bad = await newApp(browser, quiet);
  bad.log.overpassFail = true;
  bad.log.photonStopsFail = true;
  await toPreview(bad.page);
  await bad.page.click('#add-stop');
  await bad.page.waitForFunction(() => /tak dapat dimuatkan/.test(document.getElementById('stops-status').textContent));
  assert.equal(bad.log.overpass.length, 3, 'tried each server');
  assert.ok(bad.log.photonStops >= 1, 'and the search service');
  // Things recover, and the retry button finds them.
  bad.log.photonStopsFail = false;
  await bad.page.locator('#stops-status button').click();
  await bad.page.waitForSelector('#stops-list .place');
  assert.match(await text(bad.page, '#stops-list'), /Stesen Dari Photon/);
  await bad.ctx.close();
});

await check('add a stop and start are always there to tap on real phone screens', async () => {
  // Heights a phone has left once the browser's own bars are showing.
  for (const viewport of [{ width: 390, height: 664 }, { width: 320, height: 568 }, { width: 360, height: 658 }, { width: 393, height: 727 }, { width: 412, height: 780 }, { width: 844, height: 390 }]) {
    const { ctx, page } = await newApp(browser, { ...quiet, viewport, storage: { 'pintu.safetySeen': 'true', 'pintu.vehicles': { car: { kind: 'petrol', consumption: 6, range: 400, level: 60 } } } });
    await toPreview(page);
    await page.waitForTimeout(350);
    const name = `${viewport.width}x${viewport.height}`;
    await page.evaluate(() => { document.getElementById('preview').scrollTop = 0; });
    const hits = await page.evaluate(() => ['add-stop', 'start', 'try-sim', 'from-row', 'to-row', 'swap-ends', 'preview-back'].map((id) => {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      const pts = [[0.1, 0.5], [0.5, 0.5], [0.9, 0.5], [0.5, 0.15], [0.5, 0.85]].map(([x, y]) => [r.left + r.width * x, r.top + r.height * y]);
      return { id, ok: pts.every(([x, y]) => document.elementFromPoint(x, y)?.closest(`#${id}`)), bottom: r.bottom, h: innerHeight };
    }));
    for (const hit of hits) {
      assert.ok(hit.ok, `${name}: ${hit.id} is covered`);
      assert.ok(hit.bottom <= hit.h + 1, `${name}: ${hit.id} is off the screen`);
    }
    // Everything above the buttons can be scrolled clear of them.
    const clear = await page.evaluate(() => {
      const sheet = document.getElementById('preview');
      sheet.scrollTop = sheet.scrollHeight;
      const bar = document.querySelector('.action-bar').getBoundingClientRect();
      const last = [...document.querySelectorAll('#plan .plan-row, #route-note')].filter((e) => e.offsetParent).at(-1).getBoundingClientRect();
      return { bar: bar.top, last: last.bottom };
    });
    assert.ok(clear.last <= clear.bar + 1, `${name}: last row ends at ${clear.last}, buttons start at ${clear.bar}`);
    await page.evaluate(() => { document.getElementById('preview').scrollTop = 0; });

    // And a real finger tap opens the panel.
    const box = await page.locator('#add-stop').boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForSelector('#stops:not([hidden])');
    await page.waitForSelector('#stops-list .place');
    await page.waitForTimeout(350);  // the panel is still rising until then
    const item = await page.locator('#stops-list .place').first().boundingBox();
    assert.ok(item.y + item.height <= viewport.height + 1, `${name}: first stop is off the screen`);
    await page.locator('#stops-list .place').first().tap();
    await page.waitForFunction(() => document.querySelectorAll('.stop-row').length === 1);
    await page.waitForSelector('.route-opt');
    await ctx.close();
  }
});

await check('stops: another place can be searched for, and back closes the panel', async () => {
  const { ctx, page, log } = await newApp(browser, quiet);
  await toPreview(page);
  await page.click('#add-stop');
  await page.waitForSelector('#stops-list .place');
  await page.goBack();
  assert.equal(await vis(page, '#stops'), false);
  assert.equal(await vis(page, '#preview'), true);
  await page.click('#add-stop');
  await page.click('#stops-other');
  await page.fill('#search-input', 'klcc');
  await page.waitForSelector('#search-results .place');
  await page.locator('#search-results .place').nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('.stop-row').length === 1);
  await page.waitForTimeout(100);
  assert.equal(await vis(page, '#search'), false);
  assert.equal(await vis(page, '#preview'), true);
  await page.locator('.stop-row button').click();
  await page.waitForFunction(() => document.querySelectorAll('.stop-row').length === 0);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('my car: enter it, see fuel use and whether the tank is enough', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2 });
  await toPreview(page);
  assert.match(await text(page, '#plan-fuel-title'), /Tambah kenderaan/);
  await page.click('#plan-fuel-edit');
  assert.equal(await vis(page, '#vehicle'), true);
  assert.equal(await text(page, '#veh-title'), 'Kereta saya');
  await noOverflow(page, 'vehicle');
  await page.screenshot({ path: `${shots}/14-vehicle.png` });

  await page.selectOption('#veh-preset', { label: 'Perodua Myvi 1.5' });
  assert.equal(await page.inputValue('#veh-consumption'), '6.3');
  await page.click('#veh-unit-kml');
  assert.equal(await page.inputValue('#veh-consumption'), '15.9');
  await page.fill('#veh-consumption', '20');
  await page.fill('#veh-range', '600');
  await page.fill('#veh-price', '2');
  await page.locator('#veh-level').evaluate((e) => { e.value = 50; e.dispatchEvent(new Event('input')); });
  assert.equal(await text(page, '#veh-level-value'), '50%');
  await page.click('#veh-save');
  await page.waitForFunction(() => document.getElementById('vehicle').hidden);
  assert.equal(await vis(page, '#preview'), true);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pintu.vehicles')).car);
  assert.equal(stored.consumption, 5);
  assert.equal(stored.range, 600);
  assert.equal(stored.level, 50);
  assert.match(await text(page, '#plan-fuel-title'), /Guna lebih kurang 0\.2 L, RM0\.31/);
  assert.match(await text(page, '#plan-fuel-detail'), /Cukup\. Baki lebih kurang 297 km/);
  await page.locator('#plan-level').evaluate((e) => { e.value = 5; e.dispatchEvent(new Event('input')); });
  assert.match(await text(page, '#plan-fuel-detail'), /Elok isi minyak dahulu|isi minyak/);
  await noOverflow(page, 'plan');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/15-plan.png` });
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('my car: electric uses battery wording; motorcycle is kept separately', async () => {
  const { ctx, page } = await newApp(browser, quiet);
  await toPreview(page);
  await page.click('#plan-fuel-edit');
  await page.selectOption('#veh-preset', { label: 'Proton eMas 7 Premium' });
  assert.equal(await page.inputValue('#veh-range'), '410');
  assert.equal(await vis(page, '#veh-unit-row'), false);
  assert.match(await text(page, '#veh-range-label'), /sekali cas/);
  await page.click('#veh-save');
  await page.waitForFunction(() => document.getElementById('vehicle').hidden);
  assert.match(await text(page, '#plan-fuel-title'), /kWh/);
  await page.click('#mode-moto');
  await page.waitForFunction(() => /Tambah kenderaan/.test(document.getElementById('plan-fuel-title').textContent) && !document.getElementById('plan').hidden);
  await page.click('#mode-car');
  await page.waitForFunction(() => /kWh/.test(document.getElementById('plan-fuel-title').textContent) && !document.getElementById('plan').hidden);
  await page.click('#plan-fuel-edit');
  await page.click('#veh-remove');
  await page.waitForFunction(() => document.getElementById('vehicle').hidden);
  assert.match(await text(page, '#plan-fuel-title'), /Tambah kenderaan/);
  await ctx.close();
});

await check('running low warns once, offers stations, and offers the mark on the trip line', async () => {
  const long = buildTrip(P.a, [{ to: [101.9, 3.15], type: 1, street: 'Jalan Panjang', kph: 80 }, { to: [101.9, 3.2], type: 10, street: 'Akhir', kph: 60 }]);
  const { ctx, page, log } = await newApp(browser, {
    ...quiet,
    routeResponse: () => ({ trip: long }),
    storage: { 'pintu.safetySeen': 'true', 'pintu.vehicles': { car: { name: 'Myvi', kind: 'petrol', consumption: 6, range: 300, level: 10 } } },
  });
  await toPreview(page);
  assert.match(await text(page, '#plan-fuel-detail'), /Elok isi minyak|Perlu isi minyak|Cukup-cukup/);
  await page.click('#start');
  await page.waitForSelector('#nav-bar');
  assert.equal(await page.locator('#nav-strip .mark-fuel').count(), 1);
  assert.match(await text(page, '#nav-range'), /km/);
  await driveTo(page, long, { to: 8000, kph: 90 });
  await page.waitForFunction(() => /Minyak tinggal/.test(document.getElementById('chips').textContent));
  const words = (await said(page)).map((x) => x.text);
  assert.equal(words.filter((w) => w.startsWith('Minyak tinggal')).length, 1, 'said once');
  await page.locator('#chips .chip', { hasText: 'Minyak tinggal' }).click();
  await page.waitForSelector('#stops:not([hidden])');
  assert.equal(await page.locator('.cat[aria-checked="true"]').innerText(), 'Minyak');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('a finished trip updates the tank; a refill stop asks and resets it', async () => {
  const { ctx, page } = await newApp(browser, {
    ...quiet, scale: 2,
    routeResponse: (b) => (b.locations.length === 3 ? { trip: multiLeg() } : { trip: cityTrip() }),
    storage: { 'pintu.safetySeen': 'true', 'pintu.vehicles': { car: { name: 'Myvi', kind: 'petrol', consumption: 6, range: 100, level: 50 } } },
  });
  await toPreview(page);
  await page.click('#add-stop');
  await page.waitForSelector('#stops-list .place');
  await page.locator('#stops-list .place').nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('.stop-row').length === 1);
  await page.waitForSelector('.route-opt');
  await page.click('#start');
  await page.waitForSelector('#nav-bar');
  const trip = multiLeg();
  const t1 = await driveTo(page, trip, { to: 1800 });
  await page.waitForSelector('#refill:not([hidden])');
  assert.match(await text(page, '#refill-text'), /Dah isi minyak/);
  await noOverflow(page, 'refill');
  await page.screenshot({ path: `${shots}/16-refill.png` });
  await page.click('#refill-yes');
  assert.equal(await vis(page, '#refill'), false);
  await driveTo(page, trip, { from: 1800, t0: t1 });
  await page.waitForSelector('#arrival:not([hidden])');
  const v = await page.evaluate(() => JSON.parse(localStorage.getItem('pintu.vehicles')).car);
  assert.ok(v.level >= 97 && v.level <= 100, `level ${v.level}`);
  assert.match(await text(page, '#arrival-stats'), /guna lebih kurang/);
  await ctx.close();
});

await check('a practice drive does not touch the tank', async () => {
  const short = buildTrip(P.a, [{ to: [101.7012, 3.15], type: 1, street: 'Jalan Satu', kph: 40 }, { to: [101.7012, 3.1512], type: 15, street: 'Jalan Dua', kph: 40 }]);
  const { ctx, page } = await newApp(browser, {
    ...quiet,
    routeResponse: () => ({ trip: short }),
    storage: { 'pintu.safetySeen': 'true', 'pintu.vehicles': { car: { kind: 'petrol', consumption: 6, range: 100, level: 50 } } },
  });
  await toPreview(page);
  await page.click('#try-sim');
  await page.waitForSelector('#arrival:not([hidden])', { timeout: 30000 });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pintu.vehicles')).car.level), 50);
  await ctx.close();
});

await check('solat: shown when close, nowhere otherwise, and offers a surau', async () => {
  const soon = Date.now() + 12 * 60000;
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2, solat: { asr: soon } });
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat), P.a);
  await page.click('#where');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('pintu.solat') || 'null')?.data);
  assert.match(log.solat[0], /\/v2\/solat\/gps\/3\.15\/101\.70$/);
  await page.goBack();
  await page.waitForFunction(() => !document.getElementById('hud-prayer').hidden);
  assert.match(await text(page, '#hud-prayer'), /^Asar dalam 1[12] min, /);
  await noOverflow(page, 'idle prayer');
  await page.screenshot({ path: `${shots}/1b-idle-prayer.png` });
  await toPreview(page);
  assert.equal(await vis(page, '#plan-prayer'), true);
  assert.match(await text(page, '#plan-prayer-title'), /Asar dalam/);
  await page.click('#start');
  await page.waitForSelector('#nav-bar');
  await driveTo(page, cityTrip(), { to: 200 });
  await page.waitForSelector('#chips .chip');
  const chip = page.locator('#chips .chip', { hasText: 'Asar' });
  assert.match(await chip.innerText(), /Cari surau/);
  await chip.click();
  await page.waitForSelector('#stops:not([hidden])');
  assert.equal(await page.locator('.cat[aria-checked="true"]').innerText(), 'Surau');
  assert.match(decodeURIComponent(log.overpass.at(-1)), /"religion"="muslim"/);
  assert.equal(log.solat.length, 1, 'one request for the whole session');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('solat: a prayer that comes in during the trip is mentioned before you leave', async () => {
  const { ctx, page } = await newApp(browser, { ...quiet, solat: { maghrib: Date.now() + 60 * 60000 } });
  const long = buildTrip(P.a, [{ to: [102.5, 3.15], type: 1, street: 'Jalan Panjang', kph: 60 }]);
  await page.route(/valhalla1/, (r) => r.fulfill({ json: { trip: long }, headers: CORS }));
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat), P.a);
  await page.click('#where');
  await page.waitForFunction(() => localStorage.getItem('pintu.solat'));
  await page.fill('#search-input', 'klcc');
  await page.waitForSelector('#search-results .place');
  await page.locator('#search-results .place').first().click();
  await page.waitForSelector('.route-opt');
  assert.match(await text(page, '#plan-prayer-title'), /Waktu Maghrib masuk/);
  assert.equal(await page.locator('#preview-strip .mark-prayer').count(), 1);
  await ctx.close();
});

await check('solat: switched off sends nothing, and an outage shows nothing', async () => {
  const off = await newApp(browser, { storage: { 'pintu.settings': { solat: false } }, solat: { asr: Date.now() + 600000 } });
  await off.page.evaluate(([lng, lat]) => window.__gps.push(lng, lat), P.a);
  await off.page.click('#where');
  await off.page.waitForTimeout(200);
  assert.equal(off.log.solat.length, 0);
  await off.ctx.close();
  const down = await newApp(browser, {});
  await down.page.evaluate(([lng, lat]) => window.__gps.push(lng, lat), P.a);
  await down.page.click('#where');
  await down.page.waitForTimeout(200);
  await down.page.goBack();
  assert.equal(await vis(down.page, '#hud-prayer'), false);
  assert.deepEqual(down.log.errors, []);
  await down.ctx.close();
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
    for (const n of names) if (n.endsWith('-shell') && (await (await caches.open(n)).keys()).length >= 25) return true;
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
  assert.ok(!cached.some((u) => /photon|valhalla|stadia|overpass|waktusolat/.test(u)), cached.join('\n'));
  await ctx.close();
});

const TILE_PLACES = [
  { id: 21, lng: 101.7055, lat: 3.1502, props: { name: 'Petronas Dari Peta', class: 'fuel', subclass: 'fuel' } },
  { id: 22, lng: 101.7102, lat: 3.1548, props: { name: 'Shell Dari Peta', class: 'fuel', subclass: 'fuel' } },
  { id: 23, lng: 101.7053, lat: 3.1503, props: { name: 'Surau Al-Amin', class: 'place_of_worship', subclass: 'place_of_worship' } },
  { id: 24, lng: 101.7054, lat: 3.1502, props: { name: 'Nasi Kandar', class: 'restaurant', subclass: 'restaurant' } },
];

await check('stops: found in the map tiles, with no other server needed', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, tiles: TILE_PLACES });
  await toPreview(page);
  await page.click('#add-stop');
  await page.waitForSelector('#stops-list .place');
  await page.waitForFunction(() => document.getElementById('stops-status').textContent === '');
  assert.match(await text(page, '#stops-list'), /Petronas Dari Peta/);
  assert.match(await text(page, '#stops-list'), /Shell Dari Peta/);
  assert.equal(log.overpass.length, 0);
  assert.match(log.tiles[0], /\/planet\/latest\/14\/\d+\/\d+\.pbf$/);
  assert.ok(log.tiles.length <= 30, String(log.tiles.length));
  const pins = await page.evaluate(() => document.querySelectorAll('.map-pin').length);
  assert.equal(pins, 2);
  // Each category sees its own places.
  await page.locator('#stops-cats .cat').nth(3).click();
  await page.waitForFunction(() => /Surau Al-Amin/.test(document.getElementById('stops-list').textContent));
  await page.locator('#stops-cats .cat').nth(4).click();
  await page.waitForFunction(() => /Nasi Kandar/.test(document.getElementById('stops-list').textContent));
  // And one is added like any other.
  await page.locator('#stops-list .place').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.stop-row').length === 1);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('stops: with every service silent, the search still ends and offers another go', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, hangAll: true });
  await toPreview(page);
  await page.click('#add-stop');
  const began = Date.now();
  await page.waitForFunction(() => /tak dapat dimuatkan/.test(document.getElementById('stops-status').textContent), null, { timeout: 26000 });
  assert.ok(Date.now() - began < 25000, `took ${Date.now() - began} ms`);
  assert.equal(await vis(page, '#stops-status button'), true);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

const ends = (body) => body.locations.map((l) => [l.lon, l.lat]);

await check('starting point: search for one, and the buttons say what you can do from there', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2, viewport: { width: 390, height: 664 } });
  await toPreview(page);
  assert.equal(await text(page, '#from-name'), 'Lokasi anda');
  assert.equal(await text(page, '#start'), 'Mula');
  assert.equal(await text(page, '#try-sim'), 'Cuba tanpa memandu');
  assert.deepEqual(ends(log.fossgis.at(-1))[0], P.a);
  await page.screenshot({ path: `${shots}/20-from-here.png` });

  await page.click('#from-row');
  assert.equal(await vis(page, '#search'), true);
  assert.equal(await vis(page, '#search-quick'), true);
  assert.equal(await page.getAttribute('#search-input', 'placeholder'), 'Cari titik mula');
  await page.screenshot({ path: `${shots}/21-start-search.png` });
  await page.fill('#search-input', 'klcc');
  await page.waitForSelector('#search-results .place');
  assert.equal(await vis(page, '#search-quick'), false);
  await page.locator('#search-results .place').nth(1).click();
  await page.waitForFunction(() => /KLCC Park/.test(document.getElementById('from-name').textContent));
  await page.waitForSelector('.route-opt');
  assert.equal(await vis(page, '#search'), false);
  assert.deepEqual(ends(log.fossgis.at(-1))[0], [101.71, 3.14]);
  assert.deepEqual(ends(log.fossgis.at(-1))[1], P.d);
  assert.equal(await text(page, '#start'), 'Pratonton');
  assert.equal(await text(page, '#try-sim'), 'Pandu ke titik mula dulu');
  assert.match(await text(page, '#route-note'), /belum berada di titik mula/);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.start-pin').length), 1);
  await page.screenshot({ path: `${shots}/22-from-elsewhere.png` });
  await noOverflow(page, 'custom start');

  // Arriving at the start makes it an ordinary trip.
  await page.evaluate(() => window.__gps.push(101.7101, 3.1401, { accuracy: 10 }));
  await page.waitForFunction(() => document.getElementById('start').textContent === 'Mula');
  assert.equal(await text(page, '#try-sim'), 'Cuba tanpa memandu');
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat, { accuracy: 10 }), P.a);
  await page.waitForFunction(() => document.getElementById('start').textContent === 'Pratonton');

  // And back to starting from where you are.
  await page.click('#from-row');
  await page.click('#quick-here');
  await page.waitForFunction(() => document.getElementById('from-name').textContent === 'Lokasi anda');
  await page.waitForSelector('.route-opt');
  assert.deepEqual(ends(log.fossgis.at(-1))[0], P.a);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.start-pin').length), 0);
  assert.equal(await text(page, '#start'), 'Mula');
  // Leaving forgets it.
  await page.click('#from-row');
  await page.fill('#search-input', 'klcc');
  await page.waitForSelector('#search-results .place');
  await page.locator('#search-results .place').nth(1).click();
  await page.waitForFunction(() => /KLCC Park/.test(document.getElementById('from-name').textContent));
  await page.click('#preview-back');
  await page.waitForSelector('#where');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.start-pin').length), 0);
  await toPreview(page);
  assert.equal(await text(page, '#from-name'), 'Lokasi anda');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('starting point: previewing it, then coming back to the same plan', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet });
  await toPreview(page);
  await page.click('#from-row');
  await page.fill('#search-input', 'klcc');
  await page.waitForSelector('#search-results .place');
  await page.locator('#search-results .place').nth(1).click();
  await page.waitForFunction(() => document.getElementById('start').textContent === 'Pratonton' && !document.getElementById('start').disabled);
  const asked = log.fossgis.length;
  await page.click('#start');
  await page.waitForSelector('#sim-panel:not([hidden])');
  assert.match(await text(page, '#chips'), /Simulasi/);
  assert.equal(await page.evaluate(() => localStorage.getItem('pintu.trip')), null);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.start-pin').length), 0);
  await page.click('#btn-end');
  await page.click('#btn-end');
  await page.waitForSelector('.route-opt');
  assert.equal(await vis(page, '#preview'), true);
  assert.match(await text(page, '#from-name'), /KLCC Park/);
  assert.equal(await text(page, '#dest-name'), 'Suria KLCC');
  assert.equal(await text(page, '#start'), 'Pratonton');
  assert.equal(log.fossgis.length, asked, 'nothing changed, so no new route is needed');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.start-pin').length), 1);
  // A real trip never starts from there by accident: the car stays where it is.
  await page.waitForFunction(([lng, lat]) => {
    const ll = window.__map.markers.find((m) => m.el.className === 'puck').ll;
    return Math.abs(ll[0] - lng) < 0.0002 && Math.abs(ll[1] - lat) < 0.0002;
  }, P.a);

  // Going there first: the start becomes the first stop, from where you really are.
  await page.click('#try-sim');
  await page.waitForFunction(() => document.getElementById('from-name').textContent === 'Lokasi anda');
  await page.waitForSelector('.route-opt');
  const body = log.fossgis.at(-1);
  assert.deepEqual(ends(body), [P.a, [101.71, 3.14], P.d]);
  assert.equal(await page.locator('.stop-row').count(), 1);
  assert.equal(await text(page, '#start'), 'Mula');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('starting point: swap the two ends, and change the destination from here', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet });
  await toPreview(page);
  await page.click('#swap-ends');
  await page.waitForFunction(() => document.getElementById('dest-name').textContent === 'Lokasi anda');
  await page.waitForSelector('.route-opt');
  assert.deepEqual(ends(log.fossgis.at(-1)), [P.d, P.a]);
  assert.equal(await text(page, '#from-name'), 'Suria KLCC');
  assert.equal(await text(page, '#start'), 'Pratonton');
  await page.click('#swap-ends');
  await page.waitForFunction(() => document.getElementById('dest-name').textContent === 'Suria KLCC');
  await page.waitForSelector('.route-opt');
  assert.deepEqual(ends(log.fossgis.at(-1)), [P.a, P.d]);
  assert.equal(await text(page, '#from-name'), 'Lokasi anda');
  assert.equal(await text(page, '#start'), 'Mula');

  await page.click('#to-row');
  assert.equal(await page.getAttribute('#search-input', 'placeholder'), 'Cari tempat atau alamat');
  assert.equal(await vis(page, '#search-quick'), false);
  await page.fill('#search-input', 'klcc');
  await page.waitForSelector('#search-results .place');
  await page.locator('#search-results .place').nth(1).click();
  await page.waitForFunction(() => /KLCC Park/.test(document.getElementById('dest-name').textContent));
  await page.waitForSelector('.route-opt');
  assert.deepEqual(ends(log.fossgis.at(-1)), [P.a, [101.71, 3.14]]);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('starting point: chosen on the map, and named once it can be', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2, viewport: { width: 390, height: 664 } });
  await toPreview(page);
  await page.click('#from-row');
  await page.click('#quick-map');
  assert.equal(await vis(page, '.pick-bar'), true);
  assert.equal(await vis(page, '#preview'), false);
  assert.equal(await vis(page, '#search'), false);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${shots}/23-pick-on-map.png` });
  // Backing out returns to the search, then the plan, with nothing changed.
  await page.click('#pick-back');
  await page.waitForSelector('#search:not([hidden])');
  await page.click('#quick-map');
  // The map centres on you to begin with. Move it a little, as a finger would.
  await page.evaluate(() => window.__map.jumpTo({ center: [101.72, 3.13] }));
  await page.click('#pick-use');
  await page.waitForSelector('#preview:not([hidden])');
  await page.waitForSelector('.route-opt');
  assert.equal(await vis(page, '.pick-bar'), false);
  assert.equal(await vis(page, '#search'), false);
  const [lng, lat] = ends(log.fossgis.at(-1))[0];
  assert.ok(Math.abs(lng - 101.72) < 0.0002 && Math.abs(lat - 3.13) < 0.0002, `${lng},${lat}`);
  await page.waitForFunction(() => document.getElementById('from-name').textContent === 'Suria KLCC');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('starting point: a way forward when your location is off', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet });
  await page.click('#where');
  await page.fill('#search-input', 'klcc');
  await page.waitForSelector('#search-results .place');
  await page.locator('#search-results .place').first().click();
  await page.waitForTimeout(50);
  await page.evaluate(() => window.__gps.deny());
  await page.waitForFunction(() => /perlukan lokasi/.test(document.getElementById('route-status').textContent));
  await page.locator('#route-status button', { hasText: 'Pilih titik mula' }).click();
  await page.fill('#search-input', 'klcc');
  await page.waitForSelector('#search-results .place');
  await page.locator('#search-results .place').nth(1).click();
  await page.waitForSelector('.route-opt');
  assert.deepEqual(ends(log.fossgis.at(-1))[0], [101.71, 3.14]);
  assert.equal(await text(page, '#start'), 'Pratonton');
  assert.equal(await vis(page, '#try-sim'), false, 'can\'t go there first without knowing where you are');
  // A swap can't happen in the other direction without it either, but it can here.
  await page.click('#start');
  await page.waitForSelector('#sim-panel:not([hidden])');
  await page.click('#btn-end');
  await page.click('#btn-end');
  await page.waitForSelector('.route-opt');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

const puck = (page) => page.evaluate(() => {
  const ll = window.__map.markers.find((m) => m.el.className === 'puck').ll;
  return [ll[0], ll[1]];
});
const seekValue = (page) => page.evaluate(() => Number(document.getElementById('sim-seek').getAttribute('aria-valuenow')));

async function startSim(page, opts) {
  await toPreview(page);
  await page.click('#try-sim');
  await page.waitForSelector('#sim-panel:not([hidden])');
}

await check('simulation: choose the speed, and pause it', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2, viewport: { width: 390, height: 664 } });
  await startSim(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/24-sim-controls.png` });
  await noOverflow(page, 'sim');
  await smallTargets(page, 'sim', ['#sim-play', '#sim-next', '#sim-list']);
  const chosen = () => page.evaluate(() => document.querySelector('#sim-speeds [aria-checked="true"]').textContent);
  assert.equal(await chosen(), '4×');

  await page.click('#sim-play');
  await page.waitForTimeout(100);
  const a = await puck(page);
  await page.waitForTimeout(600);
  const b = await puck(page);
  assert.ok(Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6, 'paused means still');
  assert.equal(await page.getAttribute('#sim-play', 'aria-label'), 'Sambung');
  await page.click('#sim-play');
  await page.waitForTimeout(500);
  const c = await puck(page);
  assert.ok(Math.abs(b[0] - c[0]) > 1e-5 || Math.abs(b[1] - c[1]) > 1e-5, 'and carries on');

  // Faster really is faster, measured along the trip.
  await page.click('#sim-play');
  await page.locator('#sim-speeds button', { hasText: '1×' }).click();
  await page.click('#sim-play');
  const startAt = await seekValue(page);
  await page.waitForTimeout(1000);
  const slowGain = (await seekValue(page)) - startAt;
  await page.click('#sim-play');
  await page.locator('#sim-speeds button', { hasText: '30×' }).click();
  assert.equal(await chosen(), '30×');
  const fromFast = await seekValue(page);
  await page.click('#sim-play');
  await page.waitForTimeout(1000);
  const fastGain = (await seekValue(page)) - fromFast;
  assert.ok(fastGain >= slowGain + 5, `fast ${fastGain}, slow ${slowGain}`);
  await page.click('#sim-play');
  // The choice is remembered.
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pintu.settings')).simSpeed), 30);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('simulation: drag anywhere along the trip, forward or back, quietly', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet });
  await startSim(page);
  await page.click('#sim-play');
  const trip = prepareTrip(cityTrip());
  const box = await page.locator('#nav-strip').boundingBox();
  const y = box.y + box.height / 2;
  const xAt = (f) => box.x + box.width * f;
  const routes = log.fossgis.length;
  await page.waitForTimeout(120);  // anything said just before pausing has a moment to land
  const before = (await said(page)).length;

  await page.mouse.move(xAt(0.1), y);
  await page.mouse.down();
  for (const f of [0.2, 0.4, 0.6, 0.8]) {
    await page.mouse.move(xAt(f), y);
    await page.waitForTimeout(90);
  }
  assert.equal((await said(page)).length, before, 'nothing spoken while dragging');
  await page.mouse.up();
  await page.waitForTimeout(120);
  assert.ok(Math.abs((await seekValue(page)) - 80) <= 1, String(await seekValue(page)));
  let p = await puck(page);
  let want = pointAt(trip, trip.length * 0.8);
  assert.ok(Math.abs(p[0] - want[0]) < 0.0003 && Math.abs(p[1] - want[1]) < 0.0003, `${p} vs ${want}`);
  const after = await said(page);
  assert.equal(after.length, before + 1, 'one instruction for where you landed');
  assert.equal(log.fossgis.length, routes, 'a jump is not a wrong turn');
  assert.doesNotMatch(await text(page, '#chips'), /Mencari laluan|Laluan baharu/);
  const forward = await text(page, '#eta-rest');

  // And back again, which an ordinary drive never does.
  await page.mouse.move(xAt(0.25), y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
  assert.ok(Math.abs((await seekValue(page)) - 25) <= 1);
  p = await puck(page);
  want = pointAt(trip, trip.length * 0.25);
  assert.ok(Math.abs(p[0] - want[0]) < 0.0003 && Math.abs(p[1] - want[1]) < 0.0003, `${p} vs ${want}`);
  assert.notEqual(await text(page, '#eta-rest'), forward);
  assert.equal(log.fossgis.length, routes);

  // Sitting at the very end doesn't end the trip until you drive the last bit.
  await page.mouse.move(xAt(1), y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  assert.equal(await vis(page, '#arrival'), false);
  await page.click('#sim-play');
  await page.waitForSelector('#arrival:not([hidden])', { timeout: 15000 });
  await page.click('#arrival-done');
  await page.waitForSelector('.route-opt');
  assert.equal(await vis(page, '#preview'), true, 'back to the plan');
  assert.equal(await text(page, '#start'), 'Mula');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('simulation: a finger tap on the line jumps there, on phone sizes too', async () => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 664 }, { width: 844, height: 390 }]) {
    const name = `${viewport.width}x${viewport.height}`;
    const { ctx, page, log } = await newApp(browser, { ...quiet, viewport, scale: 2 });
    await startSim(page);
    await page.click('#sim-play');
    await page.waitForTimeout(350);
    const box = await page.locator('#nav-strip').boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.waitForTimeout(120);
    assert.ok(Math.abs((await seekValue(page)) - 50) <= 2, `${name}: ${await seekValue(page)}`);
    // Nothing here sits on top of anything else.
    const hits = await page.evaluate(() => ['sim-play', 'sim-next', 'sim-list', 'btn-end'].map((id) => {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      const pts = [[0.5, 0.5], [0.5, 0.1], [0.5, 0.9], [0.1, 0.5], [0.9, 0.5]].map(([x, y]) => [r.left + r.width * x, r.top + r.height * y]);
      return { id, ok: pts.every(([x, y]) => document.elementFromPoint(x, y)?.closest(`#${id}`)), inside: r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1 };
    }));
    for (const h of hits) assert.ok(h.ok && h.inside, `${name}: ${h.id} ${JSON.stringify(h)}`);
    await noOverflow(page, name);
    await page.screenshot({ path: `${shots}/25-sim-${name}.png` });
    // The speed buttons and the rest respond to a finger as well.
    await page.locator('#sim-speeds button', { hasText: '10×' }).tap();
    assert.equal(await page.evaluate(() => document.querySelector('#sim-speeds [aria-checked="true"]').textContent), '10×');
    assert.deepEqual(log.errors, []);
    await ctx.close();
  }
});

await check('simulation: next turn and the list of turns go straight there', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2, viewport: { width: 390, height: 664 } });
  await startSim(page);
  await page.click('#sim-play');
  const trip = prepareTrip(cityTrip());
  const routes = log.fossgis.length;
  const sign = () => text(page, '#sign-action');
  const first = await sign();

  await page.click('#sim-next');
  await page.waitForTimeout(100);
  const m1 = trip.maneuvers[1];
  assert.ok(Math.abs((await seekValue(page)) - Math.round(((m1.beginDist - 150) / trip.length) * 100)) <= 1);
  assert.match(await text(page, '#sign-distance'), /1[0-9]0 m|150 m/);
  assert.equal(await sign(), first, 'still on the way to that turn');

  // Pressing again from just before it goes on to the next one.
  await page.click('#sim-next');
  await page.waitForTimeout(100);
  const m2 = trip.maneuvers[2];
  assert.ok(Math.abs((await seekValue(page)) - Math.round(((m2.beginDist - 150) / trip.length) * 100)) <= 1);
  assert.notEqual(await sign(), first);

  await page.click('#sim-list');
  assert.equal(await vis(page, '#steps'), true);
  const rows = page.locator('#steps-list .place');
  assert.equal(await rows.count(), trip.maneuvers.length - 1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/26-sim-steps.png` });
  await noOverflow(page, 'steps');
  assert.equal(await page.locator('#steps-list .is-past').count() >= 1, true);
  await rows.first().click();
  await page.waitForTimeout(120);
  assert.equal(await vis(page, '#steps'), false);
  assert.ok(Math.abs((await seekValue(page)) - Math.round(((m1.beginDist - 150) / trip.length) * 100)) <= 1, 'back to the first turn');
  assert.equal(await sign(), first);
  assert.equal(log.fossgis.length, routes);
  assert.equal(await vis(page, '#nav-bar'), true);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('simulation: stops come and go as you jump past them', async () => {
  const { ctx, page, log } = await newApp(browser, {
    ...quiet,
    routeResponse: (b) => (b.locations.length > 2 ? { trip: multiLeg() } : { trip: cityTrip(), alternates: b.alternates ? [{ trip: altTrip() }] : [] }),
    tiles: TILE_PLACES,
  });
  await toPreview(page);
  await page.click('#add-stop');
  await page.waitForSelector('#stops-list .place');
  await page.locator('#stops-list .place').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.stop-row').length === 1);
  await page.waitForSelector('.route-opt');
  await page.click('#try-sim');
  await page.waitForSelector('#sim-panel:not([hidden])');
  await page.click('#sim-play');
  const trip = prepareTrip(multiLeg());
  const stopAt = trip.maneuvers.find((m) => m.isStop).beginDist;
  const box = await page.locator('#nav-strip').boundingBox();
  const tap = async (s) => {
    await page.mouse.move(box.x + box.width * (s / trip.length), box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(100);
  };
  const pins = () => page.evaluate(() => document.querySelectorAll('.map-pin.is-stop').length);
  assert.equal(await pins(), 1);
  await tap(stopAt + 400);
  assert.equal(await pins(), 0, 'skipped past');
  assert.equal(await vis(page, '#refill'), false);
  assert.equal(await page.locator('#nav-strip .mark-stop').count(), 0);
  await tap(stopAt - 400);
  assert.equal(await pins(), 1, 'ahead again');
  assert.equal(await page.locator('#nav-strip .mark-stop').count(), 1);
  // Ending returns to the plan with the stop still in it.
  await page.click('#btn-end');
  await page.click('#btn-end');
  await page.waitForSelector('.route-opt');
  assert.equal(await page.locator('.stop-row').count(), 1);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('simulation: adding a stop on the way follows the new route', async () => {
  const { ctx, page, log } = await newApp(browser, {
    ...quiet,
    routeResponse: (b) => (b.locations.length > 2 ? { trip: multiLeg() } : { trip: cityTrip(), alternates: b.alternates ? [{ trip: altTrip() }] : [] }),
    tiles: TILE_PLACES,
  });
  await startSim(page);
  await page.click('#sim-play');
  const box = await page.locator('#nav-strip').boundingBox();
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.click('#btn-add-stop');
  await page.waitForSelector('#stops-list .place');
  const asked = log.fossgis.length;
  await page.locator('#stops-list .place').first().click();
  await page.waitForFunction((n) => document.getElementById('toast').textContent.length > 0 && !document.getElementById('toast').hidden, asked);
  assert.equal(log.fossgis.length, asked + 1);
  // It keeps following the new route, and doesn't wander off and ask for another.
  await page.click('#sim-play');
  await page.waitForTimeout(2500);
  assert.equal(log.fossgis.length, asked + 1);
  assert.doesNotMatch(await text(page, '#chips'), /Mencari laluan/);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('simulation: too fast to talk over, but it still says you have arrived', async () => {
  const short = buildTrip(P.a, [
    { to: [101.704, 3.15], type: 1, street: 'Jalan Satu', kph: 40 },
    { to: [101.704, 3.154], type: 15, street: 'Jalan Dua', kph: 40 },
  ]);
  const { ctx, page, log } = await newApp(browser, { ...quiet, routeResponse: () => ({ trip: short }), storage: { 'pintu.safetySeen': 'true', 'pintu.settings': { simSpeed: 30 } } });
  await toPreview(page);
  const before = (await said(page)).length;
  await page.click('#try-sim');
  await page.waitForSelector('#arrival:not([hidden])', { timeout: 20000 });
  const words = (await said(page)).slice(before).map((s) => s.text);
  assert.deepEqual(words, ['Anda telah sampai.']);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('a real drive has none of the simulation controls', async () => {
  const { ctx, page, log } = await newApp(browser, quiet);
  await toNav(page);
  assert.equal(await vis(page, '#sim-panel'), false);
  assert.equal(await page.locator('#sim-seek').isVisible(), false);
  // And the line can't move anything.
  const box = await page.locator('#nav-strip').boundingBox();
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
  const st = await page.evaluate(() => document.getElementById('eta-rest').textContent);
  assert.ok(st.length > 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pintu.trip')).dest.name), 'Suria KLCC');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

// Rolls along a prepared route at a steady speed, one fix per `every` seconds.
let rollClock = Date.now();
async function roll(page, trip, from, to, mps = 12, every = 1) {
  const pts = [];
  for (let s = from; ; s += mps * every) {
    const at = Math.min(s, to);
    const [lng, lat] = pointAt(trip, at);
    rollClock += every * 1000;
    pts.push([lng, lat, rollClock]);
    if (s >= to) break;
  }
  await page.evaluate(([list, speed]) => {
    for (const [lng, lat, time] of list) window.__gps.push(lng, lat, { accuracy: 8, speed, time });
  }, [pts, mps]);
  await page.waitForTimeout(40);
}

function wetForecast(url, { fromPoint = 0, mm = 12, code = 95, chance = 80 } = {}) {
  const lats = new URL(url).searchParams.get('latitude').split(',');
  const hour = Math.floor(Date.now() / 3600000) * 3600;
  const time = Array.from({ length: 72 }, (_, i) => hour - 3600 + i * 3600);
  const one = (i) => {
    const wet = i >= fromPoint;
    return { hourly: { time, precipitation: time.map(() => (wet ? mm : 0)), precipitation_probability: time.map(() => (wet ? chance : 5)), weather_code: time.map(() => (wet ? code : 3)) } };
  };
  return lats.length === 1 ? one(0) : lats.map((_, i) => one(i));
}
const dryForecast = (url) => wetForecast(url, { fromPoint: 99 });
const soon = () => new Date(Date.now() + 6 * 3600000 + 8 * 3600000).toISOString().slice(0, 19);
const WARNINGS = () => [
  { warning_issue: { issued: '2026-11-01T00:00:00', title_bm: 'Amaran Hujan Berterusan', title_en: 'Continuous Rain Warning' }, valid_from: '2026-11-01T00:00:00', valid_to: soon(),
    heading_en: 'Continuous Rain (Danger)', text_en: 'Continuous rain expected in Kuala Lumpur and Selangor.', instruction_en: 'Stay safe', heading_bm: 'Hujan Berterusan (Bahaya)', text_bm: 'Hujan berterusan dijangka di Kuala Lumpur dan Selangor.', instruction_bm: 'Jaga diri' },
  { warning_issue: { issued: '2026-11-01T00:00:00', title_bm: 'Ribut Petir', title_en: 'Thunderstorm' }, valid_from: '2026-11-01T00:00:00', valid_to: soon(),
    heading_en: 'Thunderstorms', text_en: 'Thunderstorms expected in Sabah.', heading_bm: 'Ribut Petir', text_bm: 'Ribut petir dijangka di Sabah.' },
  { warning_issue: { issued: '2026-11-01T00:00:00', title_bm: 'Angin Kencang', title_en: 'Strong Wind and Rough Seas' }, valid_from: '2026-11-01T00:00:00', valid_to: soon(),
    heading_en: 'Strong Wind and Rough Seas', text_en: 'Rough seas off Kuala Lumpur.', heading_bm: 'Angin Kencang dan Laut Bergelora', text_bm: 'Laut bergelora.' },
];

await check('voices: choose a character, hear it, and it lasts', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2, viewport: { width: 390, height: 664 } });
  await page.click('#btn-settings');
  const rows = page.locator('#voice-chars .char-opt');
  assert.equal(await rows.count(), 9);
  assert.match(await text(page, '#voice-chars'), /Kapten/);
  assert.match(await text(page, '#voice-chars'), /Pencerita Filem/);
  assert.equal(await page.getAttribute('#voice-full', 'aria-checked'), 'true');
  await rows.filter({ hasText: 'Kapten' }).click();
  await page.waitForFunction(() => window.__said.length > 0);
  const heard = (await said(page)).at(-1);
  assert.match(heard.text, /300 meter/, 'the sample still gives the direction');
  assert.ok(heard.pitch < 1 && heard.rate < 1, JSON.stringify(heard));
  await page.locator('#voice-chars').scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${shots}/30-voices.png` });
  await noOverflow(page, 'voices');
  await page.reload();
  await page.click('#btn-settings');
  assert.equal(await rows.filter({ hasText: 'Kapten' }).getAttribute('aria-checked'), 'true');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('voices: a character never loses the instruction, and the first word of a turn is still a turn', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...quiet, storage: { 'pintu.safetySeen': 'true', 'pintu.settings': { voiceCharacter: 'adik' } } });
  await toNav(page);
  await roll(page, trip, 0, 60);
  const lines = (await said(page)).map((s) => s.text);
  assert.match(lines[0], /Dah sampai ke belum|Jalan-jalan|tali pinggang|teddy/, 'the greeting');
  assert.match(lines[0], /Terus sejauh|Mula|belok/i, 'and the instruction with it');
  const before = lines.length;
  await roll(page, trip, 60, trip.maneuvers[1].beginDist + 5, 12);
  const after = (await said(page)).slice(before).map((s) => s.text);
  const now = after.find((l) => /belok kanan ke Jalan Tun Razak\.$/i.test(l) && !/Dalam|Terus/.test(l));
  assert.ok(now, after.join(' | '));
  assert.ok(now.length < 70, 'short at the moment of the turn');
  assert.match(after.join(' '), /Jalan Tun Razak/);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('voices: turns only keeps quiet until a turn', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...quiet, storage: { 'pintu.safetySeen': 'true', 'pintu.settings': { voiceLevel: 'turns' } } });
  await toNav(page);
  await roll(page, trip, 0, 200);
  assert.equal((await said(page)).length, 0, 'no intro');
  await roll(page, trip, 200, trip.maneuvers[1].beginDist + 5, 12);
  const words = (await said(page)).map((s) => s.text);
  assert.equal(words.filter((w) => /^Dalam/.test(w)).length, 0, 'no warning a long way out');
  assert.equal(words.filter((w) => /^Belok kanan/.test(w)).length, 1, words.join(' | '));
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('speed limit: shown where mapped, warns once when over, and stays out of the way otherwise', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2, viewport: { width: 390, height: 664 } });
  log.laneCounts = { edges: [{ length: 1, lane_count: 2 }, { length: 10, lane_count: 2, speed_limit: 60 }] };
  await toNav(page);
  await roll(page, trip, 0, 300, 12);
  assert.equal(await vis(page, '#speed-limit'), false, 'the first stretch has no limit mapped');
  await roll(page, trip, 300, 1200, 12);
  await page.waitForFunction(() => document.getElementById('speed-limit').textContent === '60');
  assert.equal(await vis(page, '#speed-limit'), true);
  assert.equal(await page.locator('#speed.is-over').count(), 0);
  await page.screenshot({ path: `${shots}/31-limit.png` });
  const before = (await said(page)).length;
  // Just over, briefly: nothing. Then properly over.
  await roll(page, trip, 1200, 1400, 25, 1);
  await page.waitForFunction(() => document.getElementById('speed').classList.contains('is-over'));
  await page.screenshot({ path: `${shots}/32-over-limit.png` });
  await roll(page, trip, 1400, 1800, 25, 1);
  const warned = (await said(page)).slice(before).filter((s) => /Had laju 60/.test(s.text));
  assert.equal(warned.length, 1, JSON.stringify(warned));
  await roll(page, trip, 1800, 2100, 12);
  await page.waitForFunction(() => !document.getElementById('speed').classList.contains('is-over'));
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('speed limit: can be turned off, and nothing is guessed when the map has none', async () => {
  const trip = prepareTrip(cityTrip());
  const none = await newApp(browser, { ...quiet });
  none.log.laneCounts = { edges: [{ length: 10, lane_count: 2 }] };
  await toNav(none.page);
  await roll(none.page, trip, 0, 400, 25);
  assert.equal(await vis(none.page, '#speed-limit'), false);
  assert.equal(await none.page.locator('#speed.is-over').count(), 0);
  await none.ctx.close();
  const off = await newApp(browser, { ...quiet, storage: { 'pintu.safetySeen': 'true', 'pintu.settings': { speedLimit: false } } });
  off.log.laneCounts = { edges: [{ length: 10, lane_count: 2, speed_limit: 30 }] };
  await toNav(off.page);
  await roll(off.page, trip, 0, 400, 25);
  assert.equal(await vis(off.page, '#speed-limit'), false);
  assert.equal(await off.page.locator('#speed.is-over').count(), 0);
  await off.ctx.close();
});

await check('rain: shown on the plan with where and when, and official warnings for the area', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2, viewport: { width: 390, height: 664 }, forecast: (u) => wetForecast(u, { fromPoint: 1, code: 61, mm: 3 }), warnings: WARNINGS });
  await toPreview(page);
  await page.waitForFunction(() => /Mungkin hujan/.test(document.getElementById('plan-weather-title').textContent));
  assert.match(await text(page, '#plan-weather-title'), /Mungkin hujan .*lagi, sekitar/);
  await page.waitForFunction(() => /amaran rasmi/.test(document.getElementById('plan-weather-detail').textContent));
  assert.match(await text(page, '#plan-weather-detail'), /^1 amaran/, 'only the one for this route, and not the sea');
  await page.locator('#plan-weather').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/33-plan-rain.png` });
  await page.click('#plan-weather');
  assert.equal(await vis(page, '#weather'), true);
  assert.match(await text(page, '#weather-warnings'), /Hujan Berterusan \(Bahaya\)/);
  assert.doesNotMatch(await text(page, '#weather-warnings'), /Sabah|Laut/);
  assert.match(await text(page, '#weather-warnings'), /boleh menyebabkan banjir/);
  assert.match(await text(page, '#weather-note'), /Tiada amaran tidak bermaksud jalan selamat/);
  assert.equal(await page.getAttribute('#weather-roads', 'href'), 'https://bencana.jkr.gov.my/');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/34-weather-sheet.png` });
  await noOverflow(page, 'weather');
  await page.click('#weather-back');
  await page.waitForSelector('#weather', { state: 'hidden' });
  assert.equal(log.forecast.length, 1, 'once per route');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('rain: a failed check says so, and never reads as all clear', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet });
  await toPreview(page);
  await page.waitForFunction(() => /Tak dapat semak hujan/.test(document.getElementById('plan-weather-title').textContent));
  await page.click('#plan-weather');
  assert.doesNotMatch(await text(page, '#weather-rain'), /Tiada hujan/);
  assert.match(await text(page, '#weather-rain'), /Tak dapat/);
  assert.match(await text(page, '#weather-warnings'), /tidak bermaksud tiada amaran/);
  await ctx.close();

  const dry = await newApp(browser, { ...quiet, forecast: dryForecast, warnings: () => [] });
  await toPreview(dry.page);
  await dry.page.waitForFunction(() => /Tiada hujan dijangka/.test(document.getElementById('plan-weather-title').textContent));
  assert.deepEqual(dry.log.errors, []);
  await dry.ctx.close();

  const off = await newApp(browser, { ...quiet, storage: { 'pintu.safetySeen': 'true', 'pintu.settings': { weather: false } } });
  await toPreview(off.page);
  await off.page.waitForTimeout(150);
  assert.equal(await vis(off.page, '#plan-weather'), false);
  assert.equal(off.log.forecast.length, 0, 'nothing is sent when it is off');
  assert.equal(off.log.warnings, 0);
  await off.ctx.close();
  assert.deepEqual(log.errors, []);
});

await check('rain: warned about on the way, once, and never over a turn', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...quiet, forecast: (u) => wetForecast(u, { fromPoint: 1, code: 95 }), warnings: () => [] });
  await toNav(page);
  await roll(page, trip, 0, 200, 12);
  await page.waitForFunction(() => /Ribut petir/.test(document.getElementById('chips').textContent));
  const words = (await said(page)).map((s) => s.text);
  assert.equal(words.filter((w) => /ribut petir/i.test(w)).length, 1, words.join(' | '));
  await roll(page, trip, 200, 500, 12);
  assert.equal((await said(page)).filter((s) => /ribut petir/i.test(s.text)).length, 1);
  await page.locator('#chips .chip', { hasText: 'Ribut petir' }).click();
  assert.equal(await vis(page, '#weather'), true);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('HUD: big, black, flipped for the windscreen, and easy to leave', async () => {
  const trip = prepareTrip(cityTrip());
  for (const viewport of [{ width: 390, height: 664 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
    const name = `${viewport.width}x${viewport.height}`;
    const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2, viewport });
    log.laneCounts = { edges: [{ length: 10, lane_count: 2, speed_limit: 60 }] };
    await toNav(page);
    await roll(page, trip, 0, 500, 12);
    await page.click('#btn-hud');
    assert.equal(await vis(page, '#hudmode'), true);
    await roll(page, trip, 500, 600, 12);
    await page.waitForFunction(() => document.getElementById('hm-limit').textContent === '60');
    assert.match(await text(page, '#hm-road'), /Jalan Tun Razak/);
    assert.match(await text(page, '#hm-distance'), /m|km/);
    assert.equal(await text(page, '#hm-speed'), '43');
    assert.equal(await text(page, '#hm-limit'), '60');
    const flipped = await page.evaluate(() => getComputedStyle(document.getElementById('hm-face')).transform);
    assert.equal(flipped, 'matrix(1, 0, 0, -1, 0, 0)', 'flipped top to bottom, with left and right kept');
    const bg = await page.evaluate(() => getComputedStyle(document.getElementById('hudmode')).backgroundColor);
    assert.equal(bg, 'rgb(0, 0, 0)');
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${shots}/35-hud-controls-${name}.png` });
    await page.evaluate(() => document.getElementById('hm-controls').classList.add('is-hidden'));
    await page.waitForTimeout(260);
    await page.screenshot({ path: `${shots}/35-hud-${name}.png` });
    // Everything fits, even with the longest things in place.
    await page.evaluate(() => { document.getElementById('hm-speed').textContent = '110'; document.getElementById('hm-distance').textContent = '12.5 km'; });
    const fits = await page.evaluate(() => [...document.querySelectorAll('#hm-face *')].filter((e) => e.getBoundingClientRect().width && !e.closest('svg')).map((e) => {
      const r = e.getBoundingClientRect();
      return { id: e.id || e.className, ok: r.right <= innerWidth + 1 && r.left >= -1 && r.top >= -1 && r.bottom <= innerHeight + 1 };
    }).filter((x) => !x.ok));
    assert.deepEqual(fits, [], name);
    // The options go away by themselves, then come back with a tap.
    await page.evaluate(() => document.getElementById('hm-controls').classList.add('is-hidden'));
    await page.mouse.click(viewport.width / 2, viewport.height / 3);
    assert.equal(await page.locator('#hm-controls.is-hidden').count(), 0);
    await page.click('#hm-mirror');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('hm-face')).transform), 'none');
    assert.equal(await text(page, '#hm-mirror'), 'Cermin: mati');
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${shots}/36-hud-plain-${name}.png` });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pintu.settings')).hudMirror), false);
    await page.click('#hm-close');
    await page.waitForSelector('#hudmode', { state: 'hidden' });
    assert.equal(await vis(page, '#nav-bar'), true, 'still on the trip');
    assert.deepEqual(log.errors, []);
    await ctx.close();
  }
});

await check('HUD: arriving leaves it, and it follows a simulated drive', async () => {
  const short = buildTrip(P.a, [
    { to: [101.704, 3.15], type: 1, street: 'Jalan Satu', kph: 40 },
    { to: [101.704, 3.1535], type: 15, street: 'Jalan Dua', kph: 40 },
  ]);
  const { ctx, page, log } = await newApp(browser, { ...quiet, routeResponse: () => ({ trip: short }) });
  await toPreview(page);
  await page.click('#try-sim');
  await page.waitForSelector('#sim-panel:not([hidden])');
  await page.click('#btn-hud');
  await page.waitForFunction(() => document.getElementById('hm-distance').textContent.length > 0);
  await page.waitForSelector('#arrival:not([hidden])', { timeout: 20000 });
  assert.equal(await vis(page, '#hudmode'), false);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

const typeAndPick = async (page, value) => {
  await page.fill('#search-input', value);
  await page.waitForSelector('#search-results .place');
  await page.locator('#search-results .place').first().click();
  await page.waitForSelector('.route-opt');
};

await check('shared links: full links, messages and coordinates go straight to the place', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet });
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat, { accuracy: 10 }), P.a);
  await page.click('#where');
  await typeAndPick(page, 'Jumpa sini\nhttps://www.google.com/maps/place/Kedai+Kopi/@3.1500,101.7000,17z/data=!3m1!4b1!4m6!3m5!1s0x0!8m2!3d3.1579!4d101.7116');
  assert.deepEqual(log.fossgis.at(-1).locations.at(-1).lat, 3.1579);
  assert.deepEqual(log.fossgis.at(-1).locations.at(-1).lon, 101.7116);
  assert.equal(await text(page, '#dest-name'), 'Kedai Kopi');
  assert.equal(log.photon.filter((u) => !u.includes('/reverse')).length, 0, 'no need to search');
  await page.click('#preview-back');
  await page.waitForSelector('#where');
  await page.click('#where');
  await typeAndPick(page, 'https://waze.com/ul?ll=3.14%2C101.71&navigate=yes');
  assert.equal(log.fossgis.at(-1).locations.at(-1).lat, 3.14);
  // It had no name, so one is looked up.
  await page.waitForFunction(() => document.getElementById('dest-name').textContent === 'Suria KLCC');
  await page.click('#preview-back');
  await page.waitForSelector('#where');
  await page.click('#where');
  // A link with only a name becomes a search for it.
  await page.fill('#search-input', 'https://www.google.com/maps/search/?api=1&query=Suria+KLCC');
  await page.waitForSelector('#search-results .place');
  assert.ok(log.photon.at(-1).includes('q=Suria+KLCC'), log.photon.at(-1));
  // A short link, before the server exists, explains itself.
  await page.fill('#search-input', 'https://maps.app.goo.gl/AbCdEf');
  await page.waitForFunction(() => /belum boleh dibuka/.test(document.getElementById('search-status').textContent));
  assert.equal(log.server.length, 0);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('shared links: short ones go through the server, and failures say so', async () => {
  const appServer = (url) => {
    if (url.pathname === '/link' && url.searchParams.get('u').includes('good')) return { lat: 3.145, lng: 101.705, name: 'Tempat Rahsia', url: 'https://www.google.com/maps/place/x' };
    return null;
  };
  const { ctx, page, log } = await newApp(browser, { ...quiet, appServer });
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat, { accuracy: 10 }), P.a);
  await page.click('#where');
  await page.fill('#search-input', 'https://maps.app.goo.gl/bad');
  await page.waitForFunction(() => /tak dapat dibuka/.test(document.getElementById('search-status').textContent));
  await typeAndPick(page, 'https://maps.app.goo.gl/good');
  assert.equal(await text(page, '#dest-name'), 'Tempat Rahsia');
  assert.equal(log.fossgis.at(-1).locations.at(-1).lat, 3.145);
  assert.ok(log.server.some((u) => /\/link\?u=https%3A%2F%2Fmaps\.app\.goo\.gl%2Fgood$/.test(u)), log.server.join());
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('shared links: opening Pintu with a link goes straight there, and the address is tidied', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, url: `${ORIGIN}?to=3.14,101.71&name=Rumah%20Mak` });
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat, { accuracy: 10 }), P.a);
  await page.waitForSelector('.route-opt');
  assert.equal(await text(page, '#dest-name'), 'Rumah Mak');
  assert.equal(log.fossgis.at(-1).locations.at(-1).lat, 3.14);
  assert.equal(await page.evaluate(() => location.search), '');
  assert.deepEqual(log.errors, []);
  await ctx.close();

  const sharedIn = await newApp(browser, { ...quiet, url: `${ORIGIN}?title=Suria&text=${encodeURIComponent('Jom sini')}&url=${encodeURIComponent('https://www.google.com/maps?q=3.14,101.71')}` });
  await sharedIn.page.waitForSelector('#preview:not([hidden])');
  assert.equal(await sharedIn.page.evaluate(() => location.search), '');
  assert.deepEqual(sharedIn.log.errors, []);
  await sharedIn.ctx.close();
});

const pedestrian = (b) => b.costing === 'pedestrian';

await check('walking: chosen as a mode, with nothing about cars', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2, viewport: { width: 320, height: 568 }, forecast: dryForecast, warnings: () => [] });
  await toPreview(page);
  assert.equal(await vis(page, '#toll-wrap'), true);
  await page.click('#mode-walk');
  await page.waitForFunction(() => document.getElementById('mode-walk').getAttribute('aria-checked') === 'true');
  await page.waitForSelector('.route-opt');
  assert.ok(pedestrian(log.fossgis.at(-1)));
  assert.equal(await vis(page, '#toll-wrap'), false);
  assert.equal(await vis(page, '#plan-fuel'), false);
  assert.equal(await vis(page, '#plan-weather'), false);
  await noOverflow(page, 'walking');
  await page.screenshot({ path: `${shots}/37-walk-preview.png` });
  // A simulated walk, in a browser with no real GPS movement.
  await page.click('#try-sim');
  await page.waitForSelector('#sim-panel:not([hidden])');
  await page.waitForTimeout(400);
  assert.equal(await vis(page, '#speed'), false, 'no speedometer on foot');
  assert.equal(log.trace.length, 0, 'no lane or speed limit requests');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pintu.mode') || '"car"')), 'car', 'not remembered for next time');
  await page.screenshot({ path: `${shots}/38-walking.png` });
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('walking: from the arrival screen to the door, then back in the car', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...quiet, routeResponse: (b) => ({ trip: pedestrian(b) ? buildTrip(trip.coords.at(-1), [{ to: [P.d[0] + 0.0005, P.d[1]], type: 1, street: 'Laluan Pejalan Kaki', kph: 5 }, { to: [P.d[0] + 0.0005, P.d[1] + 0.0004], type: 42, kph: 5 }, { to: [P.d[0] + 0.0005, P.d[1] + 0.0008], type: 4, kph: 5 }]) : cityTrip() }) });
  await toNav(page);
  await roll(page, trip, 0, trip.length, 15);
  await page.waitForSelector('#arrival:not([hidden])');
  assert.equal(await text(page, '#arrival-walk'), 'Jalan ke pintu');
  assert.equal(await vis(page, '#arrival-mall'), false);
  await page.screenshot({ path: `${shots}/39-arrival-walk.png` });
  await page.click('#arrival-walk');
  await page.waitForSelector('#nav-bar');
  await page.waitForFunction(() => !document.getElementById('nav').hidden);
  assert.ok(pedestrian(log.fossgis.at(-1)));
  const walk = prepareTrip(log.routeResponseLast || buildTrip(trip.coords.at(-1), [{ to: [P.d[0] + 0.0005, P.d[1]], type: 1, street: 'Laluan Pejalan Kaki', kph: 5 }, { to: [P.d[0] + 0.0005, P.d[1] + 0.0004], type: 42, kph: 5 }, { to: [P.d[0] + 0.0005, P.d[1] + 0.0008], type: 4, kph: 5 }]));
  await roll(page, walk, 0, walk.length * 0.2, 1.4, 5);
  await page.waitForFunction(() => /Masuk ke bangunan/.test(document.getElementById('sign-action').textContent));
  assert.equal(await vis(page, '#speed'), false);
  await roll(page, walk, walk.length * 0.2, walk.length, 1.4, 5);
  await page.waitForSelector('#arrival:not([hidden])');
  assert.equal(await vis(page, '#arrival-walk'), false, 'already at the door');
  await page.click('#arrival-done');
  await page.waitForSelector('#where');
  await toPreview(page);
  assert.equal(await page.getAttribute('#mode-car', 'aria-checked'), 'true');
  assert.equal(log.fossgis.at(-1).costing, 'auto');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('malls: links to the map and shops, and a shop search once the server is there', async () => {
  const mallPlace = { type: 'Feature', geometry: { type: 'Point', coordinates: [101.7149, 2.9701] }, properties: { name: 'IOI City Mall', city: 'Putrajaya', state: 'Selangor', countrycode: 'MY' } };
  const shops = [{ name: 'UNIQLO', lot: 'G11-3' }, { name: "MCDONALD'S", lot: 'LG57-2' }, { name: 'AEON', lot: '2AT1-2' }];
  const appServer = (url) => (url.pathname === '/mall' && url.searchParams.get('id') === 'ioi-city' ? { shops } : null);
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2, viewport: { width: 390, height: 664 }, appServer, photonFeatures: [mallPlace] });
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat, { accuracy: 10 }), P.a);
  await page.click('#where');
  await typeAndPick(page, 'ioi city');
  assert.match(await text(page, '#plan-mall-title'), /IOI City Mall/);
  await page.click('#plan-mall');
  assert.equal(await page.getAttribute('#mall-map', 'href'), 'https://map.abuzzsolutions.asia/amap/map.php?site=ICM&servicesHtml=true&sharePoi=false&player=website');
  assert.match(await page.getAttribute('#mall-list', 'href'), /ioicitymall\.com\.my/);
  await page.waitForSelector('#mall-search:not([hidden])');
  await page.fill('#mall-search', 'uniq');
  assert.match(await text(page, '#mall-results'), /UNIQLO\s*G11-3/);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shots}/40-mall.png` });
  await noOverflow(page, 'mall');
  await page.fill('#mall-search', 'tiada');
  assert.match(await text(page, '#mall-status'), /Tiada kedai/);
  await page.click('#mall-back');
  await page.waitForSelector('#mall', { state: 'hidden' });
  assert.equal(await vis(page, '#preview'), true);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('malls: without the server it still offers the mall\'s own pages, also after arriving', async () => {
  const mallPlace = { type: 'Feature', geometry: { type: 'Point', coordinates: [P.d[0], P.d[1]] }, properties: { name: 'IOI City Mall', city: 'Putrajaya', state: 'Selangor', countrycode: 'MY' } };
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...quiet, photonFeatures: [mallPlace] });
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat, { accuracy: 10 }), P.a);
  await page.click('#where');
  await typeAndPick(page, 'ioi city');
  await page.click('#start');
  await page.waitForSelector('#nav-bar');
  await roll(page, trip, 0, trip.length, 15);
  await page.waitForSelector('#arrival:not([hidden])');
  assert.match(await text(page, '#arrival-mall'), /IOI City Mall/);
  await page.click('#arrival-mall');
  assert.equal(await vis(page, '#mall'), true);
  assert.equal(await vis(page, '#mall-search'), false);
  assert.match(await text(page, '#mall-status'), /belum tersedia/);
  assert.equal(log.server.length, 0);
  await page.click('#mall-back');
  await page.waitForSelector('#mall', { state: 'hidden' });
  assert.equal(await vis(page, '#arrival-done'), true, 'still on the arrival screen');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});


/* ---------- Human voices ---------- */

const voiceServer = ({ ready = true, reason, delay = () => 0, status } = {}) => async (url) => {
  if (url.pathname !== '/speak') return null;
  if (url.searchParams.has('check')) return ready ? { ready: true } : { ready: false, reason };
  if (status) return { __status: status };
  const wait = delay(url);
  if (wait) await new Promise((r) => setTimeout(r, wait));
  return { __audio: [1, 2, 3] };
};
const asked = (log) => log.server.filter((u) => u.includes('/speak') && !u.includes('check=')).map((u) => new URL(u).searchParams);
const played = (page) => page.evaluate(() => window.__played);
const withCast = (who, extra = {}) => ({ storage: { 'pintu.safetySeen': 'true', 'pintu.settings': { voiceCharacter: who, ...extra } } });
const settled = (page) => page.waitForTimeout(150);

await check('human voice: directions play as a recording, and the phone stays quiet', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...withCast('captain'), appServer: voiceServer() });
  await toNav(page);
  await roll(page, trip, 0, 40, 12);
  await page.waitForFunction(() => window.__played.length > 0);
  assert.deepEqual(await said(page), [], 'nothing from the phone voice');
  const first = asked(log)[0];
  assert.equal(first.get('who'), 'captain');
  assert.equal(first.get('lang'), 'ms');
  assert.ok(first.get('v'));
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('human voice: delivery marks go to the voice, and never to the screen', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...withCast('captain'), appServer: voiceServer() });
  await toNav(page);
  await roll(page, trip, 0, trip.length, 15);
  await page.waitForSelector('#arrival:not([hidden])');
  await page.waitForFunction(() => document.getElementById('speak-live').textContent.length > 0);
  const live = await page.evaluate(() => document.getElementById('speak-live').textContent);
  const quip = await text(page, '#arrival-quip');
  assert.doesNotMatch(live + quip, /\[[a-z]+\]/, `${live} ${quip}`);
  assert.ok(asked(log).length >= 2);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('human voice: the phone voice never hears a delivery mark', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, withCast('makcik'));
  await toNav(page);
  await roll(page, trip, 0, trip.length, 15);
  await page.waitForSelector('#arrival:not([hidden])');
  await settled(page);
  const all = await said(page);
  assert.ok(all.length >= 3);
  for (const { text: words } of all) assert.doesNotMatch(words, /\[[a-z]+\]/, words);
  assert.equal(log.server.length, 0);
  await ctx.close();
});

await check('human voice: a slow server never makes a direction late', async () => {
  const trip = prepareTrip(cityTrip());
  // Prepared lines and spoken ones alike take far too long to arrive.
  const { ctx, page, log } = await newApp(browser, { ...withCast('standard'), appServer: voiceServer({ delay: () => 6000 }) });
  await toNav(page);
  const started = Date.now();
  await roll(page, trip, 0, 40, 12);
  await page.waitForFunction(() => window.__said.length > 0, null, { timeout: 5500 });
  assert.ok(Date.now() - started < 5400, `spoke after ${Date.now() - started} ms`);
  const before = (await said(page)).length;
  assert.equal(before, 1);
  assert.deepEqual(await played(page), [], 'the phone spoke, so the recording must not talk over it');
  await page.waitForTimeout(6500);
  assert.deepEqual(await played(page), [], 'nor when it finally turns up');
  assert.ok(asked(log).length >= 1);
  await ctx.close();
});

await check('human voice: a server that fails hands over at once, and is left alone for a bit', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...withCast('standard'), appServer: voiceServer({ status: 500 }) });
  await toNav(page);
  await roll(page, trip, 0, 40, 12);
  await page.waitForFunction(() => window.__said.length > 0, null, { timeout: 2500 });
  await page.waitForTimeout(300);
  const tried = asked(log).length;
  assert.ok(tried >= 1);
  // Nobody waits on it again: the next direction goes straight to the phone.
  const before = (await said(page)).length;
  await roll(page, trip, 40, trip.length * 0.6, 15);
  await page.waitForFunction((n) => window.__said.length > n, before);
  assert.equal(asked(log).length, tried, 'not asked again straight away');
  assert.deepEqual(await played(page), []);
  await ctx.close();
});

await check('human voice: no key yet means the phone voice, plainly explained', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...withCast('uncle'), appServer: voiceServer({ ready: false, reason: 'no key', status: 503 }) });
  await page.click('#btn-settings');
  await page.waitForFunction(() => /belum disambungkan/.test(document.getElementById('voice-status').textContent));
  await page.click('#settings-back');
  await toNav(page);
  await roll(page, trip, 0, 40, 12);
  await page.waitForFunction(() => window.__said.length > 0, null, { timeout: 2500 });
  assert.equal(asked(log).length, 0, 'nothing to ask for');
  assert.deepEqual(await played(page), []);
  await ctx.close();
});

await check('human voice: a refused key says so, in words someone can act on', async () => {
  const { ctx, page } = await newApp(browser, { ...quiet, appServer: voiceServer({ ready: false, reason: 'key refused' }) });
  await page.click('#btn-settings');
  await page.waitForFunction(() => /ditolak/.test(document.getElementById('voice-status').textContent));
  await ctx.close();
});

await check('human voice: a server from before voices just means the phone voice', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...withCast('standard'), appServer: () => null });
  await toNav(page);
  await roll(page, trip, 0, 40, 12);
  await page.waitForFunction(() => window.__said.length > 0, null, { timeout: 2500 });
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('human voice: if the phone blocks the recording, the phone voice says it', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page } = await newApp(browser, { ...withCast('standard'), appServer: voiceServer() });
  await page.evaluate(() => { window.__audioBlocked = true; });
  await toNav(page);
  await roll(page, trip, 0, 40, 12);
  await page.waitForFunction(() => window.__said.length > 0, null, { timeout: 2500 });
  await ctx.close();
});

await check('human voice: the next directions are fetched before they\'re needed, once', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...withCast('standard'), appServer: voiceServer() });
  await page.waitForTimeout(100);
  await toNav(page);
  await roll(page, trip, 0, 40, 12);
  await page.waitForFunction(() => window.__played.length > 0);
  await page.waitForTimeout(200);
  const ready = asked(log).map((q) => q.get('text'));
  const turn = speech({ kind: 'now', index: 1, distance: 0 }, trip.maneuvers, 'ms');
  assert.ok(ready.includes(turn), `${turn} is not in ${JSON.stringify(ready)}`);
  assert.equal(new Set(ready).size, ready.length, 'nothing fetched twice');
  // When that moment comes, there's nothing left to fetch.
  const count = ready.length;
  const before = (await played(page)).length;
  await roll(page, trip, 40, trip.maneuvers[1].beginDist - 5, 12);
  await page.waitForFunction((n) => window.__played.length > n, before);
  const repeated = asked(log).map((q) => q.get('text')).filter((t) => t === turn);
  assert.equal(repeated.length, 1, 'the turn was already on the phone');
  assert.ok(asked(log).length >= count);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('human voice: choosing a character speaks in their voice, and shows who they sound like', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2, viewport: { width: 390, height: 664 }, appServer: voiceServer() });
  await page.click('#btn-settings');
  await page.waitForFunction(() => /Suara manusia aktif/.test(document.getElementById('voice-status').textContent));
  const list = await text(page, '#voice-chars');
  for (const words of [/Uncle Kopitiam/, /Cikgu Disiplin/, /loghat Melayu/, /loghat Cina/, /loghat India/, /Suara budak/]) assert.match(list, words);
  await page.locator('#voice-chars').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/50-voices.png` });
  await page.locator('#voice-chars .char-opt', { hasText: 'Uncle Kopitiam' }).click();
  await page.waitForFunction(() => window.__played.length > 0);
  const last = asked(log).at(-1);
  assert.equal(last.get('who'), 'uncle');
  assert.deepEqual(await said(page), []);
  await noOverflow(page, 'voices');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('human voice: every joke can be heard from settings, without driving badly', async () => {
  const { ctx, page, log } = await newApp(browser, { ...withCast('cikgu'), scale: 2, viewport: { width: 390, height: 664 }, appServer: voiceServer() });
  await page.click('#btn-settings');
  await page.waitForFunction(() => /Suara manusia aktif/.test(document.getElementById('voice-status').textContent));
  await page.locator('#voice-try').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/51-try-jokes.png` });
  for (const moment of ['overspeed', 'overspeed3', 'rain', 'jam', 'arrive']) {
    const before = asked(log).length;
    await page.click(`#voice-try [data-moment="${moment}"]`);
    await page.waitForTimeout(150);
    const line = asked(log).slice(before).map((q) => q.get('text')).join(' ');
    assert.ok(asked(log).length > before, moment);
    assert.ok(line, moment);
    if (moment.startsWith('overspeed')) assert.match(line, /90/, line);
    if (moment === 'rain') assert.match(line, /hujan/i, line);
  }
  await page.locator('#voice-chars .char-opt', { hasText: /^Biasa/ }).click();
  assert.equal(await vis(page, '#voice-try'), false, 'the plain voice has no jokes to try');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('human voice: a real audio element plays a real recording', async () => {
  const trip = prepareTrip(cityTrip());
  const wav = Buffer.alloc(44 + 8000);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + 8000, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(8000, 40);
  wav.fill(128, 44);
  const server = async (url) => {
    if (url.pathname !== '/speak') return null;
    if (url.searchParams.has('check')) return { ready: true };
    // Late enough that the moment of silence from the tap has finished by itself.
    await new Promise((r) => setTimeout(r, 400));
    return { __audio: [...wav], __type: 'audio/wav' };
  };
  const { ctx, page } = await newApp(browser, { ...withCast('standard'), realAudio: true, appServer: server });
  await page.evaluate(() => {
    const real = HTMLMediaElement.prototype.play;
    window.__plays = [];
    HTMLMediaElement.prototype.play = function play() {
      const entry = { src: this.src.slice(0, 20), result: 'waiting' };
      window.__plays.push(entry);
      const p = real.call(this);
      p.then(() => { entry.result = 'ok'; }, (e) => { entry.result = e.name; });
      return p;
    };
  });
  await toNav(page);
  await roll(page, trip, 0, 40, 12);
  await page.waitForFunction(() => window.__plays.some((p) => p.src.startsWith('blob:') && p.result !== 'waiting'));
  const plays = await page.evaluate(() => window.__plays);
  // The tap's moment of silence is there, and the first direction may well cut it off.
  const silence = plays.find((p) => p.src.startsWith('data:'));
  assert.ok(['ok', 'AbortError'].includes(silence?.result), JSON.stringify(plays));
  const source = await readFile(path.join(root, 'js/voice.js'), 'utf8');
  const [, dataUrl] = source.match(/const SILENCE = '([^']+)'/);
  assert.equal(await page.evaluate((src) => new Audio(src).play().then(() => 'ok', (e) => e.name), dataUrl), 'ok', 'and it really is playable');
  const clip = plays.find((p) => p.src.startsWith('blob:'));
  assert.equal(clip.result, 'ok', JSON.stringify(plays));
  assert.deepEqual(await said(page), []);
  await ctx.close();
});

await check('human voice: recordings stay on the phone, through a reload and an update', async () => {
  const { ctx, page, log } = await newApp(browser, { ...withCast('captain'), appServer: voiceServer() });
  const line = () => page.evaluate(() => import('/js/voice.js').then((v) => v.speak('Belok kiri.', { evenIfMuted: true })));
  await page.waitForFunction(async () => (await import('/js/voice.js')).humanVoice() === 'on');
  await line();
  await page.waitForFunction(() => window.__played.length > 0);
  await page.waitForFunction(async () => (await (await caches.open('pintu-voice-2')).keys()).length > 0);
  const sw = await readFile(path.join(root, 'sw.js'), 'utf8');
  assert.match(sw, /VOICE = 'pintu-voice-2'/);
  assert.match(sw, /new Set\(\[SHELL, LIBS, TILES, VOICE\]\)/);
  await page.reload();
  await page.waitForFunction(() => window.__map?.ready);
  const count = asked(log).length;
  await line();
  await page.waitForFunction(() => window.__played.length > 0);
  assert.equal(asked(log).length, count, 'not fetched again');
  await ctx.close();
});

await check('human voice: with the server gone, what\'s on the phone still plays', async () => {
  let gone = false;
  const server = async (url) => {
    if (url.pathname !== '/speak') return null;
    if (url.searchParams.has('check')) return gone ? { ready: false, reason: 'no key' } : { ready: true };
    return gone ? { __status: 503 } : { __audio: [1, 2, 3] };
  };
  const { ctx, page, log } = await newApp(browser, { ...withCast('captain'), appServer: server });
  const line = (words) => page.evaluate((w) => import('/js/voice.js').then((v) => v.speak(w, { evenIfMuted: true })), words);
  await page.waitForFunction(async () => (await import('/js/voice.js')).humanVoice() === 'on');
  await line('Belok kiri.');
  await page.waitForFunction(() => window.__played.length > 0);
  await page.waitForFunction(async () => (await (await caches.open('pintu-voice-2')).keys()).length > 0);
  gone = true;
  await page.reload();
  await page.waitForFunction(async () => (await import('/js/voice.js')).humanVoice() === 'off');
  const count = asked(log).length;
  await line('Belok kiri.');
  await page.waitForFunction(() => window.__played.length > 0);
  assert.deepEqual(await said(page), []);
  await line('Belok kanan.');
  await page.waitForFunction(() => window.__said.length > 0, null, { timeout: 1000 });
  assert.equal(asked(log).length, count, 'and nothing is asked of a server that has said no');
  await ctx.close();
});

await check('human voice: a direction and its joke are one recording, so they flow', async () => {
  const { ctx, page, log } = await newApp(browser, { ...withCast('uncle'), appServer: voiceServer() });
  await page.waitForFunction(async () => (await import('/js/voice.js')).humanVoice() === 'on');
  const line = (words) => page.evaluate((w) => import('/js/voice.js').then((v) => v.speak(w, { evenIfMuted: true })), words);
  assert.equal(await line('Belok kiri. [tease]Kopi tak lari.'), 'human');
  assert.deepEqual(asked(log).map((q) => q.get('text')), ['Belok kiri. [tease]Kopi tak lari.']);
  assert.equal((await played(page)).length, 1);
  assert.deepEqual(await said(page), []);
  await ctx.close();
});

await check('human voice: a line that\'s late is said in full by the phone, never half', async () => {
  const { ctx, page } = await newApp(browser, { ...withCast('uncle'), appServer: voiceServer({ delay: () => 3000 }) });
  await page.waitForFunction(async () => (await import('/js/voice.js')).humanVoice() === 'on');
  const heard = await page.evaluate(() => import('/js/voice.js').then((v) => v.speak('Belok kiri. [tease]Kopi tak lari.', { evenIfMuted: true, wait: 300 })));
  assert.equal(heard, 'phone');
  await settled(page);
  assert.deepEqual((await said(page)).map((s) => s.text), ['Belok kiri. Kopi tak lari.']);
  await page.waitForTimeout(3200);
  assert.deepEqual(await played(page), [], 'and the recording doesn\'t talk over it when it arrives');
  await ctx.close();
});

await check('human voice: if the first part can\'t come, the phone says the whole line', async () => {
  const { ctx, page } = await newApp(browser, { ...withCast('uncle'), appServer: voiceServer({ status: 500 }) });
  await page.waitForFunction(async () => (await import('/js/voice.js')).humanVoice() === 'on');
  await page.evaluate(() => import('/js/voice.js').then((v) => v.speak('[warm]Jom. [plain]Belok kiri. [tease]Kopi tak lari.', { evenIfMuted: true })));
  await settled(page);
  assert.deepEqual((await said(page)).map((s) => s.text), ['Jom. Belok kiri. Kopi tak lari.']);
  assert.deepEqual(await played(page), []);
  await ctx.close();
});

await check('human voice: a direction after a greeting that\'s missing is still said', async () => {
  const server = voiceServer({ delay: (url) => (url.searchParams.get('text').startsWith('[warm]') ? 3000 : 0) });
  const { ctx, page } = await newApp(browser, { ...withCast('uncle'), appServer: server });
  await page.waitForFunction(async () => (await import('/js/voice.js')).humanVoice() === 'on');
  await page.evaluate(() => import('/js/voice.js').then((v) => v.speak('[warm]Jom. [plain]Belok kiri.', { evenIfMuted: true, wait: 200 })));
  await settled(page);
  assert.deepEqual((await said(page)).map((s) => s.text), ['Jom. Belok kiri.']);
  await ctx.close();
});

await check('human voice: the next direction cuts off a line in the middle', async () => {
  const { ctx, page, log } = await newApp(browser, { ...withCast('uncle'), appServer: voiceServer() });
  await page.waitForFunction(async () => (await import('/js/voice.js')).humanVoice() === 'on');
  await page.evaluate(() => { window.__clipMs = 600; });
  await page.evaluate(() => { import('/js/voice.js').then((v) => { v.speak('Belok kiri. [tease]Kopi tak lari.', { evenIfMuted: true }); }); });
  await page.waitForFunction(() => window.__played.length === 1);
  await page.evaluate(() => import('/js/voice.js').then((v) => { v.speak('Belok kanan.', { evenIfMuted: true }); }));
  await page.evaluate(() => { window.__clipMs = 10; });
  await page.waitForFunction(() => window.__played.length === 2);
  await page.waitForTimeout(900);
  assert.equal((await played(page)).length, 2, 'the old joke never plays');
  assert.ok(asked(log).length >= 2);
  await ctx.close();
});

await check('human voice: all out for today says so, and what\'s recorded still plays', async () => {
  let out = false;
  const server = async (url) => {
    if (url.pathname !== '/speak') return null;
    if (url.searchParams.has('check')) return { ready: true };
    return out ? { __status: 429, __json: { error: 'daily' } } : { __audio: [1, 2, 3] };
  };
  const { ctx, page, log } = await newApp(browser, { ...withCast('captain'), appServer: server });
  const line = (words) => page.evaluate((w) => import('/js/voice.js').then((v) => v.speak(w, { evenIfMuted: true })), words);
  await page.waitForFunction(async () => (await import('/js/voice.js')).humanVoice() === 'on');
  await line('Belok kiri.');
  out = true;
  await line('Belok kanan.');
  await settled(page);
  assert.deepEqual((await said(page)).map((s) => s.text), ['Belok kanan.']);
  const count = asked(log).length;
  // It stops asking, and old recordings carry on.
  await line('Terus.');
  await settled(page);
  assert.equal(asked(log).length, count);
  assert.equal((await said(page)).at(-1).text, 'Terus.');
  const before = (await played(page)).length;
  await line('Belok kiri.');
  assert.equal((await played(page)).length, before + 1);
  await page.click('#btn-settings');
  await page.waitForFunction(() => /dah habis/.test(document.getElementById('voice-status').textContent));
  await ctx.close();
});

await check('human voice: choosing a voice says it\'s getting ready, and stops saying so', async () => {
  const { ctx, page } = await newApp(browser, { ...quiet, appServer: voiceServer({ delay: () => 700 }) });
  await page.click('#btn-settings');
  await page.waitForFunction(() => /Suara manusia aktif/.test(document.getElementById('voice-status').textContent));
  await page.locator('#voice-chars .char-opt', { hasText: 'Uncle Kopitiam' }).click();
  await page.waitForFunction(() => /Menyediakan suara/.test(document.getElementById('voice-wait').textContent));
  assert.equal(await vis(page, '#voice-wait'), true);
  await page.waitForFunction(() => window.__played.length > 0);
  await page.waitForFunction(() => document.getElementById('voice-wait').textContent === '');
  assert.equal(await vis(page, '#voice-wait'), false);
  await ctx.close();
});

await check('human voice: audio left encoded by the server is decoded and really plays', async () => {
  const wav = Buffer.alloc(44 + 4000);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + 4000, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(4000, 40);
  wav.fill(128, 44);
  const server = async (url) => {
    if (url.pathname !== '/speak') return null;
    if (url.searchParams.has('check')) return { ready: true };
    return { __encoded: wav.toString('base64') };
  };
  const { ctx, page } = await newApp(browser, { ...withCast('standard'), realAudio: true, appServer: server });
  await page.waitForFunction(async () => (await import('/js/voice.js')).humanVoice() === 'on');
  await page.click('#btn-settings');
  const heard = await page.evaluate(() => import('/js/voice.js').then((v) => v.speak('Belok kiri.', { evenIfMuted: true, wait: 5000 })));
  assert.equal(heard, 'human');
  assert.deepEqual(await said(page), []);
  const kept = await page.evaluate(async () => {
    const box = await caches.open('pintu-voice-2');
    const [first] = await box.keys();
    const blob = await (await box.match(first)).blob();
    return { size: blob.size, type: blob.type };
  });
  assert.equal(kept.size, wav.length);
  assert.equal(kept.type, 'audio/wav');
  await ctx.close();
});

await check('human voice: bare sound from Google is wrapped up and really plays', async () => {
  const server = async (url) => {
    if (url.pathname !== '/speak') return null;
    if (url.searchParams.has('check')) return { ready: true };
    return { __encoded: `audio/L16;codec=pcm;rate=24000\n${Buffer.alloc(9600).toString('base64')}` };
  };
  const { ctx, page } = await newApp(browser, { ...withCast('standard'), realAudio: true, appServer: server });
  await page.waitForFunction(async () => (await import('/js/voice.js')).humanVoice() === 'on');
  await page.click('#btn-settings');
  const heard = await page.evaluate(() => import('/js/voice.js').then((v) => v.speak('Belok kiri.', { evenIfMuted: true, wait: 5000 })));
  assert.equal(heard, 'human');
  assert.deepEqual(await said(page), []);
  const kept = await page.evaluate(async () => {
    const box = await caches.open('pintu-voice-2');
    const [first] = await box.keys();
    const blob = await (await box.match(first)).blob();
    return { size: blob.size, type: blob.type };
  });
  assert.deepEqual(kept, { size: 44 + 9600, type: 'audio/wav' });
  await ctx.close();
});

await check('voice check: says plainly what\'s wrong, one reason at a time', async () => {
  const cases = [
    [{ ok: false, problem: 'no key', engine: null, steps: [] }, /belum ada kunci/],
    [{ ok: false, problem: 'key', status: 403, engine: 'gemini', steps: [] }, /menolak kunci/],
    [{ ok: false, problem: 'daily', status: 429, engine: 'gemini', steps: [] }, /Kuota percuma/],
    [{ ok: false, problem: 'busy', status: 429, engine: 'gemini', steps: [] }, /dalam seminit/],
    [{ ok: false, problem: 'failed', status: 502, engine: 'gemini', who: 'standard', lang: 'ms', where: 'KUL', steps: [{ step: 'speak', status: 400, ms: 120, voice: 'Kore', why: 'User location is not supported' }] }, /gambar skrin/],
  ];
  for (const [report, words] of cases) {
    const server = async (url) => (url.pathname === '/speak' ? (url.searchParams.has('test') ? report : { ready: false, reason: 'no key' }) : null);
    const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2, viewport: { width: 390, height: 664 }, appServer: server });
    await page.click('#btn-settings');
    await page.click('#voice-check');
    await page.waitForFunction(() => document.querySelector('#voice-report p'));
    assert.match(await text(page, '#voice-report'), words);
    if (report.problem === 'failed') {
      assert.match(await text(page, '.voice-trace'), /speak 400 120ms Kore User location is not supported/);
      assert.match(await text(page, '.voice-trace'), /gemini standard ms KUL failed 502/);
      await page.locator('#voice-report').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${shots}/52-voice-check.png` });
      await noOverflow(page, 'voice check');
    }
    assert.deepEqual(log.errors, []);
    await ctx.close();
  }
});

await check('voice check: a server with old code, or none, is told apart', async () => {
  const old = await newApp(browser, { ...quiet, appServer: async () => ({ __status: 404 }) });
  await old.page.click('#btn-settings');
  await old.page.click('#voice-check');
  await old.page.waitForFunction(() => document.querySelector('#voice-report p'));
  assert.match(await text(old.page, '#voice-report'), /kod lama/);
  await old.ctx.close();
  const down = await newApp(browser, { ...quiet, appServer: () => null });
  await down.page.click('#btn-settings');
  await down.page.click('#voice-check');
  await down.page.waitForFunction(() => document.querySelector('#voice-report p'));
  assert.match(await text(down.page, '#voice-report'), /tak dapat dihubungi/);
  await down.ctx.close();
});

await check('voice check: when it works it says so, and plays a sample', async () => {
  const server = async (url) => {
    if (url.pathname !== '/speak') return null;
    if (url.searchParams.has('check')) return { ready: false, reason: 'no key' };
    if (url.searchParams.has('test')) return { ok: true, engine: 'gemini', steps: [{ step: 'speak', status: 200, ms: 900, voice: 'voice_abc' }] };
    return { __audio: [1, 2, 3] };
  };
  const { ctx, page } = await newApp(browser, { ...quiet, appServer: server });
  await page.click('#btn-settings');
  await page.click('#voice-check');
  await page.waitForFunction(() => document.querySelector('#voice-report .voice-good'));
  assert.match(await text(page, '#voice-report'), /Berfungsi/);
  await page.waitForFunction(() => window.__played.length > 0);
  assert.deepEqual(await said(page), []);
  await page.waitForFunction(() => /Suara manusia aktif/.test(document.getElementById('voice-status').textContent));
  await ctx.close();
});

await check('voice check: not offered with no server at all', async () => {
  const { ctx, page } = await newApp(browser, quiet);
  await page.click('#btn-settings');
  assert.equal(await vis(page, '#voice-check'), false);
  await ctx.close();
});

await check('after a sample, it says if that was the phone\'s voice, and why', async () => {
  const server = async (url) => {
    if (url.pathname !== '/speak') return null;
    if (url.searchParams.has('check')) return { ready: true };
    return { __status: 502, __json: { error: 'no voice could say that', why: 'Google 400: User location is not supported' } };
  };
  const { ctx, page } = await newApp(browser, { ...quiet, appServer: server });
  await page.click('#btn-settings');
  await page.waitForFunction(() => /Suara manusia aktif/.test(document.getElementById('voice-status').textContent));
  await page.locator('#voice-chars .char-opt', { hasText: 'Kapten' }).click();
  await page.waitForFunction(() => /suara telefon/.test(document.getElementById('voice-wait').textContent));
  assert.match(await text(page, '#voice-wait'), /User location is not supported/);
  await page.waitForFunction(() => window.__said.length >= 1);
  await ctx.close();
});

await check('after a sample, nothing is said when it was the human voice', async () => {
  const { ctx, page } = await newApp(browser, { ...quiet, appServer: voiceServer() });
  await page.click('#btn-settings');
  await page.waitForFunction(() => /Suara manusia aktif/.test(document.getElementById('voice-status').textContent));
  await page.locator('#voice-chars .char-opt', { hasText: 'Kapten' }).click();
  await page.waitForFunction(() => window.__played.length > 0);
  await page.waitForTimeout(300);
  assert.equal(await text(page, '#voice-wait').catch(() => ''), '');
  await ctx.close();
});

await check('human voices switched off: the phone\'s voice only, nothing asked, no accents promised', async () => {
  const config = await readFile(path.join(root, 'js/config.js'), 'utf8');
  assert.match(config, /humanVoices: false,/, 'off in the real app');
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...withCast('uncle'), humanVoices: false, appServer: voiceServer() });
  await page.click('#btn-settings');
  assert.equal(await vis(page, '#voice-check'), false);
  assert.doesNotMatch(await text(page, '#voice-chars'), /loghat|Suara budak/);
  assert.doesNotMatch(await text(page, '#voice-status'), /manusia/);
  await page.locator('#voice-chars .char-opt', { hasText: 'Kapten' }).click();
  await page.waitForFunction(() => window.__said.length > 0);
  await page.waitForTimeout(300);
  assert.equal(await text(page, '#voice-wait').catch(() => ''), '');
  await page.click('#settings-back');
  await toNav(page);
  await roll(page, trip, 0, trip.length, 15);
  await page.waitForSelector('#arrival:not([hidden])');
  assert.ok((await said(page)).length >= 3);
  assert.deepEqual(await played(page), []);
  assert.deepEqual(log.server.filter((u) => u.includes('/speak')), []);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

/* ---------- Speed cameras ---------- */

const cameraAt = along2(P.a, P.b, 0.8);
function along2(a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
const CAMERAS = { elements: [{ type: 'node', id: 9, lat: cameraAt[1], lon: cameraAt[0], tags: { highway: 'speed_camera', maxspeed: '60' } }] };

await check('speed cameras: a warning before one, on screen and aloud, once', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...quiet, overpass: CAMERAS, scale: 2 });
  await toNav(page);
  await page.waitForFunction(() => true);
  for (let i = 0; i < 50 && !log.overpass.some((b) => decodeURIComponent(b).includes('speed_camera')); i++) await page.waitForTimeout(50);
  assert.ok(log.overpass.some((b) => decodeURIComponent(b).includes('speed_camera')), 'asked for cameras');
  await page.waitForTimeout(150);
  await roll(page, trip, 0, 400, 12);
  assert.equal(await vis(page, '#camera-alert'), false, 'not yet');
  await roll(page, trip, 400, 700, 12);
  await page.waitForSelector('#camera-alert:not([hidden])');
  assert.match(await text(page, '#camera-alert'), /m\s*60/);
  await page.screenshot({ path: `${shots}/57-camera.png` });
  await roll(page, trip, 700, 860, 12);
  await page.waitForTimeout(100);
  const words = (await said(page)).map((x) => x.text).filter((x) => /Kamera laju/.test(x));
  assert.equal(words.length, 1, JSON.stringify(words));
  assert.match(words[0], /Kamera laju dalam \d+ meter\. Had 60\./);
  await roll(page, trip, 860, 1000, 12);
  assert.equal(await vis(page, '#camera-alert'), false, 'gone once passed');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('speed cameras: switched off, nothing asked and nothing said', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { storage: { 'pintu.safetySeen': 'true', 'pintu.settings': { speedCameras: false } }, overpass: CAMERAS });
  await page.click('#btn-settings');
  assert.equal(await page.isChecked('#camera-on'), false);
  await page.click('#settings-back');
  await toNav(page);
  await roll(page, trip, 0, 1000, 12);
  assert.ok(!log.overpass.some((b) => decodeURIComponent(b).includes('speed_camera')));
  assert.equal(await vis(page, '#camera-alert'), false);
  assert.ok(!(await said(page)).some((x) => /Kamera/.test(x.text)));
  await ctx.close();
});

await check('speed cameras: none answered means no warnings, and no fuss', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...quiet });
  log.overpassFail = true;
  await toNav(page);
  await roll(page, trip, 0, 1000, 12);
  assert.equal(await vis(page, '#camera-alert'), false);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

/* ---------- Tolls ---------- */

const tollTrip = () => buildTrip(P.a, [
  { to: P.b, type: 1, street: 'Jalan A' },
  { to: P.c, type: 18, street: 'E2', toll: true, highway: true },
  { to: P.d, type: 10, street: 'Jalan B' },
], { has_toll: true });

await check('tolls: each route says how far it runs on toll roads', async () => {
  const { ctx, page } = await newApp(browser, { ...quiet, routeResponse: () => ({ trip: tollTrip(), alternates: [{ trip: cityTrip() }] }) });
  await toPreview(page);
  assert.match(await text(page, '.route-opt >> nth=0'), /Tol, 1\.1 km/);
  assert.doesNotMatch(await text(page, '.route-opt >> nth=1'), /Tol/);
  await page.click('#mode-moto');
  await page.waitForSelector('.route-opt');
  assert.doesNotMatch(await text(page, '#route-list'), /Tol/, 'motorcycles don\'t pay tolls');
  await ctx.close();
});

/* ---------- Home and work ---------- */

await check('home and work: set from search, shown with the journey time, one tap to plan', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2 });
  assert.match(await text(page, '#saved-home'), /Rumah\s*Tetapkan/);
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat, { accuracy: 10 }), P.a);
  await page.click('#saved-home');
  assert.equal(await page.getAttribute('#search-input', 'placeholder'), 'Cari alamat rumah anda');
  assert.equal(await vis(page, '#search-quick'), true, 'here, or on the map');
  await page.fill('#search-input', 'klcc');
  await page.waitForSelector('#search-results .place');
  await page.locator('#search-results .place').first().click();
  await page.waitForSelector('#idle:not([hidden])');
  await page.waitForFunction(() => /sampai/.test(document.getElementById('saved-home-detail').textContent));
  assert.match(await text(page, '#saved-home-detail'), /min, sampai \d/);
  const asked = log.fossgis.length;
  assert.ok(asked >= 1);
  // The same place, a moment later: no need to ask again.
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat, { accuracy: 10 }), P.a);
  await page.waitForTimeout(150);
  assert.equal(log.fossgis.length, asked);

  // Work is right here.
  await page.click('#saved-work');
  await page.click('#quick-here');
  await page.waitForFunction(() => /Anda di sini/.test(document.getElementById('saved-work-detail').textContent));
  await page.screenshot({ path: `${shots}/53-home-work.png` });
  await noOverflow(page, 'home and work');

  await page.click('#saved-home');
  await page.waitForSelector('.route-opt');
  assert.equal(await text(page, '#dest-name'), 'Suria KLCC');
  await page.click('#preview-back');
  await page.waitForSelector('#idle:not([hidden])');

  // Changed and removed in settings.
  await page.click('#btn-settings');
  assert.match(await text(page, '#saved-list'), /Rumah\s*Suria KLCC/);
  await page.locator('#saved-list li', { hasText: 'Rumah' }).getByRole('button', { name: /Buang/ }).click();
  assert.match(await text(page, '#saved-list'), /Rumah\s*Belum ditetapkan/);
  await page.locator('#saved-list li', { hasText: 'Kerja' }).getByRole('button', { name: /Tukar/ }).click();
  await page.waitForSelector('#search:not([hidden])');
  assert.equal(await vis(page, '#settings'), false);
  assert.equal(await page.getAttribute('#search-input', 'placeholder'), 'Cari tempat kerja anda');
  await page.click('#search-back');
  await page.waitForSelector('#idle:not([hidden])');
  assert.match(await text(page, '#saved-home'), /Tetapkan/);
  await page.reload();
  assert.match(await text(page, '#saved-work'), /Kerja/);
  assert.doesNotMatch(await text(page, '#saved-work'), /Tetapkan/, 'kept after a reload');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('home and work: set by pointing at the map', async () => {
  const { ctx, page } = await newApp(browser, { ...quiet });
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat, { accuracy: 10 }), P.a);
  await page.click('#saved-work');
  await page.click('#quick-map');
  await page.waitForSelector('.pick-bar');
  assert.match(await text(page, '#pick-hint'), /kerja anda/);
  assert.equal(await vis(page, '#search'), false, 'the map, not the search, is in view');
  await page.click('#pick-use');
  await page.waitForSelector('#idle:not([hidden])');
  await page.waitForFunction(() => !/Tetapkan/.test(document.getElementById('saved-work').textContent));
  await ctx.close();
});

/* ---------- Parking ---------- */

const parkingTiles = [
  { id: 71, lng: P.d[0] + 0.0012, lat: P.d[1], props: { name: 'Parkir Menara', class: 'parking', subclass: 'parking' } },
  { id: 72, lng: P.d[0], lat: P.d[1] + 0.0025, props: { name: 'Parkir Jauh', class: 'parking', subclass: 'parking' } },
  { id: 73, lng: P.d[0] + 0.0003, lat: P.d[1], props: { name: 'Rak Basikal', class: 'parking', subclass: 'bicycle_parking' } },
];

await check('parking: car parks near the destination, and the drive can end at one', async () => {
  const { ctx, page, log } = await newApp(browser, { ...quiet, tiles: parkingTiles, scale: 2 });
  await toPreview(page);
  await page.waitForFunction(() => /berdekatan/.test(document.getElementById('plan-parking-detail').textContent));
  assert.match(await text(page, '#plan-parking-detail'), /2 berdekatan, paling dekat 1\d\d m/);
  await page.click('#plan-parking');
  assert.equal(await page.locator('#parking-list li').count(), 2);
  assert.match(await text(page, '#parking-list'), /Parkir Menara\s*1\d\d m dari destinasi/);
  await page.locator('#preview').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.screenshot({ path: `${shots}/54-parking.png` });
  const before = log.fossgis.length;
  await page.locator('#parking-list button', { hasText: 'Parkir Menara' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.route-opt').length && n >= 0, before);
  await page.waitForFunction(() => /Letak kereta di Parkir Menara/.test(document.getElementById('plan-parking-title').textContent));
  const ask = log.fossgis.at(-1);
  assert.ok(log.fossgis.length > before);
  assert.ok(Math.abs(ask.locations.at(-1).lon - (P.d[0] + 0.0012)) < 1e-5, JSON.stringify(ask.locations));
  assert.match(await text(page, '#plan-parking-detail'), /jalan kaki 1\d\d m/);
  await page.click('#plan-parking-clear');
  await page.waitForFunction(() => !/Letak kereta di/.test(document.getElementById('plan-parking-title').textContent));
  assert.ok(Math.abs(log.fossgis.at(-1).locations.at(-1).lon - P.d[0]) < 1e-6);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('parking: none nearby, or walking, means no parking row', async () => {
  const none = await newApp(browser, { ...quiet, tiles: [] });
  await toPreview(none.page);
  await none.page.waitForTimeout(400);
  assert.equal(await vis(none.page, '#plan-parking-wrap'), false);
  await none.ctx.close();
  const walking = await newApp(browser, { ...quiet, tiles: parkingTiles });
  await toPreview(walking.page);
  await walking.page.click('#mode-walk');
  await walking.page.waitForTimeout(300);
  assert.equal(await vis(walking.page, '#plan-parking-wrap'), false);
  await walking.ctx.close();
});

/* ---------- Leaving on time ---------- */

await check('leave by: pick when to arrive, and see when to leave', async () => {
  const { ctx, page } = await newApp(browser, { ...quiet, scale: 2 });
  await toPreview(page);
  assert.match(await text(page, '#plan-arrive'), /Mahu sampai bila\?/);
  const at = (mins) => page.evaluate((m) => {
    const d = new Date(Date.now() + m * 60000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }, mins);
  await page.fill('#plan-arrive-time', await at(120));
  assert.match(await text(page, '#plan-arrive-title'), /^Bertolak sebelum \d/);
  assert.match(await text(page, '#plan-arrive-detail'), /Tanpa trafik sebenar/);
  await page.locator('#preview').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${shots}/55-leave-by.png` });
  await page.fill('#plan-arrive-time', await at(1));
  assert.match(await text(page, '#plan-arrive-title'), /^Dah lewat \d+ min/);
  assert.match(await text(page, '#plan-arrive-detail'), /sampai kira-kira \d/);
  await page.fill('#plan-arrive-time', '');
  assert.match(await text(page, '#plan-arrive-title'), /Mahu sampai/);
  await noOverflow(page, 'leave by');
  await ctx.close();
});

/* ---------- Junction pictures ---------- */

const exitTrip = () => buildTrip(P.a, [
  { to: P.b, type: 1, street: 'E1', highway: true, kph: 90 },
  { to: P.c, type: 20, street: 'E35', highway: true, sign: { exit_number_elements: [{ text: '235' }], exit_branch_elements: [{ text: 'E35' }], exit_toward_elements: [{ text: 'Seremban' }] } },
  { to: P.d, type: 10, street: 'Jalan B' },
]);

await check('junction view: a picture of the exit before you reach it, with its sign', async () => {
  const trip = prepareTrip(exitTrip());
  const { ctx, page, log } = await newApp(browser, { ...quiet, scale: 2, routeResponse: () => ({ trip: exitTrip() }) });
  await toNav(page);
  await roll(page, trip, 0, 300, 20);
  await page.waitForSelector('#junction:not([hidden])');
  assert.match(await page.getAttribute('#junction', 'class'), /take-right/);
  assert.equal(await text(page, '#junction-exit'), 'Susur 235');
  assert.equal(await text(page, '#junction-to'), 'E35 · Seremban');
  const fill = () => page.evaluate(() => parseFloat(document.getElementById('junction-fill').style.width));
  const early = await fill();
  await roll(page, trip, 300, 900, 20);
  assert.ok((await fill()) > early, 'fills as it gets close');
  await page.screenshot({ path: `${shots}/56-junction.png` });
  await noOverflow(page, 'junction');
  await roll(page, trip, 900, trip.maneuvers[1].beginDist + 30, 20);
  assert.equal(await vis(page, '#junction'), false, 'gone after the exit');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('small phone: home and work, a junction and a camera all fit', async () => {
  const trip = prepareTrip(exitTrip());
  const storage = { 'pintu.safetySeen': 'true', 'pintu.saved': { home: { name: 'Rumah Panjang Sekali Di Taman Melawati', detail: '', lng: P.d[0], lat: P.d[1] }, work: { name: 'Menara', detail: '', lng: P.c[0], lat: P.c[1] } } };
  const { ctx, page } = await newApp(browser, { storage, viewport: { width: 320, height: 568 }, scale: 2, routeResponse: () => ({ trip: exitTrip() }), overpass: { elements: [{ type: 'node', id: 3, lat: along2(P.a, P.b, 0.5)[1], lon: along2(P.a, P.b, 0.5)[0], tags: { maxspeed: '110' } }] } });
  await page.click('#btn-locate');
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat, { accuracy: 10 }), P.a);
  await page.waitForFunction(() => /sampai/.test(document.getElementById('saved-home-detail').textContent));
  await noOverflow(page, 'small idle');
  await page.screenshot({ path: `${shots}/58-small-idle.png` });
  await toNav(page);
  await page.waitForTimeout(300);
  await roll(page, trip, 0, 400, 20);
  await page.waitForSelector('#junction:not([hidden])');
  await page.waitForSelector('#camera-alert:not([hidden])');
  await noOverflow(page, 'small junction');
  await page.screenshot({ path: `${shots}/59-small-junction.png` });
  await ctx.close();
});

await check('junction view: none for ordinary turns', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page } = await newApp(browser, { ...quiet });
  await toNav(page);
  for (const [a, b] of [[0, 600], [600, 1300], [1300, 2000]]) {
    await roll(page, trip, a, b, 15);
    assert.equal(await vis(page, '#junction'), false);
  }
  await ctx.close();
});

/* ---------- What the characters make of the drive ---------- */

// A trip long enough to crawl along, with no turn for a good while.
const longRoad = () => buildTrip(P.a, [{ to: [101.78, 3.15], type: 1, street: 'Lebuhraya Panjang', kph: 90 }]);

await check('sustained speeding: the warnings get firmer, and the praise comes when you stop', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...withCast('captain') });
  log.laneCounts = { edges: [{ length: 100, lane_count: 2, speed_limit: 60 }] };
  await toNav(page);
  await roll(page, trip, 0, 200, 12);
  await page.waitForFunction(() => document.getElementById('speed-limit').textContent === '60');
  await settled(page);
  const before = (await said(page)).length;
  // Every fix is a second. The same stretch of road, driven far too keenly.
  await roll(page, trip, 200, 200 + 25 * 10, 25);
  await settled(page);
  let now = (await said(page)).slice(before).map((s) => s.text);
  assert.equal(now.filter((t) => /60/.test(t)).length, 1, JSON.stringify(now));
  await roll(page, trip, 450, 450 + 25 * 25, 25);
  await settled(page);
  now = (await said(page)).slice(before).map((s) => s.text);
  const warnings = now.filter((t) => /60/.test(t));
  assert.equal(warnings.length, 2, JSON.stringify(now));
  assert.notEqual(warnings[0], warnings[1], 'not the same words');
  const firm = (await said(page)).length;
  await roll(page, trip, 1075, 1075 + 12 * 10, 12);
  await settled(page);
  const after = (await said(page)).slice(firm).map((s) => s.text);
  assert.ok(after.length >= 1, 'a kind word for slowing down');
  assert.ok(!after.some((t) => /60/.test(t)), JSON.stringify(after));
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('turns-only voice stays out of it: no remarks about speed or jams', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...withCast('captain', { voiceLevel: 'turns' }) });
  log.laneCounts = { edges: [{ length: 100, lane_count: 2, speed_limit: 60 }] };
  await toNav(page);
  await roll(page, trip, 0, 200, 12);
  await page.waitForFunction(() => document.getElementById('speed-limit').textContent === '60');
  await settled(page);
  const before = (await said(page)).length;
  await roll(page, trip, 200, 900, 25);
  await settled(page);
  const now = (await said(page)).slice(before).map((s) => s.text);
  assert.ok(!now.some((t) => /\b60\b/.test(t)), JSON.stringify(now));
  await ctx.close();
});

await check('a jam: crawling for two minutes gets a remark, and getting out of it another', async () => {
  const trip = prepareTrip(longRoad());
  const { ctx, page, log } = await newApp(browser, { ...withCast('uncle'), routeResponse: () => ({ trip: longRoad() }) });
  await toNav(page);
  await roll(page, trip, 0, 300, 15);
  await settled(page);
  const before = (await said(page)).length;
  await roll(page, trip, 300, 300 + 2 * 125, 2);
  await settled(page);
  const stuck = (await said(page)).slice(before).map((s) => s.text);
  assert.equal(stuck.length, 1, JSON.stringify(stuck));
  assert.match(stuck[0], /[Jj]em|kopi|kereta/i);
  const during = (await said(page)).length;
  await roll(page, trip, 550, 550 + 15 * 25, 15);
  await settled(page);
  const free = (await said(page)).slice(during).map((s) => s.text);
  assert.ok(free.length >= 1, 'something when it clears');
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

await check('the standard voice says nothing about jams', async () => {
  const trip = prepareTrip(longRoad());
  const { ctx, page } = await newApp(browser, { ...withCast('standard'), routeResponse: () => ({ trip: longRoad() }) });
  await toNav(page);
  await roll(page, trip, 0, 300, 15);
  await settled(page);
  const before = (await said(page)).length;
  await roll(page, trip, 300, 300 + 2 * 125, 2);
  await roll(page, trip, 550, 550 + 15 * 25, 15);
  await settled(page);
  assert.equal((await said(page)).length, before);
  await ctx.close();
});

await check('a remark waits for a direction to finish, and never talks over one', async () => {
  const trip = prepareTrip(cityTrip());
  const { ctx, page, log } = await newApp(browser, { ...withCast('adik') });
  log.laneCounts = { edges: [{ length: 100, lane_count: 2, speed_limit: 60 }] };
  await page.evaluate(() => {
    Object.defineProperty(window.speechSynthesis, 'speaking', { configurable: true, get: () => window.__talking === true });
  });
  await toNav(page);
  await roll(page, trip, 0, 200, 12);
  await page.waitForFunction(() => document.getElementById('speed-limit').textContent === '60');
  await settled(page);
  await page.evaluate(() => { window.__talking = true; });
  const before = (await said(page)).length;
  await roll(page, trip, 200, 200 + 25 * 8, 25);
  await settled(page);
  assert.equal((await said(page)).slice(before).filter((s) => /60/.test(s.text)).length, 0, 'held back while something is being said');
  await page.evaluate(() => { window.__talking = false; });
  await roll(page, trip, 400, 400 + 25 * 2, 25);
  await settled(page);
  assert.equal((await said(page)).slice(before).filter((s) => /60/.test(s.text)).length, 1, 'and said once it stops');
  await ctx.close();
});

await browser.close();
server.close();

const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
