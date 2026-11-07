// Everything Pintu depends on outside its own files lives here.
export const CONFIG = {
  version: '0.6.5',

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
    { name: 'stadia', url: 'https://api.stadiamaps.com/route/v1', traceUrl: 'https://api.stadiamaps.com/trace_attributes/v1', method: 'POST' },
    { name: 'fossgis', url: 'https://valhalla1.openstreetmap.de/route', traceUrl: 'https://valhalla1.openstreetmap.de/trace_attributes', method: 'GET' },
  ],

  search: {
    url: 'https://photon.komoot.io/api',
    reverseUrl: 'https://photon.komoot.io/reverse',
    // Peninsular Malaysia to Sabah, including Singapore and Brunei.
    bbox: [99.6, 0.85, 119.3, 7.4],
  },

  // Stops along the route come from OpenStreetMap through these, tried in order.
  // Pintu's small server, for jobs a web page can't do by itself. See server/worker.js.
  server: 'https://pintu.ashraviinrajthinagaraj.workers.dev',
  // Human-sounding voices through the server's /speak. Off: Google's free allowance ran
  // out within a drive, so every voice is the phone's own. See README.
  humanVoices: false,
  weather: {
    forecastUrl: 'https://api.open-meteo.com/v1/forecast',
    warningsUrl: 'https://api.data.gov.my/weather/warning',
    riversUrl: 'https://publicinfobanjir.water.gov.my/?lang=en',
    roadsUrl: 'https://bencana.jkr.gov.my/',
  },
  // The map's own tiles, for finding stops when the map hasn't said where it gets them.
  poiTiles: 'https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf',
  // The main server is often overloaded, so it isn't asked first.
  overpass: [
    'https://overpass.private.coffee/api/interpreter',
    'https://ovp.dresel.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ],

  // JAKIM's prayer times, by zone worked out from where you are.
  solatUrl: 'https://api.waktusolat.app/v2/solat/gps',

  home: { center: [109.2, 4.0], zoom: 4.6 },

  // Sunset and sunrise are close to 7:15 all year in Malaysia.
  nightStartsAt: 19.25,
  nightEndsAt: 7.0,
};
