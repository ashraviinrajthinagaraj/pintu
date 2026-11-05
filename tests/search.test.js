import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoordinates, parseResults, reversePlace, searchPlaces, toPlace } from '../js/search.js';

const feature = (properties, coordinates = [101.7116, 3.1579]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties });

test('turns a search result into a place', () => {
  const p = toPlace(feature({ name: 'Suria KLCC', street: 'Jalan Ampang', city: 'Kuala Lumpur', state: 'Kuala Lumpur', countrycode: 'MY' }));
  assert.equal(p.name, 'Suria KLCC');
  assert.equal(p.detail, 'Jalan Ampang, Kuala Lumpur');
  assert.equal(p.lat, 3.1579);
  assert.equal(p.lng, 101.7116);
});

test('addresses with no name use the street', () => {
  const p = toPlace(feature({ street: 'Jalan Tun Razak', housenumber: '12', city: 'Kuala Lumpur', countrycode: 'MY' }));
  assert.equal(p.name, 'Jalan Tun Razak 12');
  assert.equal(p.detail, 'Kuala Lumpur');
});

test('puts Malaysia first, drops duplicates and nameless results', () => {
  const r = parseResults({ features: [
    feature({ name: 'Mall', city: 'Singapore', countrycode: 'SG' }),
    feature({ name: 'Mall', city: 'Johor Bahru', countrycode: 'MY' }),
    feature({ name: 'Mall', city: 'Johor Bahru', countrycode: 'MY' }),
    feature({ countrycode: 'MY' }),
  ] });
  assert.deepEqual(r.map((p) => p.detail), ['Johor Bahru', 'Singapore']);
});

test('understands pasted coordinates', () => {
  assert.deepEqual(
    [parseCoordinates('3.1579, 101.7116').lat, parseCoordinates('3.1579 101.7116').lng],
    [3.1579, 101.7116],
  );
  assert.equal(parseCoordinates('Jalan 14, 2'), null);
  assert.equal(parseCoordinates('KLCC'), null);
  assert.equal(parseCoordinates('95.0, 101.0'), null);
});

test('asks for places inside the region and near you', async () => {
  let url;
  const fetchImpl = async (u) => { url = new URL(u); return new Response(JSON.stringify({ features: [] })); };
  await searchPlaces('KLCC', { near: { lat: 2.7258, lng: 101.9378 }, fetchImpl });
  assert.equal(url.searchParams.get('q'), 'KLCC');
  assert.equal(url.searchParams.get('bbox'), '99.6,0.85,119.3,7.4');
  assert.equal(url.searchParams.get('lat'), '2.7258');
  assert.equal(url.searchParams.get('lon'), '101.9378');
});

test('pasted coordinates need no network', async () => {
  const r = await searchPlaces('3.1,101.7', { fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.equal(r[0].lat, 3.1);
});

test('failed search reports failure', async () => {
  await assert.rejects(searchPlaces('x', { fetchImpl: async () => new Response('', { status: 500 }) }));
});

test('a pressed point keeps its exact position with the nearby name', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ features: [feature({ name: 'Taman Melati', countrycode: 'MY' }, [101.70001, 3.15001])] }));
  const p = await reversePlace(101.7, 3.15, { fetchImpl });
  assert.equal(p.name, 'Taman Melati');
  assert.equal(p.lng, 101.7);
  assert.equal(await reversePlace(101.7, 3.15, { fetchImpl: async () => new Response('{"features":[]}') }), null);
});
