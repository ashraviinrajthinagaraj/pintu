// Numbers as people read and hear them.

export function roundDistance(metres) {
  if (metres < 100) return Math.max(10, Math.round(metres / 10) * 10);
  if (metres < 1000) return Math.round(metres / 50) * 50;
  return metres;
}

function kmValue(metres) {
  const km = metres / 1000;
  return km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
}

export function fmtDistance(metres) {
  const r = roundDistance(metres);
  return r < 1000 ? `${r} m` : `${kmValue(r)} km`;
}

export function sayDistance(metres, lang) {
  const r = roundDistance(metres);
  if (lang === 'ms') return r < 1000 ? `${r} meter` : `${kmValue(r)} kilometer`;
  if (lang === 'zh') return r < 1000 ? `${r}米` : `${kmValue(r)}公里`;
  if (lang === 'ta') return r < 1000 ? `${r} மீட்டர்` : `${kmValue(r)} கிலோமீட்டர்`;
  if (r < 1000) return `${r} metres`;
  const km = kmValue(r);
  return `${km} ${km === 1 ? 'kilometre' : 'kilometres'}`;
}

const UNITS = { ms: ['j', 'min'], en: ['hr', 'min'], zh: ['小时', '分钟'], ta: ['மணி', 'நிமி'] };

export function fmtDuration(seconds, lang) {
  const mins = Math.max(1, Math.round(seconds / 60));
  const [hour, min] = UNITS[lang] || UNITS.en;
  if (mins < 60) return `${mins} ${min}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} ${hour} ${m} ${min}` : `${h} ${hour}`;
}

// A length of time as it's said aloud.
export function sayDuration(seconds, lang) {
  const mins = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(mins / 60), m = mins % 60;
  if (lang === 'ms') return [h ? `${h} jam` : '', m ? `${m} minit` : ''].filter(Boolean).join(' ');
  if (lang === 'zh') return `${h ? `${h}小时` : ''}${m ? `${m}分钟` : ''}`;
  if (lang === 'ta') return [h ? `${h} மணி நேரம்` : '', m ? `${m} நிமிடம்` : ''].filter(Boolean).join(' ');
  const part = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  return [h ? part(h, 'hour') : '', m ? part(m, 'minute') : ''].filter(Boolean).join(' ');
}

// How each language writes dates and times in Malaysia.
export const LOCALES = { ms: 'ms-MY', en: 'en-MY', zh: 'zh-MY', ta: 'ta-MY' };
export const localeOf = (lang) => LOCALES[lang] || LOCALES.en;

export function fmtClock(date, lang) {
  return date.toLocaleTimeString(localeOf(lang), { hour: 'numeric', minute: '2-digit' });
}
