// Following a shared map link to where it leads: short links only say so when
// followed, which a web page isn't allowed to do, so the server does it. Used by
// the server itself and, when Google turns the server's own address away, by a
// copy of the hub placed on another continent (see resolveLink in worker.js).

const AGENT = 'Mozilla/5.0 (compatible; PintuHelper/1.0)';

const START_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|share\.google|maps\.apple|maps\.apple\.com)$/i;
// A full Google Maps link that names a place by Google's id but not where it is.
const GOOGLE_MAPS = /^((www|maps)\.)?google\.(com|[a-z]{2}|com?\.[a-z]{2})$/i;
const FOLLOW_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|share\.google|maps\.apple|maps\.apple\.com|consent\.google\.com|((www|maps)\.)?google\.[a-z]{2,3}(\.[a-z]{2})?)$/i;
const MAX_HOPS = 6;
const MAX_PAGE_BYTES = 800000;

export function allowedStart(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  if (GOOGLE_MAPS.test(url.hostname) && (url.pathname.startsWith('/maps') || /^maps\./i.test(url.hostname))) return url;
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

// A position written in a map address or page. Google's own codes are often
// escaped (%21 for !), and the exact spot of the place beats where the map was
// looking, which comes first. In a page, only the place's own spot counts:
// where its map looks is wherever Google thinks the one asking is, which for
// this server can be another continent.
function findSpot(raw, { page = false } = {}) {
  const text = raw.replace(/%21/gi, '!');
  if (page) {
    const m = text.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    return m && validSpot(Number(m[1]), Number(m[2])) ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
  }
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

// Google's id for a place, in its links: two numbers, "0x…:0x…", or the same
// two inside a "ChIJ…" place id. The first is a cell of a grid over the earth
// (Google's S2 grid) with the place in it. Only its first ten levels can be
// counted on, a square about 10 km across: not where the place is, but enough
// to tell a position that's wrong from one that may be right, and where to look
// for the place by its name.
const AREA_LEVEL = 10;
export const AREA_KM = 25;
const POS_TO_IJ = [[0, 1, 3, 2], [0, 2, 3, 1], [3, 2, 0, 1], [3, 1, 0, 2]];
const POS_TO_ORIENTATION = [1, 0, 0, 3];

// The middle of a grid cell, to `level`, from its 64-bit number.
export function cellCentre(cell, level = AREA_LEVEL) {
  const face = Number(cell >> 61n);
  if (face > 5) return null;
  let i = 0, j = 0, turn = face & 1;
  for (let k = 1; k <= level; k++) {
    const pos = Number((cell >> BigInt(61 - 2 * k)) & 3n);
    const ij = POS_TO_IJ[turn][pos];
    i = i * 2 + (ij >> 1);
    j = j * 2 + (ij & 1);
    turn ^= POS_TO_ORIENTATION[pos];
  }
  const st = (x) => (x + 0.5) / 2 ** level;
  const uv = (v) => (v >= 0.5 ? (4 * v * v - 1) / 3 : (1 - 4 * (1 - v) * (1 - v)) / 3);
  const u = uv(st(i)), v = uv(st(j));
  const [x, y, z] = [[1, u, v], [-u, 1, v], [-u, -v, 1], [-1, -v, -u], [v, -1, -u], [v, u, -1]][face];
  return { lat: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI, lng: (Math.atan2(y, x) * 180) / Math.PI };
}

export function googleArea(text) {
  const pair = text.match(/0x([0-9a-f]{6,16})(?::|%3A)0x[0-9a-f]{6,16}/i);
  if (pair) return cellCentre(BigInt(`0x${pair[1]}`));
  const id = text.match(/(?:place_id(?::|=|%3A)|!1s)(ChIJ[\w-]{23})/);
  if (!id) return null;
  try {
    const bytes = Uint8Array.from(atob(id[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    if (bytes[0] !== 0x0a || bytes[2] !== 0x09) return null;
    let cell = 0n;
    for (let k = 10; k >= 3; k--) cell = (cell << 8n) | BigInt(bytes[k]);
    return cellCentre(cell);
  } catch {
    return null;
  }
}

const kmBetween = (a, b) => Math.hypot((a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180), a.lat - b.lat) * 111.32;

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

// Google's "unusual traffic" page, which it shows to addresses it has had too
// much from. The address of that page holds a code, not anything about the place.
const turnedAway = (url) => /(^|\.)google\./i.test(url.hostname) && url.pathname.startsWith('/sorry');

// Where a link leads: { lat, lng, name, url }, or only { url } (and `name` when
// the address has one) when no position could be found. `blocked` means Google
// turned this address away before saying. `trail`, if given, collects each step
// (the answer and where it was), for checking.
export async function followLink(start, trail = null, fetchImpl = (...a) => fetch(...a)) {
  let url = start;
  // Where Google's id for the place says it is, roughly, once a link shows it:
  // a position far from there isn't the place's, and the place's name can be
  // looked for around there.
  let area = googleArea(url.href);
  const fits = (spot) => !!spot && (!area || kmBetween(spot, area) <= AREA_KM);
  const unplaced = (extra) => ({ ...extra, ...(area ? { near: { lat: +area.lat.toFixed(4), lng: +area.lng.toFixed(4) } } : {}) });
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const res = await fetchImpl(url.href, { redirect: 'manual', headers: { 'user-agent': AGENT, accept: 'text/html' } });
    const next = res.headers.get('location');
    trail?.push(`${res.status} ${url.hostname}${url.pathname.slice(0, 60)}`);
    if (res.status === 429 || turnedAway(url)) return { url: start.href, blocked: true };
    if (res.status >= 300 && res.status < 400 && next) {
      const target = new URL(next, url);
      if (turnedAway(target)) {
        trail?.push(`→ ${target.hostname}${target.pathname}`);
        return { url: start.href, blocked: true };
      }
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
      area ||= googleArea(url.href);
      const spot = findSpot(url.href);
      if (fits(spot)) return { ...spot, name: placeName(url), url: url.href };
      continue;
    }
    if (!res.ok) {
      // The short link itself is broken: an honest error.
      if (hop === 0) throw new Error(`upstream ${res.status}`);
      // Google wouldn't show the page. Its address still has the place's name
      // or what was searched for, which Pintu can look up itself.
      return unplaced({ name: placeName(url), url: url.href, refused: res.status });
    }
    // Landed. The address had no position, but the page may have the place's.
    const inAddress = findSpot(url.href);
    const spot = fits(inAddress) ? inAddress : findSpot(await readSome(res), { page: true });
    if (fits(spot)) return { ...spot, name: placeName(url), url: url.href };
    return unplaced({ name: placeName(url), url: url.href });
  }
  return unplaced({ url: url.href });
}

