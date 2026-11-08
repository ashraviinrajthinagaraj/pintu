// Malaysia's pump prices are set by the government each week and published on
// data.gov.my. A trip's cost uses them when you haven't typed in a price of
// your own. Pintu's server fetches them (data.gov.my answers only a few
// requests a minute) and the phone keeps a copy for half a day.
import { CONFIG } from './config.js';
import { load, save } from './store.js';

// The first of each is what most people pay.
export const GRADES = {
  petrol: ['ron95_budi95', 'ron95', 'ron97'],
  diesel: ['diesel', 'diesel_eastmsia'],
};

const KEEP_MS = 12 * 3600e3;
// Prices change every Wednesday. Older than this and it isn't this week's.
export const STALE_MS = 15 * 86400e3;

export const defaultGrade = (kind) => GRADES[kind]?.[0] || null;
export const cleanGrade = (kind, grade) => (GRADES[kind]?.includes(grade) ? grade : defaultGrade(kind));

export function officialPrice(fuel, v) {
  if (!fuel?.prices || !v || v.kind === 'ev') return null;
  const p = Number(fuel.prices[cleanGrade(v.kind, v.grade)]);
  return Number.isFinite(p) && p > 0 ? p : null;
}

// Your own price first, the official one otherwise. `priceFrom` says which.
export function priced(v, fuel) {
  if (!v) return v;
  if (v.price) return { ...v, priceFrom: 'own' };
  const price = officialPrice(fuel, v);
  // A vehicle saved before grades existed pays what most people pay.
  return price ? { ...v, grade: cleanGrade(v.kind, v.grade), price, priceFrom: 'official' } : { ...v, priceFrom: null };
}

// The prices the server passed on, checked: a missing or odd figure is left out.
export function cleanPrices(body) {
  if (!body?.prices || typeof body.prices !== 'object') return null;
  const prices = {};
  for (const grade of [...GRADES.petrol, ...GRADES.diesel]) {
    const n = Number(body.prices[grade]);
    if (Number.isFinite(n) && n > 0 && n < 20) prices[grade] = n;
  }
  if (!Object.keys(prices).length) return null;
  return { date: /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : null, prices };
}

export const isStale = (fuel, now = Date.now()) => !fuel?.date || now - Date.parse(`${fuel.date}T00:00:00+08:00`) > STALE_MS;

export function keptFuelPrices() { return load('fuelPrice', null); }

export async function fetchFuelPrices({ server = CONFIG.server, fetchImpl = globalThis.fetch, now = Date.now(), signal } = {}) {
  const kept = keptFuelPrices();
  if (kept && now - kept.at < KEEP_MS) return kept;
  if (!server) return kept;
  try {
    const res = await fetchImpl(`${server}/fuel`, { signal });
    if (!res.ok) throw new Error(`fuel prices: ${res.status}`);
    const fresh = cleanPrices(await res.json());
    if (!fresh) throw new Error('fuel prices: nothing usable');
    const keep = { ...fresh, at: now };
    save('fuelPrice', keep);
    return keep;
  } catch {
    // Last week's price is still a fair guess.
    return kept;
  }
}
