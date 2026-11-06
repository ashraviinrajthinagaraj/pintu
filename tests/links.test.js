import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeGeohash, parseLocationText, readMapUrl, readResolved, resolveShortLink } from '../js/links.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
const spot = (text) => {
  const out = parseLocationText(text);
  assert.equal(out?.kind, 'place', `${text} gave ${JSON.stringify(out)}`);
  return out.place;
};

test('a Google Maps place link: the exact place, not where the map was looking', () => {
  const p = spot('https://www.google.com/maps/place/Suria+KLCC/@3.1500,101.7000,17z/data=!3m1!4b1!4m6!3m5!1s0x31cc37d12d669c1f:0x9e3afdd17c8a9056!8m2!3d3.1579!4d101.7116!16s');
  near(p.lat, 3.1579);
  near(p.lng, 101.7116);
  assert.equal(p.name, 'Suria KLCC');
  assert.equal(p.unnamed, false);
});

test('the other ways Google writes a position', () => {
  for (const url of [
    'https://maps.google.com/?q=3.1579,101.7116',
    'https://www.google.com/maps?q=3.1579,101.7116&z=17',
    'https://www.google.com.my/maps?ll=3.1579,101.7116',
    'https://www.google.com/maps/search/?api=1&query=3.1579%2C101.7116',
    'https://www.google.com/maps/dir/?api=1&destination=3.1579,101.7116',
    'https://www.google.com/maps/search/3.1579,+101.7116',
    'https://www.google.com/maps/dir//3.1579,101.7116/@3.15,101.71,15z',
    'https://www.google.com/maps/@3.1579,101.7116,15z',
  ]) {
    const p = spot(url);
    near(p.lat, 3.1579);
    near(p.lng, 101.7116);
  }
});

test('a dropped pin has no real name, so one gets looked up', () => {
  const p = spot('https://www.google.com/maps/place/3%C2%B009\'28.4%22N+101%C2%B042\'41.8%22E/@3.1579,101.7116,17z/data=!3m1!4b1!4m4!3m3!8m2!3d3.1579!4d101.7116');
  near(p.lat, 3.1579);
  assert.equal(p.unnamed, true);
  assert.equal(p.name, '3.15790, 101.71160');
});

test('Waze links, including the short kind that needs no server', () => {
  for (const url of [
    'https://waze.com/ul?ll=3.1579%2C101.7116&navigate=yes',
    'https://www.waze.com/ul?ll=3.1579,101.7116',
    'https://www.waze.com/live-map/directions?to=ll.3.1579%2C101.7116',
  ]) {
    const p = spot(url);
    near(p.lat, 3.1579);
    near(p.lng, 101.7116);
  }
  const short = spot('https://waze.com/ul/hw283ujw2j');
  assert.ok(short.lat > 0 && short.lng > 90 && short.lng < 120, JSON.stringify(short));
});

test('geohashes decode correctly', () => {
  // The worked example from the geohash specification.
  const g = decodeGeohash('ezs42');
  near(g.lat, 42.6, 0.03);
  near(g.lng, -5.6, 0.03);
  assert.equal(decodeGeohash('a!'), null);
});

test('Apple Maps, OpenStreetMap and geo: links', () => {
  const apple = spot('https://maps.apple.com/?ll=3.1579,101.7116&q=KLCC');
  near(apple.lat, 3.1579);
  assert.equal(apple.name, 'KLCC');
  const osm = spot('https://www.openstreetmap.org/?mlat=3.1579&mlon=101.7116#map=17/3.1579/101.7116');
  near(osm.lng, 101.7116);
  const osmView = spot('https://www.openstreetmap.org/#map=17/3.1579/101.7116');
  near(osmView.lat, 3.1579);
  const geo = spot('geo:3.1579,101.7116?q=3.1579,101.7116(Suria%20KLCC)');
  near(geo.lat, 3.1579);
  assert.equal(geo.name, 'Suria KLCC');
  const plainGeo = spot('geo:3.1579,101.7116');
  near(plainGeo.lng, 101.7116);
});

test('a link inside a message, with the place named before it', () => {
  const p = spot('Suria KLCC\nJalan Ampang\nhttps://www.google.com/maps?q=3.1579,101.7116');
  assert.equal(p.name, 'Suria KLCC');
  near(p.lat, 3.1579);
  const trailing = spot('Jumpa sini (https://www.google.com/maps?q=3.1579,101.7116).');
  near(trailing.lng, 101.7116);
});

test('a link with only a name becomes a search', () => {
  assert.deepEqual(parseLocationText('https://www.google.com/maps/search/?api=1&query=Suria+KLCC'), { kind: 'search', query: 'Suria KLCC' });
  assert.deepEqual(parseLocationText('https://www.google.com/maps/place/Suria+KLCC'), { kind: 'search', query: 'Suria KLCC' });
  assert.deepEqual(parseLocationText('https://maps.google.com/?q=Suria+KLCC'), { kind: 'search', query: 'Suria KLCC' });
  assert.deepEqual(parseLocationText('https://www.google.com/maps/search/Suria+KLCC/'), { kind: 'search', query: 'Suria KLCC' });
});

test('short links are recognised, and keep the name that came with them', () => {
  assert.deepEqual(parseLocationText('https://maps.app.goo.gl/AbCdEf123'), { kind: 'short', url: 'https://maps.app.goo.gl/AbCdEf123', name: '' });
  const withName = parseLocationText('Suria KLCC\nJalan Ampang\nhttps://maps.app.goo.gl/AbC?g_st=awb');
  assert.equal(withName.kind, 'short');
  assert.equal(withName.name, 'Suria KLCC');
  assert.equal(withName.url, 'https://maps.app.goo.gl/AbC?g_st=awb');
  assert.equal(parseLocationText('https://goo.gl/maps/xyz').kind, 'short');
  assert.equal(parseLocationText('https://maps.apple.com/p/abc').kind, 'short');
});

test('plain coordinates, with or without a comma', () => {
  near(spot('3.1579, 101.7116').lat, 3.1579);
  near(spot('3.1579 101.7116').lng, 101.7116);
  near(spot('-33.86,151.2').lat, -33.86);
});

test('anything else is left to the ordinary search', () => {
  assert.equal(parseLocationText('klcc'), null);
  assert.equal(parseLocationText('Jalan 3/4 Ampang'), null);
  assert.equal(parseLocationText('https://example.com/maps?q=3.1,101.7'), null);
  assert.equal(parseLocationText(''), null);
  assert.equal(parseLocationText(null), null);
  assert.equal(parseLocationText('200.5, 300.1'), null, 'not on Earth');
  assert.equal(parseLocationText('0, 0'), null);
});

test('a map link with no location admits it', () => {
  assert.deepEqual(parseLocationText('https://www.google.com/maps'), { kind: 'unknown' });
  assert.equal(readMapUrl('not a link'), null);
});

test('asks the server about a short link, safely encoded', async () => {
  const urls = [];
  const answer = await resolveShortLink('https://maps.app.goo.gl/a?b=c', {
    server: 'https://pintu.test',
    fetchImpl: async (u) => { urls.push(u); return new Response(JSON.stringify({ lat: 3.1, lng: 101.7 })); },
  });
  assert.equal(answer.lat, 3.1);
  assert.equal(urls[0], 'https://pintu.test/link?u=https%3A%2F%2Fmaps.app.goo.gl%2Fa%3Fb%3Dc');
  await assert.rejects(resolveShortLink('https://maps.app.goo.gl/a', { server: null }));
  await assert.rejects(resolveShortLink('https://maps.app.goo.gl/a', { server: 'https://pintu.test', fetchImpl: async () => new Response('', { status: 502 }) }));
});

test('makes sense of the server\'s answer', () => {
  const direct = readResolved({ lat: 3.1, lng: 101.7, name: 'Kedai' });
  assert.equal(direct.place.name, 'Kedai');
  assert.equal(readResolved({ lat: 3.1, lng: 101.7 }, 'Dari Mesej').place.name, 'Dari Mesej');
  const fromUrl = readResolved({ url: 'https://www.google.com/maps?q=3.1,101.7' });
  near(fromUrl.place.lng, 101.7);
  assert.deepEqual(readResolved({ url: 'https://www.google.com/maps/place/Kedai+Kopi' }), { kind: 'search', query: 'Kedai Kopi' });
  assert.deepEqual(readResolved({ url: 'https://www.google.com/maps' }, 'Nama'), { kind: 'search', query: 'Nama' });
  assert.deepEqual(readResolved({}), { kind: 'unknown' });
  assert.deepEqual(readResolved({ lat: 200, lng: 101 }), { kind: 'unknown' });
});
