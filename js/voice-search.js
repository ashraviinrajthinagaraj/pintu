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
  'என்னை', 'தயவுசெய்து',
];
const TRAILING = ['please', 'tolong', 'sekarang', 'now', 'sila', 'boleh', 'ya', 'lah',
  'கூட்டிட்டு போ', 'போகணும்', 'போங்க', 'போ', 'செல்', 'போக வேண்டும்'];

const HOME = ['rumah', 'rumah saya', 'rumah aku', 'home', 'my home', 'my house', 'house', 'வீடு', 'வீட்டுக்கு', 'என் வீடு', 'என் வீட்டுக்கு'];
const WORK = ['kerja', 'tempat kerja', 'pejabat', 'ofis', 'opis', 'office', 'the office', 'my office', 'work', 'my work',
  'வேலை', 'வேலைக்கு', 'அலுவலகம்', 'அலுவலகத்துக்கு', 'ஆபீஸ்', 'ஆபீசுக்கு'];
const CAR = ['kereta saya', 'kereta aku', 'kereta', 'mana kereta saya', 'mana kereta', 'motor saya', 'my car', 'the car', 'car', 'where is my car', 'where did i park', 'my bike',
  'என் கார்', 'கார்'];

// Asking for the nearest of something, in either language.
const NEAR = [
  ['fuel', /^(stesen minyak|minyak|isi minyak|pam minyak|stesen petrol|petrol|petrol station|petrol pump|gas station|gas|fuel|fuel station|petronas|shell|petron|caltex|bhp|பெட்ரோல் நிலையம்|பெட்ரோல்|பெட்ரோல் பங்க்)$/],
  ['ev', /^(pengecas|stesen cas|cas|cas kereta|tempat cas|charger|charging|charging station|ev charger|ev charging|ev|சார்ஜிங் நிலையம்|சார்ஜர்)$/],
  ['food', /^(makan|tempat makan|kedai makan|restoran|kedai|food|restaurant|restaurants|something to eat|eat|lunch|dinner|breakfast|சாப்பாடு|உணவகம்|உணவு)$/],
  ['hotel', /^(hotel|penginapan|tempat tidur|hotels|a hotel|somewhere to stay|ஹோட்டல்|தங்குமிடம்)$/],
];
const NEAREST = /(^|\s)(yang\s+)?(terdekat|paling dekat|dekat sini|berdekatan|nearest|nearby|near me|close by|around here|closest|அருகிலுள்ள|அருகில் உள்ள|பக்கத்தில் உள்ள|பக்கத்தில்)(?=\s|$)/;

// Chinese is written without spaces, so it's understood on its own.
const HAN = /[\u3400-\u9fff]/;
const ZH_LEAD = ['请带我去', '带我去', '载我去', '我要去', '我想去', '导航去', '导航到', '开车去', '请去', '回', '去', '到'];
const ZH_TAIL = ['谢谢', '吧', '了', '啊', '呢'];
const ZH_NEAREST = /(最近的|附近的|附近)/g;
const ZH = [
  [{ kind: 'saved', which: 'home' }, /^(家|我家|回家|屋子|家里)$/],
  [{ kind: 'saved', which: 'work' }, /^(公司|上班|办公室|工作|我公司|上班的地方)$/],
  [{ kind: 'car' }, /^(我的车|车子|我的车子|车|我的车在哪里|车在哪里)$/],
  [{ kind: 'nearby', category: 'fuel' }, /^(油站|加油站|加油|打油|油)$/],
  [{ kind: 'nearby', category: 'ev' }, /^(充电站|充电)$/],
  [{ kind: 'nearby', category: 'food' }, /^(吃东西|餐厅|吃饭|食物|美食)$/],
  [{ kind: 'nearby', category: 'hotel' }, /^(酒店|旅馆|住宿)$/],
];

function understandChinese(said) {
  let text = said.replace(/[\s，。！？、,.!?]+/g, '');
  for (let again = true; again;) {
    again = false;
    for (const w of ZH_LEAD) if (text.startsWith(w) && text.length > w.length) { text = text.slice(w.length); again = true; break; }
    for (const w of ZH_TAIL) if (text.endsWith(w) && text.length > w.length) { text = text.slice(0, -w.length); again = true; break; }
  }
  const nearest = ZH_NEAREST.test(text);
  ZH_NEAREST.lastIndex = 0;
  const bare = text.replace(ZH_NEAREST, '');
  for (const [meaning, re] of ZH) if (re.test(bare)) return { ...meaning };
  return text ? { kind: 'search', query: text, nearest } : null;
}
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
  if (HAN.test(String(said || ''))) return understandChinese(String(said));
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
