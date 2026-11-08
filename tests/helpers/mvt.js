// Writes vector tiles by the published format, so tests can feed the app real
// tile bytes. The real map library reads these too, in the real-map test, which
// is the check that this writer and Pintu's reader both follow the format.
import { lngLatToTile } from '../../js/tiles.js';

const varint = (n) => {
  const out = [];
  while (n >= 128) { out.push((n % 128) | 128); n = Math.floor(n / 128); }
  out.push(n);
  return out;
};
const tag = (field, wire) => varint(field * 8 + wire);
const bytes = (field, data) => [...tag(field, 2), ...varint(data.length), ...data];
const text = (field, s) => bytes(field, [...new TextEncoder().encode(s)]);
const zigzag = (n) => (n < 0 ? -n * 2 - 1 : n * 2);

// A whole number, a fraction, true or false, or text.
function valueBytes(v) {
  if (typeof v === 'boolean') return [...tag(7, 0), ...varint(v ? 1 : 0)];
  if (typeof v === 'number' && !Number.isInteger(v)) {
    const b = new Uint8Array(new Float64Array([v]).buffer);
    return [...tag(3, 1), ...b];
  }
  if (typeof v === 'number') return [...tag(5, 0), ...varint(v)];
  return text(1, v);
}

// layers: { poi: [{ id, lng, lat, props: { name, class, subclass, rank } }] }
// A feature with `line: [[lng, lat], …]` is a line instead of a point.
export function encodeTile(tile, layers) {
  const out = [];
  for (const [name, features] of Object.entries(layers)) {
    const keys = [], values = [];
    const index = (list, v) => {
      let i = list.indexOf(v);
      if (i < 0) { i = list.length; list.push(v); }
      return i;
    };
    const encoded = features.map((f) => {
      const tags = [];
      for (const [k, v] of Object.entries(f.props)) tags.push(...varint(index(keys, k)), ...varint(index(values, v)));
      const at = (lng, lat) => {
        const [tx, ty] = lngLatToTile(lng, lat, tile.z);
        return [Math.round((tx - tile.x) * 4096), Math.round((ty - tile.y) * 4096)];
      };
      let geom, type = 1;
      if (f.line) {
        // A line: move to the first point, then draw to each of the rest.
        type = 2;
        const pts = f.line.map(([lng, lat]) => at(lng, lat));
        geom = [...varint(9), ...varint(zigzag(pts[0][0])), ...varint(zigzag(pts[0][1])), ...varint(2 | ((pts.length - 1) << 3))];
        for (let i = 1; i < pts.length; i++) geom.push(...varint(zigzag(pts[i][0] - pts[i - 1][0])), ...varint(zigzag(pts[i][1] - pts[i - 1][1])));
      } else {
        const [x, y] = at(f.lng, f.lat);
        geom = [...varint(9), ...varint(zigzag(x)), ...varint(zigzag(y))];
      }
      return bytes(2, [
        ...(f.id != null ? [...tag(1, 0), ...varint(f.id)] : []),
        ...bytes(2, tags),
        ...tag(3, 0), ...varint(type),
        ...bytes(4, geom),
      ]);
    });
    const layer = [
      ...text(1, name),
      ...encoded.flat(),
      ...keys.flatMap((k) => text(3, k)),
      ...values.flatMap((v) => bytes(4, valueBytes(v))),
      ...tag(5, 0), ...varint(4096),
      ...tag(15, 0), ...varint(2),
    ];
    out.push(...bytes(3, layer));
  }
  return Uint8Array.from(out);
}
