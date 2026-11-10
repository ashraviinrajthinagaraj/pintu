// Traffic lights the map doesn't know, learned from where your drives stop.
// A stop like a red light: standing still for 15 seconds to two and a half
// minutes, then away and on for 150 m without stopping again (a jam stops and
// starts). The same spot on three different days, with no light known near it,
// is worth asking about. The spots stay on this phone; only a light you say yes
// to is shared.
import { haversine } from './geo.js';

export const STILL_MS = 0.8;            // m/s: slower than this is standing still
export const AWAY_MS = 3;
export const MIN_STOP_S = 15;
export const MAX_STOP_S = 150;
export const CLEAR_M = 150;
export const SAME_SPOT_M = 30;
export const DAYS_TO_ASK = 3;
export const NEAR_LIGHT_M = 60;
const KEEP_MS = 120 * 86400e3;
const MAX_SPOTS = 300;

export class StopWatch {
  constructor() {
    this.still = null;      // { time, lng, lat, road } while stopped
    this.pending = null;    // a stop that ended, waiting to see it wasn't a jam
  }

  // Each position: GPS time (ms), speed (m/s), where, and the road's name.
  // Returns a light-like stop once it's sure, or null.
  note({ time, speed, lng, lat, road = '' }) {
    if (speed == null) return null;
    if (speed < STILL_MS) {
      // Stopping again soon after: stop-and-go traffic, not a light.
      if (this.pending && haversine([lng, lat], [this.pending.lng, this.pending.lat]) < CLEAR_M) this.pending = null;
      this.still ??= { time, lng, lat, road };
      return null;
    }
    if (this.still && speed > AWAY_MS) {
      const secs = (time - this.still.time) / 1000;
      this.pending = secs >= MIN_STOP_S && secs <= MAX_STOP_S ? { ...this.still, at: time } : null;
      this.still = null;
    }
    if (this.pending && haversine([lng, lat], [this.pending.lng, this.pending.lat]) >= CLEAR_M) {
      const done = this.pending;
      this.pending = null;
      return done;
    }
    return null;
  }
}

const dayOf = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);

export function rememberStop(spots, stop, now = Date.now()) {
  const list = (spots || []).filter((s) => now - s.last < KEEP_MS);
  const day = dayOf(stop.at ?? now);
  const same = list.find((s) => haversine([s.lng, s.lat], [stop.lng, stop.lat]) <= SAME_SPOT_M);
  if (same) {
    same.count += 1;
    same.last = now;
    if (!same.days.includes(day)) same.days = [...same.days, day].slice(-10);
    if (stop.road && !same.road) same.road = stop.road;
    return list;
  }
  list.push({ lng: stop.lng, lat: stop.lat, road: stop.road || '', count: 1, days: [day], last: now, done: false });
  return list.slice(-MAX_SPOTS);
}

// Spots worth asking about now: stopped at on enough days, not asked before,
// among those `here` says are on this trip, and with no light known nearby.
export function lightsToAsk(spots, known, here = () => true) {
  return (spots || []).filter((s) => !s.done && s.days.length >= DAYS_TO_ASK && here(s)
    && !(known || []).some((k) => haversine([k.lng, k.lat], [s.lng, s.lat]) <= NEAR_LIGHT_M));
}

export function settleSpot(spots, spot) {
  return (spots || []).map((s) => (s.lng === spot.lng && s.lat === spot.lat ? { ...s, done: true } : s));
}
