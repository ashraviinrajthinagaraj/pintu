// BUDI95: the litres of subsidised RON95 used this month, against the monthly
// limit. Pintu only knows what your drives used, by its own estimate, so you can
// put in the real figure from MyKad's record or the pump receipts at any time;
// drives after that are added on top.

export const BUDI_GRADE = 'ron95_budi95';
// The limit has changed more than once (300 L, cut to 200 L in April 2026, 300 L
// again from September), so it's a setting, not a fact kept here.
export const DEFAULT_LIMIT_L = 300;
export const NEAR_SHARE = 0.8;

const monthKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export function cleanBudi(b) {
  const limit = Number(b?.limit);
  const fixed = b?.fixed && Number.isFinite(Number(b.fixed.litres)) && Number(b.fixed.litres) >= 0
    ? { month: String(b.fixed.month || ''), litres: Math.round(Number(b.fixed.litres) * 10) / 10, at: Number(b.fixed.at) || 0 }
    : null;
  return { limit: Number.isFinite(limit) && limit > 0 && limit <= 5000 ? Math.round(limit) : DEFAULT_LIMIT_L, fixed };
}

// Litres so far this month: your own figure if you gave one this month, plus
// the drives since; otherwise every drive this month on subsidised petrol.
export function budiUsed(trips, budi, now = Date.now()) {
  const b = cleanBudi(budi);
  const month = monthKey(now);
  const fixed = b.fixed?.month === month ? b.fixed : null;
  let litres = fixed ? fixed.litres : 0;
  let added = false;
  for (const t of trips || []) {
    if (t.g !== BUDI_GRADE || !(t.l > 0) || monthKey(t.at) !== month) continue;
    if (fixed && t.at <= fixed.at) continue;
    litres += t.l;
    added = true;
  }
  litres = Math.round(litres * 10) / 10;
  // A guess unless it's exactly the figure you gave.
  return { litres, limit: b.limit, share: litres / b.limit, near: litres >= b.limit * NEAR_SHARE, over: litres >= b.limit, guessed: !fixed || added };
}

// After a trip of `more` litres, would the month go near or over the limit?
export function budiAfter(used, more) {
  const litres = Math.round((used.litres + (more || 0)) * 10) / 10;
  return { ...used, litres, share: litres / used.limit, near: litres >= used.limit * NEAR_SHARE, over: litres >= used.limit };
}
