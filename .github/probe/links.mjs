// Temporary: what Pintu's server makes of Google Maps share links, asked from
// here (America) and, through check-host.net, from servers in Asia.
const SERVER = 'https://pintu.ashraviinrajthinagaraj.workers.dev';
const LINKS = [
  'https://maps.app.goo.gl/Q8nywjAZGExicjdr7?g_st=ac',
  'https://maps.app.goo.gl/GqVdG8He3DA1De4w6',
];
const check = (link) => `${SERVER}/link?check=${encodeURIComponent(link)}`;
for (const link of LINKS) {
  const res = await fetch(check(link));
  console.log('== here', res.status, (await res.text()).replace(/\n/g, ' | ').slice(0, 600));
}
const nodes = await (await fetch('https://check-host.net/nodes/hosts', { headers: { accept: 'application/json' } })).json();
const asia = Object.entries(nodes.nodes).filter(([, n]) => ['SG', 'MY', 'ID', 'TH', 'HK', 'JP', 'IN', 'VN', 'TW', 'KR'].includes(String(n.location?.[0]).toUpperCase())).map(([id, n]) => [id, n.location.join(' ')]);
console.log('asia nodes', JSON.stringify(asia), JSON.stringify(Object.values(nodes.nodes)[0]));
for (const link of LINKS) {
  const q = new URLSearchParams({ host: check(link) });
  for (const [id] of asia) q.append('node', id);
  const job = await (await fetch(`https://check-host.net/check-http?${q}`, { headers: { accept: 'application/json' } })).json();
  await new Promise((r) => setTimeout(r, 25000));
  const result = await (await fetch(`https://check-host.net/check-result/${job.request_id}`, { headers: { accept: 'application/json' } })).json();
  for (const [id, r] of Object.entries(result)) console.log('== asia', link.slice(22, 40), id, JSON.stringify(r));
}
