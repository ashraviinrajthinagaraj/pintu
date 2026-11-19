// Temporary: animal crossings and ferries that OpenStreetMap has in Malaysia.
const Q = `[out:json][timeout:180];area["ISO3166-1"="MY"][admin_level=2]->.my;
(nwr["hazard"~"animal|wildlife|deer|elephant"](area.my);
 nwr["traffic_sign"~"animal|elephant|tapir|deer|wildlife",i](area.my);
 nwr["animal_crossing"](area.my);
 node["crossing"="animal"](area.my););
out center tags;`;
const F = `[out:json][timeout:180];area["ISO3166-1"="MY"][admin_level=2]->.my;
(way["route"="ferry"](area.my);relation["route"="ferry"](area.my););
out tags center;`;
for (const [name, q] of [['animals', Q], ['ferries', F]]) {
  for (const server of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    try {
      const res = await fetch(server, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'user-agent': 'Pintu probe (github.com/ashraviinrajthinagaraj/pintu)' } });
      const j = await res.json();
      console.log('==', name, j.elements.length);
      for (const el of j.elements.slice(0, 80)) {
        const c = el.center || el;
        const t = el.tags || {};
        console.log('==', name, el.type, el.id, (c.lat ?? 0).toFixed(4), (c.lon ?? 0).toFixed(4), JSON.stringify(Object.fromEntries(Object.entries(t).filter(([k]) => /hazard|animal|traffic_sign|crossing|name|ref|operator|duration|interval|opening|motor_vehicle|motorcar|foot|highway/.test(k)))).slice(0, 260));
      }
      break;
    } catch (e) { console.log('== fail', name, server, e.message); }
  }
}
