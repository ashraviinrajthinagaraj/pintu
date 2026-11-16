// Temporary: what the map's tiles and OpenStreetMap say about a few landmarks.
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const PLACES = {
  liberty: [-74.04450, 40.68925],
  batucaves: [101.68388, 3.23720],
  petronas: [101.71185, 3.15785],
  kltower: [101.70379, 3.15277],
  merdeka118: [101.70067, 3.14158],
};
const tileOf = (lng, lat, z) => [Math.floor(((lng + 180) / 360) * 2 ** z), Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z)];

for (const [name, [lng, lat]] of Object.entries(PLACES)) {
  const [x, y] = tileOf(lng, lat, 14);
  const res = await fetch(`https://tiles.openfreemap.org/planet/latest/14/${x}/${y}.pbf`);
  console.log(`\n== ${name} tile 14/${x}/${y} status ${res.status} ${res.headers.get('content-type')}`);
  if (!res.ok) continue;
  const tile = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
  const near = (f) => {
    const g = f.toGeoJSON(x, y, 14).geometry;
    const pts = g.type === 'Point' ? [g.coordinates] : g.coordinates.flat(g.type === 'MultiPolygon' ? 2 : 1);
    return pts.some(([a, b]) => Math.abs(a - lng) < 0.0012 && Math.abs(b - lat) < 0.0012);
  };
  for (const layerName of ['building', 'poi']) {
    const layer = tile.layers[layerName];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (!near(f)) continue;
      const g = f.toGeoJSON(x, y, 14).geometry;
      const pts = g.type === 'Point' ? [g.coordinates] : g.coordinates.flat(g.type === 'MultiPolygon' ? 2 : 1);
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      console.log(`${layerName} id=${f.id} ${g.type} n=${pts.length} centre=${cx.toFixed(5)},${cy.toFixed(5)} ${JSON.stringify(f.properties)}`);
    }
  }
  const q = `[out:json][timeout:60];nwr(around:90,${lat},${lng})[~"^(man_made|building|building:part|tourism|historic)$"~"."];out tags center;`;
  try {
    const o = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: q }) });
    const j = await o.json();
    for (const e of j.elements) {
      const t = e.tags || {};
      const keep = Object.fromEntries(Object.entries(t).filter(([k]) => /^(name|name:en|man_made|building|building:part|height|min_height|ele|tourism|historic|memorial|material|colour|building:colour|roof:shape|roof:height|artwork_type|wikidata)$/.test(k)));
      console.log(`osm ${e.type}/${e.id} ${JSON.stringify(keep)} ${e.center ? `${e.center.lon},${e.center.lat}` : `${e.lon},${e.lat}`}`);
    }
  } catch (err) { console.log('overpass', err.message); }
}
