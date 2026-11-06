// Spoken directions, using whichever voices the phone already has.
const synth = () => (typeof speechSynthesis !== 'undefined' ? speechSynthesis : null);

let muted = false;
let lang = 'ms';
let style = { pitch: 1, rate: 1 };

export const setMuted = (v) => { muted = v; if (v) synth()?.cancel(); };
export const setVoiceLang = (l) => { lang = l; };
// How the current character sounds: phones can change a voice's pitch and pace.
export const setVoiceStyle = (s) => { style = s; };

function voices() {
  try { return synth()?.getVoices() || []; } catch { return []; }
}

const norm = (s) => (s || '').toLowerCase().replace('_', '-');

// Malay if the phone has it. Indonesian is the closest stand-in and reads
// Malay road names far better than an English voice would.
export function chooseVoice(list, language) {
  const find = (prefix) => list.find((v) => norm(v.lang).startsWith(prefix));
  if (language === 'ms') {
    const ms = find('ms');
    if (ms) return { voice: ms, tag: ms.lang, match: 'exact' };
    const id = find('id');
    if (id) return { voice: id, tag: id.lang, match: 'near' };
    return { voice: null, tag: 'ms-MY', match: 'none' };
  }
  const en = find('en-my') || find('en-sg') || find('en-gb') || find('en');
  return en ? { voice: en, tag: en.lang, match: 'exact' } : { voice: null, tag: 'en-GB', match: 'none' };
}

export function voiceStatus(language = lang) {
  if (!synth()) return 'none';
  return chooseVoice(voices(), language).match;
}

export function speak(text, { evenIfMuted = false } = {}) {
  const s = synth();
  if (!s || !text || (muted && !evenIfMuted)) return;
  const { voice, tag } = chooseVoice(voices(), lang);
  const u = new SpeechSynthesisUtterance(text);
  u.lang = tag;
  if (voice) u.voice = voice;
  u.rate = style.rate;
  u.pitch = style.pitch;
  s.cancel();
  // Some Android browsers drop a sentence spoken straight after cancel().
  setTimeout(() => { try { s.speak(u); } catch { /* no voice today */ } }, 40);
}

// iPhones only allow speech after a tap, so a tap on Start unlocks it.
export function unlockVoice() {
  const s = synth();
  if (!s) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    s.speak(u);
  } catch { /* nothing to unlock */ }
}

export function onVoicesReady(fn) {
  const s = synth();
  if (s && s.addEventListener) s.addEventListener('voiceschanged', fn);
}
