// Rain along the route, and official warnings for the states it passes through.
//
// The forecast is for each point at the time you'd reach it. These are forecasts,
// and official warnings cover areas rather than roads, so nothing here ever says
// a road is safe. A failed check is reported as a failed check, never as "all clear".
import { CONFIG } from './config.js';
import { within } from './net.js';
import { pointAt } from './motion.js';
import { timeBetween } from './routing.js';

const MAX_POINTS = 10;
const SPACING_M = 15000;
const WAIT_MS = 8000;
const CACHE_MS = 20 * 60000;

const STORM_CODES = new Set([95, 96, 99]);
const HEAVY_CODES = new Set([65, 67, 82]);
const HEAVY_MM = 7.6;      // an hour of this is what forecasters call heavy rain
const RAIN_MM = 1;
const RANK = { rain: 1, heavy: 2, storm: 3 };

export function routeSamples(route, fromS, now = Date.now()) {
  const span = Math.max(0, route.length - fromS);
  const n = Math.min(MAX_POINTS, Math.max(2, Math.ceil(span / SPACING_M) + 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = fromS + (span * i) / (n - 1);
    const [lng, lat] = pointAt(route, s);
    out.push({ s, lng, lat, at: now + timeBetween(route, fromS, s) * 1000 });
  }
  return out;
}

export function forecastUrl(samples) {
  const params = new URLSearchParams({
    latitude: samples.map((p) => p.lat.toFixed(3)).join(','),
    longitude: samples.map((p) => p.lng.toFixed(3)).join(','),
    hourly: 'precipitation,precipitation_probability,weather_code',
    forecast_days: '3',
    timeformat: 'unixtime',
    timezone: 'GMT',
  });
  return `${CONFIG.weather.forecastUrl}?${params}`;
}

// One location comes back as an object and several as a list.
export function parseForecast(json, samples) {
  const list = Array.isArray(json) ? json : [json];
  return samples.map((sample, i) => {
    const h = list[i]?.hourly;
    if (!h?.time?.length) return { ...sample, known: false };
    let idx = -1;
    for (let k = 0; k < h.time.length; k++) {
      if (h.time[k] * 1000 <= sample.at) idx = k;
      else break;
    }
    if (idx < 0) return { ...sample, known: false };
    return {
      ...sample,
      known: true,
      mm: h.precipitation?.[idx] ?? 0,
      chance: h.precipitation_probability?.[idx] ?? 50,
      code: h.weather_code?.[idx] ?? 0,
    };
  });
}

export function classify(p) {
  if (!p.known) return null;
  if (STORM_CODES.has(p.code) && p.chance >= 30) return 'storm';
  if ((p.mm >= HEAVY_MM || HEAVY_CODES.has(p.code)) && p.chance >= 30) return 'heavy';
  if (p.mm >= RAIN_MM && p.chance >= 40) return 'rain';
  return null;
}

// The first wet point ahead, and the worst of it anywhere along the way.
export function summariseRain(points) {
  if (!points.some((p) => p.known)) throw new Error('no forecast');
  let first = null, worst = null;
  for (const p of points) {
    const kind = classify(p);
    if (!kind) continue;
    if (!first) first = { kind, s: p.s, at: p.at };
    if (!worst || RANK[kind] > RANK[worst.kind]) worst = { kind, s: p.s, at: p.at };
  }
  return { first, worst };
}

export async function fetchRouteRain(route, fromS, { signal, fetchImpl = (...a) => fetch(...a), now = Date.now() } = {}) {
  const samples = routeSamples(route, fromS, now);
  const json = await within(WAIT_MS, signal, async (s) => {
    const res = await fetchImpl(forecastUrl(samples), { signal: s });
    if (!res.ok) throw new Error(`forecast ${res.status}`);
    return res.json();
  });
  return summariseRain(parseForecast(json, samples));
}

/* ---------- Official warnings ---------- */

// How each state may be written, in Malay or in English.
const STATES = [
  ['Johor', /johor/i], ['Kedah', /kedah/i], ['Kelantan', /kelantan/i], ['Melaka', /melaka|malacca/i],
  ['Negeri Sembilan', /negeri sembilan/i], ['Pahang', /pahang/i], ['Pulau Pinang', /pinang|penang/i],
  ['Perak', /perak/i], ['Perlis', /perlis/i], ['Sabah', /sabah/i], ['Sarawak', /sarawak/i],
  ['Selangor', /selangor/i], ['Terengganu', /terengganu/i], ['Kuala Lumpur', /kuala lumpur/i],
  ['Putrajaya', /putrajaya/i], ['Labuan', /labuan/i],
];

export const statesIn = (text) => STATES.filter(([, re]) => re.test(text || '')).map(([name]) => name);

const ON_THE_ROAD = /rain|thunderstorm|hujan|ribut petir/i;
const AT_SEA = /\bsea|wave|ombak|laut|tsunami|earthquake|gempa/i;
// Malaysian time, when the source doesn't say.
const asTime = (text) => (text ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}+08:00`) : NaN);

export function parseWarnings(json, now = Date.now()) {
  const list = Array.isArray(json) ? json : (json?.data || []);
  const out = [];
  for (const w of list) {
    const titles = `${w.warning_issue?.title_en || ''} ${w.warning_issue?.title_bm || ''} ${w.heading_en || ''} ${w.heading_bm || ''}`;
    if (!ON_THE_ROAD.test(titles) || AT_SEA.test(titles)) continue;
    const until = asTime(w.valid_to);
    // No end time given: anything issued in the last day still counts.
    const issued = asTime(w.warning_issue?.issued);
    const active = Number.isFinite(until) ? until > now : Number.isFinite(issued) && now - issued < 86400000;
    if (!active) continue;
    const all = `${titles} ${w.text_en || ''} ${w.text_bm || ''}`;
    out.push({
      heading: { ms: w.heading_bm || w.warning_issue?.title_bm || w.heading_en || '', en: w.heading_en || w.warning_issue?.title_en || w.heading_bm || '' },
      text: { ms: w.text_bm || w.text_en || '', en: w.text_en || w.text_bm || '' },
      until: Number.isFinite(until) ? until : null,
      states: statesIn(all),
      danger: /bahaya|danger/i.test(all),
      flood: /berterusan|continuous/i.test(all),
    });
  }
  return out;
}

export const warningsFor = (warnings, states) => warnings.filter((w) => w.states.some((s) => states.includes(s)));

// Which states the route passes through, asked of the search service.
export async function routeStates(route, fromS, { signal, fetchImpl = (...a) => fetch(...a) } = {}) {
  const found = new Set();
  let answered = false;
  for (const part of [0, 0.33, 0.66, 1]) {
    const [lng, lat] = pointAt(route, fromS + (route.length - fromS) * part);
    const params = new URLSearchParams({ lat: lat.toFixed(4), lon: lng.toFixed(4), limit: '1' });
    try {
      const json = await within(WAIT_MS, signal, async (s) => {
        const res = await fetchImpl(`${CONFIG.search.reverseUrl}?${params}`, { signal: s });
        if (!res.ok) throw new Error(`reverse ${res.status}`);
        return res.json();
      });
      answered = true;
      const p = json.features?.[0]?.properties || {};
      for (const name of statesIn(`${p.state || ''} ${p.county || ''} ${p.city || ''}`)) found.add(name);
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }
  if (!answered) throw new Error('no answer');
  return [...found];
}

// Straight from the government's service, or through Pintu's own server if the
// browser isn't allowed to ask directly.
export async function fetchWarnings({ signal, fetchImpl = (...a) => fetch(...a), now = Date.now(), server = CONFIG.server } = {}) {
  const urls = [CONFIG.weather.warningsUrl];
  if (server) urls.push(`${server}/warnings`);
  let lastError = new Error('no warnings source');
  for (const url of urls) {
    try {
      const json = await within(WAIT_MS, signal, async (s) => {
        const res = await fetchImpl(url, { signal: s });
        if (!res.ok) throw new Error(`warnings ${res.status}`);
        return res.json();
      });
      return parseWarnings(json, now);
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

const cache = new Map();
export const clearWeatherCache = () => cache.clear();

// Everything known about the way ahead. Each part can fail by itself, and says so.
export async function checkRouteWeather(route, fromS, opts = {}) {
  const key = route.id;
  const hit = cache.get(key);
  const now = opts.now ?? Date.now();
  if (hit && now - hit.at < CACHE_MS) return hit.result;

  const [rain, warnings] = await Promise.allSettled([
    fetchRouteRain(route, fromS, opts),
    (async () => {
      const list = await fetchWarnings(opts);
      if (!list.length) return [];
      return warningsFor(list, await routeStates(route, fromS, opts));
    })(),
  ]);
  if (opts.signal?.aborted) throw new DOMException('The request was cancelled', 'AbortError');
  const result = {
    rain: rain.status === 'fulfilled' ? rain.value : null,
    rainFailed: rain.status !== 'fulfilled',
    warnings: warnings.status === 'fulfilled' ? warnings.value : [],
    warningsFailed: warnings.status !== 'fulfilled',
  };
  // Good answers are worth keeping. A failure is worth trying again.
  if (!result.rainFailed && !result.warningsFailed) cache.set(key, { at: now, result });
  return result;
}
