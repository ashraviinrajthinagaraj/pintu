// Valhalla has no Malay directions, so Pintu writes its own in both languages
// from the numbered manoeuvre types. Server text is only a last resort.
import { sayDistance } from './format.js';

const ORD = {
  ms: ['pertama', 'kedua', 'ketiga', 'keempat', 'kelima', 'keenam', 'ketujuh', 'kelapan', 'kesembilan', 'kesepuluh'],
  en: ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'],
};

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
    onto: 'onto', toward: 'towards',
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
};

// { action: 'Belok kiri', road: 'Jalan Ampang', ref: 'FT2', toward: '' }
export function describe(m, lang) {
  const a = ACTIONS[lang] || ACTIONS.en;
  const key = BY_TYPE[m.type];
  const { name, ref } = roadNames(m);
  const toward = signText(m, 'exit_toward_elements');
  const branch = signText(m, 'exit_branch_elements');
  const exitNo = signText(m, 'exit_number_elements');

  if (!key) return { action: m.instruction || a.cont, road: '', ref: '', toward: '' };

  let action = a[key];
  if (key === 'rbEnter' && m.roundabout_exit_count >= 1 && m.roundabout_exit_count <= 10) {
    action = a.rbNth(ORD[lang === 'ms' ? 'ms' : 'en'][m.roundabout_exit_count - 1]);
  }
  if ((key === 'exitR' || key === 'exitL') && exitNo) action = a.exitNo(exitNo);

  const isDest = key.startsWith('dest');
  const road = isDest ? '' : branch || name;
  return { action, road, ref: isDest ? '' : ref, toward: isDest ? '' : toward };
}

// One spoken phrase, starting with a capital.
export function phrase(m, lang) {
  const a = ACTIONS[lang] || ACTIONS.en;
  const d = describe(m, lang);
  let text = d.action;
  if (d.road) text += ` ${a.onto} ${d.road}`;
  else if (d.ref) text += ` ${a.onto} ${d.ref.replace(/(\D)(\d)/, '$1 $2')}`;
  if (d.toward) text += `, ${a.toward} ${d.toward}`;
  return text;
}

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// Turns a prompt from Guidance into the sentence to say.
export function speech(prompt, maneuvers, lang) {
  const ms = lang === 'ms';
  const m = maneuvers[prompt.index];
  switch (prompt.kind) {
    case 'arrive':
      return ms ? 'Anda telah sampai.' : 'You have arrived.';
    case 'intro':
    case 'continue':
    case 'repeat': {
      const p = phrase(m, lang);
      if (prompt.distance < 150) return p + '.';
      if (prompt.kind === 'repeat') {
        return ms ? `Dalam ${sayDistance(prompt.distance, lang)}, ${lower(p)}.`
                  : `In ${sayDistance(prompt.distance, lang)}, ${lower(p)}.`;
      }
      if (prompt.kind === 'continue') {
        return ms ? `Terus sejauh ${sayDistance(prompt.distance, lang)}.`
                  : `Continue for ${sayDistance(prompt.distance, lang)}.`;
      }
      return ms ? `Terus sejauh ${sayDistance(prompt.distance, lang)}, kemudian ${lower(p)}.`
                : `Continue for ${sayDistance(prompt.distance, lang)}, then ${lower(p)}.`;
    }
    case 'far':
      return ms ? `Dalam ${sayDistance(prompt.distance, lang)}, ${lower(phrase(m, lang))}.`
                : `In ${sayDistance(prompt.distance, lang)}, ${lower(phrase(m, lang))}.`;
    case 'now': {
      let text = phrase(m, lang);
      if (prompt.thenIndex != null) {
        text += ms ? `, kemudian ${lower(describe(maneuvers[prompt.thenIndex], lang).action)}`
                   : `, then ${lower(describe(maneuvers[prompt.thenIndex], lang).action)}`;
      }
      return text + '.';
    }
    default:
      return '';
  }
}
