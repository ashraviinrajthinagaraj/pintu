// Looking after the car: the next service by distance, and the road tax and
// insurance renewal dates. The odometer is your reading on the day you typed it,
// plus the drives Pintu has counted since, so it drifts a little; type it again
// whenever you look.

export const SERVICE_SOON_KM = 500;
export const DATE_SOON_DAYS = [30, 7, 1];   // reminded as each of these is reached
const DAY_MS = 86400e3;

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00+08:00`));
const km = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 3e6 ? Math.round(Number(v)) : null);

export function cleanCare(c) {
  return {
    odometer: km(c?.odometer),
    odometerAt: Number(c?.odometerAt) || 0,
    serviceAt: km(c?.serviceAt),
    roadTax: isDate(c?.roadTax) ? c.roadTax : null,
    insurance: isDate(c?.insurance) ? c.insurance : null,
    seen: c?.seen && typeof c.seen === 'object' ? c.seen : {},
  };
}

// Your reading, plus the car's drives since you typed it.
export function odometerNow(care, trips) {
  const c = cleanCare(care);
  if (c.odometer == null) return null;
  const since = (trips || []).filter((t) => t.mode !== 'motorcycle' && t.at > c.odometerAt).reduce((sum, t) => sum + (t.km || 0), 0);
  return Math.round(c.odometer + since);
}

// Days from today (Malaysian date) to a YYYY-MM-DD date.
export function daysUntil(date, now = Date.now()) {
  const today = Date.parse(`${new Date(now + 8 * 3600e3).toISOString().slice(0, 10)}T00:00:00+08:00`);
  return Math.round((Date.parse(`${date}T00:00:00+08:00`) - today) / DAY_MS);
}

// What's due, most urgent first: { kind, days?, kmLeft?, step }. `step` is the
// threshold reached, so each is shown once per threshold until dealt with.
export function careDue(care, trips, now = Date.now()) {
  const c = cleanCare(care);
  const out = [];
  const odo = odometerNow(c, trips);
  if (odo != null && c.serviceAt != null) {
    const kmLeft = c.serviceAt - odo;
    if (kmLeft <= SERVICE_SOON_KM) out.push({ kind: 'service', kmLeft, step: kmLeft <= 0 ? 'over' : 'soon', urgency: kmLeft });
  }
  for (const kind of ['roadTax', 'insurance']) {
    if (!c[kind]) continue;
    const days = daysUntil(c[kind], now);
    const step = days < 0 ? 'over' : DATE_SOON_DAYS.slice().reverse().find((d) => days <= d);
    if (step != null) out.push({ kind, days, date: c[kind], step: String(step), urgency: days * 50 });
  }
  return out.sort((a, b) => a.urgency - b.urgency);
}

// Due and not yet seen at this threshold.
export const careToShow = (care, trips, now = Date.now()) => {
  const c = cleanCare(care);
  return careDue(c, trips, now).filter((d) => c.seen[`${d.kind}:${d.kind === 'service' ? c.serviceAt : c[d.kind]}`] !== d.step);
};

export function markSeen(care, due) {
  const c = cleanCare(care);
  const seen = { ...c.seen };
  for (const d of due) seen[`${d.kind}:${d.kind === 'service' ? c.serviceAt : c[d.kind]}`] = d.step;
  return { ...c, seen };
}
