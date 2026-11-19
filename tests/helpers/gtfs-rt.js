// Live bus and train positions, written the way data.gov.my sends them
// (GTFS Realtime, a protocol buffer), for tests to read back.
const varint = (n) => {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
};
const key = (field, wire) => varint(field * 8 + wire);
const bytes = (field, data) => [...key(field, 2), ...varint(data.length), ...data];
const str = (field, s) => bytes(field, [...Buffer.from(s)]);
const num = (field, n) => [...key(field, 0), ...varint(n)];
const float = (field, f) => { const b = Buffer.alloc(4); b.writeFloatLE(f); return [...key(field, 5), ...b]; };
const double = (field, f) => { const b = Buffer.alloc(8); b.writeDoubleLE(f); return [...key(field, 1), ...b]; };

export function vehicle({ id = '0', trip = '', route = '', lat, lng, bearing = 0, at = null, vid = '', plate = '' }) {
  const tripDesc = [...(trip ? str(1, trip) : []), ...str(2, '00:28:09'), ...(route ? str(5, route) : [])];
  const pos = [...float(1, lat), ...float(2, lng), ...float(3, bearing), ...double(4, 12345.5), ...float(5, 13)];
  const desc = [...(vid ? str(1, vid) : []), ...(plate ? str(3, plate) : [])];
  const vp = [...bytes(1, tripDesc), ...bytes(2, pos), ...num(4, 2), ...(at ? num(5, at) : []), ...bytes(8, desc)];
  return [...str(1, id), ...bytes(4, vp)];
}
export function feed(entities, at = 1795108712) {
  const header = [...str(1, '2.0'), ...num(2, 0), ...num(3, at)];
  return Uint8Array.from([...bytes(1, header), ...entities.flatMap((e) => bytes(2, e))]);
}
