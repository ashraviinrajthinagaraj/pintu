// Runs Pintu on the real MapLibre library, which the stub-based tests can't do.
// Needs a local copy: MAPLIBRE_DIR=/path/with/maplibre-gl.js[.css] and, for the
// style checks, style-liberty.json and style-dark.json from openfreemap-styles.
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { altTrip, cityTrip, multiLeg, P } from '../helpers/fixtures.js';
import { bearing } from '../../js/geo.js';
import { prepareTrip } from '../../js/routing.js';

const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = process.env.MAPLIBRE_DIR;
const shots = process.env.SHOTS || path.join(root, 'tests/e2e/shots');
await mkdir(shots, { recursive: true });

const realJs = await readFile(path.join(dir, 'maplibre-gl.js'), 'utf8');
const realCss = await readFile(path.join(dir, 'maplibre-gl.css'), 'utf8');
const wrapper = `;(() => {
  const lib = window.maplibregl;
  class Tracked extends lib.Map { constructor(o) { super(o); window.__map = this; window.__mapErrors = []; this.on('error', (e) => window.__mapErrors.push(String(e.error && e.error.message || e.error))); } }
  window.maplibregl = Object.assign(Object.create(lib), { Map: Tracked });
})();`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
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
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

const realStyle = async (name) => JSON.parse((await readFile(path.join(dir, `style-${name}.json`), 'utf8')).replaceAll('__TILEJSON_DOMAIN__', 'tiles.openfreemap.org'));

// A made-up neighbourhood, so screenshots show the real renderer without map data.
function demoCity(theme) {
  const night = theme === 'night';
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const roads = [], blocks = [], parks = [];
  const step = 0.00125;
  const [x0, x1, y0, y1] = [101.692, 101.726, 3.142, 3.168];
  for (let x = x0; x <= x1; x += step) roads.push({ type: 'Feature', properties: { major: Math.round((x - 101.7) / step) % 8 === 0 }, geometry: { type: 'LineString', coordinates: [[x, y0], [x, y1]] } });
  for (let y = y0; y <= y1; y += step) roads.push({ type: 'Feature', properties: { major: Math.round((y - 3.15) / step) % 8 === 0 }, geometry: { type: 'LineString', coordinates: [[x0, y], [x1, y]] } });
  for (let x = x0; x < x1; x += step) {
    for (let y = y0; y < y1; y += step) {
      if (rnd() < 0.07) {
        parks.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[x + 0.0001, y + 0.0001], [x + step - 0.0001, y + 0.0001], [x + step - 0.0001, y + step - 0.0001], [x + 0.0001, y + step - 0.0001], [x + 0.0001, y + 0.0001]]] } });
        continue;
      }
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          if (rnd() < 0.2) continue;
          const bx = x + 0.00013 + (i * (step - 0.00016)) / 2, by = y + 0.00013 + (j * (step - 0.00016)) / 2;
          const w = 0.00035, h = 0.00035;
          const tall = rnd();
          blocks.push({ type: 'Feature', properties: { h: tall > 0.93 ? 90 + rnd() * 110 : 10 + rnd() * 34 }, geometry: { type: 'Polygon', coordinates: [[[bx, by], [bx + w, by], [bx + w, by + h], [bx, by + h], [bx, by]]] } });
        }
      }
    }
  }
  return {
    version: 8,
    sources: {
      openmaptiles: { type: 'vector', tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'], maxzoom: 14 },
      roads: { type: 'geojson', data: { type: 'FeatureCollection', features: roads } },
      blocks: { type: 'geojson', data: { type: 'FeatureCollection', features: blocks } },
      parks: { type: 'geojson', data: { type: 'FeatureCollection', features: parks } },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': night ? '#12181B' : '#EDEAE2' } },
      { id: 'parks', type: 'fill', source: 'parks', paint: { 'fill-color': night ? '#17251F' : '#CFE3C4' } },
      { id: 'road-case', type: 'line', source: 'roads', paint: { 'line-color': night ? '#0B1012' : '#D5D1C7', 'line-width': ['case', ['get', 'major'], 11, 7] } },
      { id: 'road', type: 'line', source: 'roads', paint: { 'line-color': night ? '#2B3439' : '#FFFFFF', 'line-width': ['case', ['get', 'major'], 8.5, 5] } },
      { id: 'blocks', type: 'fill-extrusion', source: 'blocks', paint: { 'fill-extrusion-color': night ? '#2A3338' : '#E2DED5', 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.92 } },
    ],
  };
}

async function open(browser, { styleFor, viewport = { width: 390, height: 844 }, scale = 2, routeResponse, storage, theme = 'day', laneCount = 1 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, hasTouch: true, serviceWorkers: 'block', locale: 'ms-MY', timezoneId: 'Asia/Kuala_Lumpur' });
  const errors = [];
  ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const url = route.request().url();
    const host = new URL(url).hostname;
    if (/maplibre-gl\.js$/.test(url)) return route.fulfill({ contentType: 'text/javascript', headers: CORS, body: realJs + wrapper });
    if (/maplibre-gl\.css$/.test(url)) return route.fulfill({ contentType: 'text/css', headers: CORS, body: realCss });
    if (host === 'tiles.openfreemap.org') {
      const m = url.match(/\/styles\/(\w+)/);
      if (m) return route.fulfill({ json: await styleFor(m[1]), headers: CORS });
      if (/\/planet$/.test(url)) return route.fulfill({ json: { tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/x/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 }, headers: CORS });
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (host === 'api.stadiamaps.com') return route.fulfill({ status: 401, json: {}, headers: CORS });
    if (host === 'valhalla1.openstreetmap.de' && url.includes('/trace_attributes')) {
      return route.fulfill({ json: { edges: [{ length: 30, lane_count: laneCount }] }, headers: CORS });
    }
    if (host === 'valhalla1.openstreetmap.de') {
      const body = JSON.parse(new URL(url).searchParams.get('json'));
      return route.fulfill({ json: routeResponse ? routeResponse(body) : { trip: cityTrip(), alternates: body.alternates ? [{ trip: altTrip() }] : [] }, headers: CORS });
    }
    if (host === 'photon.komoot.io') {
      return route.fulfill({ json: { features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: P.d }, properties: { name: 'Suria KLCC', city: 'Kuala Lumpur', countrycode: 'MY' } }] }, headers: CORS });
    }
    if (host === 'overpass.private.coffee') {
      return route.fulfill({ json: { elements: [
        { type: 'node', id: 1, lat: 3.1503, lon: 101.7055, tags: { name: 'Petronas Ampang', amenity: 'fuel' } },
        { type: 'node', id: 2, lat: 3.1548, lon: 101.7104, tags: { brand: 'Shell', amenity: 'fuel' } },
      ] }, headers: CORS });
    }
    if (host === 'api.waktusolat.app') return route.fulfill({ status: 404, json: {}, headers: CORS });
    return route.abort();
  });
  await ctx.addInitScript(({ storage, theme }) => {
    const gps = { cb: null };
    window.__gps = gps;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition(cb) { gps.cb = cb; if (gps.last) setTimeout(() => cb(gps.last)); return 1; },
      clearWatch() { gps.cb = null; },
      getCurrentPosition() {},
    } });
    gps.push = (lng, lat, o = {}) => {
      gps.last = { coords: { longitude: lng, latitude: lat, accuracy: o.accuracy ?? 8, speed: o.speed ?? null, heading: o.heading ?? null }, timestamp: o.time ?? Date.now() };
      gps.cb?.(gps.last);
    };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
      request: async () => ({ release() {}, addEventListener() {} }),
    } });
    localStorage.setItem('pintu.safetySeen', 'true');
    localStorage.setItem('pintu.laneNoteSeen', 'true');
    localStorage.setItem('pintu.settings', JSON.stringify({ theme }));
    if (storage) for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, JSON.stringify(v));
  }, { storage: storage || null, theme });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load|net::ERR|404|204|sprite|glyph|Unable to perform/i.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  await page.goto(ORIGIN);
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded() !== undefined && window.__map.getLayer('pintu-route'), null, { timeout: 30000 });
  return { ctx, page, errors };
}

async function drive(page, trip, { from = 0, to, kph = 40, liveMs = 0 } = {}) {
  const { coords, cum, length } = prepareTrip(trip);
  const v = kph / 3.6;
  const end = to ?? length + 1;
  let time = Date.now();
  for (let s = from; s <= end; s += v) {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] <= s) i++;
    const f = Math.min(1, (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1));
    const p = [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * f, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * f];
    await page.evaluate(({ p, v, heading, time }) => window.__gps.push(p[0], p[1], { speed: v, heading, time }), { p, v, heading: bearing(coords[i], coords[i + 1]), time });
    time += 1000;
    if (liveMs) await page.waitForTimeout(liveMs);
  }
}

async function toPreview(page) {
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat), P.a);
  await page.click('#where');
  await page.fill('#search-input', 'klcc');
  await page.waitForSelector('#search-results .place');
  await page.locator('#search-results .place').first().click();
  await page.waitForSelector('.route-opt');
}

const settle = (page, ms = 1500) => page.waitForTimeout(ms);

const results = [];
async function check(name, fn) {
  try {
    let timer;
    const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('took over 150 seconds')), 150000); });
    await Promise.race([fn(), limit]).finally(() => clearTimeout(timer));
    results.push(['ok', name]); console.log(`ok   ${name}`);
  } catch (e) { results.push(['FAIL', name]); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 8).join('\n     ')}`); }
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });

const layerOrder = (page) => page.evaluate(() => window.__map.getStyle().layers.map((l) => ({ id: l.id, type: l.type, sl: l['source-layer'] })));

function checkOrder(layers, name) {
  const at = (id) => layers.findIndex((l) => l.id === id);
  const lastRoad = Math.max(...layers.map((l, i) => (l.sl === 'transportation' && l.type === 'line' ? i : -1)));
  assert.ok(at('pintu-route') > lastRoad, `${name}: route ${at('pintu-route')} is under a road layer at ${lastRoad}`);
  assert.ok(at('pintu-glow') > lastRoad, `${name}: glow is under a road`);
  assert.ok(at('pintu-alt') > lastRoad, `${name}: alternate is under a road`);
  assert.ok(at('pintu-3d') > -1 && at('pintu-3d') < at('pintu-route'), `${name}: buildings must be below the route`);
  const firstLabelAfter = layers.findIndex((l, i) => i > at('pintu-route') && l.type === 'symbol');
  assert.ok(firstLabelAfter > -1, `${name}: labels stay above the route`);
}

await check('real library, real day and night styles: layers valid and in the right order', async () => {
  const { ctx, page, errors } = await open(browser, { styleFor: realStyle, scale: 1 });
  checkOrder(await layerOrder(page), 'day');
  assert.equal(await page.evaluate(() => window.__map.getLayoutProperty('building-3d', 'visibility')), 'none');
  assert.equal(await page.evaluate(() => window.__map.getLayoutProperty('pintu-3d', 'visibility')), 'visible');

  await page.click('#btn-settings');
  await page.click('#theme-night');
  await page.waitForFunction(() => window.__map.getLayer('pintu-route') && window.__map.getStyle().layers.some((l) => l.id === 'road_oneway'), null, { timeout: 20000 });
  checkOrder(await layerOrder(page), 'night');
  await page.click('#theme-day');
  await page.waitForFunction(() => window.__map.getLayer('pintu-route') && window.__map.getLayer('building-3d'), null, { timeout: 20000 });
  checkOrder(await layerOrder(page), 'back to day');
  await page.click('#settings-back');

  const bad = (await page.evaluate(() => window.__mapErrors)).filter((e) => !/Failed to fetch|sprite|glyph|404|AJAXError|204|Unexpected end|Could not load/i.test(e));
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await check('real library: a full trip draws the route, follows, tilts, and ends cleanly', async () => {
  const { ctx, page, errors } = await open(browser, { styleFor: async (n) => demoCity(n === 'dark' ? 'night' : 'day'), scale: 1 });
  await toPreview(page);
  await settle(page, 1200);
  const lineCoords = await page.evaluate(() => window.__map.getSource('pintu-active').serialize().data.features[0].geometry.coordinates.length);
  assert.ok(lineCoords > 10, 'route is on the map');
  // Selecting the alternate through the real hit-test layer.
  const hit = await page.evaluate(() => {
    const m = window.__map;
    return !!m.getLayer('pintu-alt-hit') && m.getPaintProperty('pintu-alt-hit', 'line-opacity') === 0;
  });
  assert.ok(hit);

  await page.click('#start');
  await page.waitForSelector('#nav-bar');
  await drive(page, cityTrip(), { to: 500, liveMs: 30 });
  await settle(page, 1500);
  const cam = await page.evaluate(() => ({ pitch: window.__map.getPitch(), bearing: window.__map.getBearing(), zoom: window.__map.getZoom(), center: window.__map.getCenter() }));
  assert.ok(cam.pitch > 40, `pitch ${cam.pitch}`);
  assert.ok(Math.abs(cam.bearing - 90) < 8 || Math.abs(cam.bearing + 270) < 8, `bearing ${cam.bearing}`);
  assert.ok(Math.abs(cam.center.lat - 3.15) < 0.002, `centre ${JSON.stringify(cam.center)}`);

  // Flatten, and buildings go.
  await page.click('#btn-3d');
  await settle(page, 1500);
  assert.ok(await page.evaluate(() => window.__map.getPitch()) < 8);
  assert.equal(await page.evaluate(() => window.__map.getLayoutProperty('pintu-3d', 'visibility')), 'none');
  await page.click('#btn-3d');

  // Dragging stops following.
  await page.evaluate(() => { const m = window.__map; m.fire('dragstart', { originalEvent: new Event('x') }); });
  assert.equal(await page.locator('#btn-recenter').isVisible(), true);
  await page.click('#btn-recenter');

  await drive(page, cityTrip(), { from: 500 });
  await page.waitForSelector('#arrival:not([hidden])', { timeout: 20000 });
  await page.click('#arrival-done');
  await settle(page, 800);
  assert.equal(await page.evaluate(() => window.__map.getSource('pintu-active').serialize().data.features.length), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await check('real library: the arrow moves frame by frame between fixes', async () => {
  const { ctx, page } = await open(browser, { styleFor: async () => demoCity('day'), scale: 1, viewport: { width: 320, height: 568 } });
  await toPreview(page);
  await page.click('#start');
  await page.waitForSelector('#nav-bar');
  const out = await page.evaluate(async () => {
    const el = document.querySelector('.puck');
    const t0 = Date.now();
    window.__gps.push(101.703, 3.15, { speed: 14, heading: 90, time: t0 });
    const seen = new Set();
    const started = performance.now();
    await new Promise((resolve) => {
      const tick = (now) => {
        seen.add(window.__map.getCenter().lng.toFixed(7));
        if (now - started < 1500) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    return { centres: seen.size, marker: !!el, transform: el.style.transform };
  });
  assert.ok(out.marker);
  assert.ok(out.centres >= 5, `camera took ${out.centres} positions in 1.5 s after a single fix`);
  await ctx.close();
});

await check('real library: pins for stops and multi-stop routes', async () => {
  const { ctx, page, errors } = await open(browser, {
    styleFor: async () => demoCity('day'), scale: 2,
    routeResponse: (b) => (b.locations.length === 3 ? { trip: multiLeg() } : { trip: cityTrip(), alternates: b.alternates ? [{ trip: altTrip() }] : [] }),
  });
  await toPreview(page);
  await page.click('#add-stop');
  await page.waitForSelector('#stops-list .place');
  await settle(page, 900);
  assert.ok(await page.locator('.map-pin').count() >= 2);
  await page.screenshot({ path: `${shots}/real-stops.png` });
  await page.locator('.map-pin').first().evaluate((e) => e.click());
  await page.waitForFunction(() => document.querySelectorAll('.stop-row').length === 1);
  await page.waitForSelector('.route-opt');
  await settle(page, 1000);
  assert.equal(await page.locator('.map-pin.is-stop').count(), 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await check('real library: the car really draws, in the colour chosen', async () => {
  const look = { 'pintu.looks': { car: { body: 'suv', color: '#C4202A' } } };
  const { ctx, page, errors } = await open(browser, { styleFor: async () => demoCity('day'), scale: 1, storage: look });
  await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat, { heading: 90, speed: 0 }), P.a);
  await settle(page, 400);
  await page.click('#btn-locate');
  await settle(page, 2000);
  const shot = await page.screenshot();
  const sharp = require('sharp');
  const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let red = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] > 120 && data[i + 1] < 70 && data[i + 2] < 70) red++;
  }
  assert.ok(red > 150, `red pixels from the car: ${red}`);
  assert.equal(await page.locator('.puck').evaluate((e) => e.style.visibility), 'hidden');
  const bad = (await page.evaluate(() => window.__mapErrors)).filter((e) => !/Failed to fetch|204|AJAXError|Unexpected end/i.test(e));
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await check('real library: lane layers are valid, and appear with real day and night styles', async () => {
  const lanes = [{ directions: 2 }, { directions: 2 }, { directions: 64, active: 64 }];
  const trip = () => { const t = cityTrip(); t.legs[0].maneuvers[1].lanes = lanes; return t; };
  const { ctx, page, errors } = await open(browser, { styleFor: realStyle, scale: 1, laneCount: 3, routeResponse: () => ({ trip: trip() }) });
  await toPreview(page);
  await page.click('#start');
  await page.waitForSelector('#nav-bar');
  await drive(page, trip(), { to: 800, kph: 45, liveMs: 5 });
  await page.waitForFunction(() => window.__map.getSource('pintu-lanes').serialize().data.features.length > 50, null, { timeout: 12000 });
  await settle(page, 2500);
  const cam = await page.evaluate(() => ({ zoom: window.__map.getZoom(), pitch: window.__map.getPitch() }));
  assert.ok(cam.zoom > 18, `zoom ${cam.zoom}`);
  assert.ok(cam.pitch > 60, `pitch ${cam.pitch}`);
  const order = await page.evaluate(() => window.__map.getStyle().layers.map((l) => l.id));
  const at = (id) => order.indexOf(id);
  assert.ok(at('pintu-route') < at('pintu-lane-road'), 'lanes over the ordinary line');
  assert.ok(at('pintu-lane-road') < at('pintu-lane-carpet') && at('pintu-lane-carpet') < at('pintu-lane-chevron'));
  assert.equal(await page.evaluate(() => window.__map.style._order.at(-1)), 'pintu-car', 'the car is on top');
  const bad = (await page.evaluate(() => window.__mapErrors)).filter((e) => !/Failed to fetch|sprite|glyph|404|AJAXError|204|Unexpected end|Could not load/i.test(e));
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

// Pictures for looking at.
await check('screens on the real renderer', async () => {
  const car = {
    'pintu.vehicles': { car: { name: 'Myvi', kind: 'petrol', consumption: 6.3, range: 420, level: 40, price: 2.05 } },
    'pintu.looks': { car: { body: 'hatchback', color: '#C4202A' } },
  };
  const lanes = [{ directions: 2 }, { directions: 2 }, { directions: 64, active: 64 }, { directions: 66, valid: 64 }];
  const withLanes = () => {
    const trip = cityTrip();
    trip.legs[0].maneuvers[1].lanes = lanes;
    return trip;
  };
  for (const theme of ['day', 'night']) {
    const { ctx, page, errors } = await open(browser, {
      styleFor: async (n) => demoCity(n === 'dark' ? 'night' : 'day'), theme, storage: car, laneCount: 3,
      routeResponse: (b) => ({ trip: withLanes(), alternates: b.alternates ? [{ trip: altTrip() }] : [] }),
    });
    await page.evaluate(([lng, lat]) => window.__gps.push(lng, lat, { heading: 90 }), P.a);
    await settle(page, 400);
    await page.click('#btn-locate');
    await settle(page, 1800);
    await page.screenshot({ path: `${shots}/real-${theme}-1-idle.png` });
    await toPreview(page);
    await settle(page, 2200);
    await page.screenshot({ path: `${shots}/real-${theme}-2-preview.png` });
    await page.click('#start');
    await page.waitForSelector('#nav-bar');
    await drive(page, withLanes(), { to: 780, kph: 45, liveMs: 12 });
    await settle(page, 1800);
    await page.screenshot({ path: `${shots}/real-${theme}-3-nav.png` });
    if (theme === 'day') {
      await page.click('#btn-end');
      await page.click('#btn-end');
      await page.click('#btn-settings');
      await page.click('#set-vehicle-open');
      await page.locator('#veh-bodies button', { hasText: 'SUV' }).click();
      await settle(page, 1200);
      await page.screenshot({ path: `${shots}/real-${theme}-4-vehicle.png` });
    }
    await ctx.close();
    assert.deepEqual(errors, []);
  }
});

await browser.close();
server.close();
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
