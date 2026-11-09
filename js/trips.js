// A short line about each drive, kept on this phone and nowhere else, for a
// summary of the month: how far, how long, how much of it was spent crawling,
// and roughly what the fuel cost.
import { load, remove, save } from './store.js';

const KEY = 'trips';
export const KEEP_MONTHS = 13;
const MAX_TRIPS = 2500;
// Shorter than this is moving the car, not a trip.
export const MIN_KM = 0.3;
// Slower than this counts as stuck: a jam, or waiting at lights.
export const CRAWL_MS = 10 / 3.6;

const monthOf = (ms) => {
  const d = new Date(ms);
  return { year: d.getFullYear(), month: d.getMonth() };
};

export function keptTrips() {
  const list = load(KEY, []);
  return Array.isArray(list) ? list.filter((t) => t && Number.isFinite(t.at) && t.km > 0) : [];
}

export function forgetTrips() { remove(KEY); }

// Only the figures, and the place's name so the month can say where you went most.
export function cleanTrip(t) {
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
  return {
    at: Math.round(n(t.at)),
    km: Math.round(n(t.km) * 10) / 10,
    s: Math.round(n(t.s)),
    slow: Math.round(Math.min(n(t.slow), n(t.s))),
    cost: t.cost != null && Number.isFinite(Number(t.cost)) && t.cost > 0 ? Math.round(t.cost * 100) / 100 : null,
    mode: ['car', 'motorcycle'].includes(t.mode) ? t.mode : 'car',
    to: String(t.to || '').slice(0, 60),
    // For BUDI95: the litres used, and which fuel.
    l: Number.isFinite(Number(t.l)) && t.l != null && Number(t.l) > 0 ? Math.round(Number(t.l) * 10) / 10 : null,
    g: typeof t.g === 'string' && /^[a-z0-9_]{2,24}$/.test(t.g) ? t.g : null,
    // For claiming mileage: marked as work, and where it started.
    w: !!t.w,
    from: String(t.from || '').slice(0, 60),
  };
}

// The drive just ended, changed: marked as work, or not. Only soon after.
export function markLastTrip(patch, now = Date.now()) {
  const list = keptTrips();
  const last = list[list.length - 1];
  if (!last || now - last.at > 30 * 60e3) return null;
  list[list.length - 1] = cleanTrip({ ...last, ...patch });
  save(KEY, list);
  return list[list.length - 1];
}

export function recordTrip(trip, now = Date.now()) {
  if (!(trip?.km >= MIN_KM)) return false;
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - KEEP_MONTHS, 1);
  cutoff.setHours(0, 0, 0, 0);
  const list = keptTrips().filter((t) => t.at >= cutoff.getTime());
  list.push(cleanTrip({ at: now, ...trip }));
  save(KEY, list.slice(-MAX_TRIPS));
  return true;
}

// Months that have any trips, newest first, as { year, month } with month from 0.
export function tripMonths(trips) {
  const seen = new Map();
  for (const t of trips) {
    const m = monthOf(t.at);
    seen.set(m.year * 12 + m.month, m);
  }
  return [...seen.entries()].sort((a, b) => b[0] - a[0]).map(([, m]) => m);
}

export function monthSummary(trips, year, month) {
  const inMonth = (t, y, m) => { const d = new Date(t.at); return d.getFullYear() === y && d.getMonth() === m; };
  const these = trips.filter((t) => inMonth(t, year, month));
  const days = new Date(year, month + 1, 0).getDate();
  const perDay = Array(days).fill(0);
  const places = new Map();
  let km = 0, seconds = 0, slow = 0, cost = 0, costed = 0, longest = null;
  for (const t of these) {
    km += t.km;
    seconds += t.s;
    slow += t.slow;
    if (t.cost != null) { cost += t.cost; costed++; }
    perDay[new Date(t.at).getDate() - 1] += t.km;
    if (!longest || t.km > longest.km) longest = t;
    if (t.to) places.set(t.to, (places.get(t.to) || 0) + 1);
  }
  let top = null;
  for (const [name, count] of places) if (count >= 2 && (!top || count > top.count)) top = { name, count };
  const before = month === 0 ? [year - 1, 11] : [year, month - 1];
  const prevKm = trips.filter((t) => inMonth(t, ...before)).reduce((sum, t) => sum + t.km, 0);
  return {
    year, month,
    trips: these.length,
    km: Math.round(km * 10) / 10,
    seconds,
    slow,
    cost: costed ? Math.round(cost * 100) / 100 : null,
    // When only some trips had a price, the total is for those.
    costAll: costed === these.length,
    costed,
    longest: longest ? { km: longest.km, to: longest.to, at: longest.at } : null,
    top,
    perDay: perDay.map((v) => Math.round(v * 10) / 10),
    prevKm: Math.round(prevKm * 10) / 10,
  };
}

// Keeps count of time spent crawling, from one GPS fix to the next, and how
// long the drive took by the GPS's own clock.
export class CrawlClock {
  constructor() { this.slow = 0; this.first = null; this.last = null; }
  get span() { return this.first == null ? 0 : (this.last - this.first) / 1000; }
  add(time, speed) {
    if (this.first == null) this.first = time;
    if (this.last != null) {
      const dt = (time - this.last) / 1000;
      // A long gap is lost signal, not time sat in a jam.
      if (dt > 0 && dt <= 5 && speed != null && speed < CRAWL_MS) this.slow += dt;
    }
    this.last = time;
  }
}
