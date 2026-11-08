// Pintu's small server, run here against stand-ins for the sites it talks to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import worker from '../server/worker.js';
import { forgetCounts } from '../server/tomtom.js';
import { CHARACTER_IDS } from '../js/characters.js';

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
  assert.match(await res.text(), /running\. Version \d{4}-\d{2}-\d{2}\./);
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

/* ---------- Human voices ---------- */

const ENV = { AZURE_SPEECH_KEY: 'secret-key-123' };
const TTS = 'https://southeastasia.tts.speech.microsoft.com/cognitiveservices/v1';
const speakUrl = (who, lang, text) => `/speak?who=${who}&lang=${lang}&text=${encodeURIComponent(text)}`;
const say = (path, { origin = PINTU, env = ENV } = {}) => worker.fetch(new Request(`${HOME}${path}`, { headers: origin ? { origin } : {} }), env);

// Pretends to be Azure, and keeps what it was asked to say.
function azure(answer = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) {
  const asked = [];
  globalThis.fetch = async (url, init = {}) => {
    asked.push({ url: String(url), ...init });
    return answer(asked.length, init);
  };
  return asked;
}

// Enough XML checking to catch a tag left open, or text breaking out of one.
function assertBalanced(xml) {
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([\w:]+)([^<>]*?)(\/?)>/g)) {
    if (m[4]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2], xml);
    else stack.push(m[2]);
  }
  assert.deepEqual(stack, [], xml);
  assert.doesNotMatch(xml.replace(/<[^<>]*>/g, '').replace(/&(amp|lt|gt|quot|apos);/g, ''), /[<>&]/, xml);
}

test('a spoken line comes back as audio, ready to keep', async () => {
  const asked = azure();
  const res = await say(speakUrl('captain', 'ms', 'Belok kiri.'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/mpeg');
  assert.equal(res.headers.get('access-control-allow-origin'), PINTU);
  assert.match(res.headers.get('cache-control'), /immutable/);
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3]);
  assert.equal(asked[0].url, TTS);
  assert.equal(asked[0].method, 'POST');
  assert.equal(asked[0].headers['Ocp-Apim-Subscription-Key'], 'secret-key-123');
  assert.match(asked[0].headers['X-Microsoft-OutputFormat'], /mp3/);
  assert.match(asked[0].body, /name="ms-MY-OsmanNeural"/);
  assertBalanced(asked[0].body);
});

test('every character can speak both languages, with properly formed requests', async () => {
  for (const who of CHARACTER_IDS) {
    for (const lang of ['ms', 'en']) {
      const asked = azure();
      const res = await say(speakUrl(who, lang, 'Belok kiri. [tease]Eh… 90 kilometer? [whisper]Jangan.'));
      assert.equal(res.status, 200, `${who} ${lang}`);
      assertBalanced(asked[0].body);
    }
  }
});

test('the characters don\'t all share one voice, and the accents are real ones', async () => {
  const voiceOf = async (who, lang) => {
    const asked = azure();
    await say(speakUrl(who, lang, 'Belok kiri.'));
    return asked[0].body.match(/voice name="([^"]+)"/)[1];
  };
  assert.match(await voiceOf('captain', 'ms'), /^ms-MY-/);
  assert.match(await voiceOf('makcik', 'ms'), /^ms-MY-/);
  assert.match(await voiceOf('commentator', 'en'), /^en-IN-/);
  assert.match(await voiceOf('cikgu', 'en'), /^en-IN-/);
  assert.match(await voiceOf('uncle', 'ms'), /^zh-CN-/);
  assert.match(await voiceOf('agent', 'ms'), /^zh-CN-/);
  assert.match(await voiceOf('uncle', 'en'), /^en-SG-/);
  const all = [];
  for (const who of ['captain', 'commentator', 'cikgu', 'uncle', 'agent', 'trailer', 'adik']) all.push(await voiceOf(who, 'ms'));
  assert.equal(new Set(all).size, all.length, all.join());
});

test('a voice from another language is told which language to speak', async () => {
  const asked = azure();
  await say(speakUrl('uncle', 'ms', 'Belok kiri.'));
  assert.match(asked[0].body, /<lang xml:lang="ms-MY">/);
  const own = azure();
  await say(speakUrl('captain', 'ms', 'Belok kiri.'));
  assert.doesNotMatch(own[0].body, /<lang/);
});

test('delivery marks become small changes in the voice, and pauses', async () => {
  const asked = azure();
  await say(speakUrl('standard', 'ms', 'Belok kiri. [deadpan]Hmm… baiklah. [excited]Yay!'));
  const { body } = asked[0];
  assert.doesNotMatch(body, /\[|\]/, 'marks are never read aloud');
  assert.match(body, /Belok kiri\./);
  assert.match(body, /<prosody rate="-7%" pitch="-3%">Hmm<\/prosody><break time="350ms"\/><prosody rate="-7%" pitch="-3%">baiklah\.<\/prosody>/);
  assert.match(body, /<prosody rate="\+9%" pitch="\+6%">Yay!<\/prosody>/);
  assert.equal((body.match(/<break time="280ms"\/>/g) || []).length, 2, 'a beat before each change');
});

test('after a joke, a direction goes back to a normal voice', async () => {
  const asked = azure();
  await say(speakUrl('standard', 'ms', '[whisper]Senyap… [plain]Belok kiri.'));
  assert.match(asked[0].body, /<break time="280ms"\/>Belok kiri\./);
});

test('nothing in a line can break out into the request', async () => {
  const asked = azure();
  const res = await say(speakUrl('standard', 'en', 'A&B <voice name="evil">"x"</voice> [bogus]y'));
  assert.equal(res.status, 200);
  const { body } = asked[0];
  assert.doesNotMatch(body, /name="evil"/);
  assert.doesNotMatch(body, /bogus/, 'an unknown mark is dropped');
  assert.match(body, /A&amp;B &lt;voice name=&quot;evil&quot;&gt;/);
  assertBalanced(body);
});

test('numbers are spelled out for a voice from another language, in the right one', async () => {
  const words = async (who, lang, text) => {
    const asked = azure();
    await say(speakUrl(who, lang, text));
    return asked[0].body;
  };
  assert.match(await words('commentator', 'ms', 'Dalam 300 meter'), /Dalam tiga ratus meter/);
  assert.match(await words('commentator', 'ms', '1.5 kilometer'), /satu perpuluhan lima kilometer/);
  assert.match(await words('cikgu', 'ms', 'Had 90'), /Had sembilan puluh/);
  assert.match(await words('captain', 'en', 'The limit is 110'), /one hundred ten/);
  assert.match(await words('captain', 'en', 'In 2.5 kilometres'), /two point five kilometres/);
  assert.match(await words('commentator', 'ms', 'Masuk E2 dan FT3'), /Masuk E2 dan FT3/, 'road names stay as they are');
  assert.match(await words('captain', 'ms', 'Dalam 300 meter'), /Dalam 300 meter/, 'a Malay voice reads them itself');
});

test('an English voice reading Malay is helped with the Malay spelling', async () => {
  const asked = azure();
  await say(speakUrl('commentator', 'ms', 'Cuaca kecil dicuba Cyberjaya McDonald'));
  assert.match(asked[0].body, /Cuacha kechil dichuba Cyberjaya McDonald/);
  const native = azure();
  await say(speakUrl('commentator', 'en', 'Cuaca kecil'));
  assert.match(native[0].body, /kecil/);
});

test('only known characters, only the two languages, only short lines', async () => {
  const asked = azure();
  for (const path of [
    speakUrl('nobody', 'ms', 'x'),
    speakUrl('__proto__', 'ms', 'x'),
    speakUrl('constructor', 'ms', 'x'),
    speakUrl('captain', 'fr', 'x'),
    speakUrl('captain', '__proto__', 'x'),
    speakUrl('captain', 'ms', ''),
    speakUrl('captain', 'ms', 'x'.repeat(421)),
    '/speak',
  ]) {
    assert.equal((await say(path)).status, 400, path);
  }
  assert.equal(asked.length, 0);
});

test('without a key it says so, and asks nobody', async () => {
  const asked = azure();
  const res = await say(speakUrl('captain', 'ms', 'x'), { env: {} });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('access-control-allow-origin'), PINTU);
  assert.deepEqual(await (await say('/speak?check=1', { env: {} })).json(), { ready: false, reason: 'no key' });
  assert.equal((await worker.fetch(new Request(`${HOME}${speakUrl('captain', 'ms', 'x')}`, { headers: { origin: PINTU } }))).status, 503, 'no settings at all');
  assert.equal(asked.length, 0);
});

test('the check says whether the key works, using none of the allowance', async () => {
  let asked = azure(() => new Response('[]'));
  assert.deepEqual(await (await say('/speak?check=1')).json(), { ready: true });
  assert.match(asked[0].url, /voices\/list$/);
  asked = azure(() => new Response('', { status: 401 }));
  assert.deepEqual(await (await say('/speak?check=1')).json(), { ready: false, reason: 'key refused' });
  azure(() => new Response('', { status: 500 }));
  assert.deepEqual(await (await say('/speak?check=1')).json(), { ready: false, reason: 'unavailable' });
});

test('the key never reaches the page, whatever happens', async () => {
  for (const status of [200, 400, 401, 403, 429, 500]) {
    azure(() => new Response(status === 200 ? new Uint8Array([1]) : 'nope', { status }));
    const res = await say(speakUrl('captain', 'ms', 'x'));
    const all = JSON.stringify([...res.headers]) + new TextDecoder().decode(await res.arrayBuffer());
    assert.doesNotMatch(all, /secret-key-123/, String(status));
  }
});

test('if a voice isn\'t offered here, the next one takes over', async () => {
  const asked = azure((n) => (n <= 2 ? new Response('no such voice', { status: 400 }) : new Response(new Uint8Array([9]))));
  const res = await say(speakUrl('commentator', 'en', 'Turn left.'));
  assert.equal(res.status, 200);
  assert.match(asked[0].body, /en-IN-ArjunNeural/);
  assert.match(asked[1].body, /en-IN-ArjunNeural/, 'same voice, simpler request');
  assert.doesNotMatch(asked[1].body, /prosody|<break/);
  assert.match(asked[2].body, /en-IN-PrabhatNeural/);
});

test('every character has an ordinary voice to fall back on, if the special ones aren\'t offered', async () => {
  for (const who of CHARACTER_IDS) {
    for (const lang of ['ms', 'en']) {
      const asked = azure((n, init) => (/name="(ms-MY|en-SG)-/.test(init.body) ? new Response(new Uint8Array([1])) : new Response('no', { status: 400 })));
      const res = await say(speakUrl(who, lang, 'Belok kiri.'));
      assert.equal(res.status, 200, `${who} ${lang}`);
      assert.ok(asked.length <= 6, `${who} ${lang}: ${asked.length}`);
    }
  }
});

test('if no voice can say it, that\'s an honest failure', async () => {
  const asked = azure(() => new Response('no', { status: 400 }));
  const res = await say(speakUrl('commentator', 'en', 'Turn left.'));
  assert.equal(res.status, 502);
  assert.ok(asked.length <= 6, String(asked.length));
});

test('Azure refusing is passed on clearly, so the phone can step back', async () => {
  azure(() => new Response('slow down', { status: 429 }));
  assert.equal((await say(speakUrl('captain', 'ms', 'x'))).status, 429);
  azure(() => new Response('no', { status: 401 }));
  assert.equal((await say(speakUrl('captain', 'ms', 'x'))).status, 503);
  azure(() => new Response('no', { status: 403 }));
  assert.equal((await say(speakUrl('captain', 'ms', 'x'))).status, 503);
  azure(() => new Response('oops', { status: 500 }));
  const res = await say(speakUrl('captain', 'ms', 'x'));
  assert.equal(res.status, 502);
  assert.equal(res.headers.get('access-control-allow-origin'), PINTU);
});

test('a human voice only ever speaks for Pintu\'s own page', async () => {
  const asked = azure();
  for (const origin of ['https://evil.example', null]) {
    assert.equal((await say(speakUrl('captain', 'ms', 'x'), { origin })).status, 403);
  }
  assert.equal(asked.length, 0);
});

test('a line already recorded isn\'t paid for twice', async () => {
  const store = new Map();
  globalThis.caches = {
    default: {
      match: async (req) => store.get(req.url)?.clone(),
      put: async (req, res) => { store.set(req.url, res); },
    },
  };
  try {
    const asked = azure();
    const first = await say(speakUrl('captain', 'ms', 'Belok kiri.'));
    assert.deepEqual([...new Uint8Array(await first.arrayBuffer())], [1, 2, 3]);
    const again = await say(speakUrl('captain', 'ms', 'Belok kiri.'));
    assert.equal(again.headers.get('access-control-allow-origin'), PINTU);
    assert.deepEqual([...new Uint8Array(await again.arrayBuffer())], [1, 2, 3]);
    assert.equal(asked.length, 1);
    await say(speakUrl('makcik', 'ms', 'Belok kiri.'));
    assert.equal(asked.length, 2, 'another character is another recording');
  } finally {
    delete globalThis.caches;
  }
});

test('a broken shelf never costs the line', async () => {
  globalThis.caches = { default: { match: async () => { throw new Error('no cache here'); }, put: async () => { throw new Error('no'); } } };
  try {
    azure();
    assert.equal((await say(speakUrl('captain', 'ms', 'x'))).status, 200);
  } finally {
    delete globalThis.caches;
  }
});

/* ---------- Google's voices ---------- */

const G = 'https://generativelanguage.googleapis.com/v1beta';
let nextKey = 0;
const freshKey = () => ({ GEMINI_API_KEY: `gemini-key-${++nextKey}` });
const SOUND = Buffer.from([82, 73, 70, 70, 1, 2, 3, 4]).toString('base64');
const spoken = () => new Response(JSON.stringify({
  steps: [
    { type: 'thought', content: [] },
    { type: 'model_output', content: [{ type: 'text', text: 'hm' }, { type: 'audio', mime_type: 'audio/wav', data: SOUND }] },
  ],
}));

// Pretends to be Google, and keeps what it was asked.
function google({ speak = spoken, voices = [], create = () => new Response(JSON.stringify({ id: 'voice_new' })), list } = {}) {
  const asked = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const entry = { url: u, method: init.method || 'GET', headers: init.headers, body: init.body ? JSON.parse(init.body) : null };
    asked.push(entry);
    if (u.startsWith(`${G}/voices`) && entry.method === 'GET') return list ? list() : new Response(JSON.stringify({ voices }));
    if (u === `${G}/voices`) return create(entry);
    if (u === `${G}/interactions`) return speak(entry, asked.filter((a) => a.url === u).length);
    if (u.startsWith(`${G}/models/`)) return new Response('{}');
    throw new Error(`the server tried to reach ${u}`);
  };
  return asked;
}
const interactions = (asked) => asked.filter((a) => a.url === `${G}/interactions`);

test('Google: a line comes back as audio, asked for the way its documents say', async () => {
  const env = freshKey();
  const asked = google({ voices: [{ id: 'voice_abc', display_name: 'pintu-captain-ms' }] });
  const res = await say(speakUrl('captain', 'ms', '[deadpan]Kopi dah habis.'), { env });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /base64/, 'left for the phone to decode');
  assert.equal(res.headers.get('access-control-allow-origin'), PINTU);
  assert.equal(await res.text(), `audio/wav\n${SOUND}`, 'with what kind of sound it is');
  const [call] = interactions(asked);
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['x-goog-api-key'], env.GEMINI_API_KEY);
  assert.deepEqual(call.body, {
    model: 'gemini-3.8-flash-tts',
    input: [{ type: 'user_input', content: [{ type: 'text', text: 'Kopi dah habis.', annotations: [{ type: 'speech_metadata', style: 'deadpan and dry' }] }] }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice: 'voice_abc' }] },
  });
});

test('Google: a plain direction is directed by nothing but its words', async () => {
  const asked = google({ voices: [{ id: 'voice_abc', display_name: 'pintu-standard-ms' }] });
  await say(speakUrl('standard', 'ms', 'Belok kiri.'), { env: freshKey() });
  assert.equal(interactions(asked)[0].body.input[0].content[0].annotations, undefined);
});

test('Google: a character\'s accent comes from a voice designed once, then reused', async () => {
  const env = freshKey();
  const asked = google();
  await say(speakUrl('uncle', 'ms', 'Belok kiri.'), { env });
  const made = asked.filter((a) => a.url === `${G}/voices` && a.method === 'POST');
  assert.equal(made.length, 1);
  const { store, voice } = made[0].body;
  assert.equal(store, true);
  assert.equal(voice.type, 'prompted');
  assert.equal(voice.display_name, 'pintu-uncle-ms');
  assert.equal(voice.gender, 'male');
  assert.equal(voice.language_code, 'ms-MY');
  assert.match(voice.prompted.input, /Malaysian Chinese accent/);
  assert.equal(voice.model, 'gemini-3.8-flash-tts');
  assert.equal(interactions(asked)[0].body.generation_config.speech_config[0].voice, 'voice_new');
  const before = asked.length;
  await say(speakUrl('uncle', 'ms', 'Belok kanan.'), { env });
  assert.equal(asked.length, before + 1, 'just the line: no listing and no making');
});

test('Google: every character has a voice to design, of the right kind', async () => {
  const want = { captain: /Malay accent/, makcik: /Malay accent/, uncle: /Chinese accent/, agent: /Chinese accent/, cikgu: /Indian accent/, commentator: /Indian accent/ };
  for (const who of CHARACTER_IDS) {
    for (const lang of ['ms', 'en']) {
      const asked = google();
      const res = await say(speakUrl(who, lang, 'Belok kiri.'), { env: freshKey() });
      assert.equal(res.status, 200, `${who} ${lang}`);
      const { voice } = asked.find((a) => a.method === 'POST' && a.url === `${G}/voices`).body;
      if (want[who]) assert.match(voice.prompted.input, want[who], who);
      assert.ok(['male', 'female'].includes(voice.gender), who);
      assert.ok(voice.prompted.input.length < 200, 'one or two sentences');
    }
  }
});

test('Google: a voice made before is found again, the oldest if there are two', async () => {
  const env = freshKey();
  const asked = google({ voices: [
    { id: 'voice_newer', display_name: 'pintu-agent-en' },
    { id: 'voice_other', display_name: 'something else' },
    { id: 'voice_older', display_name: 'pintu-agent-en' },
  ] });
  await say(speakUrl('agent', 'en', 'Turn left.'), { env });
  assert.equal(interactions(asked)[0].body.generation_config.speech_config[0].voice, 'voice_older');
  assert.ok(!asked.some((a) => a.method === 'POST' && a.url === `${G}/voices`));
});

test('Google: if a region isn\'t accepted when designing, it tries without', async () => {
  const asked = google({ create: (entry) => (entry.body.voice.language_code ? new Response('bad', { status: 400 }) : new Response(JSON.stringify({ id: 'voice_plain' }))) });
  const res = await say(speakUrl('makcik', 'ms', 'Belok kiri.'), { env: freshKey() });
  assert.equal(res.status, 200);
  assert.equal(interactions(asked)[0].body.generation_config.speech_config[0].voice, 'voice_plain');
});

test('Google: if a voice can\'t be designed, a ready-made one plays the part, and it isn\'t tried again at once', async () => {
  const env = freshKey();
  const asked = google({ create: () => new Response('not on this plan', { status: 403 }) });
  const res = await say(speakUrl('commentator', 'en', '[excited]Goal!'), { env });
  assert.equal(res.status, 200);
  const [call] = interactions(asked);
  assert.equal(call.body.generation_config.speech_config[0].voice, 'Fenrir');
  assert.match(call.body.input[0].content[0].annotations[0].style, /football commentator, excited/);
  const makes = () => asked.filter((a) => a.method === 'POST' && a.url === `${G}/voices`).length;
  const count = makes();
  await say(speakUrl('commentator', 'en', 'Turn left.'), { env });
  assert.equal(makes(), count);
});

test('Google: if voices can\'t be listed, nothing is designed blindly', async () => {
  const asked = google({ list: () => new Response('no', { status: 500 }) });
  const res = await say(speakUrl('captain', 'ms', 'Belok kiri.'), { env: freshKey() });
  assert.equal(res.status, 200);
  assert.ok(!asked.some((a) => a.method === 'POST' && a.url === `${G}/voices`));
  assert.equal(interactions(asked)[0].body.generation_config.speech_config[0].voice, 'Charon');
});

test('Google: a designed voice it won\'t use gives way to a ready-made one', async () => {
  const asked = google({
    voices: [{ id: 'voice_gone', display_name: 'pintu-captain-ms' }],
    speak: (entry) => (entry.body.generation_config.speech_config[0].voice === 'voice_gone' ? new Response('no such voice', { status: 404 }) : spoken()),
  });
  const res = await say(speakUrl('captain', 'ms', 'Belok kiri.'), { env: freshKey() });
  assert.equal(res.status, 200);
  assert.equal(interactions(asked).length, 2);
});

test('Google: the words go in exactly as they should be read', async () => {
  const words = async (who, lang, text) => {
    const asked = google({ voices: [{ id: 'v', display_name: `pintu-${who}-${lang}` }] });
    await say(speakUrl(who, lang, text), { env: freshKey() });
    return interactions(asked)[0].body.input[0].content[0].text;
  };
  assert.equal(await words('captain', 'ms', 'Dalam 300 meter, belok kiri.'), 'Dalam tiga ratus meter, belok kiri.');
  assert.equal(await words('captain', 'en', 'The limit is 90.'), 'The limit is ninety.');
  assert.equal(await words('captain', 'ms', 'Masuk E2 dan FT3.'), 'Masuk E2 dan FT3.');
  assert.equal(await words('captain', 'ms', 'Cuaca… sangat tenang.'), 'Cuaca <short pause> sangat tenang.');
  assert.equal(await words('captain', 'ms', '[sigh]Haih… jem.'), '<sigh> Haih <short pause> jem.');
  assert.equal(await words('captain', 'ms', '[shock]Oh!'), '<gasp> Oh!');
  assert.equal(await words('captain', 'ms', 'Jalan <laugh> [bogus]Ampang'), 'Jalan laugh Ampang', 'nothing can pretend to be a sound effect');
});

test('Google: a tease sometimes comes with a chuckle, and never a sound it wasn\'t asked for', async () => {
  const words = async (text) => {
    const asked = google({ voices: [{ id: 'v', display_name: 'pintu-uncle-ms' }] });
    await say(speakUrl('uncle', 'ms', text), { env: freshKey() });
    return interactions(asked)[0].body.input[0].content[0].text;
  };
  const results = [await words('[tease]Eh.'), await words('[tease]Eh, a'), await words('[tease]Eh, abc')];
  assert.equal(results.filter((t) => t.startsWith('<chuckle>')).length, 1, results.join());
  assert.doesNotMatch(await words('[warm]Eh.'), /</);
});

test('Google: when the first model\'s allowance runs out, the second carries on', async () => {
  const asked = google({
    voices: [{ id: 'v', display_name: 'pintu-captain-ms' }],
    speak: (entry) => (entry.body.model === 'gemini-3.8-flash-tts' ? new Response('GenerateRequestsPerDayPerProjectPerModel', { status: 429 }) : spoken()),
  });
  const res = await say(speakUrl('captain', 'ms', 'Belok kiri.'), { env: freshKey() });
  assert.equal(res.status, 200);
  assert.deepEqual(interactions(asked).map((c) => c.body.model), ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']);
});

test('Google: all out for today is told apart from busy for a moment', async () => {
  const voices = [{ id: 'v', display_name: 'pintu-captain-ms' }];
  google({ voices, speak: () => new Response('quota GenerateRequestsPerDayPerProjectPerModel exceeded', { status: 429 }) });
  let res = await say(speakUrl('captain', 'ms', 'Belok kiri.'), { env: freshKey() });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'daily');
  google({ voices, speak: () => new Response('quota GenerateRequestsPerMinutePerProjectPerModel exceeded', { status: 429 }) });
  res = await say(speakUrl('captain', 'ms', 'Belok kiri.'), { env: freshKey() });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'busy');
});

test('Google: a bad key is reported as one', async () => {
  const voices = [{ id: 'v', display_name: 'pintu-captain-ms' }];
  google({ voices, speak: () => new Response('API key not valid. Please pass a valid API key.', { status: 400 }) });
  assert.equal((await say(speakUrl('captain', 'ms', 'Belok kiri.'), { env: freshKey() })).status, 503);
  google({ voices, speak: () => new Response('forbidden', { status: 403 }) });
  assert.equal((await say(speakUrl('captain', 'ms', 'Belok kiri.'), { env: freshKey() })).status, 503);
});

test('Google: the check says whether the key works, without spending a line', async () => {
  const check = async (status) => {
    const asked = [];
    globalThis.fetch = async (url, init) => { asked.push({ url: String(url), init }); return new Response('{}', { status }); };
    const body = await (await say('/speak?check=1', { env: freshKey() })).json();
    assert.equal(asked.length, 1);
    assert.match(asked[0].url, /\/models\/gemini-3\.8-flash-tts$/);
    return body;
  };
  assert.deepEqual(await check(200), { ready: true });
  assert.deepEqual(await check(400), { ready: false, reason: 'key refused' });
  assert.deepEqual(await check(403), { ready: false, reason: 'key refused' });
  assert.deepEqual(await check(500), { ready: false, reason: 'unavailable' });
});

test('Google: no audio in the answer is an honest failure', async () => {
  google({ voices: [{ id: 'v', display_name: 'pintu-captain-ms' }], speak: () => new Response(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'no' }] }] })) });
  assert.equal((await say(speakUrl('captain', 'ms', 'Belok kiri.'), { env: freshKey() })).status, 502);
});

test('Google: the key never reaches the page, whatever happens', async () => {
  for (const status of [200, 400, 401, 403, 429, 500]) {
    const env = freshKey();
    google({ voices: [{ id: 'v', display_name: 'pintu-captain-ms' }], speak: () => (status === 200 ? spoken() : new Response(`bad ${env.GEMINI_API_KEY}`, { status })) });
    const res = await say(speakUrl('captain', 'ms', 'x'), { env });
    const all = JSON.stringify([...res.headers]) + new TextDecoder().decode(await res.arrayBuffer());
    assert.doesNotMatch(all, /gemini-key/, String(status));
  }
});

test('with both keys, Azure takes over when Google has run out', async () => {
  const env = { ...freshKey(), AZURE_SPEECH_KEY: 'azure-key' };
  const reached = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    reached.push(u);
    if (u.startsWith(`${G}/voices`)) return new Response(JSON.stringify({ voices: [{ id: 'v', display_name: 'pintu-captain-ms' }] }));
    if (u === `${G}/interactions`) return new Response('PerDay', { status: 429 });
    return new Response(new Uint8Array([7]));
  };
  const res = await say(speakUrl('captain', 'ms', 'Belok kiri.'), { env });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/mpeg');
  assert.equal(reached.at(-1), TTS);
});

test('with both keys, Google goes first', async () => {
  const env = { ...freshKey(), AZURE_SPEECH_KEY: 'azure-key' };
  const asked = google({ voices: [{ id: 'v', display_name: 'pintu-captain-ms' }] });
  const res = await say(speakUrl('captain', 'ms', 'Belok kiri.'), { env });
  assert.match(res.headers.get('content-type'), /base64/);
  assert.ok(!asked.some((a) => a.url === TTS));
});

test('Google: a recording kept on the shelf keeps its kind of audio', async () => {
  const store = new Map();
  globalThis.caches = { default: { match: async (req) => store.get(req.url)?.clone(), put: async (req, res) => { store.set(req.url, res); } } };
  try {
    const env = freshKey();
    const asked = google({ voices: [{ id: 'v', display_name: 'pintu-captain-ms' }] });
    await say(speakUrl('captain', 'ms', 'Belok kiri.'), { env });
    const again = await say(speakUrl('captain', 'ms', 'Belok kiri.'), { env });
    assert.match(again.headers.get('content-type'), /base64/);
    assert.equal(await again.text(), `audio/wav\n${SOUND}`);
    assert.equal(interactions(asked).length, 1);
  } finally {
    delete globalThis.caches;
  }
});

test('Google: the audio is found however its answer is laid out', async () => {
  const layouts = [
    JSON.stringify({ steps: [{ content: [{ data: SOUND, type: 'audio' }], type: 'model_output' }] }),
    JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: 'AAAAAAAAAAAA' }, { type: 'audio', data: SOUND }] }] }, null, 2),
    `{"steps":[{"type":"model_output","content":[{"type":"audio","data":"${SOUND.replace(/\//g, '\\/')}"}]}]}`,
  ];
  for (const layout of layouts) {
    google({ voices: [{ id: 'v', display_name: 'pintu-captain-ms' }], speak: () => new Response(layout) });
    const res = await say(speakUrl('captain', 'ms', 'Belok kiri.'), { env: freshKey() });
    assert.equal(res.status, 200, layout);
    assert.equal(await res.text(), SOUND, layout);
  }
});

test('Google: a designed voice\'s long sample is never read as data', async () => {
  const sample = 'x'.repeat(2000000);
  const asked = google({ create: () => new Response(`{"id":"voice_big","sample_audio":{"mime_type":"audio/wav","data":"${sample}"}}`) });
  const res = await say(speakUrl('makcik', 'ms', 'Belok kiri.'), { env: freshKey() });
  assert.equal(res.status, 200);
  assert.equal(interactions(asked)[0].body.generation_config.speech_config[0].voice, 'voice_big');
});

test('Google: a failure says what it was, without the key', async () => {
  const env = freshKey();
  google({
    voices: [{ id: 'v', display_name: 'pintu-captain-ms' }],
    speak: () => new Response(`User location is not supported. key=${env.GEMINI_API_KEY}`, { status: 400 }),
  });
  const res = await say(speakUrl('captain', 'ms', 'Belok kiri.'), { env });
  assert.equal(res.status, 502);
  assert.equal(res.headers.get('access-control-allow-origin'), PINTU);
  const body = await res.json();
  assert.match(body.why, /location is not supported/);
  assert.doesNotMatch(JSON.stringify(body), /gemini-key/);
});

test('the voice test reports every step of one real line', async () => {
  const env = freshKey();
  const asked = google();
  const report = await (await say('/speak?test=1&who=uncle&lang=en', { env })).json();
  assert.equal(report.ok, true);
  assert.equal(report.engine, 'gemini');
  assert.equal(report.who, 'uncle');
  assert.equal(report.lang, 'en');
  assert.deepEqual(report.steps.map((n) => n.step), ['list', 'design', 'speak']);
  assert.ok(report.steps.every((n) => n.status === 200));
  assert.equal(interactions(asked).length, 1, 'one line of the allowance');
  assert.doesNotMatch(JSON.stringify(report), /gemini-key/);
});

test('the voice test shows where it went wrong', async () => {
  const env = freshKey();
  google({
    create: () => new Response(`voices are not on your plan ${env.GEMINI_API_KEY}`, { status: 403 }),
    speak: () => new Response('quota GenerateRequestsPerDayPerProjectPerModel', { status: 429 }),
  });
  const report = await (await say('/speak?test=1&who=captain&lang=ms', { env })).json();
  assert.equal(report.ok, false);
  assert.equal(report.problem, 'daily');
  assert.equal(report.status, 429);
  const design = report.steps.find((n) => n.step === 'design');
  assert.equal(design.status, 403);
  assert.match(design.why, /not on your plan \*\*\*/);
  assert.doesNotMatch(JSON.stringify(report), /gemini-key/);
  assert.equal(report.steps.at(-1).voice, 'Charon');
});

test('the voice test knows when there is no key, and asks nobody', async () => {
  const asked = google();
  const report = await (await say('/speak?test=1', { env: {} })).json();
  assert.deepEqual([report.ok, report.problem, report.engine], [false, 'no key', null]);
  assert.equal(asked.length, 0);
});

test('the voice test works with Azure as well', async () => {
  azure();
  const report = await (await say('/speak?test=1&who=captain')).json();
  assert.equal(report.engine, 'azure');
  assert.equal(report.ok, true);
});

test('the voice test isn\'t fooled by a made-up character', async () => {
  google();
  const report = await (await say('/speak?test=1&who=__proto__&lang=fr', { env: freshKey() })).json();
  assert.equal(report.who, 'standard');
  assert.equal(report.lang, 'ms');
});

test('a shelf that throws at once still never costs the line', async () => {
  globalThis.caches = { default: { match() { throw new Error('no'); }, put() { throw new Error('no'); } } };
  try {
    azure();
    assert.equal((await say(speakUrl('captain', 'ms', 'x'))).status, 200);
  } finally {
    delete globalThis.caches;
  }
});

test('the settings for updating the server point at the real thing', () => {
  const settings = readFileSync(new URL('../server/wrangler.toml', import.meta.url), 'utf8');
  assert.match(settings, /^name = "pintu"$/m, 'must match the Worker\'s name in Cloudflare');
  const [, main] = settings.match(/^main = "([^"]+)"$/m);
  assert.ok(existsSync(new URL(`../server/${main}`, import.meta.url)));
  assert.match(settings, /^keep_vars = true$/m);
  assert.match(settings, /^account_id = "[0-9a-f]{32}"$/m);
});

test('the same settings work from the top of the repository', () => {
  const settings = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(settings, /^name = "pintu"$/m);
  const [, main] = settings.match(/^main = "([^"]+)"$/m);
  assert.ok(existsSync(new URL(`../${main}`, import.meta.url)));
  assert.match(settings, /^keep_vars = true$/m);
  assert.match(settings, /^account_id = "[0-9a-f]{32}"$/m);
});

test('Google: bare sound is passed on with what it is, so the phone can wrap it up', async () => {
  const pcm = Buffer.alloc(48, 1).toString('base64');
  google({
    voices: [{ id: 'v', display_name: 'pintu-captain-ms' }],
    speak: () => new Response(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/L16;codec=pcm;rate=24000', data: pcm }] }] })),
  });
  const res = await say(speakUrl('captain', 'ms', 'Belok kiri.'), { env: freshKey() });
  assert.equal(await res.text(), `audio/L16;codec=pcm;rate=24000\n${pcm}`);
});

test('the voice test says what kind of sound came back', async () => {
  google({ voices: [{ id: 'v', display_name: 'pintu-captain-ms' }] });
  const report = await (await say('/speak?test=1&who=captain&lang=ms', { env: freshKey() })).json();
  const spoke = report.steps.find((n) => n.step === 'speak');
  assert.equal(spoke.kind, 'audio/wav');
  assert.equal(spoke.head, '52 49 46 46');
  assert.equal(spoke.size, SOUND.length);
});

test('Google: a direction and its joke are one recording, each part directed', async () => {
  const asked = google({ voices: [{ id: 'voice_u', display_name: 'pintu-uncle-ms' }] });
  const res = await say(speakUrl('uncle', 'ms', 'Belok kiri. [sigh]Haih… jem. [plain]Terus.'), { env: freshKey() });
  assert.equal(res.status, 200);
  const calls = interactions(asked);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.input[0].content, [
    { type: 'text', text: 'Belok kiri.' },
    { type: 'text', text: '<sigh> Haih <short pause> jem.', annotations: [{ type: 'speech_metadata', style: 'weary' }] },
    { type: 'text', text: 'Terus.' },
  ]);
});

test('Google: parts said the same way are one part', async () => {
  const asked = google({ voices: [{ id: 'v', display_name: 'pintu-captain-ms' }] });
  await say(speakUrl('captain', 'ms', '[warm]Hai. [warm]Jom. [bogus]Pergi.'), { env: freshKey() });
  const { content } = interactions(asked)[0].body.input[0];
  assert.equal(content.length, 1);
  assert.equal(content[0].text, 'Hai. Jom. Pergi.');
});

test('Google: if parts aren\'t accepted, the whole line goes as one', async () => {
  const asked = google({
    voices: [{ id: 'v', display_name: 'pintu-uncle-ms' }],
    speak: (entry) => (entry.body.input[0].content.length > 1 ? new Response('Invalid content', { status: 400 }) : spoken()),
  });
  const res = await say(speakUrl('uncle', 'ms', 'Belok kiri. [tease]Kopi tak lari.'), { env: freshKey() });
  assert.equal(res.status, 200);
  const calls = interactions(asked);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.input[0].content.length, 1);
  assert.match(calls[1].body.input[0].content[0].text, /^Belok kiri\. (<chuckle> )?Kopi tak lari\.$/);
  assert.equal(calls[1].body.input[0].content[0].annotations[0].style, 'teasing, a bit amused');
});

test('Google: a ready-made voice is told who to play in every part', async () => {
  const asked = google({ create: () => new Response('no', { status: 403 }) });
  await say(speakUrl('commentator', 'ms', 'Belok kiri. [excited]Gol!'), { env: freshKey() });
  const { content } = interactions(asked)[0].body.input[0];
  assert.equal(content[0].annotations[0].style, 'an animated football commentator');
  assert.equal(content[1].annotations[0].style, 'an animated football commentator, excited');
});

test('the voice test tries a direction with a joke, and says how it was sent', async () => {
  const asked = google({ voices: [{ id: 'v', display_name: 'pintu-captain-ms' }] });
  const report = await (await say('/speak?test=1&who=captain&lang=ms', { env: freshKey() })).json();
  assert.equal(report.ok, true);
  assert.equal(report.steps.at(-1).shape, 'parts');
  assert.equal(interactions(asked)[0].body.input[0].content.length, 2);
});

/* ---------- Traffic, from TomTom ---------- */

const TT_KEY = { TOMTOM_API_KEY: 'tomtom-test-key' };
const ROUTE = [[101.7, 3.15], [101.705, 3.15], [101.71, 3.15], [101.71, 3.16]];
const sendRoute = (body, { env = TT_KEY, origin = PINTU, method = 'POST', path = '/traffic' } = {}) => worker.fetch(new Request(`${HOME}${path}`, {
  method,
  headers: { ...(origin ? { origin } : {}), 'content-type': 'text/plain' },
  ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
}), env);

function tomtom(answer) {
  forgetCounts();
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    return typeof answer === 'function' ? answer(String(url), init) : answer;
  };
  return calls;
}
const tomtomRoute = () => new Response(JSON.stringify({ routes: [{
  summary: { lengthInMeters: 2200, travelTimeInSeconds: 900, trafficDelayInSeconds: 420 },
  legs: [{ points: [
    { latitude: 3.15, longitude: 101.7 }, { latitude: 3.15, longitude: 101.703 }, { latitude: 3.15, longitude: 101.706 },
    { latitude: 3.15, longitude: 101.71 }, { latitude: 3.155, longitude: 101.71 }, { latitude: 3.16, longitude: 101.71 },
  ] }],
  sections: [
    { startPointIndex: 0, endPointIndex: 5, sectionType: 'TRAVEL_MODE', travelMode: 'car' },
    { startPointIndex: 1, endPointIndex: 3, sectionType: 'TRAFFIC', simpleCategory: 'JAM', effectiveSpeedInKmh: 11, delayInSeconds: 300.4, magnitudeOfDelay: 2 },
    { startPointIndex: 4, endPointIndex: 5, sectionType: 'TRAFFIC', simpleCategory: 'ROAD_WORK', delayInSeconds: 120 },
    { startPointIndex: 9, endPointIndex: 12, sectionType: 'TRAFFIC', simpleCategory: 'JAM', delayInSeconds: 60 },
  ],
}] }), { status: 200, headers: { 'content-type': 'application/json' } });

test('traffic: asks TomTom to follow Pintu\'s own route, and passes back only the slow stretches', async () => {
  const calls = tomtom(tomtomRoute);
  const res = await sendRoute({ points: ROUTE });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), PINTU);
  const body = await res.json();
  assert.equal(calls.length, 1);
  const { url, method, body: sent } = calls[0];
  assert.equal(method, 'POST');
  assert.match(url, /^https:\/\/api\.tomtom\.com\/routing\/1\/calculateRoute\/3\.15000,101\.70000:3\.16000,101\.71000\/json\?/);
  const q = new URL(url).searchParams;
  assert.equal(q.get('key'), TT_KEY.TOMTOM_API_KEY);
  assert.equal(q.get('sectionType'), 'traffic');
  assert.equal(q.get('traffic'), 'true');
  assert.deepEqual(sent.supportingPoints[1], { latitude: 3.15, longitude: 101.705 });
  assert.equal(sent.supportingPoints.length, ROUTE.length);
  assert.equal(body.delay, 420);
  assert.deepEqual(body.jams, [
    { from: [101.703, 3.15], to: [101.71, 3.15], delay: 300, speed: 11, kind: 'JAM', size: 2 },
    { from: [101.71, 3.155], to: [101.71, 3.16], delay: 120, speed: null, kind: 'ROAD_WORK', size: null },
  ]);
  assert.ok(!JSON.stringify(body).includes(TT_KEY.TOMTOM_API_KEY), 'the key never reaches the page');
});

test('traffic: without a key it says so, and asks nobody', async () => {
  const calls = tomtom(tomtomRoute);
  const res = await sendRoute({ points: ROUTE }, { env: {} });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'no key' });
  assert.equal(calls.length, 0);
});

test('traffic: only a real route, only by POST, only from Pintu', async () => {
  const calls = tomtom(tomtomRoute);
  for (const bad of ['not json', { points: [[101.7, 3.15]] }, { points: [[101.7, 3.15], ['x', 3]] }, { points: [[200, 3], [101, 3]] },
    { points: Array.from({ length: 2001 }, (_, i) => [101.7 + i * 1e-4, 3.15]) }]) {
    assert.equal((await sendRoute(bad)).status, 400, JSON.stringify(bad).slice(0, 40));
  }
  assert.equal((await sendRoute(null, { method: 'GET' })).status, 405);
  assert.equal((await sendRoute({ points: ROUTE }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await sendRoute({ points: ROUTE }, { path: '/link' })).status, 405, 'nothing else takes a POST');
  assert.equal(calls.length, 0);
});

test('traffic: TomTom refusing the key, being busy, or not following the route', async () => {
  tomtom(() => new Response(JSON.stringify({ detailedError: { message: 'Developer Inactive' } }), { status: 403 }));
  let res = await sendRoute({ points: ROUTE });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'key refused', why: 'Developer Inactive' });
  tomtom(() => new Response('{}', { status: 429 }));
  assert.equal((await sendRoute({ points: ROUTE })).status, 429);
  tomtom(() => new Response('{"detailedError":{"message":"Engine error"}}', { status: 400 }));
  res = await sendRoute({ points: ROUTE });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error, 'could not follow the route');
  tomtom(() => { throw new Error('offline'); });
  assert.equal((await sendRoute({ points: ROUTE })).status, 502);
});

test('traffic: /traffic?check=1 in a browser says whether it works, and nothing else', async () => {
  const look = (env) => worker.fetch(new Request(`${HOME}/traffic?check=1`), env);
  tomtom(tomtomRoute);
  assert.match(await (await look({})).text(), /no TomTom key yet/);
  const calls = tomtom(tomtomRoute);
  const ok = await (await look(TT_KEY)).text();
  assert.match(ok, /^Traffic: working/);
  assert.ok(!ok.includes(TT_KEY.TOMTOM_API_KEY));
  assert.equal(calls[0].method, 'GET', 'a two-point check needs no route sent');
  tomtom(() => new Response('{"detailedError":{"message":"Forbidden"}}', { status: 403 }));
  assert.match(await (await look(TT_KEY)).text(), /refused the key/);
});

/* ---------- More from TomTom ---------- */

const askPintu = (path, { method = 'GET', body, env = TT_KEY, origin = PINTU } = {}) => worker.fetch(new Request(`${HOME}${path}`, {
  method,
  headers: { ...(origin ? { origin } : {}), 'content-type': 'text/plain' },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
}), env);

test('traffic: a quicker way round comes back when asked for, staying on the route at first', async () => {
  const alt = { summary: { travelTimeInSeconds: 600, trafficDelayInSeconds: 30, lengthInMeters: 2600 },
    legs: [{ points: Array.from({ length: 1000 }, (_, i) => ({ latitude: 3.15 + i * 1e-5, longitude: 101.7 })) }] };
  const calls = tomtom(async () => {
    const main = await tomtomRoute().json();
    main.routes.push(alt);
    return new Response(JSON.stringify(main), { status: 200 });
  });
  const body = await (await askPintu('/traffic', { method: 'POST', body: { points: ROUTE, better: true } })).json();
  const q = new URL(calls[0].url).searchParams;
  assert.equal(q.get('maxAlternatives'), '1');
  assert.equal(q.get('alternativeType'), 'betterRoute');
  assert.equal(q.get('minDeviationDistance'), '500');
  assert.equal(body.better.travel, 600);
  assert.equal(body.better.path.length, 600, 'thinned');
  assert.deepEqual(body.better.path[0], [101.7, 3.15]);
  assert.deepEqual(body.better.path[599], [101.7, 3.15999]);

  // Not asked for: not looked for.
  const plain = tomtom(tomtomRoute);
  await askPintu('/traffic', { method: 'POST', body: { points: ROUTE } });
  assert.equal(new URL(plain[0].url).searchParams.get('maxAlternatives'), null);
});

test('traffic: what a slow stretch is, from the causes TomTom gives', async () => {
  const { kindOf } = await import('../server/tomtom.js');
  const cause = (...c) => ({ simpleCategory: 'OTHER', tec: { causes: c.map(([mainCauseCode, subCauseCode]) => ({ mainCauseCode, subCauseCode })) } });
  assert.equal(kindOf(cause([1], [2])), 'ACCIDENT');
  assert.equal(kindOf(cause([5, 1])), 'FLOOD');
  assert.equal(kindOf(cause([7])), 'FLOOD');
  assert.equal(kindOf(cause([5, 4])), 'OTHER', 'a landslip is not a flood');
  assert.equal(kindOf(cause([13])), 'BREAKDOWN');
  assert.equal(kindOf(cause([10])), 'HAZARD');
  assert.equal(kindOf({ simpleCategory: 'ROAD_CLOSURE', tec: { causes: [{ mainCauseCode: 2 }] } }), 'ROAD_CLOSURE');
  assert.equal(kindOf({ simpleCategory: 'JAM' }), 'JAM');
  assert.equal(kindOf({ simpleCategory: 'ROAD_WORK' }), 'ROAD_WORK');
  assert.equal(kindOf({}), 'OTHER');
});

test('traffic: when to leave, to arrive at a time, from how traffic usually is', async () => {
  const calls = tomtom(async () => {
    const main = await tomtomRoute().json();
    Object.assign(main.routes[0].summary, { departureTime: '2026-11-09T08:05:00+08:00', arrivalTime: '2026-11-09T09:00:00+08:00' });
    return new Response(JSON.stringify(main), { status: 200 });
  });
  const body = await (await askPintu('/traffic', { method: 'POST', body: { points: ROUTE, arriveAt: '2026-11-09T09:00:00+08:00', better: true } })).json();
  const q = new URL(calls[0].url).searchParams;
  assert.equal(q.get('arriveAt'), '2026-11-09T09:00:00+08:00');
  assert.equal(q.get('maxAlternatives'), null, 'TomTom takes one or the other');
  assert.equal(body.leave, '2026-11-09T08:05:00+08:00');
  // Anything else as a time is ignored rather than passed on.
  const odd = tomtom(tomtomRoute);
  await askPintu('/traffic', { method: 'POST', body: { points: ROUTE, arriveAt: 'tomorrow&key=x' } });
  assert.equal(new URL(odd[0].url).searchParams.get('arriveAt'), null);
});

test('tiles: traffic colours and incidents come through, kept a minute, key never shown', async () => {
  const store = new Map();
  globalThis.caches = { default: {
    match: async (req) => store.get(req.url)?.clone(),
    put: async (req, res) => { store.set(req.url, res); },
  } };
  const calls = tomtom(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
  let res = await askPintu('/tiles/flow/12/3245/2012.pbf');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/x-protobuf');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(res.headers.get('access-control-allow-origin'), PINTU);
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3]);
  assert.match(calls[0].url, /^https:\/\/api\.tomtom\.com\/traffic\/map\/4\/tile\/flow\/relative\/12\/3245\/2012\.pbf\?key=/);
  res = await askPintu('/tiles/flow/12/3245/2012.pbf');
  assert.equal(calls.length, 1, 'the second look came from the cache');
  res = await askPintu('/tiles/incidents/12/3245/2012.pbf');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=120');
  assert.match(calls[1].url, /\/tile\/incidents\/12\/3245\/2012\.pbf/);
  assert.equal((await askPintu('/tiles/flow/3/9/1.pbf')).status, 404, 'no such tile');
  assert.equal((await askPintu('/tiles/other/3/1/1.pbf')).status, 404);
  assert.equal((await askPintu('/tiles/flow/12/3245/2012.pbf', { origin: 'https://evil.example' })).status, 403);
  // No key yet: an empty tile, so the map simply shows nothing.
  store.clear();
  assert.equal((await askPintu('/tiles/flow/12/3245/2012.pbf', { env: {} })).status, 204);
  delete globalThis.caches;
});

test('speed limits: TomTom\'s roads along the route, joined into stretches', async () => {
  const road = (coords, value, extra = {}) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { speedLimits: { value, unit: 'kmph', type: 'Maximum', ...extra } } });
  const calls = tomtom(() => new Response(JSON.stringify({ route: [
    road([[101.7, 3.15], [101.701, 3.15]], 60),
    road([[101.701, 3.15], [101.703, 3.15]], 60),
    road([[101.703, 3.15], [101.71, 3.15]], 90),
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[101.71, 3.15], [101.71, 3.155]] }, properties: {} },
    road([[101.71, 3.155], [101.71, 3.16]], 40, { type: 'Recommended' }),
  ] }), { status: 200 }));
  const body = await (await askPintu('/limits', { method: 'POST', body: { points: ROUTE } })).json();
  assert.deepEqual(body.limits, [
    { from: [101.7, 3.15], to: [101.703, 3.15], limit: 60 },
    { from: [101.703, 3.15], to: [101.71, 3.15], limit: 90 },
  ]);
  const { url, method, body: sent } = calls[0];
  assert.equal(method, 'POST');
  assert.match(url, /^https:\/\/api\.tomtom\.com\/snapToRoads\/1\?/);
  assert.match(new URL(url).searchParams.get('fields'), /speedLimits\{value,unit,type\}/);
  assert.deepEqual(sent.points[0], { type: 'Feature', geometry: { type: 'Point', coordinates: [101.7, 3.15] }, properties: {} });
});

test('addresses: from TomTom, named the way people say them', async () => {
  const calls = tomtom(() => new Response(JSON.stringify({ results: [
    { type: 'Point Address', position: { lat: 3.1101, lon: 101.6205 }, address: { streetNumber: '12', streetName: 'Jalan SS 2/24', municipalitySubdivision: 'SS 2', municipality: 'Petaling Jaya', countrySubdivision: 'Selangor', countryCode: 'MY', freeformAddress: '12, Jalan SS 2/24, 47300 Petaling Jaya, Selangor' } },
    { type: 'Geography', position: { lat: 3.07, lon: 101.6 }, address: { municipality: 'Subang Jaya', countrySubdivision: 'Selangor', countryCode: 'MY' } },
    { type: 'Street' },
  ] }), { status: 200 }));
  const res = await askPintu('/geocode?q=12%20jalan%20ss2%2F24&lat=3.1&lon=101.6');
  const { places } = await res.json();
  assert.deepEqual(places, [
    { name: '12 Jalan SS 2/24', detail: 'SS 2, Petaling Jaya, Selangor', lng: 101.6205, lat: 3.1101, type: 'Point Address', country: 'MY' },
    { name: 'Subang Jaya', detail: 'Selangor', lng: 101.6, lat: 3.07, type: 'Geography', country: 'MY' },
  ]);
  const q = new URL(calls[0].url);
  assert.match(q.pathname, /^\/search\/2\/geocode\/12%20jalan%20ss2%2F24\.json$/);
  assert.equal(q.searchParams.get('countrySet'), 'MY,SG,BN');
  assert.equal(q.searchParams.get('lat'), '3.1000');
  assert.equal((await askPintu('/geocode?q=ab')).status, 400);
});

test('electric cars: where to charge, how long, and how full on arrival', async () => {
  const calls = tomtom(() => new Response(JSON.stringify({ routes: [{
    summary: { travelTimeInSeconds: 14400, totalChargingTimeInSeconds: 1800, remainingChargeAtArrivalInkWh: 9 },
    legs: [
      { summary: { remainingChargeAtArrivalInkWh: 7.5, chargingInformationAtEndOfLeg: {
        chargingParkName: 'Gentari R&R Seremban', chargingParkOperatorName: 'Gentari', targetChargeInkWh: 48, chargingTimeInSeconds: 1500,
        chargingParkLocation: { coordinate: { latitude: 2.71, longitude: 101.94 } }, chargingConnectionInfo: { chargingPowerInkW: 90 } } },
        points: [{ latitude: 3.1, longitude: 101.7 }, { latitude: 2.7, longitude: 101.9 }] },
      { summary: { remainingChargeAtArrivalInkWh: 9 }, points: [{ latitude: 2.7, longitude: 101.9 }, { latitude: 1.5, longitude: 103.7 }] },
    ],
  }] }), { status: 200 }));
  const trip = { points: [[101.7, 3.1], [103.7, 1.5]], battery: 60, level: 80, consumption: 15, avoidTolls: true };
  const body = await (await askPintu('/ev', { method: 'POST', body: trip })).json();
  assert.deepEqual(body, {
    stops: [{ name: 'Gentari R&R Seremban', operator: 'Gentari', lng: 101.94, lat: 2.71, minutes: 25, arrive: 13, to: 80, kw: 90, before: 0 }],
    arrive: 15,
    charging: 30,
    travel: 14400,
  });
  const q = new URL(calls[0].url).searchParams;
  assert.equal(q.get('currentChargeInkWh'), '48.0');
  assert.equal(q.get('maxChargeInkWh'), '60.0');
  assert.equal(q.get('minChargeAtDestinationInkWh'), '6.0');
  assert.equal(q.get('avoid'), 'tollRoads');
  assert.equal(q.get('constantSpeedConsumptionInkWhPerHundredkm'), '30,11.25:60,12.75:90,15.75:110,18.75:130,21.75');
  assert.match(new URL(calls[0].url).pathname, /calculateLongDistanceEVRoute\/3\.10000,101\.70000:1\.50000,103\.70000\/json$/);
  assert.ok(calls[0].body.chargingParameters.chargingConnectors.every((c) => c.plugTypes.includes('Combo_to_IEC_62196_Type_2_Base')));
  assert.equal((await askPintu('/ev', { method: 'POST', body: { ...trip, battery: 'big' } })).status, 400);
  tomtom(() => new Response('{"detailedError":{"message":"No route found"}}', { status: 400 }));
  const none = await askPintu('/ev', { method: 'POST', body: trip });
  assert.equal(none.status, 422);
  assert.equal((await none.json()).error, 'no way to charge');
});

test('everything TomTom needs a key, and says so without one', async () => {
  tomtom(tomtomRoute);
  for (const [path, opts] of [['/limits', { method: 'POST', body: { points: ROUTE } }], ['/geocode?q=jalan%20ampang', {}], ['/ev', { method: 'POST', body: {} }]]) {
    const res = await askPintu(path, { ...opts, env: {} });
    assert.equal(res.status, 503, path);
    assert.deepEqual(await res.json(), { error: 'no key' });
  }
});

/* ---------- Directions from TomTom, as a backup ---------- */

const ttPoint = (lng, lat) => ({ latitude: lat, longitude: lng });
function tomtomDirections({ waypoint = false } = {}) {
  // East along one road, a left turn north, and (maybe) a stop on the way.
  const leg1 = [ttPoint(101.700, 3.150), ttPoint(101.705, 3.150), ttPoint(101.710, 3.150)];
  const leg2 = [ttPoint(101.710, 3.150), ttPoint(101.710, 3.155), ttPoint(101.710, 3.160)];
  const legs = waypoint ? [{ points: leg1 }, { points: leg2 }] : [{ points: [...leg1, ...leg2.slice(1)] }];
  const ins = [
    { routeOffsetInMeters: 0, travelTimeInSeconds: 0, point: leg1[0], pointIndex: 0, maneuver: 'DEPART', street: 'Jalan Ampang', message: 'Leave from Jalan Ampang' },
    waypoint
      ? { routeOffsetInMeters: 1112, travelTimeInSeconds: 90, point: leg1[2], pointIndex: 2, maneuver: 'WAYPOINT_LEFT', message: 'You have reached your waypoint' }
      : { routeOffsetInMeters: 1112, travelTimeInSeconds: 90, point: leg1[2], pointIndex: 2, maneuver: 'TURN_LEFT', street: 'Jalan Tun Razak', roadNumbers: ['FT 1'], turnAngleInDecimalDegrees: -90, message: 'Turn left onto Jalan Tun Razak' },
    { routeOffsetInMeters: 2224, travelTimeInSeconds: 200, point: leg2[2], pointIndex: 4, maneuver: 'ARRIVE_LEFT', message: 'You have arrived' },
  ];
  return new Response(JSON.stringify({ routes: [{
    summary: { lengthInMeters: 2224, travelTimeInSeconds: 200 },
    legs,
    sections: [{ startPointIndex: 2, endPointIndex: 4, sectionType: 'TOLL_ROAD' }],
    guidance: { instructions: ins },
  }] }), { status: 200 });
}

test('directions: a route planner request answered by TomTom, in the same shape', async () => {
  const { prepareTrip, parseResponse } = await import('../js/routing.js');
  const calls = tomtom(() => tomtomDirections());
  const body = { locations: [{ lat: 3.15, lon: 101.7, type: 'break', heading: 92 }, { lat: 3.16, lon: 101.71, type: 'break' }], costing: 'auto', alternates: 2, costing_options: { auto: { use_tolls: 0 } } };
  const res = await askPintu('/route', { method: 'POST', body });
  assert.equal(res.status, 200);
  const data = await res.json();
  const q = new URL(calls[0].url).searchParams;
  assert.match(new URL(calls[0].url).pathname, /calculateRoute\/3\.15000,101\.70000:3\.16000,101\.71000\/json$/);
  assert.equal(q.get('instructionsType'), 'coded');
  assert.equal(q.get('travelMode'), 'car');
  assert.equal(q.get('maxAlternatives'), '2');
  assert.equal(q.get('vehicleHeading'), '92');
  assert.equal(q.get('avoid'), 'tollRoads');
  assert.deepEqual(q.getAll('sectionType'), ['tollRoad', 'motorway', 'ferry']);

  const [route] = parseResponse(data);
  assert.equal(route.coords.length, 5);
  assert.deepEqual(route.maneuvers.map((m) => m.type), [1, 15, 6]);
  const turn = route.maneuvers[1];
  assert.deepEqual(turn.street_names, ['Jalan Tun Razak', 'FT 1']);
  assert.equal(turn.begin_shape_index, 2);
  assert.ok(Math.abs(turn.beginDist - 1110) < 15, String(turn.beginDist));
  assert.equal(turn.toll, true);
  assert.equal(route.maneuvers[0].toll, undefined);
  assert.equal(route.hasToll, true);
  assert.equal(route.time, 200);
  assert.ok(prepareTrip(data.trip));
});

test('directions: a stop on the way splits the route the way Pintu expects', async () => {
  const { parseResponse } = await import('../js/routing.js');
  const calls = tomtom(() => tomtomDirections({ waypoint: true }));
  const body = { locations: [{ lat: 3.15, lon: 101.7 }, { lat: 3.15, lon: 101.71, type: 'break' }, { lat: 3.155, lon: 101.712, type: 'through' }, { lat: 3.16, lon: 101.71 }], costing: 'motorcycle', alternates: 2 };
  const data = await (await askPintu('/route', { method: 'POST', body })).json();
  const q = new URL(calls[0].url).searchParams;
  assert.equal(new URL(calls[0].url).pathname.split('/')[4].split(':').length, 3, 'points to pass through are left to TomTom');
  assert.equal(q.get('maxAlternatives'), null, 'no alternatives with stops');
  assert.equal(q.get('travelMode'), 'motorcycle');
  assert.equal(data.trip.legs.length, 2);
  const [route] = parseResponse(data);
  assert.deepEqual(route.maneuvers.map((m) => [m.type, !!m.isStop]), [[1, false], [6, true], [1, false], [6, false]]);
  assert.equal(route.coords.length, 5);
});

test('directions: nonsense is refused, and TomTom finding nothing says so', async () => {
  tomtom(() => tomtomDirections());
  assert.equal((await askPintu('/route', { method: 'POST', body: { locations: [{ lat: 3, lon: 101 }] } })).status, 400);
  assert.equal((await askPintu('/route', { method: 'POST', body: { locations: [{ lat: 'x', lon: 101 }, { lat: 3, lon: 101 }] } })).status, 400);
  tomtom(() => new Response('{"detailedError":{"message":"NO_ROUTE_FOUND"}}', { status: 400 }));
  const res = await askPintu('/route', { method: 'POST', body: { locations: [{ lat: 3.15, lon: 101.7 }, { lat: 1.3, lon: 103.8 }] } });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error, 'no route');
});

test('directions: what each of TomTom\'s turns becomes', async () => {
  const { turnType } = await import('../server/tomtom.js');
  const t = (maneuver, turnAngleInDecimalDegrees = 0) => turnType({ maneuver, turnAngleInDecimalDegrees });
  assert.equal(t('TURN_RIGHT'), 10);
  assert.equal(t('KEEP_LEFT'), 24);
  assert.equal(t('ROUNDABOUT_LEFT'), 26);
  assert.equal(t('MOTORWAY_EXIT_LEFT'), 21);
  assert.equal(t('TAKE_EXIT', -30), 21);
  assert.equal(t('ENTER_MOTORWAY', 40), 18);
  assert.equal(t('ENTRANCE_RAMP'), 17);
  assert.equal(t('MAKE_UTURN'), 12);
  assert.equal(t('SOMETHING_NEW'), 8);
});

test('fair use: each connection gets so many TomTom requests a minute', async () => {
  const { PER_MINUTE, allowed, forgetCounts } = await import('../server/tomtom.js');
  forgetCounts();
  tomtom(tomtomRoute);
  const from = (ip) => worker.fetch(new Request(`${HOME}/traffic`, { method: 'POST', headers: { origin: PINTU, 'cf-connecting-ip': ip }, body: JSON.stringify({ points: ROUTE }) }), TT_KEY);
  for (let i = 0; i < PER_MINUTE.api; i++) assert.equal((await from('1.2.3.4')).status, 200);
  const over = await from('1.2.3.4');
  assert.equal(over.status, 429);
  assert.equal(over.headers.get('retry-after'), '60');
  assert.equal((await from('5.6.7.8')).status, 200, 'someone else is fine');
  // A minute later it starts again.
  const t = Date.now();
  for (let i = 0; i < PER_MINUTE.tile; i++) allowed('9.9.9.9', 'tile', t);
  assert.equal(allowed('9.9.9.9', 'tile', t), false);
  assert.equal(allowed('9.9.9.9', 'tile', t + 60000), true);
  forgetCounts();
});
