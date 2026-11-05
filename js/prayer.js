// Prayer times from JAKIM's published schedule for the zone you're in. Pintu
// never works them out itself: if the schedule can't be fetched, it shows nothing.
import { CONFIG } from './config.js';
import { haversine } from './geo.js';
import { load, save } from './store.js';

const ORDER = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
export const NAMES = { fajr: 'Subuh', dhuhr: 'Zohor', asr: 'Asar', maghrib: 'Maghrib', isha: 'Isyak' };

const BEFORE_MS = 30 * 60000;   // "close" means within the next half hour
const AFTER_MS = 15 * 60000;    // or within the last quarter hour
const MOVED_M = 25000;          // far enough that the zone might have changed
const RETRY_MS = 10 * 60000;

export function parseMonth(json) {
  if (!json || !Array.isArray(json.prayers) || !json.prayers.length) return null;
  const days = {};
  for (const p of json.prayers) {
    if (p.day) days[p.day] = Object.fromEntries(ORDER.map((n) => [n, Number(p[n]) * 1000]));
  }
  return { zone: json.zone, year: json.year, month: json.month_number, days };
}

function timesAround(data, now) {
  const d = new Date(now);
  if (data.year !== d.getFullYear() || data.month !== d.getMonth() + 1) return [];
  const out = [];
  for (const day of [d.getDate() - 1, d.getDate(), d.getDate() + 1]) {
    const times = data.days[day];
    if (times) for (const name of ORDER) if (times[name]) out.push({ name, at: times[name] });
  }
  return out.sort((a, b) => a.at - b.at);
}

// A prayer that has just come in, or is about to.
export function closePrayer(data, now) {
  if (!data) return null;
  const times = timesAround(data, now);
  const justIn = times.filter((t) => t.at <= now && now - t.at <= AFTER_MS).pop();
  if (justIn) return { ...justIn, state: 'now', minutes: 0 };
  const soon = times.find((t) => t.at > now && t.at - now <= BEFORE_MS);
  return soon ? { ...soon, state: 'soon', minutes: Math.ceil((soon.at - now) / 60000) } : null;
}

// The first prayer to come in while you're on the road.
export function prayerDuringTrip(data, now, tripSeconds) {
  if (!data) return null;
  const end = now + tripSeconds * 1000;
  const hit = timesAround(data, now).find((t) => t.at > now && t.at <= end);
  return hit ? { ...hit, afterSeconds: (hit.at - now) / 1000 } : null;
}

export class PrayerTimes {
  constructor({ fetchImpl = (...a) => fetch(...a), onChange } = {}) {
    this.fetchImpl = fetchImpl;
    this.onChange = onChange;
    this.cached = load('solat', null);
    this.data = this.cached ? this.cached.data : null;
    this.busy = false;
    this.lastTry = 0;
  }

  // Called with your position now and then. Only goes to the network when it
  // has to: new month, new area, or nothing stored yet.
  async update(lat, lng, now = Date.now()) {
    if (this.busy || now - this.lastTry < RETRY_MS) return;
    const d = new Date(now);
    const c = this.cached;
    const sameMonth = c && c.data.year === d.getFullYear() && c.data.month === d.getMonth() + 1;
    if (sameMonth && haversine([c.lng, c.lat], [lng, lat]) < MOVED_M) return;

    this.busy = true;
    this.lastTry = now;
    try {
      // Two decimal places is about a kilometre: plenty to find the zone.
      const url = `${CONFIG.solatUrl}/${lat.toFixed(2)}/${lng.toFixed(2)}`;
      const res = await this.fetchImpl(url);
      if (!res.ok) throw new Error(`solat ${res.status}`);
      const data = parseMonth(await res.json());
      if (!data) throw new Error('solat: nothing usable');
      this.cached = { data, lat, lng };
      this.data = data;
      save('solat', this.cached);
      this.onChange?.();
    } catch {
      // Outside Malaysia, or the service is down. Old times from another month
      // or area must not linger as if they were right.
      if (!sameMonth) {
        this.data = null;
        this.onChange?.();
      }
    } finally {
      this.busy = false;
    }
  }
}
