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
  if (r < 1000) return `${r} metres`;
  const km = kmValue(r);
  return `${km} ${km === 1 ? 'kilometre' : 'kilometres'}`;
}

export function fmtDuration(seconds, lang) {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hour = lang === 'ms' ? 'j' : 'hr';
  return m ? `${h} ${hour} ${m} min` : `${h} ${hour}`;
}

export function fmtClock(date, lang) {
  return date.toLocaleTimeString(lang === 'ms' ? 'ms-MY' : 'en-MY', { hour: 'numeric', minute: '2-digit' });
}
