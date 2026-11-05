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
  `<svg viewBox="0 0 34 42" aria-hidden="true" width="100%" height="100%" ${attrs}><path d="M3 41V17a14 14 0 0 1 28 0v24Z" fill="none" stroke="currentColor" stroke-width="4"/><path d="M8.5 41V17.5a8.5 8.5 0 0 1 17 0V41Z" fill="currentColor"/><circle cx="21" cy="26" r="1.9" fill="var(--knob, #00693E)"/></svg>`;

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
  const n = count >= 1 && count <= 9 ? `<text x="32" y="33.5" text-anchor="middle" font-size="19" font-weight="800" fill="currentColor" stroke="none" font-family="Overpass, Arial, sans-serif">${count}</text>` : '';
  return `<circle cx="32" cy="27" r="19" stroke-width="7"/><path d="M32 60V47"/>${n}`;
}

export function turnIcon(m) {
  if ([4, 5, 6].includes(m.type)) return doorSvg('style="--knob:var(--plate,#00693E)"');
  if (m.type === 26 || m.type === 27) return svg(roundabout(m.type === 26 ? m.roundabout_exit_count : 0));
  const [shape, flip] = BY_TYPE[m.type] || ['straight'];
  return svg(flip ? mirror(SHAPES[shape]) : SHAPES[shape]);
}

const line = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const UI = {
  back: line('<path d="M15 5l-7 7 7 7"/>'),
  settings: line('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/>'),
  locate: line('<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  recenter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 19.5 21 12 16.8 4.5 21Z" fill="currentColor"/></svg>',
  sound: line('<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5Z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/>'),
  soundOff: line('<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5Z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
};

export const puckSvg = `<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="17" fill="#fff"/><path d="M22 9 31.5 31 22 26.2 12.5 31Z" fill="#0B4DA2"/></svg>`;

export const destPinSvg = `<svg viewBox="0 0 38 48" aria-hidden="true" width="38" height="48"><path d="M3 47V19a16 16 0 0 1 32 0v28Z" fill="#00693E"/><path d="M6.5 44V19a12.5 12.5 0 0 1 25 0v25Z" fill="none" stroke="#fff" stroke-width="2"/><path d="M11 44V20a8 8 0 0 1 16 0v24Z" fill="#fff"/><circle cx="23.2" cy="30" r="1.8" fill="#00693E"/></svg>`;
