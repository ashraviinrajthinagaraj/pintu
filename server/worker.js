// Pintu's small server, for jobs a web page isn't allowed to do by itself:
//
//   /link?u=…      where a shared short map link leads
//   /warnings      MET Malaysia's weather warnings
//   /mall?id=…     the shop list from a mall's own directory
//
// It runs on Cloudflare Workers and keeps no records. It only ever answers
// Pintu's own page, and only ever contacts the sites listed here, so it can't be
// used to reach anything else.

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

async function handle(request, origin) {
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

  return reply({ error: 'not found' }, origin, 404);
}

export default {
  async fetch(request) {
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
      return await handle(request, origin);
    } catch {
      return reply({ error: 'unavailable' }, origin, 502);
    }
  },
};
