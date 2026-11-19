// Temporary: Singapore's traffic camera list, near the two crossings into Johor.
const near = (c) => (c.location.latitude > 1.43 && c.location.longitude > 103.75 && c.location.longitude < 103.80) || (c.location.longitude < 103.66 && c.location.latitude > 1.32);
for (const url of ['https://api.data.gov.sg/v1/transport/traffic-images', 'https://api-open.data.gov.sg/v2/real-time/api/traffic-images']) {
  const t0 = Date.now();
  const res = await fetch(url);
  const text = await res.text();
  console.log('==', url, res.status, `${Date.now() - t0} ms`, text.length, JSON.stringify(Object.fromEntries([...res.headers].filter(([k]) => /cache|age|ratelimit|access-control|content-type/i.test(k)))));
  try {
    const j = JSON.parse(text);
    const items = j.items || j.data?.items;
    const cams = items?.[0]?.cameras || [];
    console.log('== count', cams.length, 'timestamp', items?.[0]?.timestamp);
    for (const c of cams.filter(near)) console.log('== cam', c.camera_id, c.location.latitude, c.location.longitude, c.timestamp, c.image, JSON.stringify(c.image_metadata));
    const one = cams.find((c) => c.camera_id === '2701') || cams[0];
    if (one) {
      const img = await fetch(one.image);
      console.log('== image', img.status, img.headers.get('content-type'), img.headers.get('content-length'), img.headers.get('access-control-allow-origin'), img.headers.get('cache-control'));
    }
  } catch (e) { console.log('== body', text.slice(0, 300)); }
}
