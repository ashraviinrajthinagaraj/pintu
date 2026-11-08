// Keeps Pintu opening with poor signal. The app's own files come from the
// network when possible so updates arrive by themselves. Searches, routes and
// stops are never stored here.
const VERSION = 'pintu-0.9.6';
const SHELL = `${VERSION}-shell`;
const LIBS = `${VERSION}-libs`;
const TILES = 'pintu-tiles-1';
const VOICE = 'pintu-voice-2';   // recordings of spoken lines, kept by voice.js
const MAX_TILES = 4000;   // room for a long trip's map, kept for when there's no signal

const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/car-gl.js', 'js/car-mesh.js', 'js/config.js', 'js/format.js', 'js/geo.js', 'js/guidance.js', 'js/i18n.js',
  'js/icons.js', 'js/instructions.js', 'js/lanes.js', 'js/location.js', 'js/map.js', 'js/motion.js', 'js/places.js',
  'js/prayer.js', 'js/routing.js', 'js/search.js', 'js/store.js', 'js/tiles.js', 'js/vehicle.js', 'js/characters.js', 'js/audio.js', 'js/cameras.js', 'js/delivery.js', 'js/junction.js', 'js/kinds.js', 'js/leaveby.js', 'js/nearby.js', 'js/parking.js', 'js/drive-watch.js', 'js/tolls.js', 'js/traffic.js', 'js/traffic-map.js', 'js/tomtom.js', 'js/offline.js', 'js/usage.js', 'js/report.js', 'js/fuel-price.js', 'js/voice-search.js', 'js/trips.js', 'js/battery.js', 'js/hub.js', 'js/road-reports.js', 'js/together.js', 'js/commute.js',
  'js/cast/adik.js', 'js/cast/agent.js', 'js/cast/captain.js', 'js/cast/cikgu.js', 'js/cast/commentator.js', 'js/cast/makcik.js', 'js/cast/trailer.js', 'js/cast/uncle.js', 'js/links.js', 'js/malls.js', 'js/net.js', 'js/weather.js', 'js/vehicle-ui.js',
  'js/voice.js',
  'fonts/Barlow-Medium.woff', 'fonts/Barlow-SemiBold.woff', 'fonts/Barlow-Bold.woff',
  'fonts/BarlowSemiCondensed-SemiBold.woff', 'fonts/BarlowSemiCondensed-Bold.woff',
  'fonts/BarlowSemiCondensed-ExtraBold.woff',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, LIBS, TILES, VOICE]);
    for (const name of await caches.keys()) if (!keep.has(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    // Always checked with the site, so an update shows the next time Pintu opens
    // rather than when the browser's own copy happens to expire.
    const res = await fetch(request, { cache: 'no-cache' });
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const page = await cache.match('index.html');
      if (page) return page;
    }
    throw err;
  }
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    if (cacheName === TILES) trim(cache);
  }
  return res;
}

let putsSinceTrim = 0;
async function trim(cache) {
  if (++putsSinceTrim < 100) return;
  putsSinceTrim = 0;
  const keys = await cache.keys();
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(old);
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === location.origin) {
    e.respondWith(networkFirst(request));
  } else if (/\/maplibre-gl@/.test(url.pathname)) {
    e.respondWith(cacheFirst(LIBS, request));
  } else if (url.hostname === 'tiles.openfreemap.org') {
    // Styles can change; tiles, fonts and sprites sit under versioned paths.
    if (url.pathname.startsWith('/styles/')) {
      e.respondWith(fetch(request).then(async (res) => {
        if (res.ok) (await caches.open(LIBS)).put(request, res.clone());
        return res;
      }).catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        throw new Error('style unavailable');
      }));
    } else {
      e.respondWith(cacheFirst(TILES, request));
    }
  }
});

/* ---------- Morning alerts ---------- */

// The server's address, as in js/config.js. A notification carries nothing itself:
// the phone asks the server what to say, giving the address it was woken on.
const SERVER = 'https://pintu.ashraviinrajthinagaraj.workers.dev';

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let msg = { title: 'Pintu', body: 'Buka Pintu untuk lihat perjalanan ke tempat kerja hari ini.', url: './?go=work' };
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const res = await fetch(`${SERVER}/commute/message`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ endpoint: sub?.endpoint }),
      });
      if (res.ok) {
        const got = await res.json();
        if (typeof got.title === 'string') msg.title = got.title.slice(0, 80);
        if (typeof got.body === 'string') msg.body = got.body.slice(0, 200);
      }
    } catch { /* the plain message, then */ }
    await self.registration.showNotification(msg.title, { body: msg.body, icon: 'icons/icon-192.png', tag: 'commute', renotify: true, data: { url: msg.url } });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  // Only ever Pintu's own page.
  const url = new URL('./?go=work', self.registration.scope).href;
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of open) {
      if (c.url.startsWith(self.registration.scope)) {
        await c.focus();
        return c.navigate?.(url);
      }
    }
    return self.clients.openWindow(url);
  })());
});
