// A side view of your vehicle for the route plan, in the body and colour you
// chose for the map. Plain shapes, drawn here, facing the way you're going.

const GROUND = 43;
let made = 0;

// Each body: its outline (wheel arches cut in), its windows, the pillars that
// split them, and where the wheels sit.
const BODIES = {
  hatchback: {
    body: 'M17 38L16.5 26Q17 21 20 19L27 15Q30 13.6 35 13.6L58 13.4Q62 13.4 65 15.5L75 22L98 24.5Q104 25.5 106 29.5L106.8 35Q106.8 38 104.5 38L97.5 38A9 9 0 0 0 79.5 38L41.5 38A9 9 0 0 0 23.5 38Z',
    glass: 'M25 22.6Q26 18.4 29 17L35 15.6L57 15.3Q60.5 15.3 63 17.2L70.5 22.6Z',
    pillars: [48], wheels: [32.5, 88.5], wheelY: 38, r: 7.3, lamp: [100, 27], tail: [17, 23],
  },
  sedan: {
    body: 'M8 37.5L8 29Q8 26 12 25.5L26 24L36 15Q38 13.6 42 13.6L62 13.6Q66 13.6 69 15.5L80 23L104 25Q110 26 111.5 31L112 35Q112 38 109.5 38L103 38A9.5 9.5 0 0 0 84 38L38 38A9.5 9.5 0 0 0 19 38Z',
    glass: 'M33 22.6L39 16.2Q40.5 15.4 43 15.4L61.5 15.4Q65 15.4 67.5 17.2L75 22.6Z',
    pillars: [53], wheels: [28.5, 93.5], wheelY: 38, r: 7.5, lamp: [106, 27.5], tail: [9, 27],
  },
  suv: {
    body: 'M9 37L8.5 21Q9 15 14 12.5L20 10Q22 9 27 9L66 9Q70 9 73 11.5L82 19.5L103 21.5Q109 22.5 110.5 27L111 34Q111 37 108.5 37L102.5 37A10.5 10.5 0 0 0 81.5 37L38.5 37A10.5 10.5 0 0 0 17.5 37Z',
    glass: 'M15 19.6Q15.5 14 19 12.5L25 11L65 11Q69 11 71.5 13L78.5 19.6Z',
    pillars: [33, 55], wheels: [28, 92], wheelY: 37, r: 8.5, lamp: [104, 24], tail: [9, 19],
  },
  mpv: {
    body: 'M9 37L8.5 18Q9 12 15 10.5L22 9.5L70 9.5Q74 9.5 77 12L90 21.5L104 23.5Q109 24.5 110.5 28.5L111 34Q111 37 108.5 37L102.5 37A10 10 0 0 0 82.5 37L37.5 37A10 10 0 0 0 17.5 37Z',
    glass: 'M14 21Q14.2 13.4 18.5 12.2L23 11.5L69 11.5Q73 11.5 76 14L85.2 21Z',
    pillars: [33, 56], wheels: [27.5, 92.5], wheelY: 37, r: 8, lamp: [105, 26], tail: [9, 17],
  },
  pickup: {
    body: 'M8 36L8 23L45 23L48 11Q49 9.5 52 9.5L70 9.5Q74 9.5 76.5 12L84 20L103 22Q109 23 110.5 27L111 33Q111 36 108.5 36L102.5 36A10.5 10.5 0 0 0 81.5 36L38.5 36A10.5 10.5 0 0 0 17.5 36Z',
    glass: 'M50 19.8L51.3 12.6Q52 11.4 54 11.4L69.5 11.4Q73 11.4 75 13.4L80.5 19.8Z',
    pillars: [63], wheels: [28, 92], wheelY: 36, r: 8.5, lamp: [104, 25], tail: [8.5, 25], bed: true,
  },
};

const wheel = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#121618"/><circle cx="${x}" cy="${y}" r="${r * 0.46}" fill="#8E989D"/><circle cx="${x}" cy="${y}" r="${r * 0.16}" fill="#3A4246"/>`;

// Light paint needs a darker edge to stand out; dark paint needs a lighter one.
function edgeFor(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(n)) return 'rgba(255,255,255,.25)';
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum < 0.35 ? 'rgba(255,255,255,.32)' : 'rgba(0,0,0,.35)';
}

function car(b, color, id) {
  const pillars = b.pillars.map((x) => `<rect x="${x}" y="8" width="2.6" height="16" fill="${color}"/>`).join('');
  const [lx, ly] = b.lamp, [tx, ty] = b.tail;
  return `<path d="${b.body}" fill="${color}"/>`
    + `<path d="${b.body}" fill="url(#${id})"/>`
    + `<g clip-path="url(#${id}c)"><path d="${b.glass}" fill="#1C2A31"/><path d="${b.glass}" fill="url(#${id}g)"/>${pillars}</g>`
    + (b.bed ? '<path d="M10 25.5H44" stroke="rgba(0,0,0,.35)" stroke-width="1.4"/>' : '')
    + `<path d="${b.body}" fill="none" stroke="${edgeFor(color)}" stroke-width="1"/>`
    + `<path d="M${lx} ${ly}h5.5l-1 2.6h-4.5Z" fill="#FFF6D6"/>`
    + `<path d="M${tx} ${ty}h2.4v4.2h-2.4Z" fill="#E0322B"/>`
    + b.wheels.map((x) => wheel(x, b.wheelY, b.r)).join('');
}

function motorcycle(color) {
  const edge = edgeFor(color);
  return wheel(28, 34, 9.5) + wheel(91, 34, 9.5)
    + '<path d="M28 34 52 29" stroke="#59636A" stroke-width="3.2" stroke-linecap="round"/>'
    + '<path d="M91 34 80.5 9.5" stroke="#9AA3A8" stroke-width="3.2" stroke-linecap="round"/>'
    + '<path d="M77 8.5 85.5 7" stroke="#2A3135" stroke-width="3" stroke-linecap="round"/>'
    + '<rect x="49" y="23" width="20" height="11" rx="3" fill="#2A3135"/>'
    + '<path d="M57 33.5 33 30.5" stroke="#8E989D" stroke-width="2.6" stroke-linecap="round"/>'
    + `<path d="M21 17.5 33 15.5 34 21 25.5 22Z" fill="${color}" stroke="${edge}" stroke-width="1"/>`
    + '<path d="M31 18.5Q32 15.5 36.5 15.5L53 16.5 53 21 33 22Z" fill="#20272B"/>'
    + `<path d="M51 22.5 53 15Q56 11.5 64 11.5L73 12Q78 12.5 78.5 17L77 22.5Z" fill="${color}" stroke="${edge}" stroke-width="1"/>`
    + `<path d="M76.5 11 84 9Q89 11 87.5 18L80 22Z" fill="${color}" stroke="${edge}" stroke-width="1"/>`
    + '<path d="M83.6 11.6l3.6-.6.2 3.4-3.4.8Z" fill="#FFF6D6"/>'
    + '<path d="M21.5 18.4h2.4v2.4h-2.4Z" fill="#E0322B"/>';
}

// An SVG for the look: { body, color }. A body it doesn't know is a hatchback.
export function vehiclePicture(look = {}) {
  const color = /^#[0-9a-f]{6}$/i.test(look.color || '') ? look.color : '#F1F3F4';
  const id = `vp${++made}`;
  const b = BODIES[look.body] || BODIES.hatchback;
  const art = look.body === 'motorcycle' ? motorcycle(color) : car(b, color, id);
  return `<svg viewBox="0 0 120 48" aria-hidden="true" focusable="false"><defs>`
    + `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>`
    + `<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9FC4D6" stop-opacity=".45"/><stop offset=".5" stop-color="#9FC4D6" stop-opacity="0"/></linearGradient>`
    + `<clipPath id="${id}c"><path d="${b.glass}"/></clipPath>`
    + `</defs><ellipse cx="60" cy="${GROUND}" rx="52" ry="2.6" fill="#000" opacity=".4"/>${art}</svg>`;
}

export const BODY_NAMES = Object.keys(BODIES);
