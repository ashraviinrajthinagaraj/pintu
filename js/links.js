// Turning what people share into a place: a Google Maps, Waze or Apple Maps link,
// a message with a link inside it, or plain coordinates.
//
// Full links carry their location, so they're read right here. Short links only
// say where they lead when you follow them, which a browser isn't allowed to do
// for another site, so those go through Pintu's small server.
import { CONFIG } from './config.js';
import { within } from './net.js';

const SHORT_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|share\.google|maps\.apple)$/i;
const MAP_HOSTS = /^((www|maps|m)\.)?google\.[a-z.]{2,7}$|^(www\.)?waze\.com$|^maps\.apple\.com$|^(www\.)?openstreetmap\.org$|^(www\.)?osm\.org$/i;
const LOOKS_LIKE_URL = /(https?:\/\/[^\s<>"]+|geo:[^\s<>"]+)/i;
const NUMBER = '(-?\\d{1,3}(?:\\.\\d+)?)';
const PAIR = new RegExp(`^\\s*${NUMBER}\\s*(?:,|%2C|\\s)\\s*\\+?${NUMBER}\\s*$`, 'i');

const valid = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
// A sentence's punctuation isn't part of the link, but a closing bracket might be.
function trimLink(link) {
  const out = link.replace(/[.,;!]+$/, '');
  return out.endsWith(')') && !out.includes('(') ? out.slice(0, -1).replace(/[.,;!]+$/, '') : out;
}

const coordsName = (lat, lng) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

function pair(text) {
  if (!text) return null;
  let decoded = text;
  try { decoded = decodeURIComponent(text); } catch { /* leave it as it came */ }
  const m = decoded.replace(/^(ll\.|loc:)/i, '').match(PAIR);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return valid(lat, lng) ? { lat, lng } : null;
}

function clean(text) {
  let out = text || '';
  try { out = decodeURIComponent(out.replace(/\+/g, ' ')); } catch { /* leave it as it came */ }
  return out.trim();
}

// Waze's short links are a geohash, so they need no server at all.
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
export function decodeGeohash(hash) {
  let lat = [-90, 90], lng = [-180, 180], even = true;
  for (const ch of hash.toLowerCase()) {
    const v = BASE32.indexOf(ch);
    if (v < 0) return null;
    for (let bit = 4; bit >= 0; bit--) {
      const range = even ? lng : lat;
      const mid = (range[0] + range[1]) / 2;
      if ((v >> bit) & 1) range[0] = mid;
      else range[1] = mid;
      even = !even;
    }
  }
  return { lat: (lat[0] + lat[1]) / 2, lng: (lng[0] + lng[1]) / 2 };
}

// { lat, lng, name } or { query } from a full link. Null if it holds neither.
export function readMapUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }

  if (url.protocol === 'geo:') {
    const [spot, rest = ''] = raw.slice(4).split('?');
    const where = pair(spot.split(';')[0]);
    const q = new URLSearchParams(rest).get('q') || '';
    const inside = q.match(/^(-?[\d.]+),(-?[\d.]+)\s*(?:\((.*)\))?$/);
    if (inside && valid(Number(inside[1]), Number(inside[2]))) return { lat: Number(inside[1]), lng: Number(inside[2]), name: clean(inside[3] || '') };
    if (where) return { ...where, name: clean(q) };
    return q ? { query: clean(q) } : null;
  }

  const full = url.href;
  const path = decodeURIComponent(url.pathname);
  const get = (k) => url.searchParams.get(k);

  // Waze
  const wazeHash = /(^|\.)waze\.com$/i.test(url.hostname) && url.pathname.match(/^\/ul\/h([0-9a-z]+)/i);
  if (wazeHash) {
    const spot = decodeGeohash(wazeHash[1]);
    if (spot) return { ...spot, name: '' };
  }

  // The exact place, which beats where the map happened to be looking.
  const exact = full.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const placeName = path.match(/\/maps\/place\/([^/]+)/);
  // A dropped pin's "name" is only its coordinates written the long way.
  const name = placeName && !pair(placeName[1]) && !/°/.test(path) ? clean(placeName[1]) : '';
  if (exact && valid(Number(exact[1]), Number(exact[2]))) return { lat: Number(exact[1]), lng: Number(exact[2]), name };

  // Parameters that hold a position directly.
  for (const key of ['q', 'query', 'daddr', 'destination', 'll', 'center', 'sll', 'to', 'coordinate']) {
    const spot = pair(get(key));
    if (spot) {
      const q = get('q');
      return { ...spot, name: clean(get('name') || get('label') || (q && !pair(q) ? q : '')) || name };
    }
  }
  // OpenStreetMap
  if (get('mlat') && get('mlon') && valid(Number(get('mlat')), Number(get('mlon')))) {
    return { lat: Number(get('mlat')), lng: Number(get('mlon')), name: '' };
  }
  const hashMap = url.hash.match(/map=\d+(?:\.\d+)?\/(-?[\d.]+)\/(-?[\d.]+)/);
  if (hashMap && valid(Number(hashMap[1]), Number(hashMap[2]))) return { lat: Number(hashMap[1]), lng: Number(hashMap[2]), name: '' };

  // /maps/dir/…/3.1,101.7 and /maps/search/3.1,+101.7 and /maps/place/3.1,101.7
  const segments = path.split('/').filter(Boolean);
  for (const part of [...segments].reverse()) {
    const spot = pair(part.replace(/\+/g, ' '));
    if (spot) return { ...spot, name };
  }

  // A named place where the map is centred nearby is better than a text search.
  const view = full.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (view && valid(Number(view[1]), Number(view[2]))) return { lat: Number(view[1]), lng: Number(view[2]), name };

  // Only a name, then. The search can look for it.
  if (name) return { query: name };
  const q = get('q') || get('query') || get('daddr') || get('destination') || get('address');
  if (q) return { query: clean(q) };
  const searching = path.match(/\/maps\/search\/([^/]+)/);
  if (searching) return { query: clean(searching[1]) };
  return null;
}

const toPlace = ({ lat, lng, name = '' }, fallbackName = '') => ({
  name: name || fallbackName || coordsName(lat, lng),
  detail: '',
  lat,
  lng,
  country: '',
  unnamed: !(name || fallbackName),
});

// What someone pasted or shared. Null means it isn't a location, so search as usual.
export function parseLocationText(text) {
  const input = (text || '').trim();
  if (!input) return null;

  const found = input.match(LOOKS_LIKE_URL)?.[1];
  if (found) {
    const link = trimLink(found);
    // Whatever came before the link is often the place's name.
    const before = input.slice(0, input.indexOf(link)).split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
    let host = '';
    try { host = new URL(link).hostname; } catch { /* a geo: link has no host */ }
    if (SHORT_HOSTS.test(host) || (/^maps\.apple\.com$/i.test(host) && /^\/p\//.test(new URL(link).pathname))) {
      return { kind: 'short', url: link, name: before };
    }
    // Other sites' links are just links, whatever their addresses happen to contain.
    if (host && !MAP_HOSTS.test(host)) return null;
    const read = readMapUrl(link);
    if (read?.lat != null) return { kind: 'place', place: toPlace(read, before) };
    if (read?.query) return { kind: 'search', query: read.query };
    return before ? { kind: 'search', query: before } : { kind: 'unknown' };
  }

  const spot = pair(input);
  if (spot) return { kind: 'place', place: toPlace(spot) };
  return null;
}

// Ask the server where a short link leads.
export async function resolveShortLink(url, { signal, fetchImpl = (...a) => fetch(...a), server = CONFIG.server } = {}) {
  if (!server) throw new Error('no server');
  return within(10000, signal, async (s) => {
    const res = await fetchImpl(`${server}/link?u=${encodeURIComponent(url)}`, { signal: s });
    if (!res.ok) throw new Error(`link ${res.status}`);
    return res.json();
  });
}

// The answer from the server, as a place or something to search for.
export function readResolved(answer, name = '') {
  if (Number.isFinite(answer?.lat) && Number.isFinite(answer?.lng) && valid(answer.lat, answer.lng)) {
    return { kind: 'place', place: toPlace({ lat: answer.lat, lng: answer.lng, name: answer.name || name }) };
  }
  const read = answer?.url ? readMapUrl(answer.url) : null;
  if (read?.lat != null) return { kind: 'place', place: toPlace(read, name) };
  if (read?.query) return { kind: 'search', query: read.query };
  if (name) return { kind: 'search', query: name };
  return { kind: 'unknown' };
}
