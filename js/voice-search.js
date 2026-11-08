// Saying where you want to go instead of typing it. The phone's own speech
// service turns what you say into words (on Android that is Google's). A few
// short phrases go straight where you mean: home, work, your car, or the
// nearest petrol station. Anything else is searched for like typed words.

const SPEECH_LANG = { ms: 'ms-MY', en: 'en-MY', zh: 'zh-CN', ta: 'ta-IN' };
export const speechLang = (lang) => SPEECH_LANG[lang] || SPEECH_LANG.ms;

const Recognition = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
export const canListen = () => !!Recognition();

// Words around the place that don't name it: "take me to", "tolong bawa saya ke".
const LEADING = [
  'saya nak pergi ke', 'saya nak pergi', 'saya nak ke', 'nak pergi ke', 'nak pergi', 'nak ke', 'tolong bawa saya ke', 'bawa saya ke',
  'bawa saya', 'tolong', 'pergi ke', 'pergi', 'jalan ke', 'balik ke', 'balik', 'pandu ke', 'navigasi ke', 'cari', 'ke',
  'i want to go to', 'i want to go', 'take me to', 'take me', 'navigate to', 'directions to', 'drive to', 'go to', 'head to',
  'get me to', 'show me', 'find me', 'find', 'search for', 'search', 'go', 'drive', 'navigate', 'head', 'jom pergi', 'jom',
  'to', 'please', 'hey pintu', 'pintu',
];
const TRAILING = ['please', 'tolong', 'sekarang', 'now', 'sila', 'boleh', 'ya', 'lah'];

const HOME = ['rumah', 'rumah saya', 'rumah aku', 'home', 'my home', 'my house', 'house'];
const WORK = ['kerja', 'tempat kerja', 'pejabat', 'ofis', 'opis', 'office', 'the office', 'my office', 'work', 'my work'];
const CAR = ['kereta saya', 'kereta aku', 'kereta', 'mana kereta saya', 'mana kereta', 'motor saya', 'my car', 'the car', 'car', 'where is my car', 'where did i park', 'my bike'];

// Asking for the nearest of something, in either language.
const NEAR = [
  ['fuel', /^(stesen minyak|minyak|isi minyak|pam minyak|stesen petrol|petrol|petrol station|petrol pump|gas station|gas|fuel|fuel station|petronas|shell|petron|caltex|bhp)$/],
  ['ev', /^(pengecas|stesen cas|cas|cas kereta|tempat cas|charger|charging|charging station|ev charger|ev charging|ev)$/],
  ['food', /^(makan|tempat makan|kedai makan|restoran|kedai|food|restaurant|restaurants|something to eat|eat|lunch|dinner|breakfast)$/],
  ['hotel', /^(hotel|penginapan|tempat tidur|hotels|a hotel|somewhere to stay)$/],
];
const NEAREST = /\b(yang\s+)?(terdekat|paling dekat|dekat sini|berdekatan|nearest|nearby|near me|close by|around here|closest)\b/;
const NEAREST_ALL = new RegExp(NEAREST.source, 'g');

// Words as said, with punctuation gone; matching is done on a lower-case copy so a
// name keeps the capitals the phone gave it ("KLCC", "Mid Valley").
const wordsOf = (text) => String(text || '').normalize('NFKC').replace(/[.,!?;:"“”]+/g, ' ').split(/\s+/).filter(Boolean);
const lower = (words) => words.join(' ').toLowerCase();

function strip(words, phrases, atEnd) {
  let w = words;
  for (let again = true; again && w.length;) {
    again = false;
    for (const p of phrases) {
      const n = p.split(' ').length;
      if (n > w.length) continue;
      const part = atEnd ? w.slice(w.length - n) : w.slice(0, n);
      if (lower(part) !== p) continue;
      w = atEnd ? w.slice(0, w.length - n) : w.slice(n);
      again = true;
      break;
    }
  }
  return w;
}

// What someone said, as something Pintu can do.
export function understand(said) {
  const all = wordsOf(said);
  if (!all.length) return null;
  const place = strip(strip(all, LEADING, false), TRAILING, true);
  const text = lower(place);
  // "the nearest petrol station" and "stesen minyak terdekat" are the same ask.
  const nearest = NEAREST.test(text);
  const bare = lower(strip(wordsOf(text.replace(NEAREST_ALL, ' ')), ['the', 'a', 'an', 'satu', 'mana'], false));
  if (HOME.includes(bare)) return { kind: 'saved', which: 'home' };
  if (WORK.includes(bare)) return { kind: 'saved', which: 'work' };
  if (CAR.includes(bare)) return { kind: 'car' };
  for (const [category, re] of NEAR) {
    if (re.test(bare)) return { kind: 'nearby', category };
  }
  // A place name keeps its own words, only without "take me to".
  if (!place.length) return null;
  return { kind: 'search', query: place.join(' '), nearest };
}

// Listens once. `onWords` hears the words as they come, for showing in the box.
export function listen({ lang, onWords, onDone, onFail }) {
  const R = Recognition();
  if (!R) { onFail?.('unsupported'); return null; }
  const rec = new R();
  rec.lang = speechLang(lang);
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let heard = '';
  let finished = false;
  let problem = null;
  rec.onresult = (e) => {
    let text = '';
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0]?.transcript || '';
      if (e.results[i].isFinal) finished = true;
    }
    heard = text.trim();
    onWords?.(heard, finished);
  };
  rec.onerror = (e) => { problem = e.error || 'failed'; };
  rec.onend = () => {
    if (heard && problem !== 'aborted') onDone?.(heard);
    else onFail?.(problem || 'no-speech');
  };
  try { rec.start(); } catch { onFail?.('busy'); return null; }
  return {
    stop: () => { try { rec.stop(); } catch { /* already stopped */ } },
    cancel: () => {
      rec.onend = null;
      rec.onresult = null;
      try { rec.abort(); } catch { /* already stopped */ }
    },
  };
}
