// A person's car and what a trip will take out of it. Every answer here is an
// estimate from what they typed in, and the app says so wherever it shows one.

// Starting points only. They can be changed once picked. Sources are in the README.
export const PRESETS = [
  { name: 'Perodua Axia 1.0', kind: 'petrol', consumption: 6.5 },
  { name: 'Perodua Myvi 1.5', kind: 'petrol', consumption: 6.3 },
  { name: 'Honda City 1.5', kind: 'petrol', consumption: 6.3 },
  { name: 'Toyota Vios 1.5', kind: 'petrol', consumption: 6.5 },
  { name: 'Nissan Almera 1.0T', kind: 'petrol', consumption: 5.8 },
  { name: 'Proton eMas 5 Prime', kind: 'ev', range: 225, consumption: 13.4 },
  { name: 'Proton eMas 5 Premium', kind: 'ev', range: 325, consumption: 12.4 },
  { name: 'Proton eMas 7 Prime', kind: 'ev', range: 345, consumption: 14.4 },
  { name: 'Proton eMas 7 Premium', kind: 'ev', range: 410, consumption: 14.7 },
  { name: 'Proton eMas 7 Premium Plus', kind: 'ev', range: 450, consumption: 15.2 },
  { name: 'BYD Atto 3 Ultra', kind: 'ev', range: 410, consumption: 12.2 },
  { name: 'BYD Atto 3 Premium', kind: 'ev', range: 510, consumption: 14.7 },
];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function cleanVehicle(v) {
  if (!v) return null;
  const kind = ['petrol', 'diesel', 'ev'].includes(v.kind) ? v.kind : 'petrol';
  const clean = {
    name: (v.name || '').trim(),
    kind,
    consumption: num(v.consumption),
    range: num(v.range),
    price: num(v.price),
    level: Math.min(100, Math.max(0, Number.isFinite(Number(v.level)) ? Number(v.level) : 100)),
  };
  return clean.consumption || clean.range ? clean : null;
}

export const kmPerLitreToL100 = (kmPerL) => (kmPerL > 0 ? 100 / kmPerL : null);
export const l100ToKmPerLitre = (l100) => (l100 > 0 ? 100 / l100 : null);

// Keep this much in hand: real driving often uses more than the figures say,
// and stations aren't everywhere.
export function reserveKm(v) {
  return v.range ? Math.max(30, v.range * 0.1) : 30;
}

export function rangeLeft(v, drivenKm = 0) {
  if (!v.range) return null;
  return (v.range * v.level) / 100 - drivenKm;
}

export function tripPlan(v, tripKm) {
  if (!v) return null;
  const used = v.consumption ? (tripKm * v.consumption) / 100 : null;
  const cost = used != null && v.price ? used * v.price : null;
  const plan = { kind: v.kind, unit: v.kind === 'ev' ? 'kWh' : 'L', used, cost, status: 'unknown', rangeNow: null, rangeAtEnd: null, refillWithinKm: null };
  if (v.range) {
    const reserve = reserveKm(v);
    plan.rangeNow = rangeLeft(v);
    plan.rangeAtEnd = plan.rangeNow - tripKm;
    if (plan.rangeAtEnd >= reserve) plan.status = 'enough';
    else if (plan.rangeAtEnd >= 0) plan.status = 'tight';
    else plan.status = 'short';
    // Plan to stop while there's still some reserve left.
    if (plan.status !== 'enough') plan.refillWithinKm = Math.max(0, plan.rangeNow - reserve);
  }
  return plan;
}

// What's left after a drive, as a level for next time.
export function levelAfter(v, drivenKm) {
  if (!v.range) return v.level;
  return Math.max(0, Math.round(v.level - (drivenKm / v.range) * 100));
}

export function rangeWarning(v, drivenKm, remainingKm) {
  const left = rangeLeft(v, drivenKm);
  if (left == null) return null;
  const reserve = reserveKm(v);
  if (left > reserve) return null;
  // Close to the destination with enough to get there: no need to worry anyone.
  if (remainingKm + 5 < left) return null;
  return { left: Math.max(0, left), urgent: left <= reserve / 2 };
}
