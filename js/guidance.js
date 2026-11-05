// The navigator's brain: given GPS fixes and a route, works out where you are
// along it, what comes next, what to say and when you've left the route.
// It has no idea the browser exists, so all of it can be tested without one.
import { angleDiff, bearing, clamp, haversine, projectOnSegment } from './geo.js';

const BACK_SLACK = 25;      // metres progress may slip back from GPS jitter
const DEST_RADIUS = 25;     // metres from the destination that count as arrived
const OFF_SECONDS = 6;      // how long you must be away before re-routing
const WRONG_WAY_SECONDS = 8;

export function promptDistances(speed) {
  const v = Math.max(speed || 0, 8);
  if (v >= 22) return { far: 2000, now: v * 9 };   // from about 80 km/h
  if (v >= 14) return { far: 700, now: v * 6 };    // from about 50 km/h
  return { far: 300, now: Math.max(40, v * 5) };
}

export class Guidance {
  constructor(route) {
    this.route = route;
    this.s = 0;
    this.seg = 0;
    this.lastTime = null;
    this.offSince = null;
    this.wrongSince = null;
    this.everOn = false;
    this.firstFix = null;
    this.spoken = new Set();
    this.lastNext = null;
    this.started = false;
    this.arrived = false;
    this.lastState = null;
  }

  update(fix) {
    const p = [fix.lng, fix.lat];
    const accuracy = fix.accuracy ?? 20;
    const speed = fix.speed ?? 0;
    const { coords, cum, length } = this.route;
    if (!this.firstFix) this.firstFix = p;

    const weak = accuracy > 100;
    const threshold = clamp(accuracy * 1.5, 30, 75);
    const dt = this.lastTime ? Math.max(1, (fix.time - this.lastTime) / 1000) : 1;
    this.lastTime = fix.time;

    const reach = Math.max(150, Math.max(speed, 15) * dt * 1.6 + 60);
    let match = this._nearest(p, fix, this.s - BACK_SLACK, this.s + reach);

    // Further along the route? That's a shortcut, or GPS returning after a tunnel.
    if (match.dist > threshold && !weak) {
      const ahead = this._nearest(p, fix, this.s + reach, length, threshold);
      if (ahead) match = ahead;
    }

    const onRoute = match.dist <= threshold;
    if (onRoute && !weak) this.everOn = true;

    let offRoute = false;
    if (!weak) {
      offRoute = this._checkOff(p, fix, onRoute, match);
    }

    if (onRoute && !weak && !offRoute) {
      const s = match.s;
      this.s = s < this.s ? Math.max(s, this.s - BACK_SLACK) : s;
      this.seg = match.seg;
    }

    const state = this._state(p, fix, onRoute && !offRoute, match, offRoute, weak, accuracy);
    state.prompts = this._prompts(state, speed);
    this.lastState = state;
    return state;
  }

  // Say the current instruction again on request, or after a pause.
  repeat() {
    const st = this.lastState;
    if (!st || st.arrived) return null;
    return { kind: 'repeat', index: st.nextIndex, distance: st.distanceToNext };
  }

  _nearest(p, fix, from, to, within = Infinity) {
    const { coords, cum } = this.route;
    let i = 0;
    // Binary search for the first segment that reaches `from`.
    let lo = 0, hi = cum.length - 1;
    const start = Math.max(0, from);
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid + 1] !== undefined && cum[mid + 1] < start) lo = mid + 1;
      else hi = mid;
    }
    i = Math.min(lo, coords.length - 2);

    const useHeading = fix.heading != null && (fix.speed ?? 0) >= 3;
    let best = null, bestScore = Infinity;
    for (; i < coords.length - 1 && cum[i] <= to; i++) {
      const pr = projectOnSegment(p, coords[i], coords[i + 1]);
      if (pr.dist > within) continue;
      const segBearing = bearing(coords[i], coords[i + 1]);
      const opposite = useHeading && angleDiff(fix.heading, segBearing) > 100;
      if (within !== Infinity && opposite) continue;
      const score = pr.dist + (opposite ? 25 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { dist: pr.dist, point: pr.point, seg: i, bearing: segBearing, s: cum[i] + (cum[i + 1] - cum[i]) * pr.t };
      }
    }
    if (within !== Infinity) return best;
    return best || { dist: Infinity, point: p, seg: this.seg, bearing: 0, s: this.s };
  }

  _checkOff(p, fix, onRoute, match) {
    const t = fix.time;
    if (onRoute) {
      this.offSince = null;
      const opposite = (fix.speed ?? 0) >= 4 && fix.heading != null && angleDiff(fix.heading, match.bearing) > 135;
      if (!opposite) { this.wrongSince = null; return false; }
      if (this.wrongSince == null) this.wrongSince = t;
      return t - this.wrongSince >= WRONG_WAY_SECONDS * 1000;
    }
    this.wrongSince = null;
    // Starting in a car park or side lane is normal. Don't call that lost
    // until you've actually moved away from where you began.
    if (!this.everOn && haversine(p, this.firstFix) < 150) { this.offSince = null; return false; }
    if (this.offSince == null) this.offSince = t;
    return t - this.offSince >= OFF_SECONDS * 1000;
  }

  _state(p, fix, onRoute, match, offRoute, weak, accuracy) {
    const { maneuvers, length, coords } = this.route;
    const s = this.s;
    let nextIndex = maneuvers.length - 1;
    for (let i = 0; i < maneuvers.length; i++) {
      if (maneuvers[i].beginDist > s + 3) { nextIndex = i; break; }
    }
    const currentIndex = Math.max(0, nextIndex - 1);
    const next = maneuvers[nextIndex];

    const remainingDistance = Math.max(0, length - s);
    const cur = maneuvers[currentIndex];
    const curLen = Math.max(1, next.beginDist - cur.beginDist);
    const fractionLeft = clamp((next.beginDist - s) / curLen, 0, 1);
    const remainingTime = cur.time * fractionLeft + next.timeFromHere;

    const toEnd = haversine(p, coords[coords.length - 1]);
    if (!this.arrived && !weak && this.everOn &&
        (remainingDistance < DEST_RADIUS || (toEnd < DEST_RADIUS && s > length * 0.5))) {
      this.arrived = true;
    }

    const then = maneuvers[nextIndex + 1];
    const gap = then ? then.beginDist - next.beginDist : Infinity;

    return {
      s,
      snapped: onRoute ? match.point : p,
      roadBearing: onRoute ? match.bearing : null,
      onRoute,
      offRoute,
      weak,
      accuracy,
      arrived: this.arrived,
      nextIndex,
      currentIndex,
      next,
      distanceToNext: Math.max(0, next.beginDist - s),
      then: gap < 300 ? then : null,
      remainingDistance,
      remainingTime,
    };
  }

  _prompts(st, speed) {
    if (st.arrived) {
      if (this.spoken.has('arrive')) return [];
      this.spoken.add('arrive');
      return [{ kind: 'arrive', index: st.nextIndex }];
    }
    if (st.offRoute) return [];

    const out = [];
    const i = st.nextIndex;
    const d = st.distanceToNext;
    const { far, now } = promptDistances(speed);

    if (!this.started) {
      this.started = true;
      this.lastNext = i;
      if (d <= far) this.spoken.add(`${i}:far`);
      if (d <= now) this.spoken.add(`${i}:now`);
      return [{ kind: 'intro', index: i, distance: d }];
    }

    const changed = this.lastNext !== i;
    this.lastNext = i;

    if (d <= now) {
      if (!this.spoken.has(`${i}:now`)) {
        this.spoken.add(`${i}:now`);
        this.spoken.add(`${i}:far`);
        const prompt = { kind: 'now', index: i, distance: d };
        const m = this.route.maneuvers;
        if (m[i + 1] && m[i + 1].beginDist - m[i].beginDist < 150) prompt.thenIndex = i + 1;
        out.push(prompt);
      }
    } else if (d <= far) {
      if (!this.spoken.has(`${i}:far`) && d > now * 1.5) {
        this.spoken.add(`${i}:far`);
        out.push({ kind: 'far', index: i, distance: d });
      }
    } else if (changed && d > 2000) {
      out.push({ kind: 'continue', index: i, distance: d });
    }
    return out;
  }
}
