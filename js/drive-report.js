// How a drive went, from the GPS: sudden braking, sharp starts, and time over
// the speed limit, with a mark out of 100. Phones measure speed well from GPS
// (the Doppler shift), about once a second. A single odd reading is ignored:
// speed is taken as the middle of the last three readings, and changes are
// judged over two seconds or so, not from one fix to the next.
// Kept on the phone with the trip's line, nowhere else.

export const HARD_BRAKE = 3.0;      // m/s², 11 km/h less each second: a sudden stop
export const HARD_START = 3.0;      // m/s², 11 km/h more each second: pulling away hard
export const BRAKE_FROM = 20 / 3.6; // braking only counts from above this speed
export const OVER_BY_KMH = 5;       // over the limit by more than this
export const MIN_KM = 1;            // shorter drives get no report
const WINDOW_S = [1.5, 3.5];        // speed change judged over this long
const MAX_GAP_S = 4;                // longer between fixes is lost signal
const MAX_ACCURACY_M = 30;          // rougher fixes aren't used

// The mark: 100 for a smooth drive within the limits, less for each hard
// brake and sharp start, and for time over the limit (as a share of the time
// the limit was known, so a long drive isn't marked down for being long).
export function driveScore({ brakes = 0, starts = 0, overS = 0, limitedS = 0 }) {
  const overShare = limitedS > 60 ? overS / limitedS : 0;
  const lost = brakes * 8 + starts * 4 + Math.min(40, Math.round(overShare * 100));
  return Math.max(0, Math.min(100, 100 - lost));
}

export class DriveReport {
  constructor() {
    this.recent = [];        // the last few seconds of fixes: { t, v }
    this.raw = [];           // the last three speeds as read
    this.brakes = 0;
    this.starts = 0;
    this.overS = 0;
    this.limitedS = 0;
    this.topMs = 0;
    this.braking = false;
    this.starting = false;
    this.last = null;
  }

  // A fix: `time` in ms, `speed` in m/s, `accuracy` in metres, `limit` in km/h (or null).
  add({ time, speed, accuracy = null, limit = null }) {
    if (!Number.isFinite(time) || !Number.isFinite(speed) || speed < 0 || (accuracy != null && accuracy > MAX_ACCURACY_M)) return;
    const last = this.last;
    this.last = { t: time, v: speed };
    if (last) {
      const dt = (time - last.t) / 1000;
      if (!(dt > 0) || dt > MAX_GAP_S) {
        this.recent = [];
        this.raw = [];
      } else if (limit > 0) {
        this.limitedS += dt;
        if (speed * 3.6 > limit + OVER_BY_KMH) this.overS += dt;
      }
    }
    this.raw = [...this.raw.slice(-2), speed];
    const v = [...this.raw].sort((x, y) => x - y)[Math.floor(this.raw.length / 2)];
    this.topMs = Math.max(this.topMs, v);
    this.recent.push({ t: time, v });
    while (this.recent.length && (time - this.recent[0].t) / 1000 > WINDOW_S[1]) this.recent.shift();
    // The change over the last couple of seconds.
    const from = this.recent.find((r) => (time - r.t) / 1000 >= WINDOW_S[0]);
    if (!from) return;
    const a = (v - from.v) / ((time - from.t) / 1000);
    if (a <= -HARD_BRAKE && from.v >= BRAKE_FROM) {
      if (!this.braking) this.brakes++;
      this.braking = true;
    } else if (a > -1) {
      this.braking = false;
    }
    if (a >= HARD_START) {
      if (!this.starting) this.starts++;
      this.starting = true;
    } else if (a < 1) {
      this.starting = false;
    }
  }

  get result() {
    const r = {
      brakes: this.brakes,
      starts: this.starts,
      overS: Math.round(this.overS),
      limitedS: Math.round(this.limitedS),
      topKmh: Math.round(this.topMs * 3.6),
    };
    return { ...r, score: driveScore(r) };
  }
}

// For the month: the average mark, and the totals, from the trips that have one.
export function monthDriving(trips) {
  const marked = trips.filter((t) => Number.isFinite(t.sc));
  if (!marked.length) return null;
  return {
    trips: marked.length,
    score: Math.round(marked.reduce((s, t) => s + t.sc, 0) / marked.length),
    brakes: marked.reduce((s, t) => s + (t.b || 0), 0),
    starts: marked.reduce((s, t) => s + (t.a || 0), 0),
    overS: marked.reduce((s, t) => s + (t.o || 0), 0),
  };
}
