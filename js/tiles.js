// Reads places straight out of the map's own tiles. The phone already reaches
// this server to draw the map, so it's the one source of places that works
// whenever the map does. Vector tiles are small protocol buffers, and only a
// little of the format is needed to get points and names out of them.
import { pointAt } from './motion.js';

// The deepest level the map server has, and the only one with every place on it.
export const TILE_Z = 14;
const SAMPLE_M = 500;
const MAX_TILES = 200;

const decoder = new TextDecoder();

class Pb {
  constructor(bytes, start = 0, end = bytes.length) {
    this.b = bytes;
    this.i = start;
    this.end = end;
  }

  get more() { return this.i < this.end; }

  varint() {
    let out = 0, mul = 1, byte;
    do {
      byte = this.b[this.i++];
      out += (byte & 0x7f) * mul;
      mul *= 128;
    } while (byte >= 0x80 && this.i < this.end);
    return out;
  }

  // A run of bytes with its length in front, as a reader of its own.
  sub() {
    const n = this.varint();
    const r = new Pb(this.b, this.i, this.i + n);
    this.i += n;
    return r;
  }

  text() {
    const n = this.varint();
    const s = decoder.decode(this.b.subarray(this.i, this.i + n));
    this.i += n;
    return s;
  }

  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.i += 8;
    else if (wire === 2) this.i += this.varint();
    else if (wire === 5) this.i += 4;
    else throw new Error('not a tile');
  }
}

const zigzag = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);

// Only text matters here. Numbers keep their place in the list, as null.
function readValue(pb) {
  let value = null;
  while (pb.more) {
    const tag = pb.varint();
    if (tag >> 3 === 1) value = pb.text();
    else pb.skip(tag & 7);
  }
  return value;
}

function readFeature(pb, keys, values) {
  const props = {};
  let id = null, x = null, y = null;
  while (pb.more) {
    const tag = pb.varint();
    const field = tag >> 3;
    if (field === 1) id = pb.varint();
    else if (field === 2) {
      const tags = pb.sub();
      while (tags.more) {
        const k = tags.varint();
        const v = tags.varint();
        props[keys[k]] = values[v];
      }
    } else if (field === 4) {
      const geom = pb.sub();
      // The first move gives the point, or the first corner of anything bigger.
      if ((geom.varint() & 7) === 1) {
        x = zigzag(geom.varint());
        y = zigzag(geom.varint());
      }
    } else pb.skip(tag & 7);
  }
  return { id, props, x, y };
}

function readLayer(pb, wanted) {
  let name = null, extent = 4096;
  const keys = [], values = [], raw = [];
  while (pb.more) {
    const tag = pb.varint();
    const field = tag >> 3;
    if (field === 1) {
      name = pb.text();
      if (name !== wanted) return null;
    } else if (field === 2) raw.push(pb.sub());
    else if (field === 3) keys.push(pb.text());
    else if (field === 4) values.push(readValue(pb.sub()));
    else if (field === 5) extent = pb.varint();
    else pb.skip(tag & 7);
  }
  if (name !== wanted) return null;
  // Features can come before the words they refer to, so they're read last.
  return { extent, features: raw.map((f) => readFeature(f, keys, values)) };
}

export function tileToLngLat(x, y, z = TILE_Z) {
  const n = 2 ** z;
  return [(x / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI];
}

export function lngLatToTile(lng, lat, z = TILE_Z) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lng + 180) / 360) * n, ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n];
}

// Every place in a tile, wherever it is on the Earth.
export function readPlaces(buffer, tile, layerName = 'poi') {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const pb = new Pb(bytes);
  while (pb.more) {
    const tag = pb.varint();
    if (tag >> 3 !== 3) { pb.skip(tag & 7); continue; }
    const layer = readLayer(pb.sub(), layerName);
    if (!layer) continue;
    const out = [];
    for (const f of layer.features) {
      if (f.x == null) continue;
      const [lng, lat] = tileToLngLat(tile.x + f.x / layer.extent, tile.y + f.y / layer.extent, tile.z);
      const p = f.props;
      out.push({
        id: `t${f.id ?? `${tile.x}/${tile.y}/${f.x}/${f.y}`}`,
        lng,
        lat,
        name: p.name || p['name:latin'] || p.name_en || p['name:en'] || '',
        class: p.class || '',
        subclass: p.subclass || '',
      });
    }
    return out;
  }
  return [];
}

// The tiles a stretch of route runs through, the nearest first.
export function tilesAlongRoute(route, fromS, toS, radius, { z = TILE_Z, max = MAX_TILES } = {}) {
  const seen = new Set();
  const out = [];
  const add = (s) => {
    const [lng, lat] = pointAt(route, s);
    const dLat = radius / 110540;
    const dLng = radius / (111320 * Math.cos((lat * Math.PI) / 180));
    const [x0, y0] = lngLatToTile(lng - dLng, lat + dLat, z);
    const [x1, y1] = lngLatToTile(lng + dLng, lat - dLat, z);
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
      for (let y = Math.floor(y0); y <= Math.floor(y1); y++) {
        const key = `${x}/${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ z, x, y });
      }
    }
  };
  for (let s = fromS; s < toS && out.length < max; s += SAMPLE_M) add(s);
  if (out.length < max) add(toS);
  return out.slice(0, max);
}

export const tileAddress = (template, { z, x, y }) => template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
