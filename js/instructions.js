// Valhalla has no Malay directions, so Pintu writes its own in each language
// from the numbered manoeuvre types. Server text is only a last resort.
import { sayDistance } from './format.js';

const ORD = {
  ms: ['pertama', 'kedua', 'ketiga', 'keempat', 'kelima', 'keenam', 'ketujuh', 'kelapan', 'kesembilan', 'kesepuluh'],
  en: ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'],
  zh: ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'],
  ta: ['முதல்', 'இரண்டாவது', 'மூன்றாவது', 'நான்காவது', 'ஐந்தாவது', 'ஆறாவது', 'ஏழாவது', 'எட்டாவது', 'ஒன்பதாவது', 'பத்தாவது'],
};
const known = (lang) => (ORD[lang] ? lang : 'en');

const REF = /^[A-Z]{0,3}[\s-]?\d{1,4}[A-Z]?$/;

export function roadNames(m) {
  const names = (m.street_names && m.street_names.length ? m.street_names : m.begin_street_names) || [];
  return {
    name: names.find((n) => !REF.test(n)) || '',
    ref: names.find((n) => REF.test(n)) || '',
  };
}

function signText(m, key) {
  const list = m.sign && m.sign[key];
  return list && list[0] ? list[0].text : '';
}

const ACTIONS = {
  ms: {
    start: 'Mula bergerak',
    dest: 'Destinasi anda', destR: 'Destinasi di sebelah kanan', destL: 'Destinasi di sebelah kiri',
    cont: 'Terus',
    slightR: 'Belok sedikit ke kanan', right: 'Belok kanan', sharpR: 'Belok tajam ke kanan',
    slightL: 'Belok sedikit ke kiri', left: 'Belok kiri', sharpL: 'Belok tajam ke kiri',
    uturn: 'Buat pusingan U',
    rampS: 'Masuk susur di hadapan', rampR: 'Masuk susur di sebelah kanan', rampL: 'Masuk susur di sebelah kiri',
    exitR: 'Keluar di sebelah kanan', exitL: 'Keluar di sebelah kiri',
    stayS: 'Kekal ke hadapan', stayR: 'Kekal di sebelah kanan', stayL: 'Kekal di sebelah kiri',
    merge: 'Masuk', mergeR: 'Masuk ke kanan', mergeL: 'Masuk ke kiri',
    rbExit: 'Keluar dari bulatan',
    ferryIn: 'Naik feri', ferryOut: 'Turun dari feri',
    rbEnter: 'Masuk bulatan',
    rbNth: (n) => `Di bulatan, ambil jalan keluar ${n}`,
    exitNo: (n) => `Keluar di susur ${n}`,
    stop: 'Hentian anda', stopR: 'Hentian di sebelah kanan', stopL: 'Hentian di sebelah kiri',
    lift: 'Guna lif', stairs: 'Guna tangga', escalator: 'Guna eskalator', enter: 'Masuk ke bangunan', leave: 'Keluar dari bangunan',
    onto: 'ke', toward: 'menuju',
  },
  en: {
    start: 'Head off',
    dest: 'Your destination', destR: 'Your destination is on the right', destL: 'Your destination is on the left',
    cont: 'Continue',
    slightR: 'Bear right', right: 'Turn right', sharpR: 'Turn sharp right',
    slightL: 'Bear left', left: 'Turn left', sharpL: 'Turn sharp left',
    uturn: 'Make a U-turn',
    rampS: 'Take the ramp ahead', rampR: 'Take the ramp on the right', rampL: 'Take the ramp on the left',
    exitR: 'Exit on the right', exitL: 'Exit on the left',
    stayS: 'Keep straight', stayR: 'Keep right', stayL: 'Keep left',
    merge: 'Merge', mergeR: 'Merge right', mergeL: 'Merge left',
    rbExit: 'Leave the roundabout',
    ferryIn: 'Board the ferry', ferryOut: 'Leave the ferry',
    rbEnter: 'Enter the roundabout',
    rbNth: (n) => `At the roundabout, take the ${n} exit`,
    exitNo: (n) => `Take exit ${n}`,
    stop: 'Your stop', stopR: 'Your stop is on the right', stopL: 'Your stop is on the left',
    lift: 'Take the lift', stairs: 'Take the stairs', escalator: 'Take the escalator', enter: 'Enter the building', leave: 'Leave the building',
    onto: 'onto', toward: 'towards',
  },
  zh: {
    start: '出发',
    dest: '您的目的地', destR: '目的地在右边', destL: '目的地在左边',
    cont: '直走',
    slightR: '靠右前方行驶', right: '右转', sharpR: '向右急转',
    slightL: '靠左前方行驶', left: '左转', sharpL: '向左急转',
    uturn: '掉头',
    rampS: '进入前方匝道', rampR: '进入右边匝道', rampL: '进入左边匝道',
    exitR: '从右边出口离开', exitL: '从左边出口离开',
    stayS: '保持直行', stayR: '靠右行驶', stayL: '靠左行驶',
    merge: '汇入', mergeR: '向右汇入', mergeL: '向左汇入',
    rbExit: '离开圆环',
    ferryIn: '登上渡轮', ferryOut: '离开渡轮',
    rbEnter: '进入圆环',
    rbNth: (n) => `在圆环，走第${n}个出口`,
    exitNo: (n) => `从 ${n} 号出口离开`,
    stop: '您的停靠站', stopR: '停靠站在右边', stopL: '停靠站在左边',
    lift: '搭电梯', stairs: '走楼梯', escalator: '搭扶手电梯', enter: '进入建筑物', leave: '离开建筑物',
    onto: '进入', toward: '往',
  },
  ta: {
    start: 'புறப்படுங்கள்',
    dest: 'உங்கள் சேருமிடம்', destR: 'சேருமிடம் வலதுபுறம் உள்ளது', destL: 'சேருமிடம் இடதுபுறம் உள்ளது',
    cont: 'நேராகச் செல்லுங்கள்',
    slightR: 'சற்று வலதுபுறம் செல்லுங்கள்', right: 'வலதுபுறம் திரும்புங்கள்', sharpR: 'கூர்மையாக வலதுபுறம் திரும்புங்கள்',
    slightL: 'சற்று இடதுபுறம் செல்லுங்கள்', left: 'இடதுபுறம் திரும்புங்கள்', sharpL: 'கூர்மையாக இடதுபுறம் திரும்புங்கள்',
    uturn: 'U திருப்பம் எடுங்கள்',
    rampS: 'முன்னால் உள்ள சரிவுப் பாதையில் செல்லுங்கள்', rampR: 'வலதுபுறச் சரிவுப் பாதையில் செல்லுங்கள்', rampL: 'இடதுபுறச் சரிவுப் பாதையில் செல்லுங்கள்',
    exitR: 'வலதுபுறம் வெளியேறுங்கள்', exitL: 'இடதுபுறம் வெளியேறுங்கள்',
    stayS: 'நேராகவே இருங்கள்', stayR: 'வலதுபுறமாகவே இருங்கள்', stayL: 'இடதுபுறமாகவே இருங்கள்',
    merge: 'இணையுங்கள்', mergeR: 'வலதுபுறம் இணையுங்கள்', mergeL: 'இடதுபுறம் இணையுங்கள்',
    rbExit: 'சுற்றுவட்டத்திலிருந்து வெளியேறுங்கள்',
    ferryIn: 'படகில் ஏறுங்கள்', ferryOut: 'படகிலிருந்து இறங்குங்கள்',
    rbEnter: 'சுற்றுவட்டத்தில் நுழையுங்கள்',
    rbNth: (n) => `சுற்றுவட்டத்தில், ${n} வெளியேறும் வழியை எடுங்கள்`,
    exitNo: (n) => `${n} வெளியேறும் வழியை எடுங்கள்`,
    stop: 'உங்கள் நிறுத்தம்', stopR: 'நிறுத்தம் வலதுபுறம் உள்ளது', stopL: 'நிறுத்தம் இடதுபுறம் உள்ளது',
    lift: 'மின்தூக்கியைப் பயன்படுத்துங்கள்', stairs: 'படிக்கட்டைப் பயன்படுத்துங்கள்', escalator: 'நகரும் படிக்கட்டைப் பயன்படுத்துங்கள்', enter: 'கட்டடத்திற்குள் நுழையுங்கள்', leave: 'கட்டடத்திலிருந்து வெளியேறுங்கள்',
    onto: '', toward: 'நோக்கி',
  },
};

const BY_TYPE = {
  1: 'start', 2: 'start', 3: 'start',
  4: 'dest', 5: 'destR', 6: 'destL',
  7: 'cont', 8: 'cont',
  9: 'slightR', 10: 'right', 11: 'sharpR',
  12: 'uturn', 13: 'uturn',
  14: 'sharpL', 15: 'left', 16: 'slightL',
  17: 'rampS', 18: 'rampR', 19: 'rampL',
  20: 'exitR', 21: 'exitL',
  22: 'stayS', 23: 'stayR', 24: 'stayL',
  25: 'merge', 37: 'mergeR', 38: 'mergeL',
  26: 'rbEnter', 27: 'rbExit',
  28: 'ferryIn', 29: 'ferryOut',
  39: 'lift', 40: 'stairs', 41: 'escalator', 42: 'enter', 43: 'leave',
};

// { action: 'Belok kiri', road: 'Jalan Ampang', ref: 'FT2', toward: '' }
export function describe(m, lang) {
  const a = ACTIONS[lang] || ACTIONS.en;
  let key = BY_TYPE[m.type];
  if (m.isStop) key = { dest: 'stop', destR: 'stopR', destL: 'stopL' }[key] || key;
  const { name, ref } = roadNames(m);
  const toward = signText(m, 'exit_toward_elements');
  const branch = signText(m, 'exit_branch_elements');
  const exitNo = signText(m, 'exit_number_elements');

  if (!key) return { action: m.instruction || a.cont, road: '', ref: '', toward: '' };

  let action = a[key];
  if (key === 'rbEnter' && m.roundabout_exit_count >= 1 && m.roundabout_exit_count <= 10) {
    action = a.rbNth(ORD[known(lang)][m.roundabout_exit_count - 1]);
  }
  if ((key === 'exitR' || key === 'exitL') && exitNo) action = a.exitNo(exitNo);

  const isDest = key.startsWith('dest') || key.startsWith('stop');
  const road = isDest ? '' : branch || name;
  return { action, road, ref: isDest ? '' : ref, toward: isDest ? '' : toward };
}

// One spoken phrase, starting with a capital.
export function phrase(m, lang) {
  const a = ACTIONS[lang] || ACTIONS.en;
  const d = describe(m, lang);
  const road = d.road || (d.ref ? d.ref.replace(/(\D)(\d)/, '$1 $2') : '');
  if (lang === 'zh') {
    let text = d.action;
    if (road) text += `，${a.onto} ${road}`;
    if (d.toward) text += `，${a.toward} ${d.toward}`;
    return text;
  }
  if (lang === 'ta') {
    // Tamil puts the road first: "Jalan Ampang-இல் இடதுபுறம் திரும்புங்கள்".
    let text = road ? `${road}-இல் ${d.action}` : d.action;
    if (d.toward) text += `, ${d.toward} ${a.toward}`;
    return text;
  }
  let text = d.action;
  if (road) text += ` ${a.onto} ${road}`;
  if (d.toward) text += `, ${a.toward} ${d.toward}`;
  return text;
}

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// The sentences around a direction, in each language.
const SAY = {
  ms: {
    arrive: 'Anda telah sampai.', stop: 'Anda telah sampai di hentian.', end: '.',
    inD: (d, p) => `Dalam ${d}, ${lower(p)}.`, cont: (d) => `Terus sejauh ${d}.`,
    contThen: (d, p) => `Terus sejauh ${d}, kemudian ${lower(p)}.`, then: (p, next) => `${p}, kemudian ${lower(next)}`,
  },
  en: {
    arrive: 'You have arrived.', stop: 'You have reached your stop.', end: '.',
    inD: (d, p) => `In ${d}, ${lower(p)}.`, cont: (d) => `Continue for ${d}.`,
    contThen: (d, p) => `Continue for ${d}, then ${lower(p)}.`, then: (p, next) => `${p}, then ${lower(next)}`,
  },
  zh: {
    arrive: '您已到达目的地。', stop: '您已到达停靠站。', end: '。',
    inD: (d, p) => `${d}后，${p}。`, cont: (d) => `直走${d}。`,
    contThen: (d, p) => `直走${d}，然后${p}。`, then: (p, next) => `${p}，然后${next}`,
  },
  ta: {
    arrive: 'நீங்கள் சேருமிடத்தை அடைந்துவிட்டீர்கள்.', stop: 'நீங்கள் நிறுத்தத்தை அடைந்துவிட்டீர்கள்.', end: '.',
    inD: (d, p) => `${d} தூரத்தில், ${p}.`, cont: (d) => `${d} நேராகச் செல்லுங்கள்.`,
    contThen: (d, p) => `${d} நேராகச் சென்று, பிறகு ${p}.`, then: (p, next) => `${p}, பிறகு ${next}`,
  },
};

// Turns a prompt from Guidance into the sentence to say.
export function speech(prompt, maneuvers, lang) {
  const w = SAY[lang] || SAY.en;
  const m = maneuvers[prompt.index];
  const far = (d) => sayDistance(d, lang);
  switch (prompt.kind) {
    case 'arrive':
      return w.arrive;
    case 'stop':
      return w.stop;
    case 'intro':
    case 'continue':
    case 'repeat': {
      const p = phrase(m, lang);
      if (prompt.distance < 150) return p + w.end;
      if (prompt.kind === 'repeat') {
        const advice = laneAdvice(m.lanes, lang);
        const base = w.inD(far(prompt.distance), p);
        return advice ? `${base} ${advice}` : base;
      }
      if (prompt.kind === 'continue') return w.cont(far(prompt.distance));
      return w.contThen(far(prompt.distance), p);
    }
    case 'far': {
      const advice = laneAdvice(m.lanes, lang);
      const base = w.inD(far(prompt.distance), phrase(m, lang));
      return advice ? `${base} ${advice}` : base;
    }
    case 'now': {
      let text = phrase(m, lang);
      if (prompt.thenIndex != null) text = w.then(text, describe(maneuvers[prompt.thenIndex], lang).action);
      return text + w.end;
    }
    default:
      return '';
  }
}

// Lane guidance. Valhalla describes each lane with bitmasks of the directions
// it allows, which of those keep you on the route, and which are best.
const LANE_BITS = [
  [2, 'straight'], [16, 'slightLeft'], [32, 'slightRight'], [8, 'left'], [64, 'right'],
  [4, 'sharpLeft'], [128, 'sharpRight'], [256, 'uturn'], [512, 'mergeLeft'], [1024, 'mergeRight'],
];

function laneDirections(mask) {
  return LANE_BITS.filter(([bit]) => mask & bit).map(([, name]) => name);
}

// [{ direction: 'left', others: ['straight'], state: 'best' | 'ok' | 'other' }],
// or null if there's nothing that would actually help you choose a lane.
export function laneView(lanes) {
  if (!Array.isArray(lanes) || lanes.length < 2) return null;
  const view = lanes.map((l) => {
    const all = laneDirections(l.directions || 0);
    const pick = (mask) => laneDirections(mask)[0] || 'straight';
    const direction = l.active ? pick(l.active) : l.valid ? pick(l.valid) : all[0] || 'straight';
    const state = l.active ? 'best' : l.valid ? 'ok' : 'other';
    return { direction, others: all.filter((d) => d !== direction), state };
  });
  if (!view.some((l) => l.state !== 'other')) return null;
  if (view.every((l) => l.state === 'best')) return null;
  return view;
}

// The lanes to be in, as words, or nothing if they can't be said simply.
export function laneAdvice(lanes, lang) {
  const view = laneView(lanes);
  if (!view) return '';
  const wanted = view.some((l) => l.state === 'best') ? 'best' : 'ok';
  const picks = view.map((l, i) => (l.state === wanted ? i : -1)).filter((i) => i >= 0);
  const n = view.length;
  const count = picks.length;
  const contiguous = picks[count - 1] - picks[0] === count - 1;
  if (!count || !contiguous || count === n) return '';
  let side = null;
  if (picks[0] === 0) side = 'left';
  else if (picks[count - 1] === n - 1) side = 'right';
  const L = LANES_SAID[lang] || LANES_SAID.en;
  if (!side) return L.middle;
  const word = L[side];
  const countWord = L.counts[count] || String(count);
  return count === 1 ? L.one(word) : L.many(countWord, word);
}

const LANES_SAID = {
  ms: { left: 'kiri', right: 'kanan', counts: ['', 'satu', 'dua', 'tiga', 'empat'], one: (w) => `Guna lorong paling ${w}.`, many: (n, w) => `Guna ${n} lorong ${w}.`, middle: 'Guna lorong tengah.' },
  en: { left: 'left', right: 'right', counts: ['', 'one', 'two', 'three', 'four'], one: (w) => `Use the ${w} lane.`, many: (n, w) => `Use the ${n} ${w} lanes.`, middle: 'Use the middle lane.' },
  zh: { left: '左', right: '右', counts: ['', '一', '两', '三', '四'], one: (w) => `走最${w}边的车道。`, many: (n, w) => `走${w}边${n}条车道。`, middle: '走中间的车道。' },
  ta: { left: 'இடது', right: 'வலது', counts: ['', 'ஒரு', 'இரண்டு', 'மூன்று', 'நான்கு'], one: (w) => `மிக ${w} வழித்தடத்தைப் பயன்படுத்துங்கள்.`, many: (n, w) => `${w}புற ${n} வழித்தடங்களில் ஒன்றைப் பயன்படுத்துங்கள்.`, middle: 'நடு வழித்தடத்தைப் பயன்படுத்துங்கள்.' },
};
