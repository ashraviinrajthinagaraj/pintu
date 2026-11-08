// TomTom's traffic drawn on the map: each road coloured by how its speed
// compares with normal, and markers for accidents, floods, breakdowns, road
// works and closures. Both come as map tiles through Pintu's server.

// How far below its usual speed a road has to be for each colour.
export const FLOW_COLOURS = [
  [0.25, '#8E1B1B'],   // nearly stopped
  [0.5, '#E0362C'],    // slow
  [0.75, '#F28C1B'],   // slower than usual
  [Infinity, '#3BA55C'],
];
// While driving only the slow parts are drawn, so the route stays easy to see.
export const DRIVING_BELOW = 0.75;

// The incidents worth a marker, and how each looks. TomTom's numbers.
export const INCIDENTS = {
  1: { name: 'accident', fill: '#D32F2F', glyph: 'car' },
  3: { name: 'danger', fill: '#F2A51A', glyph: 'warn', ink: '#1E1E1E' },
  7: { name: 'lane', fill: '#E8590C', glyph: 'lane' },
  8: { name: 'closed', fill: '#C62828', glyph: 'bar' },
  9: { name: 'works', fill: '#E8590C', glyph: 'cone' },
  11: { name: 'flood', fill: '#1E6FD9', glyph: 'waves' },
  14: { name: 'breakdown', fill: '#F2A51A', glyph: 'car', ink: '#1E1E1E' },
};

const GLYPHS = {
  car: ['M5.5 15.5v-3.2l2-4.8h9l2 4.8v3.2', 'M5.5 15.5v2.8h2.6v-1.6h7.8v1.6h2.6v-2.8Z', 'M8.3 12.4h.2M15.5 12.4h.2'],
  warn: ['M12 4.5 20.5 19h-17Z', 'M12 10v4', 'M12 16.6v.3'],
  lane: ['M7 19V5', 'M17 19v-5l-4.5-4.5V5'],
  bar: ['M6.5 12h11'],
  cone: ['M10.2 5h3.6l4 13H6.2Z', 'M8.2 12.8h7.6', 'M4.5 18.5h15'],
  waves: ['M3.5 9c2.8-2 5.7 2 8.5 0s5.7-2 8.5 0', 'M3.5 13.5c2.8-2 5.7 2 8.5 0s5.7-2 8.5 0', 'M3.5 18c2.8-2 5.7 2 8.5 0s5.7-2 8.5 0'],
};

export const incidentImageId = (code) => `pintu-incident-${code}`;

// A round marker with a white rim and a simple symbol, drawn once per kind.
export function drawIncident(code, ratio = 2) {
  const look = INCIDENTS[code];
  const size = 30 * ratio;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof Path2D === 'undefined') return null;
  ctx.scale(ratio, ratio);
  ctx.beginPath();
  ctx.arc(15, 15, 13, 0, Math.PI * 2);
  ctx.fillStyle = look.fill;
  ctx.fill();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.translate(3, 3);
  ctx.strokeStyle = look.ink || '#fff';
  ctx.lineWidth = look.glyph === 'bar' ? 3.4 : 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const d of GLYPHS[look.glyph]) ctx.stroke(new Path2D(d));
  return { width: size, height: size, data: ctx.getImageData(0, 0, size, size).data, pixelRatio: ratio };
}

export function flowPaint() {
  const level = ['to-number', ['get', 'traffic_level'], 1];
  const colour = ['step', level];
  colour.push(FLOW_COLOURS[0][1]);
  for (let i = 1; i < FLOW_COLOURS.length; i++) colour.push(FLOW_COLOURS[i - 1][0], FLOW_COLOURS[i][1]);
  // Where each side of a road has its own speed, draw it on the side cars
  // drive on: the left, in Malaysia.
  const side = (n) => ['case', ['==', ['get', 'traffic_road_coverage'], 'one_side'], ['case', ['has', 'left_hand_traffic'], -n, n], 0];
  return {
    'line-color': ['case', ['has', 'road_closure'], '#5B1212', colour],
    'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.4, 13, 3, 16, 5, 18, 8],
    'line-offset': ['interpolate', ['linear'], ['zoom'], 9, side(1), 13, side(2.2), 16, side(4), 18, side(6.5)],
    'line-opacity': 0.9,
  };
}

export function flowFilter(driving) {
  return driving
    ? ['any', ['has', 'road_closure'], ['<', ['to-number', ['get', 'traffic_level'], 1], DRIVING_BELOW]]
    : ['all'];
}

export const incidentFilter = ['in', ['to-number', ['get', 'icon_category'], 0], ['literal', Object.keys(INCIDENTS).map(Number)]];
