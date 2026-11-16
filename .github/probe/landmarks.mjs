// Temporary: which way the Statue of Liberty's pedestal and the Batu Caves steps run.
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const tileOf = (lng, lat, z) => [Math.floor(((lng + 180) / 360) * 2 ** z), Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z)];
const bearing = (a, b) => {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return ((Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
};
const metres = (a, b) => Math.hypot((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) * 111320;

async function tile(lng, lat) {
  const [x, y] = tileOf(lng, lat, 14);
  const res = await fetch(`https://tiles.openfreemap.org/planet/latest/14/${x}/${y}.pbf`);
  return { t: new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer()))), x, y };
}

{
  const at = [-74.04455, 40.68925];
  const { t, x, y } = await tile(...at);
  const L = t.layers.building;
  console.log('== liberty');
  for (let i = 0; i < L.length; i++) {
    const f = L.feature(i);
    if (![2296511452, 2296511462, 2296511442, 2296511432, 2296511472, 329654122].includes(f.id)) continue;
    const g = f.toGeoJSON(x, y, 14).geometry;
    const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat(1);
    for (const ring of rings) {
      const edges = [];
      for (let j = 1; j < ring.length; j++) {
        const m = metres(ring[j - 1], ring[j]);
        if (m > 2) edges.push(`${bearing(ring[j - 1], ring[j]).toFixed(1)}°/${m.toFixed(1)}m`);
      }
      const c = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);
      console.log(`building ${f.id} ${JSON.stringify(f.properties)} centre ${c[0].toFixed(6)},${c[1].toFixed(6)} n=${ring.length} edges ${edges.join(' ')}`);
    }
  }
}
{
  const at = [101.68398, 3.23748];
  const { t, x, y } = await tile(...at);
  console.log('== batu');
  for (const name of ['transportation', 'poi', 'building', 'transportation_name']) {
    const L = t.layers[name];
    if (!L) continue;
    for (let i = 0; i < L.length; i++) {
      const f = L.feature(i);
      const g = f.toGeoJSON(x, y, 14).geometry;
      const lines = g.type === 'Point' ? [[g.coordinates]] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates : g.coordinates.flat(1);
      for (const line of lines) {
        if (!line.some((p) => metres(p, at) < 160)) continue;
        const a = line[0], b = line[line.length - 1];
        console.log(`${name} ${f.id} ${g.type} ${JSON.stringify(f.properties)} from ${a[0].toFixed(6)},${a[1].toFixed(6)} to ${b[0].toFixed(6)},${b[1].toFixed(6)} bearing ${bearing(a, b).toFixed(0)} len ${metres(a, b).toFixed(0)} near ${Math.min(...line.map((p) => metres(p, at))).toFixed(0)}m`);
      }
    }
  }
}
