import { bearing, haversine } from './geo.js';

// The phone's GPS. Fills in speed and heading when the phone doesn't report them.
export class Gps {
  constructor(onFix, onError) {
    this.onFix = onFix;
    this.onError = onError;
    this.watch = null;
    this.prev = null;
    this.heading = null;
  }

  get running() { return this.watch != null; }

  start() {
    if (this.watch != null) return;
    if (!('geolocation' in navigator)) { this.onError({ code: 2 }); return; }
    this.watch = navigator.geolocation.watchPosition(
      (pos) => this._handle(pos),
      (err) => this.onError(err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
  }

  stop() {
    if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null;
  }

  // Phones can quietly end a watch while the app is in the background.
  restart() { this.stop(); this.start(); }

  _handle(pos) {
    const c = pos.coords;
    const fix = {
      lng: c.longitude,
      lat: c.latitude,
      accuracy: c.accuracy,
      speed: c.speed != null && c.speed >= 0 ? c.speed : null,
      heading: c.heading != null && !Number.isNaN(c.heading) ? c.heading : null,
      time: pos.timestamp || Date.now(),
    };
    if (this.prev) {
      const p = [this.prev.lng, this.prev.lat], q = [fix.lng, fix.lat];
      const moved = haversine(p, q);
      const dt = (fix.time - this.prev.time) / 1000;
      if (fix.speed == null && dt > 0) fix.speed = moved / dt;
      if (fix.heading == null && moved > 5) fix.heading = bearing(p, q);
    }
    if (fix.heading != null && (fix.speed ?? 0) > 1) this.heading = fix.heading;
    if (fix.heading == null || (fix.speed ?? 0) <= 1) fix.heading = this.heading;
    this.prev = fix;
    this.onFix(fix);
  }
}

// Drives a route without moving, so the whole trip can be tried from the sofa.
export class SimulatedDrive {
  constructor(route, onFix, { factor = 4, intervalMs = 1000, startAt = 0 } = {}) {
    this.route = route;
    this.onFix = onFix;
    this.factor = factor;
    this.intervalMs = intervalMs;
    this.s = startAt;
    this.t = Date.now();
    this.timer = null;
  }

  start() {
    this._tick();
    this.timer = setInterval(() => this._tick(), this.intervalMs);
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  _speedAt(s) {
    const { maneuvers } = this.route;
    let m = maneuvers[0];
    for (const x of maneuvers) { if (x.beginDist <= s) m = x; else break; }
    return m.time > 0 && m.length > 0 ? (m.length * 1000) / m.time : 12;
  }

  _tick() {
    const { coords, cum, length } = this.route;
    const v = this._speedAt(this.s);
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] <= this.s) i++;
    const span = cum[i + 1] - cum[i] || 1;
    const t = Math.min(1, (this.s - cum[i]) / span);
    this.t += this.intervalMs;
    this.onFix({
      lng: coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
      lat: coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
      accuracy: 8,
      speed: v,
      heading: bearing(coords[i], coords[i + 1]),
      time: this.t,
    });
    if (this.s >= length) { this.stop(); return; }
    this.s = Math.min(length, this.s + v * this.factor * (this.intervalMs / 1000));
  }
}
