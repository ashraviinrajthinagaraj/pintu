// Builds data/along.json: every toll plaza booth, speed camera, R&R and lay-by
// in Malaysia that OpenStreetMap knows, small enough to keep with the app. The
// route screen then finds what's on each route at once, without asking a map
// server and waiting. Run by .github/workflows/along-data.yml each week.
//
//   node scripts/along-data.mjs [out-file]
//
// The data is © OpenStreetMap contributors, under the Open Database License.
import { readFile, writeFile } from 'node:fs/promises';

const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const QUERY = '[out:json][timeout:300];'
  + 'area["ISO3166-1"="MY"][admin_level=2]->.my;'
  + '(nwr["barrier"="toll_booth"](area.my);'
  + 'node["highway"="toll_gantry"](area.my);'
  + 'node["highway"="speed_camera"](area.my);'
  + 'nwr["highway"="services"](area.my);'
  + 'nwr["highway"="rest_area"](area.my););'
  + 'out center tags;';

// Fewer than this many means something went wrong, not that they were all removed.
export const AT_LEAST = { tolls: 300, cameras: 20, rests: 100 };

const round = (x) => Math.round(x * 1e5) / 1e5;
const short = (type) => ({ node: 'n', way: 'w', relation: 'r' }[type] || 'n');

// The server's answer as short lists: [id, lat, lng, ...], id like "n123".
export function compact(json, updated) {
  const tolls = [], cameras = [], rests = [];
  for (const el of json?.elements || []) {
    const tags = el.tags || {};
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const id = `${short(el.type)}${el.id}`;
    if (tags.barrier === 'toll_booth' || tags.highway === 'toll_gantry') {
      tolls.push([id, round(lat), round(lng), tags.name || '', tags.highway === 'toll_gantry' ? 1 : 0]);
    } else if (tags.highway === 'speed_camera') {
      const limit = parseInt(tags.maxspeed, 10);
      cameras.push([id, round(lat), round(lng), limit >= 5 && limit <= 130 ? limit : 0]);
    } else if (tags.highway === 'services' || tags.highway === 'rest_area') {
      rests.push([id, round(lat), round(lng), tags.highway === 'services' ? 'r' : 'l', tags.name || tags['name:ms'] || tags['name:en'] || '']);
    }
  }
  const byId = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return {
    source: '© OpenStreetMap contributors, ODbL',
    updated,
    tolls: tolls.sort(byId),
    cameras: cameras.sort(byId),
    rests: rests.sort(byId),
  };
}

// One item a line, so each week's change reads clearly in the history.
export function serialise(data) {
  const list = (rows) => (rows.length ? `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]` : '[]');
  return `{"source":${JSON.stringify(data.source)},"updated":${JSON.stringify(data.updated)},\n`
    + `"tolls":${list(data.tolls)},\n"cameras":${list(data.cameras)},\n"rests":${list(data.rests)}}\n`;
}

async function ask(server) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 330000);
  try {
    const res = await fetch(server, {
      method: 'POST',
      body: new URLSearchParams({ data: QUERY }),
      headers: { 'user-agent': 'Pintu along-data (https://github.com/ashraviinrajthinagaraj/pintu)' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const json = await res.json();
    if (json.remark && /error|timed out/i.test(json.remark)) throw new Error(json.remark);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function main(out = new URL('../data/along.json', import.meta.url)) {
  let json = null;
  for (const server of SERVERS) {
    const started = Date.now();
    try {
      json = await ask(server);
      console.log(`${new URL(server).host}: answered in ${Math.round((Date.now() - started) / 1000)} s`);
      break;
    } catch (err) {
      console.log(`${new URL(server).host}: ${err.message}`);
    }
  }
  if (!json) throw new Error('no server answered');
  const data = compact(json, new Date().toISOString().slice(0, 10));
  for (const [kind, min] of Object.entries(AT_LEAST)) {
    if (data[kind].length < min) throw new Error(`only ${data[kind].length} ${kind}: not saved`);
  }
  // Only the date changed: leave the file alone.
  try {
    const before = JSON.parse(await readFile(out, 'utf8'));
    if (serialise({ ...before, updated: data.updated }) === serialise(data)) {
      console.log('no change');
      return;
    }
  } catch { /* no file yet */ }
  const text = serialise(data);
  await writeFile(out, text);
  console.log(`tolls ${data.tolls.length}, cameras ${data.cameras.length}, rests ${data.rests.length}, ${text.length} bytes`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv[2]).catch((err) => { console.error(err.message); process.exit(1); });
}
