import { CONFIG } from './config.js';

const uniq = (list) => [...new Set(list.filter(Boolean))];

export function toPlace(feature) {
  const p = feature.properties || {};
  const [lng, lat] = feature.geometry.coordinates;
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const name = p.name || street || p.city || p.county || p.state || '';
  const detail = uniq([p.name ? street : '', p.district || p.locality, p.city, p.state || p.county])
    .filter((x) => x !== name)
    .join(', ');
  return { name, detail, lng, lat, country: p.countrycode || '' };
}

export function parseResults(json) {
  const seen = new Set();
  const places = [];
  for (const f of json.features || []) {
    const place = toPlace(f);
    if (!place.name) continue;
    const key = `${place.name}|${place.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push(place);
  }
  // Malaysian results first, without otherwise disturbing the order.
  return places.filter((p) => p.country === 'MY').concat(places.filter((p) => p.country !== 'MY'));
}

// Someone sends you "3.1579, 101.7116": that's a place too.
export function parseCoordinates(text) {
  const m = text.trim().match(/^(-?\d{1,2}\.\d+)\s*[,\s]\s*(-?\d{1,3}\.\d+)$/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, detail: '', lat, lng, country: '' };
}

export async function searchPlaces(q, { near, signal, fetchImpl = (...a) => fetch(...a) } = {}) {
  const coords = parseCoordinates(q);
  if (coords) return [coords];
  const params = new URLSearchParams({ q, limit: '10', bbox: CONFIG.search.bbox.join(',') });
  if (near) {
    params.set('lat', near.lat.toFixed(4));
    params.set('lon', near.lng.toFixed(4));
    params.set('location_bias_scale', '0.3');
  }
  const res = await fetchImpl(`${CONFIG.search.url}?${params}`, { signal });
  if (!res.ok) throw new Error(`search ${res.status}`);
  return parseResults(await res.json());
}

export async function reversePlace(lng, lat, { signal, fetchImpl = (...a) => fetch(...a) } = {}) {
  const params = new URLSearchParams({ lat: lat.toFixed(6), lon: lng.toFixed(6), limit: '1' });
  const res = await fetchImpl(`${CONFIG.search.reverseUrl}?${params}`, { signal });
  if (!res.ok) throw new Error(`reverse ${res.status}`);
  const [place] = parseResults(await res.json());
  return place ? { ...place, lng, lat } : null;
}
