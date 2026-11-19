import test from 'node:test';
import assert from 'node:assert/strict';
import { CROSSINGS, crossingOf, fetchCameras, throughFor } from '../js/crossings.js';
import { cumulative } from '../js/geo.js';

const route = (coords) => ({ coords, cum: cumulative(coords) });
const JB = [103.7637, 1.4627], SG = [103.8198, 1.3521];
const causeway = CROSSINGS.find((c) => c.id === 'causeway');
const link = CROSSINGS.find((c) => c.id === 'second-link');
const at = (c) => [c.bridge.lng, c.bridge.lat];

test('which crossing a trip goes over, and which way', () => {
  const into = crossingOf(route([JB, [103.768, 1.456], at(causeway), [103.7716, 1.447], SG]));
  assert.equal(into.crossing.id, 'causeway');
  assert.equal(into.intoSg, true);
  assert.ok(into.at > 0);
  const out = crossingOf(route([SG, [103.635, 1.3487], at(link), [103.605, 1.365], JB]));
  assert.equal(out.crossing.id, 'second-link');
  assert.equal(out.intoSg, false);
  assert.equal(crossingOf(route([[101.70, 3.15], [101.72, 3.16]])), null, 'a trip in KL crosses nothing');
  assert.equal(crossingOf(null), null);
});

test('the point to pass faces the way the trip goes', () => {
  assert.deepEqual(throughFor(link, true), { lat: 1.355772, lng: 103.626322, heading: 130 });
  assert.equal(throughFor(link, false).heading, 310);
  assert.equal(throughFor(causeway, false).heading, 337);
});

test('camera photos: only images from data.gov.sg, by camera', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ items: [{ cameras: [
    { camera_id: '2701', timestamp: '2026-11-20T09:15:00+08:00', image: 'https://images.data.gov.sg/api/traffic-images/2026/11/a.jpg', location: { latitude: 1.447, longitude: 103.77 } },
    { camera_id: '666', image: 'https://evil.example/x.jpg', location: {} },
    { camera_id: '4703', image: 'javascript:alert(1)' },
  ] }] }), { status: 200 });
  const cams = await fetchCameras({ fetchImpl });
  assert.deepEqual([...cams.keys()], ['2701']);
  assert.equal(cams.get('2701').at, Date.parse('2026-11-20T01:15:00Z'));
  await assert.rejects(fetchCameras({ fetchImpl: async () => new Response('', { status: 429 }) }));
});
