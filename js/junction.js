// A clear picture of a highway exit or fork, drawn before you get there.
const KINDS = {
  17: { take: 'straight', others: ['right'] },
  18: { take: 'right', others: ['straight'] },
  19: { take: 'left', others: ['straight'] },
  20: { take: 'right', others: ['straight'] },
  21: { take: 'left', others: ['straight'] },
  22: { take: 'straight', others: ['right'] },
  23: { take: 'right', others: ['left'] },
  24: { take: 'left', others: ['right'] },
};

export const JUNCTION_RANGE = { highway: 1500, road: 500 };

const signText = (m, key) => m.sign?.[key]?.[0]?.text || '';

export function junctionFor(m) {
  const kind = m && KINDS[m.type];
  if (!kind) return null;
  return {
    ...kind,
    exitNo: signText(m, 'exit_number_elements'),
    branch: signText(m, 'exit_branch_elements'),
    toward: signText(m, 'exit_toward_elements'),
  };
}

// Each road leaves the junction at the same point and heads off its own way.
const PATHS = {
  trunk: 'M120 150V96',
  straight: 'M120 96V8',
  right: 'M120 96C120 70 150 54 214 18',
  left: 'M120 96C120 70 90 54 26 18',
};
const HEADS = {
  straight: 'M120 0 136 24H104Z',
  right: 'M226 11 212 36 198 15Z',
  left: 'M14 11 42 15 28 36Z',
};

// Only the shapes. The words go on top separately, as text, never as markup.
export function junctionSvg(j) {
  const road = (d) => `<path d="${d}" class="jv-road"/><path d="${d}" class="jv-line"/>`;
  const others = j.others.map((o) => road(PATHS[o])).join('');
  return `<svg viewBox="0 0 240 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
${others}${road(PATHS.trunk)}${road(PATHS[j.take])}
<path d="${PATHS.trunk}" class="jv-route"/><path d="${PATHS[j.take]}" class="jv-route"/>
<path d="${HEADS[j.take]}" class="jv-head"/>
</svg>`;
}
