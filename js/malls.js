// Malls whose own directory and indoor map Pintu can point you to.
//
// Pintu can't guide you inside a building: GPS is unreliable indoors, and a web
// page can't use the Wi-Fi or Bluetooth signals that indoor positioning needs.
// The mall's own interactive map can, so that's what these links open.
import { CONFIG } from './config.js';
import { within } from './net.js';
import { haversine } from './geo.js';

export const MALLS = [
  {
    id: 'ioi-city',
    name: 'IOI City Mall',
    match: /\bioi\s*city\b/i,
    at: [101.7149, 2.9701],
    radius: 600,
    map: 'https://map.abuzzsolutions.asia/amap/map.php?site=ICM&servicesHtml=true&sharePoi=false&player=website',
    directory: 'https://www.ioicitymall.com.my/?cat=36&tenantlist=full',
  },
];

export function mallFor(place) {
  if (!place) return null;
  const text = `${place.name || ''} ${place.detail || ''}`;
  return MALLS.find((m) => m.match.test(text)
    || (Number.isFinite(place.lng) && haversine([place.lng, place.lat], m.at) <= m.radius)) || null;
}

// The shop list comes through Pintu's server, which keeps a day's copy.
export async function fetchShops(mall, { signal, fetchImpl = (...a) => fetch(...a), server = CONFIG.server } = {}) {
  if (!server) throw new Error('no server');
  return within(12000, signal, async (s) => {
    const res = await fetchImpl(`${server}/mall?id=${encodeURIComponent(mall.id)}`, { signal: s });
    if (!res.ok) throw new Error(`mall ${res.status}`);
    const json = await res.json();
    return Array.isArray(json.shops) ? json.shops : [];
  });
}

export function searchShops(shops, q, limit = 30) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return shops
    .filter((shop) => words.every((w) => shop.name.toLowerCase().includes(w)))
    .sort((a, b) => a.name.length - b.name.length)
    .slice(0, limit);
}
