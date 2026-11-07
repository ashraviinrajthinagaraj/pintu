// Notices how the drive is going, so a character has something to say about it.
// It works only from your speed, the road's limit and the clock, so all of it can
// be tested without a browser. Pintu has no live traffic, so a jam here means
// you've been crawling for a while on a road that should be quicker.
export const OVER_BY_KMH = 5;        // a speedometer reads a little high
export const OVER_HOLD_MS = 4000;    // passing a slower car shouldn't set it off
export const OVER_LONG_MS = 30000;
export const OVER_LONGER_MS = 90000;
export const OVER_AGAIN_MS = 120000; // the last warning, if it's still needed
export const OVER_REPEAT_MS = 90000; // the first remark, for a fresh burst of speed
export const UNDER_GRACE_MS = 5000;  // dipping under for a moment isn't slowing down

export const JAM_AFTER_MS = 120000;  // a long red light is shorter than this
export const JAM_LONG_MS = 480000;
export const JAM_GAP_MS = 300000;
export const JAM_MIN_ROAD_KMH = 40;  // a slow lane isn't a jam
export const JAM_MOVED_M = 30;       // sitting still isn't a jam, it might be a red light
export const JAM_CLEAR_MS = 20000;   // moving freely for this long ends it
export const PARKED_MS = 240000;     // not a metre in four minutes means you've stopped
const ROLLED_KMH = 25;               // leaving a car park isn't a jam either

export const DRIVE_BREAK_MS = 2 * 3600000;
export const DRIVE_BREAK_AGAIN_MS = 3600000;
export const RESTED_MS = 900000;

export const QUIET_MS = 480000;
export const QUIET_GAP_MS = 600000;
export const QUIET_CLEAR_M = 2000;   // nothing to say for a while yet
export const QUIET_MIN_KMH = 30;

export class DriveWatch {
  // `driving` carries on from an earlier trip with no proper rest between.
  constructor({ driving = 0 } = {}) {
    this.lastTime = null;
    // Over the limit.
    this.overSince = null;
    this.underSince = null;
    this.overTier = 0;
    this.lastFirst = -Infinity;
    this.lastStern = -Infinity;
    // Crawling.
    this.rolled = false;
    this.slowSince = null;
    this.freeSince = null;
    this.stillSince = null;
    this.moved = 0;
    this.inJam = false;
    this.lastJam = -Infinity;
    // Long days, and quiet roads.
    this.driving = Math.max(0, driving);
    // Already reminded on that trip: the next reminder is the next hour after.
    this.nextBreak = this.driving < DRIVE_BREAK_MS
      ? DRIVE_BREAK_MS
      : DRIVE_BREAK_MS + Math.ceil((this.driving - DRIVE_BREAK_MS + 1) / DRIVE_BREAK_AGAIN_MS) * DRIVE_BREAK_AGAIN_MS;
    this.lastHeard = null;
    this.lastQuiet = -Infinity;
  }

  // Two hours or more at the wheel without a proper rest.
  get tired() {
    return this.driving >= DRIVE_BREAK_MS;
  }

  // Whatever is said counts as talking, so a quiet remark waits for real quiet.
  heard(time) {
    this.lastHeard = time;
  }

  // Everything new to say something about, as a list of moment names.
  update({ time, kmh, limit = null, roadKmh = null, nearTurn = false, nearEnd = false, clearAhead = 0 }) {
    if (this.lastHeard == null) this.lastHeard = time;
    const dt = this.lastTime == null ? 0 : Math.min(Math.max(0, time - this.lastTime), 10000);
    this.lastTime = time;
    if (kmh == null) return [];
    const out = [];
    this._overLimit(time, kmh, limit, out);
    this._crawling(time, kmh, roadKmh, nearTurn, nearEnd, dt, out);
    this._longDay(time, kmh, dt, out);
    this._quiet(time, kmh, clearAhead, out);
    return out;
  }

  _overLimit(time, kmh, limit, out) {
    if (limit && kmh > limit + OVER_BY_KMH) {
      this.underSince = null;
      this.overSince ??= time;
      const held = time - this.overSince;
      if (held >= OVER_LONGER_MS) {
        if (this.overTier < 3 || time - this.lastStern >= OVER_AGAIN_MS) {
          this.overTier = 3;
          this.lastStern = time;
          out.push('overspeed3');
        }
      } else if (held >= OVER_LONG_MS) {
        if (this.overTier < 2) {
          this.overTier = 2;
          out.push('overspeed2');
        }
      } else if (held >= OVER_HOLD_MS && this.overTier < 1 && time - this.lastFirst >= OVER_REPEAT_MS) {
        this.overTier = 1;
        this.lastFirst = time;
        out.push('overspeed');
      }
      return;
    }
    if (this.overSince == null) return;
    this.underSince ??= time;
    if (time - this.underSince < UNDER_GRACE_MS) return;
    // Only worth praising after it had been going on for a while.
    if (this.overTier >= 2) out.push('slowed');
    this.overSince = null;
    this.underSince = null;
    this.overTier = 0;
  }

  _crawling(time, kmh, roadKmh, nearTurn, nearEnd, dt, out) {
    if (kmh >= ROLLED_KMH) this.rolled = true;
    const road = roadKmh ?? 0;
    const slowBelow = Math.min(20, Math.max(12, road * 0.3));
    const tracking = this.slowSince != null || (this.rolled && road >= JAM_MIN_ROAD_KMH);

    if (tracking && kmh < slowBelow) {
      this.freeSince = null;
      this.slowSince ??= time;
      this.moved += (kmh / 3.6) * (dt / 1000);
      if (kmh < 1.5) {
        this.stillSince ??= time;
        if (time - this.stillSince >= PARKED_MS) {
          // Not a jam after all: a stop, a queue for petrol, somewhere to be.
          this.slowSince = null;
          this.moved = 0;
          this.inJam = false;
          return;
        }
      } else {
        this.stillSince = null;
      }
      const slowFor = time - this.slowSince;
      if (!this.inJam) {
        if (slowFor >= JAM_AFTER_MS && this.moved >= JAM_MOVED_M && !nearTurn && !nearEnd && time - this.lastJam >= JAM_GAP_MS) {
          this.inJam = true;
          this.lastJam = time;
          out.push('jam');
        }
      } else if (time - this.lastJam >= JAM_LONG_MS && !nearEnd) {
        this.lastJam = time;
        out.push('jamLong');
      }
      return;
    }

    this.stillSince = null;
    if (this.slowSince == null) return;
    // Stop-start traffic has short bursts in it. Only keeping moving ends a jam.
    this.freeSince ??= time;
    if (time - this.freeSince < JAM_CLEAR_MS) return;
    if (this.inJam) out.push('jamClear');
    this.slowSince = null;
    this.freeSince = null;
    this.moved = 0;
    this.inJam = false;
  }

  _longDay(time, kmh, dt, out) {
    if (kmh >= 5) {
      this.restSince = null;
      this.driving += dt;
      if (this.driving >= this.nextBreak) {
        this.nextBreak += DRIVE_BREAK_AGAIN_MS;
        out.push('longDrive');
      }
      return;
    }
    this.restSince ??= time;
    if (time - this.restSince >= RESTED_MS) {
      this.driving = 0;
      this.nextBreak = DRIVE_BREAK_MS;
    }
  }

  _quiet(time, kmh, clearAhead, out) {
    if (kmh < QUIET_MIN_KMH || clearAhead < QUIET_CLEAR_M) return;
    if (time - this.lastHeard < QUIET_MS || time - this.lastQuiet < QUIET_GAP_MS) return;
    this.lastQuiet = time;
    out.push('quiet');
  }
}
