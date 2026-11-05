// Everything Pintu depends on outside its own files lives here.
export const CONFIG = {
  version: '0.2.0',

  maplibre: {
    version: '5.24.0',
    // Tried in order, so one CDN being down doesn't take the map with it.
    cdns: ['https://cdn.jsdelivr.net/npm/maplibre-gl@', 'https://unpkg.com/maplibre-gl@'],
  },

  mapStyles: {
    day: 'https://tiles.openfreemap.org/styles/liberty',
    night: 'https://tiles.openfreemap.org/styles/dark',
  },

  // Both speak the same Valhalla format, so Pintu can move between them.
  // Stadia answers once this site's address is added to a free Stadia account;
  // until then it refuses and the FOSSGIS public server is used instead.
  routing: [
    { name: 'stadia', url: 'https://api.stadiamaps.com/route/v1', method: 'POST' },
    { name: 'fossgis', url: 'https://valhalla1.openstreetmap.de/route', method: 'GET' },
  ],

  search: {
    url: 'https://photon.komoot.io/api',
    reverseUrl: 'https://photon.komoot.io/reverse',
    // Peninsular Malaysia to Sabah, including Singapore and Brunei.
    bbox: [99.6, 0.85, 119.3, 7.4],
  },

  // Stops along the route come from OpenStreetMap through these, tried in order.
  overpass: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ],

  // JAKIM's prayer times, by zone worked out from where you are.
  solatUrl: 'https://api.waktusolat.app/v2/solat/gps',

  home: { center: [109.2, 4.0], zoom: 4.6 },

  // Sunset and sunrise are close to 7:15 all year in Malaysia.
  nightStartsAt: 19.25,
  nightEndsAt: 7.0,
};
