import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { prepareTrip } from '../js/routing.js';
import { buildTrip, cityTrip, P } from './helpers/fixtures.js';
import {
  checkRouteWeather, classify, clearWeatherCache, fetchRouteRain, fetchWarnings, forecastUrl, parseForecast,
  parseWarnings, routeSamples, routeStates, statesIn, summariseRain, warningsFor,
} from '../js/weather.js';

const NOW = Date.parse('2026-11-06T02:00:00Z');
const route = () => prepareTrip(cityTrip());
const longRoute = () => prepareTrip(buildTrip([100.3, 5.4], [{ to: [101.7, 3.15], type: 1, street: 'Lebuhraya', kph: 100 }]));

function hourly(wet, { mm = 12, code = 95, chance = 80 } = {}) {
  const start = NOW / 1000 - 3600;
  const time = Array.from({ length: 48 }, (_, i) => start + i * 3600);
  return {
    hourly: {
      time,
      precipitation: time.map(() => (wet ? mm : 0)),
      precipitation_probability: time.map(() => (wet ? chance : 5)),
      weather_code: time.map(() => (wet ? code : 3)),
    },
  };
}

test('samples the route, with the time you would reach each point', () => {
  const r = longRoute();
  const samples = routeSamples(r, 0, NOW);
  assert.equal(samples.length, 10, 'limited, however long the trip');
  assert.equal(samples[0].s, 0);
  assert.equal(samples[0].at, NOW);
  assert.ok(Math.abs(samples.at(-1).s - r.length) < 1);
  assert.ok(samples.at(-1).at > NOW + 3600000, 'hours later at the far end');
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i].at >= samples[i - 1].at);
  // A short trip is at least both ends.
  assert.equal(routeSamples(route(), 0, NOW).length, 2);
  // Only what's still ahead.
  assert.ok(routeSamples(r, 100000, NOW)[0].s === 100000);
});

test('asks for the forecast at those points, without sending exact positions', () => {
  const url = new URL(forecastUrl(routeSamples(route(), 0, NOW)));
  assert.equal(url.origin + url.pathname, CONFIG.weather.forecastUrl);
  assert.equal(url.searchParams.get('latitude').split(',').length, 2);
  assert.match(url.searchParams.get('latitude'), /^\d+\.\d{3},\d+\.\d{3}$/);
  assert.equal(url.searchParams.get('timeformat'), 'unixtime');
  assert.match(url.searchParams.get('hourly'), /precipitation_probability/);
});

test('reads the hour you will be there, for one location or many', () => {
  const samples = routeSamples(route(), 0, NOW);
  const parsed = parseForecast([hourly(false), hourly(true)], samples);
  assert.equal(parsed[0].known, true);
  assert.equal(parsed[0].mm, 0);
  assert.equal(parsed[1].code, 95);
  const single = parseForecast(hourly(true), samples.slice(0, 1));
  assert.equal(single[0].mm, 12);
  assert.equal(parseForecast({}, samples)[0].known, false);
  const future = [{ ...samples[0], at: NOW - 86400000 }];
  assert.equal(parseForecast(hourly(true), future)[0].known, false, 'before the forecast begins');
});

test('tells a thunderstorm from heavy rain from rain, and ignores unlikely drizzle', () => {
  const p = (mm, chance, code) => ({ known: true, mm, chance, code });
  assert.equal(classify(p(2, 60, 95)), 'storm');
  assert.equal(classify(p(10, 60, 63)), 'heavy');
  assert.equal(classify(p(0, 60, 82)), 'heavy');
  assert.equal(classify(p(2, 60, 61)), 'rain');
  assert.equal(classify(p(0.2, 90, 51)), null, 'barely anything');
  assert.equal(classify(p(2, 10, 61)), null, 'unlikely');
  assert.equal(classify(p(0, 5, 95)), null, 'a storm nobody expects');
  assert.equal(classify({ known: false }), null);
});

test('finds the first rain ahead, and the worst of it', () => {
  const at = (s, mm, code, chance = 80) => ({ known: true, s, at: NOW + s, mm, code, chance });
  const out = summariseRain([at(0, 0, 3), at(10, 2, 61), at(20, 12, 95), at(30, 2, 61)]);
  assert.equal(out.first.kind, 'rain');
  assert.equal(out.first.s, 10);
  assert.equal(out.worst.kind, 'storm');
  assert.equal(out.worst.s, 20);
  assert.deepEqual(summariseRain([at(0, 0, 3)]), { first: null, worst: null });
});

test('no forecast at all is a failure, not a dry road', () => {
  assert.throws(() => summariseRain([{ known: false }, { known: false }]));
});

test('fetches and summarises, and fails rather than guessing', async () => {
  const r = route();
  const wet = await fetchRouteRain(r, 0, { now: NOW, fetchImpl: async () => new Response(JSON.stringify([hourly(false), hourly(true)])) });
  assert.equal(wet.first.kind, 'storm');
  assert.ok(wet.first.s > 0);
  await assert.rejects(fetchRouteRain(r, 0, { now: NOW, fetchImpl: async () => new Response('', { status: 500 }) }));
  await assert.rejects(fetchRouteRain(r, 0, { now: NOW, fetchImpl: async () => { throw new TypeError('offline'); } }));
});

const warning = (over = {}) => ({
  warning_issue: { issued: '2026-11-06T06:00:00', title_bm: 'Amaran Hujan Berterusan', title_en: 'Continuous Rain Warning' },
  valid_from: '2026-11-06T06:00:00',
  valid_to: '2026-11-07T00:00:00',
  heading_en: 'Continuous Rain (Danger)',
  text_en: 'Continuous rain in Kelantan and Terengganu.',
  instruction_en: 'Stay safe',
  heading_bm: 'Hujan Berterusan (Bahaya)',
  text_bm: 'Hujan berterusan di Kelantan dan Terengganu.',
  instruction_bm: 'Jaga diri',
  ...over,
});

test('keeps warnings about rain on land that are still in force', () => {
  const list = parseWarnings([
    warning(),
    warning({ heading_en: 'Strong Wind and Rough Seas', heading_bm: 'Angin Kencang', warning_issue: { title_en: 'Strong Wind', title_bm: 'Angin' }, text_en: 'Rough seas off Kelantan', text_bm: 'Laut bergelora' }),
    warning({ valid_to: '2026-11-06T09:00:00' }),
  ], NOW);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].states, ['Kelantan', 'Terengganu']);
  assert.equal(list[0].danger, true);
  assert.equal(list[0].flood, true);
  assert.equal(list[0].heading.ms, 'Hujan Berterusan (Bahaya)');
  assert.equal(list[0].heading.en, 'Continuous Rain (Danger)');
});

test('reads times as Malaysian unless told otherwise', () => {
  // 09:00 in Malaysia is 01:00 UTC, an hour before NOW.
  assert.equal(parseWarnings([warning({ valid_to: '2026-11-06T09:00:00' })], NOW).length, 0);
  // 11:00 is an hour after.
  assert.equal(parseWarnings([warning({ valid_to: '2026-11-06T11:00:00' })], NOW).length, 1);
  assert.equal(parseWarnings([warning({ valid_to: '2026-11-06T09:00:00Z' })], NOW).length, 1, 'said to be UTC');
});

test('copes with a missing end time, or a wrapped response', () => {
  assert.equal(parseWarnings([warning({ valid_to: null })], NOW).length, 1, 'recent');
  assert.equal(parseWarnings([warning({ valid_to: null, warning_issue: { issued: '2026-11-01T00:00:00', title_en: 'Rain' } })], NOW).length, 0, 'old');
  assert.equal(parseWarnings({ data: [warning()] }, NOW).length, 1);
  assert.deepEqual(parseWarnings(null, NOW), []);
});

test('recognises states however they are written', () => {
  assert.deepEqual(statesIn('Wilayah Persekutuan Kuala Lumpur'), ['Kuala Lumpur']);
  assert.deepEqual(statesIn('Pulau Pinang'), ['Pulau Pinang']);
  assert.deepEqual(statesIn('Penang'), ['Pulau Pinang']);
  assert.deepEqual(statesIn('Malacca'), ['Melaka']);
  assert.deepEqual(statesIn('Perak and Perlis'), ['Perak', 'Perlis']);
  assert.deepEqual(statesIn(''), []);
  const list = parseWarnings([warning()], NOW);
  assert.equal(warningsFor(list, ['Selangor']).length, 0);
  assert.equal(warningsFor(list, ['Selangor', 'Kelantan']).length, 1);
});

test('asks which states the route passes through', async () => {
  const seen = [];
  const answers = ['Selangor', 'Kuala Lumpur', 'Pahang', 'Pahang'];
  const states = await routeStates(route(), 0, {
    fetchImpl: async (u) => {
      seen.push(String(u));
      return new Response(JSON.stringify({ features: [{ properties: { state: answers[seen.length - 1] } }] }));
    },
  });
  assert.deepEqual(states.sort(), ['Kuala Lumpur', 'Pahang', 'Selangor']);
  assert.equal(seen.length, 4);
  await assert.rejects(routeStates(route(), 0, { fetchImpl: async () => { throw new TypeError('offline'); } }));
});

test('uses the server when the browser can\'t ask directly', async () => {
  const urls = [];
  const fetchImpl = async (u) => {
    urls.push(String(u));
    if (String(u).includes('data.gov.my')) throw new TypeError('blocked');
    return new Response(JSON.stringify([warning()]));
  };
  const list = await fetchWarnings({ now: NOW, fetchImpl, server: 'https://pintu.test' });
  assert.equal(list.length, 1);
  assert.deepEqual(urls, [CONFIG.weather.warningsUrl, 'https://pintu.test/warnings']);
  await assert.rejects(fetchWarnings({ now: NOW, fetchImpl, server: null }));
});

function services({ rain = 'wet', warnings = 'ok', state = 'Kelantan' } = {}) {
  const calls = { forecast: 0, warnings: 0, reverse: 0 };
  const fetchImpl = async (u) => {
    u = String(u);
    if (u.includes('open-meteo')) {
      calls.forecast++;
      if (rain === 'fail') throw new TypeError('offline');
      return new Response(JSON.stringify([hourly(false), hourly(rain === 'wet')]));
    }
    if (u.includes('data.gov.my')) {
      calls.warnings++;
      if (warnings === 'fail') throw new TypeError('offline');
      return new Response(JSON.stringify(warnings === 'none' ? [] : [warning()]));
    }
    calls.reverse++;
    return new Response(JSON.stringify({ features: [{ properties: { state } }] }));
  };
  return { calls, fetchImpl };
}

test('puts it all together, once per route for a while', async () => {
  clearWeatherCache();
  const r = route();
  const { calls, fetchImpl } = services();
  const opts = { now: NOW, fetchImpl, server: null };
  const out = await checkRouteWeather(r, 0, opts);
  assert.equal(out.rain.first.kind, 'storm');
  assert.equal(out.warnings.length, 1);
  assert.equal(out.rainFailed, false);
  assert.equal(out.warningsFailed, false);
  await checkRouteWeather(r, 0, opts);
  assert.equal(calls.forecast, 1);
  await checkRouteWeather(r, 0, { ...opts, now: NOW + 21 * 60000 });
  assert.equal(calls.forecast, 2, 'looked at again later');
});

test('a warning elsewhere isn\'t shown, and no warnings needs no state lookup', async () => {
  clearWeatherCache();
  const elsewhere = services({ state: 'Selangor' });
  assert.equal((await checkRouteWeather(route(), 0, { now: NOW, fetchImpl: elsewhere.fetchImpl, server: null })).warnings.length, 0);
  clearWeatherCache();
  const none = services({ warnings: 'none' });
  await checkRouteWeather(route(), 0, { now: NOW, fetchImpl: none.fetchImpl, server: null });
  assert.equal(none.calls.reverse, 0);
});

test('each part fails by itself, says so, and is tried again', async () => {
  clearWeatherCache();
  const r = route();
  const noRain = services({ rain: 'fail' });
  const a = await checkRouteWeather(r, 0, { now: NOW, fetchImpl: noRain.fetchImpl, server: null });
  assert.equal(a.rainFailed, true);
  assert.equal(a.rain, null);
  assert.equal(a.warnings.length, 1);
  await checkRouteWeather(r, 0, { now: NOW, fetchImpl: noRain.fetchImpl, server: null });
  assert.equal(noRain.calls.forecast, 2, 'failures aren\'t kept');

  clearWeatherCache();
  const noWarn = services({ warnings: 'fail' });
  const b = await checkRouteWeather(r, 0, { now: NOW, fetchImpl: noWarn.fetchImpl, server: null });
  assert.equal(b.warningsFailed, true);
  assert.deepEqual(b.warnings, []);
  assert.equal(b.rain.first.kind, 'storm');
});

test('leaving ends the check', async () => {
  clearWeatherCache();
  const ctrl = new AbortController();
  const pending = checkRouteWeather(route(), 0, { signal: ctrl.signal, fetchImpl: () => new Promise(() => {}), server: null });
  ctrl.abort();
  await assert.rejects(pending, /cancelled/);
  assert.ok(P.a);
});
