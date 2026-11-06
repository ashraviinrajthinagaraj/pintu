// Pintu's small server, for jobs a web page isn't allowed to do by itself:
//
//   /link?u=…      where a shared short map link leads
//   /warnings      MET Malaysia's weather warnings
//   /mall?id=…     the shop list from a mall's own directory
//   /speak?…       a line spoken by a character's human-sounding voice
//
// It runs on Cloudflare Workers and keeps no records. It only ever answers
// Pintu's own page, and only ever contacts the sites listed here, so it can't be
// used to reach anything else.
//
// The human voices come from Azure Speech. Its key stays here as a secret called
// AZURE_SPEECH_KEY and never goes to the page. Without it, /speak says so and the
// page uses the phone's own voice.

// The page allowed to use this server.
const ALLOWED_ORIGINS = ['https://ashraviinrajthinagaraj.github.io'];

const START_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|share\.google|maps\.apple|maps\.apple\.com)$/i;
const FOLLOW_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|share\.google|maps\.apple|maps\.apple\.com|consent\.google\.com|((www|maps)\.)?google\.[a-z]{2,3}(\.[a-z]{2})?)$/i;
const MAX_HOPS = 6;
const MAX_PAGE_BYTES = 800000;

const WARNINGS_URL = 'https://api.data.gov.my/weather/warning';
const MALLS = {
  'ioi-city': 'https://www.ioicitymall.com.my/?cat=36&tenantlist=full',
};

const AGENT = 'Mozilla/5.0 (compatible; PintuHelper/1.0)';

function reply(body, origin, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      vary: 'Origin',
      ...extra,
    },
  });
}

function allowedStart(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  if (!START_HOSTS.test(url.hostname)) return null;
  // goo.gl and g.co shorten everything. Only map links are this server's business.
  if (/^goo\.gl$/i.test(url.hostname) && !url.pathname.startsWith('/maps')) return null;
  if (/^g\.co$/i.test(url.hostname) && !url.pathname.startsWith('/kgs')) return null;
  return url;
}

function allowedHop(url) {
  return url.protocol === 'https:' && !url.port && !url.username && !url.password && FOLLOW_HOSTS.test(url.hostname);
}

const validSpot = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

// A position written in a map address or page.
function findSpot(text) {
  const patterns = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /[?&](?:q|query|ll|center|destination|daddr)=(-?\d+\.\d+)(?:,|%2C)\+?(-?\d+\.\d+)/,
    /\/maps\/(?:place|search|dir)\/(?:[^/]*\/)*(-?\d+\.\d+)(?:,|%2C)\+?(-?\d+\.\d+)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /center=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/,
    /[?&]coordinate=(-?\d+\.\d+)(?:,|%2C)(-?\d+\.\d+)/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && validSpot(Number(m[1]), Number(m[2]))) return { lat: Number(m[1]), lng: Number(m[2]) };
  }
  return null;
}

function placeName(url) {
  const m = url.pathname.match(/\/maps\/place\/([^/]+)/);
  if (!m) return url.searchParams.get('q') && !findSpot(url.href) ? url.searchParams.get('q') : '';
  try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch { return ''; }
}

async function readSome(res) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '', size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    text += decoder.decode(value, { stream: true });
    if (size >= MAX_PAGE_BYTES) { await reader.cancel(); break; }
  }
  return text;
}

async function followLink(start) {
  let url = start;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const res = await fetch(url.href, { redirect: 'manual', headers: { 'user-agent': AGENT, accept: 'text/html' } });
    const next = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && next) {
      const target = new URL(next, url);
      if (!allowedHop(target)) return { url: url.href };
      // A cookie question stands between us and the map. The answer is in its address.
      const after = /^consent\.google\.com$/i.test(target.hostname) ? target.searchParams.get('continue') : null;
      if (after) {
        const carried = new URL(after);
        if (!allowedHop(carried)) return { url: url.href };
        url = carried;
      } else {
        url = target;
      }
      const spot = findSpot(url.href);
      if (spot) return { ...spot, name: placeName(url), url: url.href };
      continue;
    }
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    // Landed. The address had no position, but the page itself usually does.
    const spot = findSpot(url.href) || findSpot(await readSome(res));
    return { ...spot, name: placeName(url), url: url.href };
  }
  return { url: url.href };
}

// "UNIQLO [ G11-3 ]" with the page's tags taken out.
function parseShops(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(a|div|li|p|h\d|td|tr|span)>/gi, '$&\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;|&#8217;/g, "'")
    .replace(/&nbsp;/g, ' ');
  const shops = [];
  const seen = new Set();
  for (const m of text.matchAll(/([^\n[\]]{1,70}?)\s*\[\s*([A-Za-z0-9][^\]\n]{0,40}?)\s*\]/g)) {
    const name = m[1].replace(/\s+/g, ' ').trim();
    const lot = m[2].replace(/\s+/g, ' ').trim();
    const key = `${name}|${lot}`;
    if (!name || seen.has(key)) continue;
    seen.add(key);
    shops.push({ name, lot });
  }
  return shops;
}


/* ---------- Human voices ---------- */

// Change this when a character's voice changes, so old recordings aren't reused.
const SPEECH_VERSION = '1';
const MAX_SPEECH = 420;
const AUDIO_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

// native: trained in this language.
// multi:  speaks many languages, keeping the accent of its own.
// reads:  from another language, reading as a speaker of its own would. Numbers
//         are spelled out, because it would otherwise say them in its own language.
const voice = (name, how, rate = 0, pitch = 0) => ({ name, how, rate, pitch });

const LADY = 'ms-MY-YasminNeural';
const MAN = 'ms-MY-OsmanNeural';
const IN_MAN = 'en-IN-ArjunNeural';
const IN_MAN_2 = 'en-IN-PrabhatNeural';
const IN_LADY = 'en-IN-AartiNeural';
const IN_LADY_2 = 'en-IN-NeerjaNeural';
const SG_MAN = 'en-SG-WayneNeural';
const SG_LADY = 'en-SG-LunaNeural';
const ZH_MAN = 'zh-CN-YunyiMultilingualNeural';
const ZH_MAN_2 = 'zh-CN-YunfanMultilingualNeural';
const ZH_LADY = 'zh-CN-XiaochenMultilingualNeural';
const ZH_LADY_2 = 'zh-CN-XiaoxiaoMultilingualNeural';
const ZH_CHILD = 'zh-CN-XiaoyouMultilingualNeural';
const NARRATOR = 'en-US-BrianMultilingualNeural';
const NARRATOR_2 = 'en-US-AndrewMultilingualNeural';

// Each list is tried in order, in case Azure doesn't offer a voice in this region.
const SPEAKERS = {
  standard: {
    ms: [voice(LADY, 'native')],
    en: [voice(SG_LADY, 'native'), voice(LADY, 'reads')],
  },
  captain: {
    ms: [voice(MAN, 'native', -3, -3)],
    en: [voice(MAN, 'reads', -3, -3), voice(SG_MAN, 'native', -3, -3)],
  },
  makcik: {
    ms: [voice(LADY, 'native', 5, 7)],
    en: [voice(LADY, 'reads', 5, 7), voice(SG_LADY, 'native', 5, 7)],
  },
  commentator: {
    ms: [voice(IN_MAN, 'reads', 8), voice(IN_MAN_2, 'reads', 8), voice(MAN, 'native', 8)],
    en: [voice(IN_MAN, 'native', 8), voice(IN_MAN_2, 'native', 8), voice(SG_MAN, 'native', 8)],
  },
  cikgu: {
    ms: [voice(IN_LADY, 'reads', -2), voice(IN_LADY_2, 'reads', -2), voice(LADY, 'native', -2)],
    en: [voice(IN_LADY, 'native', -2), voice(IN_LADY_2, 'native', -2), voice(SG_LADY, 'native', -2)],
  },
  uncle: {
    ms: [voice(ZH_MAN, 'multi', -3), voice(ZH_MAN_2, 'multi', -3), voice(MAN, 'native', -3)],
    en: [voice(SG_MAN, 'native', -3), voice(ZH_MAN, 'multi', -3)],
  },
  agent: {
    ms: [voice(ZH_LADY, 'multi', -3, -2), voice(ZH_LADY_2, 'multi', -3, -2), voice(LADY, 'native', -3, -2)],
    en: [voice(ZH_LADY, 'multi', -3, -2), voice(ZH_LADY_2, 'multi', -3, -2), voice(SG_LADY, 'native', -3, -2)],
  },
  trailer: {
    ms: [voice(NARRATOR, 'multi', -10, -8), voice(NARRATOR_2, 'multi', -10, -8), voice(MAN, 'native', -10, -8)],
    en: [voice(NARRATOR, 'multi', -10, -8), voice(NARRATOR_2, 'multi', -10, -8), voice(SG_MAN, 'native', -10, -8)],
  },
  adik: {
    ms: [voice(ZH_CHILD, 'multi'), voice(ZH_LADY_2, 'multi', 4, 14), voice(LADY, 'native', 4, 14)],
    en: [voice(ZH_CHILD, 'multi'), voice(ZH_LADY_2, 'multi', 4, 14), voice(SG_LADY, 'native', 4, 14)],
  },
};

// How a line is delivered. Small changes on purpose: a person's voice moves a
// little, and anything bigger starts to sound like a machine doing an impression.
const MOODS = {
  plain: {},
  warm: { rate: -3, pitch: 1 },
  tease: { rate: 3, pitch: 3 },
  deadpan: { rate: -7, pitch: -3 },
  excited: { rate: 9, pitch: 6 },
  worried: { rate: -2, pitch: 4 },
  whisper: { rate: -6, pitch: -2, volume: -30 },
  sigh: { rate: -12, pitch: -5 },
  stern: { rate: -5, pitch: -4 },
  shock: { rate: 6, pitch: 9 },
};

const PAUSE = '<break time="350ms"/>';   // where a line says "…"
const BEAT = '<break time="280ms"/>';    // before the delivery changes, as a joke lands

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const signed = (n) => `${n >= 0 ? '+' : ''}${n}%`;

const MS_ONES = ['kosong', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'lapan', 'sembilan'];
const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function malayNumber(n) {
  if (n < 10) return MS_ONES[n];
  if (n === 10) return 'sepuluh';
  if (n === 11) return 'sebelas';
  if (n < 20) return `${MS_ONES[n - 10]} belas`;
  if (n < 100) return `${MS_ONES[Math.floor(n / 10)]} puluh${n % 10 ? ` ${MS_ONES[n % 10]}` : ''}`;
  if (n < 1000) {
    const h = Math.floor(n / 100);
    return `${h === 1 ? 'seratus' : `${MS_ONES[h]} ratus`}${n % 100 ? ` ${malayNumber(n % 100)}` : ''}`;
  }
  const k = Math.floor(n / 1000);
  return `${k === 1 ? 'seribu' : `${malayNumber(k)} ribu`}${n % 1000 ? ` ${malayNumber(n % 1000)}` : ''}`;
}

function englishNumber(n) {
  if (n < 20) return EN_ONES[n];
  if (n < 100) return `${EN_TENS[Math.floor(n / 10)]}${n % 10 ? `-${EN_ONES[n % 10]}` : ''}`;
  if (n < 1000) return `${EN_ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${englishNumber(n % 100)}` : ''}`;
  return `${englishNumber(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${englishNumber(n % 1000)}` : ''}`;
}

// "1.5" becomes "satu perpuluhan lima". "E2", a road's name, stays as it is.
function spellNumbers(text, lang) {
  const say = lang === 'ms' ? malayNumber : englishNumber;
  const point = lang === 'ms' ? 'perpuluhan' : 'point';
  return text.replace(/(?<![\p{L}\d])\d{1,6}(?:\.\d+)?(?![\p{L}\d])/gu, (found) => {
    const [whole, part] = found.split('.');
    const spoken = say(Number(whole));
    return part ? `${spoken} ${point} ${[...part].map((d) => say(Number(d))).join(' ')}` : spoken;
  });
}

// An English voice reads the Malay "c" as a "k", which turns "cuaca" into something
// else. Capitals are left alone so names like "Cyberjaya" stay right.
const forEnglishEyes = (text) => text.replace(/(^|[\s,.aeiou])c(?=[aeiou])/g, '$1ch').replace(/\bsy(?=[aeiou])/g, 'sh');

// "Turn left. [tease]Eh… why?" as the pieces of speech Azure is asked for.
function spokenBody(text, lang, speaker, plain) {
  const adjust = (phrase) => {
    if (speaker.how !== 'reads') return phrase;
    const spelled = spellNumbers(phrase, lang);
    return lang === 'ms' && speaker.name.startsWith('en-') ? forEnglishEyes(spelled) : spelled;
  };
  const parts = text.split(/\[([a-z]+)\]/);
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    const mood = MOODS[parts[i - 1]] || {};
    const phrases = parts[i].split('…').map((p) => p.replace(/[\[\]]/g, ' ').trim()).filter(Boolean);
    if (!phrases.length) continue;
    if (out.length && !plain) out.push(BEAT);
    const rate = speaker.rate + (mood.rate || 0);
    const pitch = speaker.pitch + (mood.pitch || 0);
    const volume = mood.volume;
    const attrs = [
      rate ? `rate="${signed(rate)}"` : '',
      pitch ? `pitch="${signed(pitch)}"` : '',
      volume ? `volume="${signed(volume)}"` : '',
    ].filter(Boolean).join(' ');
    phrases.forEach((phrase, n) => {
      const words = xml(adjust(phrase));
      if (plain) { out.push(`${n ? ', ' : ' '}${words}`); return; }
      if (n) out.push(PAUSE);
      out.push(attrs ? `<prosody ${attrs}>${words}</prosody>` : words);
    });
  }
  return out.join('');
}

function buildSsml(text, lang, speaker, plain = false) {
  const locale = lang === 'ms' ? 'ms-MY' : 'en-US';
  const body = spokenBody(text, lang, speaker, plain);
  const multi = speaker.how === 'multi';
  const root = multi ? 'en-US' : speaker.name.slice(0, 5);
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${root}"><voice name="${speaker.name}">${multi ? `<lang xml:lang="${locale}">${body}</lang>` : body}</voice></speak>`;
}

class VoiceRefused extends Error {
  constructor(status) { super('refused'); this.status = status; }
}

// Azure answers 400 for a voice it doesn't have here or a line it can't read, so
// each voice gets one simpler attempt and then the next voice gets a turn.
async function synthesize(text, lang, speakers, key, region) {
  for (const speaker of speakers) {
    for (const plain of [false, true]) {
      const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'content-type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': AUDIO_FORMAT,
          'user-agent': 'PintuHelper',
        },
        body: buildSsml(text, lang, speaker, plain),
      });
      if (res.ok) {
        const audio = await res.arrayBuffer();
        if (audio.byteLength) return audio;
      } else if (res.status !== 400) {
        throw new VoiceRefused(res.status);
      }
    }
  }
  return null;
}

// Whether the key works, without using up any of the free allowance.
async function voiceCheck(key, region) {
  if (!key) return { ready: false, reason: 'no key' };
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
    headers: { 'Ocp-Apim-Subscription-Key': key, 'user-agent': 'PintuHelper' },
  });
  await res.body?.cancel();
  if (res.ok) return { ready: true };
  return { ready: false, reason: res.status === 401 || res.status === 403 ? 'key refused' : 'unavailable' };
}

async function speakRoute(url, origin, env, ctx) {
  const key = env?.AZURE_SPEECH_KEY;
  const region = /^[a-z0-9]+$/.test(env?.AZURE_SPEECH_REGION || '') ? env.AZURE_SPEECH_REGION : 'southeastasia';
  if (url.searchParams.has('check')) {
    return reply(await voiceCheck(key, region), origin, 200, { 'cache-control': 'no-store' });
  }

  const who = url.searchParams.get('who');
  const lang = url.searchParams.get('lang');
  const text = (url.searchParams.get('text') || '').replace(/[\u0000-\u001f]/g, ' ').trim();
  const speakers = Object.hasOwn(SPEAKERS, who) && (lang === 'ms' || lang === 'en') ? SPEAKERS[who][lang] : null;
  if (!speakers || !text || text.length > MAX_SPEECH) return reply({ error: 'bad request' }, origin, 400);
  if (!key) return reply({ error: 'no voice key' }, origin, 503);

  const headers = {
    'content-type': 'audio/mpeg',
    'cache-control': 'public, max-age=31536000, immutable',
    'access-control-allow-origin': origin,
    vary: 'Origin',
  };
  const shelf = globalThis.caches?.default;
  const label = new Request(`https://speech.pintu.invalid/${SPEECH_VERSION}/${who}/${lang}?t=${encodeURIComponent(text)}`);
  const kept = await shelf?.match(label).catch(() => null);
  if (kept) return new Response(kept.body, { headers });

  let audio;
  try {
    audio = await synthesize(text, lang, speakers, key, region);
  } catch (err) {
    if (err.status === 429) return reply({ error: 'busy' }, origin, 429);
    if (err.status === 401 || err.status === 403) return reply({ error: 'key refused' }, origin, 503);
    throw err;
  }
  if (!audio) return reply({ error: 'no voice could say that' }, origin, 502);
  const keep = shelf?.put(label, new Response(audio.slice(0), { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=2592000' } })).catch(() => {});
  if (keep) ctx?.waitUntil?.(keep);
  return new Response(audio, { headers });
}

async function handle(request, origin, env, ctx) {
  const url = new URL(request.url);

  if (url.pathname === '/link') {
    const start = allowedStart(url.searchParams.get('u') || '');
    if (!start) return reply({ error: 'not a map link' }, origin, 400);
    return reply(await followLink(start), origin, 200, { 'cache-control': 'no-store' });
  }

  if (url.pathname === '/warnings') {
    const res = await fetch(WARNINGS_URL, { headers: { 'user-agent': AGENT }, cf: { cacheTtl: 600, cacheEverything: true } });
    if (!res.ok) return reply({ error: 'source unavailable' }, origin, 502);
    return reply(await res.json(), origin, 200, { 'cache-control': 'public, max-age=600' });
  }

  if (url.pathname === '/mall') {
    const source = MALLS[url.searchParams.get('id')];
    if (!source) return reply({ error: 'unknown mall' }, origin, 404);
    const res = await fetch(source, { headers: { 'user-agent': AGENT }, cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!res.ok) return reply({ error: 'source unavailable' }, origin, 502);
    const shops = parseShops(await res.text());
    if (shops.length < 20) return reply({ error: 'could not read the list' }, origin, 502);
    return reply({ shops }, origin, 200, { 'cache-control': 'public, max-age=86400' });
  }

  if (url.pathname === '/speak') return speakRoute(url, origin, env, ctx);

  return reply({ error: 'not found' }, origin, 404);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('origin');
    const url = new URL(request.url);

    // Opening the address in a browser shows it's up, and nothing else.
    if (url.pathname === '/' && !origin) {
      return new Response('Pintu server is running.', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('Not allowed', { status: 403 });
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET', vary: 'Origin' } });
    }
    if (request.method !== 'GET') return new Response('Not allowed', { status: 405 });

    try {
      return await handle(request, origin, env, ctx);
    } catch {
      return reply({ error: 'unavailable' }, origin, 502);
    }
  },
};
