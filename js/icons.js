// Turn arrows drawn like the ones on road signs: a heavy shaft and a solid head.
const svg = (inner, attrs = '') =>
  `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="9" stroke-linejoin="round" aria-hidden="true" width="100%" height="100%" ${attrs}>${inner}</svg>`;

const head = (d) => `<path d="${d}" fill="currentColor" stroke="none"/>`;

const SHAPES = {
  straight: `<path d="M32 60V22"/>${head('M32 4 52 26H12Z')}`,
  right: `<path d="M18 60V36q0-12 12-12h10"/>${head('M60 24 38 4v40Z')}`,
  slight: `<path d="M22 60V40L38 24"/>${head('M54 8 26 13 49 36Z')}`,
  sharp: `<path d="M16 60V24q0-13 10-5l14 14"/>${head('M56 50 51 21 26 46Z')}`,
  uturn: `<path d="M14 60V26a15 15 0 0 1 30 0v12"/>${head('M44 60 25 36h38Z')}`,
  fork: `<path d="M28 60V40L40 26"/><path d="M28 40 14 24" opacity=".45"/>${head('M54 10 29 16 48 34Z')}`,
  merge: `<path d="M34 60V24"/><path d="M12 60c0-14 8-16 22-24" opacity=".45"/>${head('M34 4 53 26H15Z')}`,
  ferry: `<path d="M20 38V24h24v14"/>${head('M6 38h52l-9 18H15Z')}`,
};

export const doorSvg = (attrs = '') =>
  `<svg viewBox="0 0 34 42" aria-hidden="true" width="100%" height="100%" ${attrs}><path d="M3 41V17a14 14 0 0 1 28 0v24Z" fill="none" stroke="currentColor" stroke-width="4"/><path d="M8.5 41V17.5a8.5 8.5 0 0 1 17 0V41Z" fill="currentColor"/><circle cx="21" cy="26" r="1.9" fill="var(--knob, #00794A)"/></svg>`;

const mirror = (inner) => `<g transform="translate(64 0) scale(-1 1)">${inner}</g>`;

const BY_TYPE = {
  1: ['straight'], 2: ['straight'], 3: ['straight'], 7: ['straight'], 8: ['straight'], 17: ['straight'], 22: ['straight'],
  9: ['slight'], 18: ['slight'], 20: ['slight'],
  16: ['slight', true], 19: ['slight', true], 21: ['slight', true],
  10: ['right'], 15: ['right', true],
  11: ['sharp'], 14: ['sharp', true],
  12: ['uturn'], 13: ['uturn', true],
  23: ['fork'], 24: ['fork', true],
  25: ['merge'], 37: ['merge'], 38: ['merge', true],
  28: ['ferry'], 29: ['ferry'],
};

function roundabout(count) {
  const n = count >= 1 && count <= 9 ? `<text x="32" y="33.5" text-anchor="middle" font-size="19" font-weight="800" fill="currentColor" stroke="none" font-family="Barlow Semi Condensed, Arial, sans-serif">${count}</text>` : '';
  return `<circle cx="32" cy="27" r="19" stroke-width="7"/><path d="M32 60V47"/>${n}`;
}

export function turnIcon(m) {
  if ([4, 5, 6].includes(m.type)) return doorSvg('style="--knob:var(--plate,#00794A)"');
  if (m.type === 26 || m.type === 27) return svg(roundabout(m.type === 26 ? m.roundabout_exit_count : 0));
  const [shape, flip] = BY_TYPE[m.type] || ['straight'];
  return svg(flip ? mirror(SHAPES[shape]) : SHAPES[shape]);
}

const LANES = {
  straight: ['straight'], uturn: ['uturn'],
  slightRight: ['slight'], right: ['right'], sharpRight: ['sharp'], mergeRight: ['merge'],
  slightLeft: ['slight', true], left: ['right', true], sharpLeft: ['sharp', true], mergeLeft: ['merge', true],
};

// One lane's arrow, with anything else the lane allows drawn faintly behind it.
export function laneIcon(direction, others = []) {
  const draw = (name) => {
    const [shape, flip] = LANES[name] || LANES.straight;
    return flip ? mirror(SHAPES[shape]) : SHAPES[shape];
  };
  const faint = others.map((name) => `<g opacity=".3">${draw(name)}</g>`).join('');
  return svg(faint + draw(direction));
}

const line = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const UI = {
  back: line('<path d="M15 5l-7 7 7 7"/>'),
  close: line('<path d="M6 6l12 12M18 6 6 18"/>'),
  settings: line('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>'),
  locate: line('<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  recenter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 19.5 21 12 16.8 4.5 21Z" fill="currentColor"/></svg>',
  sound: line('<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5Z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/>'),
  soundOff: line('<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5Z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  plus: line('<path d="M12 5v14M5 12h14"/>'),
  fuel: line('<path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3.5 21h13M8 8h4"/><path d="M15 12h1.5a2 2 0 0 1 2 2v2.5a1.5 1.5 0 0 0 3 0V9l-3-3"/>'),
  ev: line('<path d="M13 2.5 5.5 13.5H11L10 21.5 18.5 10H12.5Z" fill="currentColor" stroke-width="1.6"/>'),
  rest: line('<path d="M4 18V9m16 9v-5a3 3 0 0 0-3-3H4M4 15h16"/><circle cx="8.5" cy="6.5" r="1.6"/>'),
  surau: line('<path d="M5 21v-8a7 7 0 0 1 14 0v8Z"/><path d="M3 21h18M12 6V2.5"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/>'),
  food: line('<path d="M7 3v7a2.5 2.5 0 0 0 2.5 2.5V21M4.5 3v6.5M9.5 3v6.5M17 21v-7h-2.5V8c0-3 1.5-5 4-5v18"/>'),
  car: line('<path d="M4 16v-3l2-5.5A2 2 0 0 1 8 6h8a2 2 0 0 1 2 1.5l2 5.5v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1ZM4.5 12.5h15"/><circle cx="7.5" cy="15" r=".6" fill="currentColor"/><circle cx="16.5" cy="15" r=".6" fill="currentColor"/><path d="M6 17v2M18 17v2"/>'),
  chevron: line('<path d="M9 5l7 7-7 7"/>'),
  walk: line('<circle cx="13" cy="4.2" r="1.9"/><path d="m9.5 22 2.2-6.5L9 12.6l1.4-5.1 3.1.5 2.2 3.4 3.3 1"/><path d="M10.4 7.5 6.5 9.6 5.4 13M13.2 15.2 15.5 22"/>'),
  rain: line('<path d="M6.5 15.5a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 17.6 8a3.8 3.8 0 0 1-.1 7.5"/><path d="m9 17-1.5 4M13 17l-1.5 4M17 17l-1.5 4"/>'),
  store: line('<path d="M4 9.5 5.5 4h13L20 9.5M5 9.5V20h14V9.5M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M10 20v-5h4v5"/>'),
  paste: line('<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9.5 4.5V3h5v1.5M9.5 10.5h5M9.5 14.5h5"/>'),
  swap: line('<path d="M8 20V5M8 5 4 9M8 5l4 4M16 4v15M16 19l-4-4M16 19l4-4"/>'),
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5Z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4.5h4v15h-4ZM13.5 4.5h4v15h-4Z" fill="currentColor"/></svg>',
  skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5v15l10-7.5Z" fill="currentColor"/><path d="M16 4.5h3.2v15H16Z" fill="currentColor"/></svg>',
  list: line('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/>'),
  camera: line('<path d="M3.5 8.5h10.5a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H3.5Z"/><path d="M16 11.5 21 9v7l-5-2.5M6 16.5 5 21M10 16.5l1 4.5"/><circle cx="8.5" cy="12.5" r="1.8"/>'),
  home: line('<path d="M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5"/><path d="M10 20v-5.5h4V20"/>'),
  work: line('<rect x="3.5" y="7.5" width="17" height="12.5" rx="2"/><path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2M3.5 13h17"/>'),
  parking: line('<rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M9.5 17V7.5h3.2a2.9 2.9 0 0 1 0 5.8H9.5"/>'),
  star: line('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z"/>'),
  bed: line('<path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11.5" r="2"/>'),
  clock: line('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.5l3.5 2"/>'),
  pin: line('<path d="M12 21.5s7.5-6.7 7.5-12a7.5 7.5 0 1 0-15 0c0 5.3 7.5 12 7.5 12Z"/><circle cx="12" cy="9.5" r="2.6"/>'),
};

export const CATEGORY_ICONS = { sights: UI.star, hotel: UI.bed, parking: UI.parking, fuel: UI.fuel, ev: UI.ev, rest: UI.rest, surau: UI.surau, food: UI.food };

export const puckSvg = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="pk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#A9D2FF"/><stop offset="1" stop-color="#2B7BF0"/></linearGradient></defs><circle class="puck-halo" cx="32" cy="32" r="30" fill="#4A9BFF" fill-opacity=".2"/><path d="M32 8 50 52 32 42 14 52Z" fill="url(#pk)" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"/></svg>`;

export const destPinSvg = `<svg viewBox="0 0 38 48" aria-hidden="true" width="38" height="48"><path d="M3 47V19a16 16 0 0 1 32 0v28Z" fill="#00794A"/><path d="M6.5 44V19a12.5 12.5 0 0 1 25 0v25Z" fill="none" stroke="#fff" stroke-width="2"/><path d="M11 44V20a8 8 0 0 1 16 0v24Z" fill="#fff"/><circle cx="23.2" cy="30" r="1.8" fill="#00794A"/></svg>`;
