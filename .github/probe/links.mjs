// Temporary: the full address a share link leads to, from here.
for (const link of ['https://maps.app.goo.gl/Q8nywjAZGExicjdr7?g_st=ac', 'https://maps.app.goo.gl/GqVdG8He3DA1De4w6', 'https://maps.app.goo.gl/XvXukVhZNT7tQHY29']) {
  const res = await fetch(link, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (compatible; PintuHelper/1.0)' } });
  console.log('== link', link, res.status, res.headers.get('location'));
}
