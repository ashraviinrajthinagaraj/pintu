// GPS reports about once a second, but a screen draws sixty times. This fills
// in the frames between fixes so the arrow glides instead of hopping: it moves
// at your current speed along the road, and eases toward each new fix.
//
// The arrow has a speed of its own that changes smoothly, like a car's. A new
// fix that disagrees a little changes how fast the arrow goes, never where it
// is, so there is no surge or jolt each second.
import { angleDiff, bearing, clamp } from './geo.js';

const GLIDE_MS = 2000;         // keep going at full speed this long after a fix,
const EXTRAPOLATE_MS = 3500;   // then slow to a stop by here, and wait
const CATCH_UP = 2.25;         // per second: how much of the gap to a fix is closed
const RESPOND = 9;             // per second: how quickly the arrow's own speed changes
const TURN = 6;                // how quickly the arrow's direction follows the road
const TURN_FREE = 4.5;         // the same off the route, where GPS directions are noisier
const SNAP_M = 200;            // a jump this big is a real jump, not GPS noise
const SNAP_FREE_DEG = 0.01;    // the same off the route, about a kilometre
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
    this.vel = 0;           // the arrow's own speed along the route, metres a second
    this.vel2 = null;       // and off the route, metres a second east and north
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
    this.vel = 0;
    this.vel2 = null;
    this.fixAt = now;
    this.pos = null;
    this.heading = null;
  }

  // On the route: progress along it. `now` is when the fix was taken, which
  // can be a little before it arrived.
  onRoute(s, speed, now) {
    const wasFree = !!this.free;
    this.free = null;
    this.targetS = s;
    this.speed = speed > 0.6 ? speed : 0;
    this.fixAt = now;
    if (this.s == null || Math.abs(s - this.s) > SNAP_M) {
      this.s = s;
      this.vel = this.speed;
    } else if (wasFree) {
      this.vel = this.speed;
    }
  }

  // Off the route, or no route at all: a position and direction.
  offRoute(lng, lat, heading, speed, now) {
    if (!this.free) this.vel2 = null;
    this.free = { lng, lat, heading };
    this.speed = speed > 0.6 ? speed : 0;
    this.fixAt = now;
    if (!this.pos) this.pos = [lng, lat];
  }

  frame(now) {
    const dt = this.lastFrame == null ? 0 : Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    const respond = 1 - Math.exp(-dt * RESPOND);
    const age = Math.max(0, now - this.fixAt);
    // Where you'd be by now at the speed of the last fix. Without GPS for a
    // while that slows to a stop, and the arrow waits there rather than going back.
    const fade = EXTRAPOLATE_MS - GLIDE_MS;
    const slowing = Math.min(Math.max(age - GLIDE_MS, 0), fade);
    const coasting = this.speed * (1 - slowing / fade);
    const travelled = (this.speed * (Math.min(age, GLIDE_MS) + slowing - (slowing * slowing) / (2 * fade))) / 1000;

    let wanted = null, turnRate = TURN;
    if (this.free) {
      const f = this.free;
      const kx = 111320 * Math.cos((f.lat * Math.PI) / 180), ky = 110540;
      const r = ((f.heading ?? 0) * Math.PI) / 180;
      const east = f.heading != null ? Math.sin(r) : 0, north = f.heading != null ? Math.cos(r) : 0;
      const target = [f.lng + (east * travelled) / kx, f.lat + (north * travelled) / ky];
      const far = !this.pos || Math.abs(target[0] - this.pos[0]) > SNAP_FREE_DEG || Math.abs(target[1] - this.pos[1]) > SNAP_FREE_DEG;
      if (far || !this.vel2) this.vel2 = [east * coasting, north * coasting];
      if (far) {
        this.pos = target;
      } else {
        // Split the gap into along the way you're heading and across it, so a
        // fix a little behind is waited out here too instead of backed up to.
        const gapE = (target[0] - this.pos[0]) * kx, gapN = (target[1] - this.pos[1]) * ky;
        const along = gapE * east + gapN * north;
        let wantAlong = coasting + along * CATCH_UP;
        if (along < 0 && along > -BACK_TOLERANCE_M) wantAlong = Math.max(0, wantAlong);
        const wantE = east * wantAlong + (gapE - east * along) * CATCH_UP;
        const wantN = north * wantAlong + (gapN - north * along) * CATCH_UP;
        this.vel2[0] += (wantE - this.vel2[0]) * respond;
        this.vel2[1] += (wantN - this.vel2[1]) * respond;
        // Stopped, and already there: stop now rather than roll on.
        if (!coasting && along <= 0) {
          const ahead = this.vel2[0] * east + this.vel2[1] * north;
          if (ahead > 0) { this.vel2[0] -= east * ahead; this.vel2[1] -= north * ahead; }
        }
        this.pos = [this.pos[0] + (this.vel2[0] * dt) / kx, this.pos[1] + (this.vel2[1] * dt) / ky];
      }
      wanted = f.heading;
      turnRate = TURN_FREE;
    } else if (this.route && this.s != null) {
      const predicted = this.targetS + travelled;
      const gap = predicted - this.s;
      // Road speed, plus a share of whatever gap remains. Never back up for
      // ordinary GPS wobble, because that's what looks wrong.
      let want = coasting + gap * CATCH_UP;
      if (gap < 0 && gap > -BACK_TOLERANCE_M) want = Math.max(0, want);
      this.vel += (want - this.vel) * respond;
      // Stopped, and already there: stop now rather than roll on.
      if (!coasting && gap <= 0 && this.vel > 0) this.vel = 0;
      this.s = clamp(this.s + this.vel * dt, 0, this.route.length);
      if ((this.s >= this.route.length && this.vel > 0) || (this.s <= 0 && this.vel < 0)) this.vel = 0;
      this.pos = pointAt(this.route, this.s);
      // Aim a little ahead so bends are taken as a curve instead of a corner.
      const ahead = clamp(Math.max(this.speed, 5) * 1.2, 12, 70);
      const further = pointAt(this.route, Math.min(this.route.length, this.s + ahead));
      if (further[0] !== this.pos[0] || further[1] !== this.pos[1]) wanted = bearing(this.pos, further);
    }

    if (wanted != null) {
      const turn = 1 - Math.exp(-dt * turnRate);
      this.heading = this.heading == null ? wanted : turnToward(this.heading, wanted, turn);
    }
    return this.pos ? { lng: this.pos[0], lat: this.pos[1], heading: this.heading, s: this.s } : null;
  }
}

export { angleDiff };
