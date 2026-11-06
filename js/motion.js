// GPS reports about once a second, but a screen draws sixty times. This fills
// in the frames between fixes so the arrow glides instead of hopping: it moves
// at your current speed along the road, and eases toward each new fix.
import { angleDiff, bearing, clamp } from './geo.js';

const EXTRAPOLATE_MS = 2500;   // keep gliding this long after a fix, then wait
const CATCH_UP = 3.2;          // how quickly the arrow closes the gap to a fix
const TURN = 4.5;              // how quickly the arrow's direction follows the road
const SNAP_M = 200;            // a jump this big is a real jump, not GPS noise
const BACK_TOLERANCE_M = 30;   // small corrections backwards are simply waited out

export function turnToward(from, to, amount) {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * amount + 360) % 360;
}

export function pointAt(route, s) {
  const { coords, cum } = route;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid - 1;
  }
  const i = Math.min(lo, coords.length - 2);
  const span = cum[i + 1] - cum[i] || 1;
  const t = clamp((s - cum[i]) / span, 0, 1);
  return [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t];
}

export class Motion {
  constructor() {
    this.route = null;
    this.free = null;       // the last position when not following a route
    this.fixAt = 0;
    this.targetS = 0;
    this.speed = 0;
    this.s = null;
    this.pos = null;
    this.heading = null;
    this.lastFrame = null;
  }

  setRoute(route) {
    this.route = route;
    this.s = null;
    this.free = null;
  }

  clearRoute() {
    this.route = null;
    this.s = null;
  }

  // Placed somewhere new on purpose: no gliding there, and facing the new road.
  jump(s, now) {
    this.free = null;
    this.s = s;
    this.targetS = s;
    this.speed = 0;
    this.fixAt = now;
    this.pos = null;
    this.heading = null;
  }

  // On the route: progress along it.
  onRoute(s, speed, now) {
    this.free = null;
    this.targetS = s;
    this.speed = speed > 0.6 ? speed : 0;
    this.fixAt = now;
    if (this.s == null || Math.abs(s - this.s) > SNAP_M) this.s = s;
  }

  // Off the route, or no route at all: a position and direction.
  offRoute(lng, lat, heading, speed, now) {
    this.free = { lng, lat, heading };
    this.speed = speed > 0.6 ? speed : 0;
    this.fixAt = now;
    if (!this.pos) this.pos = [lng, lat];
  }

  frame(now) {
    const dt = this.lastFrame == null ? 0 : Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    const ease = 1 - Math.exp(-dt * CATCH_UP);
    const turn = 1 - Math.exp(-dt * TURN);
    const age = now - this.fixAt;
    const moving = age < EXTRAPOLATE_MS ? this.speed : 0;

    let wanted = null;
    if (this.free) {
      const f = this.free;
      let target = [f.lng, f.lat];
      if (moving && f.heading != null) {
        const metres = moving * Math.min(age, EXTRAPOLATE_MS) / 1000;
        const r = (f.heading * Math.PI) / 180;
        target = [
          f.lng + (Math.sin(r) * metres) / (111320 * Math.cos((f.lat * Math.PI) / 180)),
          f.lat + (Math.cos(r) * metres) / 110540,
        ];
      }
      this.pos = this.pos
        ? [this.pos[0] + (target[0] - this.pos[0]) * ease, this.pos[1] + (target[1] - this.pos[1]) * ease]
        : target;
      if (Math.abs(target[0] - this.pos[0]) > 0.01 || Math.abs(target[1] - this.pos[1]) > 0.01) this.pos = target;
      wanted = f.heading;
    } else if (this.route && this.s != null) {
      const predicted = this.targetS + moving * Math.min(age, EXTRAPOLATE_MS) / 1000;
      const gap = predicted - this.s;
      // Glide at road speed, plus a share of whatever gap remains. Never creep
      // backwards for ordinary GPS wobble, because that's what looks wrong.
      let step = moving * dt + (gap - moving * dt) * ease;
      if (gap < 0 && gap > -BACK_TOLERANCE_M) step = 0;
      this.s = clamp(this.s + step, 0, this.route.length);
      this.pos = pointAt(this.route, this.s);
      // Aim a little ahead so bends are taken as a curve instead of a corner.
      const ahead = clamp(Math.max(this.speed, 5) * 1.2, 12, 70);
      const further = pointAt(this.route, Math.min(this.route.length, this.s + ahead));
      if (further[0] !== this.pos[0] || further[1] !== this.pos[1]) wanted = bearing(this.pos, further);
    }

    if (wanted != null) {
      this.heading = this.heading == null ? wanted : turnToward(this.heading, wanted, turn);
    }
    return this.pos ? { lng: this.pos[0], lat: this.pos[1], heading: this.heading, s: this.s } : null;
  }
}

export { angleDiff };
