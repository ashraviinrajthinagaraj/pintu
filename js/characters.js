// Who's talking. Every character here is original, written for Pintu.
//
// The rule that keeps them safe to drive with: the instruction is always said in
// full, and always first at the moment of a turn. A joke only ever comes after an
// instruction, where the next instruction simply cuts it off, or as a word or two
// in front of one. Nothing here ever encourages going faster.
//
// An accent comes from the voice a character is given, never from how a line is
// written, and the jokes are about who they are: a pilot, a teacher, an aunty.
// A mark like "[tease]" says how a line is delivered. See delivery.js.
import adik from './cast/adik.js';
import agent from './cast/agent.js';
import captain from './cast/captain.js';
import cikgu from './cast/cikgu.js';
import commentator from './cast/commentator.js';
import makcik from './cast/makcik.js';
import trailer from './cast/trailer.js';
import uncle from './cast/uncle.js';

const CAST = {
  standard: {
    name: { ms: 'Biasa', en: 'Standard' },
    about: { ms: 'Arahan sahaja, tanpa gurauan.', en: 'Directions only, no jokes.' },
    tag: { ms: 'Perempuan, loghat Melayu', en: 'Female, local accent' },
    voice: { pitch: 1, rate: 1 },
    lines: null,
  },
  captain,
  makcik,
  uncle,
  cikgu,
  commentator,
  agent,
  trailer,
  adik,
};

export const CHARACTER_IDS = Object.keys(CAST);
// The characters speak Malay and English. In other languages Pintu speaks plainly.
export const CAST_LANGS = ['ms', 'en'];
const castLang = (lang) => (lang === 'ms' ? 'ms' : 'en');
export const characterName = (id, lang) => (CAST[id] || CAST.standard).name[castLang(lang)];
export const characterAbout = (id, lang) => (CAST[id] || CAST.standard).about[castLang(lang)];
export const characterVoice = (id) => (CAST[id] || CAST.standard).voice;
export const characterTag = (id, lang) => (CAST[id] || CAST.standard).tag[castLang(lang)];

const last = new Map();

// A line of this kind, avoiding the one just used. Empty if there's none.
export function pick(id, key, lang, { rand = Math.random, vars = {} } = {}) {
  if (!CAST_LANGS.includes(lang)) return '';
  const lines = CAST[id]?.lines?.[lang]?.[key];
  if (!lines?.length) return '';
  let i = Math.floor(rand() * lines.length) % lines.length;
  const memo = `${id}:${key}:${lang}`;
  if (lines.length > 1 && last.get(memo) === i) i = (i + 1) % lines.length;
  last.set(memo, i);
  return lines[i].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const joinLead = (lead, text) => (/,$/.test(lead) ? `${lead} ${lowerFirst(text)}` : `${lead} ${text}`);

const TALK = new Set(['slowed', 'jam', 'jamLong', 'jamClear', 'longDrive', 'quiet']);

// `base` is the plain instruction. Whatever else is said, all of it stays.
export function dress(id, kind, base, lang, { rand = Math.random, vars = {} } = {}) {
  // Moments with nothing to report except what the character makes of them.
  if (TALK.has(kind)) return pick(id, kind, lang, { rand, vars }) || base || '';
  if (!CAST[id]?.lines || !base) return base;
  switch (kind) {
    // The moment of the turn: a word or two at most, sometimes.
    case 'now': {
      if (rand() > 0.35) return base;
      const lead = pick(id, 'nowLead', lang, { rand });
      return lead ? joinLead(lead, base) : base;
    }
    // Plenty of time before the turn.
    case 'far':
    case 'intro':
    case 'continue': {
      let text = base;
      if (rand() < 0.3) {
        const lead = pick(id, 'lead', lang, { rand });
        if (lead) text = joinLead(lead, text);
      }
      if (rand() < 0.55) {
        const tail = pick(id, 'tail', lang, { rand });
        if (tail) text = `${text} ${tail}`;
      }
      return text;
    }
    case 'arrive':
    case 'stop':
    case 'rain':
    case 'fuel': {
      const line = pick(id, kind, lang, { rand, vars });
      return line ? `${base} ${line}` : base;
    }
    // Their own words carry the same message.
    case 'overspeed':
    case 'overspeed2':
    case 'overspeed3':
    case 'reroute':
      return pick(id, kind, lang, { rand, vars }) || base;
    // Asked to say it again: just say it.
    default:
      return base;
  }
}

// A short sample, for choosing a voice.
export function sample(id, lang, base) {
  if (!CAST[id]?.lines || !CAST_LANGS.includes(lang)) return base;
  const lead = pick(id, 'start', lang);
  const tail = pick(id, 'tail', lang);
  return `${lead} [plain]${base} ${tail}`;
}
