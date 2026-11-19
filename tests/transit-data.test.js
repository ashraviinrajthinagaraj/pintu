import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { boxOf, colourOf, csv, feedOf, FEEDS, ktmStations, nameCase, railLines, simplify, unzip } from '../scripts/transit-data.mjs';

// A small zip, as the data portal sends them: some files deflated, some not,
// and the Mac's shadow copies alongside.
function makeZip(files) {
  const locals = [], dir = [];
  let offset = 0;
  for (const [name, text, deflate] of files) {
    const raw = Buffer.from(text);
    const body = deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    dir.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const dirBuf = Buffer.concat(dir);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dirBuf, end]);
}

test('the files come out of a zip, deflated or not, without the Mac copies', () => {
  const zip = makeZip([
    ['routes.txt', 'route_id\nAG\n', true],
    ['__MACOSX/._routes.txt', 'junk', false],
    ['feed/stops.txt', 'stop_id\nA1\n', false],
    ['shapes.txt', 'x\n'.repeat(500), true],
  ]);
  const all = unzip(zip);
  assert.deepEqual(Object.keys(all).sort(), ['routes.txt', 'shapes.txt', 'stops.txt']);
  assert.equal(all['routes.txt'], 'route_id\nAG\n');
  assert.equal(all['stops.txt'], 'stop_id\nA1\n');
  assert.deepEqual(Object.keys(unzip(zip, ['stops.txt'])), ['stops.txt']);
  assert.throws(() => unzip(Buffer.from('not a zip at all, honestly')), /not a zip/);
});

test('rows of a timetable file, quotes, commas and Windows line ends and all', () => {
  const rows = csv('﻿route_id,route_long_name,route_color\r\nU3000,"Terminal Maluri ~ Lebuh Ampang",006CFF\r\nU4020,"Wangsa Maju, Setapak",\r\n');
  assert.deepEqual(rows, [
    { route_id: 'U3000', route_long_name: 'Terminal Maluri ~ Lebuh Ampang', route_color: '006CFF' },
    { route_id: 'U4020', route_long_name: 'Wangsa Maju, Setapak', route_color: '' },
  ]);
  assert.deepEqual(csv('a,b\n1,"say ""hi"""'), [{ a: '1', b: 'say "hi"' }]);
  assert.deepEqual(csv(''), []);
});

test('names in capitals read normally, keeping the short forms people know', () => {
  assert.equal(nameCase('TAMAN BAHAGIA'), 'Taman Bahagia');
  assert.equal(nameCase('KL SENTRAL'), 'KL Sentral');
  assert.equal(nameCase('SS 15'), 'SS 15');
  assert.equal(nameCase('USJ 21'), 'USJ 21');
  assert.equal(nameCase('SUNWAY LINE'), 'Sunway Line');
  assert.equal(nameCase('T105'), 'T105');
  assert.equal(nameCase('KLIA2'), 'KLIA2');
  assert.equal(nameCase("JALAN TUN SAMBANTHAN"), 'Jalan Tun Sambanthan');
  // Already written properly: left alone.
  assert.equal(nameCase('Terminal Maluri ~ Lebuh Ampang'), 'Terminal Maluri ~ Lebuh Ampang');
  assert.equal(nameCase('  BANDAR   UTAMA '), 'Bandar Utama');
});

test('a route keeps its colour unless it is missing or too pale for the map', () => {
  assert.equal(colourOf('e57200', '#000'), '#E57200');
  assert.equal(colourOf('FFFFFF', '#1565C0'), '#1565C0');
  assert.equal(colourOf('F2F2F2', '#1565C0'), '#1565C0');
  assert.equal(colourOf('', '#1565C0'), '#1565C0');
  assert.equal(colourOf('blue', '#1565C0'), '#1565C0');
});

test('the area a feed covers comes from its stops, ignoring ones in the sea', () => {
  const box = boxOf([
    { stop_lat: '3.10', stop_lon: '101.60' },
    { stop_lat: '3.30', stop_lon: '101.80' },
    { stop_lat: '0', stop_lon: '0' },
    { stop_lat: '', stop_lon: '' },
  ]);
  assert.deepEqual(box, [101.55, 3.05, 101.85, 3.35]);
  assert.equal(boxOf([{ stop_lat: '0', stop_lon: '0' }]), null);
});

test('a line is kept to the points that shape it', () => {
  const straight = Array.from({ length: 50 }, (_, i) => [101.6 + i * 0.001, 3.1]);
  assert.equal(simplify(straight).length, 2);
  const bent = [...straight, [101.649, 3.12]];
  assert.equal(simplify(bent).length, 3);
});

const RAIL = {
  'routes.txt': 'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_color,route_text_color,category,status\n'
    + 'AG,rapidrail,AGL,Ampang Line,Ampang ~ Sentul Timur,1,e57200,FFFFFF,LRT,valid\n'
    + 'KJ,rapidrail,KJL,Kelana Jaya Line,Gombak ~ Putra Heights,1,D50032,FFFFFF,LRT,valid\n'
    + 'XX,rapidrail,XXL,Old Line,,1,000000,FFFFFF,LRT,invalid\n',
  'trips.txt': 'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\n'
    + 'AG,MonFri,AGL_MonFri_1,back,1,shp_AG_1\nAG,MonFri,AGL_MonFri_0,there,0,shp_AG_0\nKJ,MonFri,KJ_0,there,0,shp_KJ_0\n',
  'shapes.txt': 'shape_id,shape_pt_lon,shape_pt_lat,shape_pt_sequence\n'
    + 'shp_AG_0,101.70,3.15,2\nshp_AG_0,101.76,3.15,1\nshp_AG_0,101.69,3.20,3\n'
    + 'shp_AG_1,101.69,3.20,1\nshp_AG_1,101.76,3.15,2\n'
    + 'shp_KJ_0,101.60,3.10,1\nshp_KJ_0,101.70,3.15,2\n',
  'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon,category,route_id,geometry,isOKU,status,search\n'
    + 'AG18,AMPANG,3.150318,101.760049,LRT,AG,[object Object],true,valid,LRT AMPANG\n'
    + 'KJ15,KL SENTRAL,3.13442,101.68625,LRT,KJ,[object Object],true,valid,LRT KL SENTRAL\n'
    + 'XX1,GONE,3.1,101.6,LRT,XX,[object Object],true,invalid,\n',
};

test('the LRT lines, one way along each in its colour, and their stations', () => {
  const { lines, stations } = railLines(RAIL);
  assert.deepEqual(lines.map((l) => [l.id, l.name, l.kind, l.colour]), [
    ['AG', 'Ampang Line', 'LRT', '#E57200'],
    ['KJ', 'Kelana Jaya Line', 'LRT', '#D50032'],
  ]);
  // In the order of the points, not of the file.
  assert.deepEqual(lines[0].line, [[101.76, 3.15], [101.7, 3.15], [101.69, 3.2]]);
  assert.deepEqual(stations, [
    ['Ampang', 3.15032, 101.76005, '#E57200'],
    ['KL Sentral', 3.13442, 101.68625, '#D50032'],
  ]);
});

const KTM = {
  'routes.txt': 'agency_id,route_id,route_type,route_short_name,route_long_name,route_desc,route_url,route_color,route_text_color\n'
    + 'ktmb,KC05_KB18,0,Seremban Line,KTM Batu Caves - Pulau Sebang/Tampin,,,3C5A9F,FFFFFF\n'
    + 'ktmb,KA15_KD19,0,Port Klang Line,KTM Tanjung Malim - Pelabuhan Klang,,,DC2420,FFFFFF\n'
    + 'ktmb,ETS,2,ETS,ETS,,,,\n',
  'trips.txt': 'route_id,service_id,trip_id,direction_id\nKC05_KB18,wk,2001,0\nKC05_KB18,wk,2003,0\nKA15_KD19,wk,1101,0\nETS,ets,1004,0\n',
  'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n'
    + '2001,06:00:00,06:00:00,50600,1\n2003,06:30:00,06:30:00,50600,1\n1101,06:10:00,06:10:00,50600,1\n'
    + '1101,06:20:00,06:20:00,19100,2\n1004,07:00:00,07:00:00,19100,3\n1004,09:00:00,09:00:00,80000,4\n',
  'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\n50600,BATU CAVES,3.237796,101.681215\n19100,KL SENTRAL,3.1343,101.6865\n80000,IPOH,4.5975,101.0732\n',
};

test("KTM's stations, in the colour of the line most of their trains are on", () => {
  assert.deepEqual(ktmStations(KTM), [
    ['Batu Caves', 3.2378, 101.68122, '#3C5A9F'],
    ['KL Sentral', 3.1343, 101.6865, '#DC2420'],
    // Only ETS trains stop here, and they have no colour of their own.
    ['Ipoh', 4.5975, 101.0732, '#3C5A9F'],
  ]);
});

test('each live feed gets its area and its routes, with names and colours', () => {
  const bus = feedOf(FEEDS.find((f) => f.id === 'rapid-bus-kl'), {
    'routes.txt': 'route_id,agency_id,route_short_name,route_long_name,route_type,route_color,route_text_color\n'
      + 'B1000,rapidkl,SUNWAY LINE,BRT USJ 7 - BRT Setia Jaya,3,21618C,FFFFFF\n'
      + 'U3000,rapidkl,300,Terminal Maluri ~ Lebuh Ampang,3,006CFF,FFFFFF\n'
      + 'U9990,rapidkl,,KOTA DAMANSARA - BANDAR UTAMA,3,FFFFFF,000000\n',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\n1,A,3.0,101.5\n2,B,3.3,101.8\n',
  });
  assert.equal(bus.url, 'https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl');
  assert.equal(bus.kind, 'bus');
  assert.equal(bus.name, 'Rapid KL');
  assert.deepEqual(bus.box, [101.45, 2.95, 101.85, 3.35]);
  assert.deepEqual(bus.routes, {
    B1000: ['Sunway Line', 'BRT USJ 7 - BRT Setia Jaya', '#21618C'],
    U3000: ['300', 'Terminal Maluri ~ Lebuh Ampang', '#006CFF'],
    U9990: ['Kota Damansara - Bandar Utama', '', '#1565C0'],
  });
  assert.equal(bus.trips, undefined);

  const ktm = feedOf(FEEDS.find((f) => f.id === 'ktmb'), KTM);
  assert.equal(ktm.url, 'https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb');
  assert.equal(ktm.kind, 'train');
  assert.deepEqual(ktm.routes.ETS, ['ETS', 'ETS', '#3C5A9F']);
  assert.deepEqual(ktm.trips, { 2001: 'KC05_KB18', 2003: 'KC05_KB18', 1101: 'KA15_KD19', 1004: 'ETS' });
});

test('every feed the data portal lists, each with its own live address', () => {
  assert.equal(FEEDS.length, 14);
  assert.equal(new Set(FEEDS.map((f) => f.id)).size, FEEDS.length);
  for (const f of FEEDS) assert.ok(['bus', 'train'].includes(f.kind) && f.name && f.path, f.id);
});
