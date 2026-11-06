// Pintu's small server, run here against stand-ins for the sites it talks to.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/worker.js';
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
