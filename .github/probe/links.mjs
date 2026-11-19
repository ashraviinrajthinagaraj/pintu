// Temporary: what Malaysia's open transport data has, and whether a page may read it.
import { writeFile } from 'node:fs/promises';
const H = { origin: 'https://ashraviinrajthinagaraj.github.io' };
for (const [name, url] of [
  ['rail', 'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl'],
  ['ktmb', 'https://api.data.gov.my/gtfs-static/ktmb'],
  ['bus', 'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kl'],
]) {
  const res = await fetch(url, { headers: H });
  const buf = Buffer.from(await res.arrayBuffer());
  console.log('== static', name, res.status, buf.length, res.headers.get('access-control-allow-origin'), res.headers.get('content-type'));
  await writeFile(`${name}.zip`, buf);
  await new Promise((r) => setTimeout(r, 16000));
}
for (const [name, url] of [
  ['rt-bus', 'https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl'],
  ['rt-feeder', 'https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder'],
  ['rt-ktmb', 'https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb'],
]) {
  const res = await fetch(url, { headers: H });
  const buf = Buffer.from(await res.arrayBuffer());
  console.log('== live', name, res.status, buf.length, res.headers.get('access-control-allow-origin'), res.headers.get('content-type'), res.headers.get('cache-control'), JSON.stringify([...res.headers].filter(([k]) => /rate|limit|retry/i.test(k))));
  await writeFile(`${name}.pb`, buf);
  await new Promise((r) => setTimeout(r, 16000));
}
