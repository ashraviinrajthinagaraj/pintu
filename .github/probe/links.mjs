// Temporary: what the server, and Google, say about a Google Maps share link.
const SERVER = 'https://pintu.ashraviinrajthinagaraj.workers.dev';
const LINKS = [
  'https://maps.app.goo.gl/Q8nywjAZGExicjdr7?g_st=ac',
  'https://maps.app.goo.gl/GqVdG8He3DA1De4w6',
];
const short = (s, n = 260) => String(s).slice(0, n);
for (const link of LINKS) {
  console.log('== server', link);
  try {
    const res = await fetch(`${SERVER}/link?u=${encodeURIComponent(link)}`, { headers: { origin: 'https://ashraviinrajthinagaraj.github.io' } });
    console.log('status', res.status, short(await res.text(), 700));
  } catch (e) { console.log('error', e.message); }
}
for (const ua of ['Mozilla/5.0 (compatible; PintuHelper/1.0)', 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36']) {
  let url = LINKS[0];
  console.log('== hops with', ua);
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': ua, accept: 'text/html' } });
    const next = res.headers.get('location');
    console.log('hop', hop, res.status, short(url, 200), '->', short(next || '', 400));
    if (!(res.status >= 300 && res.status < 400 && next)) {
      const body = await res.text();
      console.log('body', body.length, short(body.replace(/\s+/g, ' '), 600));
      const m = body.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)|center=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)|@(-?\d+\.\d+),(-?\d+\.\d+)/);
      console.log('spot in page', m?.[0]);
      break;
    }
    url = new URL(next, url).href;
  }
}
