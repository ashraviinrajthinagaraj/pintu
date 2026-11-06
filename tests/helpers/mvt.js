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

// layers: { poi: [{ id, lng, lat, props: { name, class, subclass, rank } }] }
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
      const [tx, ty] = lngLatToTile(f.lng, f.lat, tile.z);
      const x = Math.round((tx - tile.x) * 4096), y = Math.round((ty - tile.y) * 4096);
      const geom = [...varint(9), ...varint(zigzag(x)), ...varint(zigzag(y))];
      return bytes(2, [
        ...(f.id != null ? [...tag(1, 0), ...varint(f.id)] : []),
        ...bytes(2, tags),
        ...tag(3, 0), ...varint(1),
        ...bytes(4, geom),
      ]);
    });
    const layer = [
      ...text(1, name),
      ...encoded.flat(),
      ...keys.flatMap((k) => text(3, k)),
      ...values.flatMap((v) => bytes(4, typeof v === 'number' ? [...tag(5, 0), ...varint(v)] : text(1, v))),
      ...tag(5, 0), ...varint(4096),
      ...tag(15, 0), ...varint(2),
    ];
    out.push(...bytes(3, layer));
  }
  return Uint8Array.from(out);
}
