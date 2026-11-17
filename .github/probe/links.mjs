// Temporary: the server's far-away copies following a share link for real.
const SERVER = 'https://pintu.ashraviinrajthinagaraj.workers.dev';
const LINK = 'https://maps.app.goo.gl/Q8nywjAZGExicjdr7?g_st=ac';
for (const from of ['', 'wnam', 'weur', 'wnam']) {
  const t0 = Date.now();
  const res = await fetch(`${SERVER}/link?check=${encodeURIComponent(LINK)}${from ? `&from=${from}` : ''}`);
  console.log('== from', from || 'here', res.status, `${Date.now() - t0} ms`, (await res.text()).replace(/\n/g, ' | ').slice(0, 400));
}
const res = await fetch(SERVER);
console.log('== version', await res.text());
