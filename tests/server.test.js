// Pintu's small server, run here against stand-ins for the sites it talks to.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/worker.js';

const PINTU = 'https://ashraviinrajthinagaraj.github.io';
const HOME = 'https://pintu.example.workers.dev';

function ask(path, { origin = PINTU, method = 'GET' } = {}) {
  const headers = origin ? { origin } : {};
  return worker.fetch(new Request(`${HOME}${path}`, { method, headers }));
}
const linkTo = (u) => `/link?u=${encodeURIComponent(u)}`;

// Pretends to be the internet, and keeps a list of everything asked of it.
function internet(sites) {
  const asked = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    asked.push(url);
    const answer = sites[url];
    if (answer === undefined) throw new Error(`the server tried to reach ${url}`);
    return typeof answer === 'function' ? answer() : answer;
  };
  return asked;
}
const redirect = (to) => () => new Response(null, { status: 302, headers: { location: to } });
const page = (html) => () => new Response(html, { status: 200 });

test('only answers Pintu\'s own page', async () => {
  const asked = internet({});
  for (const origin of ['https://evil.example', 'http://ashraviinrajthinagaraj.github.io', 'https://ashraviinrajthinagaraj.github.io.evil.example', null]) {
    const res = await ask(linkTo('https://maps.app.goo.gl/x'), { origin });
    assert.equal(res.status, 403, String(origin));
  }
  assert.deepEqual(asked, []);
});

test('says it\'s running when opened in a browser, and nothing more', async () => {
  const res = await ask('/', { origin: null });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /running/);
});

test('only GET', async () => {
  internet({});
  assert.equal((await ask(linkTo('https://maps.app.goo.gl/x'), { method: 'POST' })).status, 405);
  const pre = await ask('/link', { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), PINTU);
});

test('refuses to fetch anything that isn\'t a map link', async () => {
  const asked = internet({});
  for (const bad of [
    'https://evil.example/x',
    'http://maps.app.goo.gl/x',
    'https://maps.app.goo.gl.evil.example/x',
    'https://evil.example@maps.app.goo.gl/x',
    'https://maps.app.goo.gl:8443/x',
    'https://localhost/admin',
    'https://169.254.169.254/latest/meta-data',
    'https://goo.gl/somethingelse',
    'https://g.co/other',
    'file:///etc/passwd',
    'not a url',
    '',
  ]) {
    const res = await ask(linkTo(bad));
    assert.equal(res.status, 400, bad);
  }
  assert.deepEqual(asked, [], 'and never tried');
});

test('follows a short link to its position', async () => {
  internet({
    'https://maps.app.goo.gl/AbC': redirect('https://www.google.com/maps/place/Suria+KLCC/@3.15,101.70,17z/data=!3d3.1579!4d101.7116'),
  });
  const res = await ask(linkTo('https://maps.app.goo.gl/AbC'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), PINTU);
  const body = await res.json();
  assert.equal(body.lat, 3.1579);
  assert.equal(body.lng, 101.7116);
  assert.equal(body.name, 'Suria KLCC');
});

test('goes through several hops, and past the cookie question', async () => {
  const final = 'https://www.google.com/maps/place/Kedai/@3.2,101.6,17z/data=!3d3.21!4d101.61';
  const consent = `https://consent.google.com/m?continue=${encodeURIComponent(final)}&gl=MY`;
  internet({
    'https://maps.app.goo.gl/AbC': redirect('https://goo.gl/maps/hop'),
    'https://goo.gl/maps/hop': redirect(consent),
  });
  const body = await (await ask(linkTo('https://maps.app.goo.gl/AbC'))).json();
  assert.equal(body.lat, 3.21);
  assert.equal(body.name, 'Kedai');
});

test('never follows a redirect off the map sites', async () => {
  const asked = internet({
    'https://maps.app.goo.gl/AbC': redirect('https://evil.example/steal'),
    'https://goo.gl/maps/inner': redirect('https://169.254.169.254/latest/meta-data'),
    'https://goo.gl/maps/plain': redirect('http://www.google.com/maps'),
    'https://goo.gl/maps/hidden': redirect(`https://consent.google.com/m?continue=${encodeURIComponent('https://evil.example/')}`),
  });
  for (const start of ['https://maps.app.goo.gl/AbC', 'https://goo.gl/maps/inner', 'https://goo.gl/maps/plain', 'https://goo.gl/maps/hidden']) {
    const res = await ask(linkTo(start));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.lat, undefined);
    assert.equal(body.url, start, 'stops where it was');
  }
  assert.ok(asked.every((u) => !/evil|169\.254|^http:/.test(u)), asked.join());
});

test('gives up after a sensible number of hops', async () => {
  const sites = {};
  for (let i = 0; i < 20; i++) sites[`https://goo.gl/maps/${i}`] = redirect(`https://goo.gl/maps/${i + 1}`);
  const asked = internet(sites);
  const res = await ask(linkTo('https://goo.gl/maps/0'));
  assert.equal(res.status, 200);
  assert.ok(asked.length <= 6, String(asked.length));
});

test('reads the position from the page when the address has none', async () => {
  const url = 'https://www.google.com/maps/place/Kedai+Kopi/data=!4m2!3m1!1s0x0';
  internet({
    'https://maps.app.goo.gl/AbC': redirect(url),
    [url]: page('<html><meta content="https://maps.google.com/maps/api/staticmap?center=3.1579%2C101.7116&zoom=15"></html>'),
  });
  const body = await (await ask(linkTo('https://maps.app.goo.gl/AbC'))).json();
  assert.equal(body.lat, 3.1579);
  assert.equal(body.lng, 101.7116);
  assert.equal(body.name, 'Kedai Kopi');
});

test('only ever returns a position and an address, never a page', async () => {
  const url = 'https://www.google.com/maps/place/x';
  internet({
    'https://maps.app.goo.gl/AbC': redirect(url),
    [url]: page('<html>SECRET PAGE CONTENT</html>'),
  });
  const text = await (await ask(linkTo('https://maps.app.goo.gl/AbC'))).text();
  assert.doesNotMatch(text, /SECRET/);
});

test('a site being down is an honest error', async () => {
  internet({ 'https://maps.app.goo.gl/AbC': () => { throw new TypeError('down'); } });
  const res = await ask(linkTo('https://maps.app.goo.gl/AbC'));
  assert.equal(res.status, 502);
  assert.equal(res.headers.get('access-control-allow-origin'), PINTU, 'the page can still read why');
});

async function spotInPage(text) {
  const url = 'https://www.google.com/maps/place/Kedai';
  internet({ 'https://maps.app.goo.gl/AbC': redirect(url), [url]: page(text) });
  return (await ask(linkTo('https://maps.app.goo.gl/AbC'))).json();
}

test('finds a position written in all the usual ways', async () => {
  for (const text of [
    'x!3d3.15!4d101.7y', '?q=3.15,101.7', '&ll=3.15%2C101.7', '/maps/place/3.15,101.7', '/maps/search/3.15,+101.7',
    '@3.15,101.7,17z', 'center=3.15%2C101.7', '?destination=3.15,101.7',
  ]) {
    const body = await spotInPage(text);
    assert.equal(body.lat, 3.15, text);
    assert.equal(body.lng, 101.7, text);
  }
  for (const text of ['nothing here', '@95.5,300.5,17z', '@0.0,0.0,2z']) {
    assert.equal((await spotInPage(text)).lat, undefined, text);
  }
});

test('passes on the weather warnings, and nothing else', async () => {
  const asked = internet({ 'https://api.data.gov.my/weather/warning': () => new Response(JSON.stringify([{ heading_en: 'Rain' }])) });
  const res = await ask('/warnings?u=https://evil.example');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), [{ heading_en: 'Rain' }]);
  assert.deepEqual(asked, ['https://api.data.gov.my/weather/warning']);
  internet({ 'https://api.data.gov.my/weather/warning': () => new Response('', { status: 500 }) });
  assert.equal((await ask('/warnings')).status, 502);
});

const LISTING = `
  <html><head><style>.a{}</style><script>var x = "NOPE [ 1 ]";</script></head><body>
  <h2>Anchor</h2>
  <a href="about-tenant/?pid=1"><div class="n">AEON</div> <span>[ 2AT1-2 ]</span></a>
  <a href="about-tenant/?pid=2">DECATHLON [ G61-6 ]</a>
  <h2>Food &amp; Beverage</h2>
  <div><a href="about-tenant/?pid=3">MCDONALD&#039;S</a><span> [ LG57-2 ]</span></div>
  <a href="about-tenant/?pid=3b">MCDONALD&#039;S [ LG57-2 ]</a>
  <a href="about-tenant/?pid=4">BASKIN ROBBINS [ L1-74 ]</a>
  <a href="about-tenant/?pid=5">BASKIN ROBBINS [ L3-12 ]</a>
  <a href="about-tenant/?pid=6">Nasi Lemak Shop [ LG - 233 ]</a>
  </body></html>`;

test('reads a mall\'s shop list from its page', async () => {
  const filler = Array.from({ length: 20 }, (_, i) => `<a>Pengisi ${i} [ Z-${i} ]</a>`).join('');
  internet({ 'https://www.ioicitymall.com.my/?cat=36&tenantlist=full': () => new Response(`${LISTING}${filler}`) });
  const { shops } = await (await ask('/mall?id=ioi-city')).json();
  assert.deepEqual(shops.filter((shop) => !shop.name.startsWith('Pengisi')), [
    { name: 'AEON', lot: '2AT1-2' },
    { name: 'DECATHLON', lot: 'G61-6' },
    { name: "MCDONALD'S", lot: 'LG57-2' },
    { name: 'BASKIN ROBBINS', lot: 'L1-74' },
    { name: 'BASKIN ROBBINS', lot: 'L3-12' },
    { name: 'Nasi Lemak Shop', lot: 'LG - 233' },
  ]);
});

test('serves a known mall\'s list, and refuses any other', async () => {
  const many = Array.from({ length: 25 }, (_, i) => `<a>Kedai ${i} [ L1-${i} ]</a>`).join('\n');
  const asked = internet({ 'https://www.ioicitymall.com.my/?cat=36&tenantlist=full': () => new Response(many) });
  const res = await ask('/mall?id=ioi-city');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.shops.length, 25);
  assert.equal(body.shops[3].lot, 'L1-3');
  assert.equal((await ask('/mall?id=https://evil.example')).status, 404);
  assert.equal(asked.length, 1);
});

test('a page it can\'t make sense of is an error, not an empty mall', async () => {
  internet({ 'https://www.ioicitymall.com.my/?cat=36&tenantlist=full': () => new Response('<html>Redesigned!</html>') });
  assert.equal((await ask('/mall?id=ioi-city')).status, 502);
});

test('nothing else is here', async () => {
  const asked = internet({});
  assert.equal((await ask('/anything')).status, 404);
  assert.equal((await ask('/')).status, 404);
  assert.deepEqual(asked, []);
});
