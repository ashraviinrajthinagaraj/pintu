// The road ahead drawn lane by lane: dividers, painted arrows, and a guidance
// carpet leading into the lane you want. A phone's GPS can't tell which lane
// you're really in, so the car on screen follows the carpet. It shows where to be,
// not where you are.
import { clamp } from './geo.js';
import { laneView } from './instructions.js';
import { pointAt } from './motion.js';

export const LANE_WIDTH = 4;       // a little wider than life, so lanes read at a glance
const SAMPLE_M = 5;
const BEHIND_M = 45;
const AHEAD_MIN_M = 420;
const REBUILD_M = 30;
const APPROACH_M = 450;
const SHOULDER_M = 0.7;

const RIGHT_TYPES = new Set([9, 10, 11, 12, 18, 20, 23, 37]);
const LEFT_TYPES = new Set([13, 14, 15, 16, 19, 21, 24, 38]);

export const laneOffset = (index, count) => (index - (count - 1) / 2) * LANE_WIDTH;

// Malaysia keeps left, so with no reason to move, sit left of centre.
export const cruiseLane = (count) => Math.floor((count - 1) / 2);

const smooth = (t) => t * t * (3 - 2 * t);

// Which lane a manoeuvre wants. With lane arrows mapped, that's what they say.
// With only a lane count, the sensible side: on a keep-left road a right turn
// goes from the right and a left turn from the left.
export function laneTarget(m, count, from) {
  const view = laneView(m.lanes);
  if (view) {
    const wanted = view.some((l) => l.state === 'best') ? 'best' : 'ok';
    const picks = view.map((l, i) => (l.state === wanted ? i : -1)).filter((i) => i >= 0);
    const scaled = from == null ? (view.length - 1) / 2 : from;
    const index = picks.reduce((best, i) => (Math.abs(i - scaled) < Math.abs(best - scaled) ? i : best), picks[0]);
    return { index, count: view.length, view, source: 'data' };
  }
  if (count < 2) return null;
  if (RIGHT_TYPES.has(m.type)) return { index: count - 1, count, view: null, source: 'estimate' };
  if (LEFT_TYPES.has(m.type)) return { index: 0, count, view: null, source: 'estimate' };
  return null;
}

// Painted road arrows in metres: x to the right, y along the road.
const ARROWS = {
  straight: [[-0.22, 0], [0.22, 0], [0.22, 3.6], [0.66, 3.6], [0, 5.6], [-0.66, 3.6], [-0.22, 3.6]],
  right: [[-0.22, 0], [0.22, 0], [0.22, 2.3], [0.95, 2.3], [0.95, 1.5], [1.95, 2.6], [0.95, 3.7], [0.95, 2.9], [-0.22, 2.9]],
  slightRight: [[-0.22, 0], [0.22, 0], [0.22, 2.1], [0.95, 3.2], [1.28, 2.95], [1.42, 5.0], [0.05, 4.2], [0.5, 3.75], [-0.22, 2.6]],
  uturn: [[-0.22, 0], [0.22, 0], [0.22, 2.7], [1.02, 2.7], [1.02, 1.7], [0.6, 1.7], [1.24, 0.5], [1.88, 1.7], [1.46, 1.7], [1.46, 3.3], [-0.22, 3.3]],
};
const ARROW_FOR = {
  straight: ['straight', 1],
  right: ['right', 1], sharpRight: ['right', 1], slightRight: ['slightRight', 1], mergeRight: ['slightRight', 1],
  left: ['right', -1], sharpLeft: ['right', -1], slightLeft: ['slightRight', -1], mergeLeft: ['slightRight', -1],
  uturn: ['uturn', 1],
};
const MANEUVER_ARROW = {
  9: 'slightRight', 10: 'right', 11: 'sharpRight', 12: 'uturn', 13: 'uturn', 14: 'sharpLeft', 15: 'left', 16: 'slightLeft',
  18: 'slightRight', 19: 'slightLeft', 20: 'slightRight', 21: 'slightLeft', 23: 'slightRight', 24: 'slightLeft',
  37: 'slightRight', 38: 'slightLeft',
};

export class LaneScene {
  constructor(route, counts = []) {
    this.route = route;
    this.counts = counts;
    this.keys = [];
    this.active = false;
    this.builtAt = null;
    this.features = null;
    this.trimS = 0;
    this.ahead = AHEAD_MIN_M;
  }

  setCounts(counts) {
    this.counts = counts;
    this.builtAt = null;
  }

  countAt(s) {
    for (const m of this.route.maneuvers) {
      if (m.lanes && m.lanes.length >= 2 && s <= m.beginDist && s >= m.beginDist - APPROACH_M) return Math.min(8, m.lanes.length);
    }
    for (const c of this.counts) if (s >= c.from && s < c.to) return c.count;
    return 1;
  }

  // Lanes worth drawing here: the road has several, now and just ahead.
  wantsToShow(s) {
    return this.countAt(s) >= 2 && this.countAt(s + 60) >= 2;
  }

  plan(s, speed) {
    const v = Math.max(speed || 0, 8);
    const keys = [];
    const here = this.keys.length ? this.lateralAt(s) : laneOffset(cruiseLane(this.countAt(s)), this.countAt(s));
    keys.push({ s, d: here });
    let prev = here;
    let lastEnd = s;

    const add = (from, to, d) => {
      const a = Math.max(from, lastEnd);
      const b = Math.max(to, a + 5);
      keys.push({ s: a, d: prev }, { s: b, d });
      prev = d;
      lastEnd = b;
    };

    const horizon = s + Math.max(900, this.ahead * 2);
    for (const m of this.route.maneuvers) {
      if (m.beginDist <= s - 10) continue;
      if (m.beginDist > horizon) break;
      const before = this.countAt(m.beginDist - 5);
      const want = laneTarget(m, before, null);
      if (want) {
        const lead = clamp(v * 9, 70, 300);
        const settle = clamp(v * 3, 25, 90);
        const n = want.count;
        add(m.beginDist - lead, m.beginDist - settle, laneOffset(want.index, n));
      }
      const after = this.countAt(m.beginDist + 25);
      add(m.beginDist + 8, m.beginDist + 40, laneOffset(cruiseLane(after), after));
    }
    this.keys = keys.sort((a, b) => a.s - b.s);
  }

  lateralAt(s) {
    const k = this.keys;
    if (!k.length) return 0;
    if (s <= k[0].s) return k[0].d;
    for (let i = 1; i < k.length; i++) {
      if (s <= k[i].s) {
        const span = k[i].s - k[i - 1].s;
        const t = span > 0 ? (s - k[i - 1].s) / span : 1;
        return k[i - 1].d + (k[i].d - k[i - 1].d) * smooth(t);
      }
    }
    return k[k.length - 1].d;
  }

  // Degrees the car turns into a lane change, so it looks like one.
  yawAt(s) {
    return (Math.atan2(this.lateralAt(s + 4) - this.lateralAt(s), 4) * 180) / Math.PI;
  }

  // Called with each GPS fix. Returns true when the drawing needs replacing.
  update(s, speed) {
    const wants = this.wantsToShow(s);
    const changed = wants !== this.active;
    this.active = wants;
    if (!wants) {
      if (changed) { this.features = EMPTY; this.builtAt = null; this.keys = []; }
      return changed;
    }
    if (this.builtAt == null || Math.abs(s - this.builtAt) >= REBUILD_M) {
      this.ahead = Math.max(AHEAD_MIN_M, (speed || 0) * 18);
      this.plan(s, speed);
      this.features = this.build(s);
      this.builtAt = s;
      return true;
    }
    return changed;
  }

  _frame(s) {
    const p = pointAt(this.route, s);
    const a = pointAt(this.route, Math.max(0, s - 4));
    const b = pointAt(this.route, Math.min(this.route.length, s + 4));
    const k = Math.cos((p[1] * Math.PI) / 180);
    let tx = (b[0] - a[0]) * k, ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    // Metres to degrees here. Forward along the road, and to its right.
    const mLng = 1 / (111320 * k), mLat = 1 / 110540;
    return {
      at: (x, y) => [
        p[0] + (ty * x + tx * y) * mLng,
        p[1] + (-tx * x + ty * y) * mLat,
      ],
    };
  }

  build(s) {
    const route = this.route;
    const end = Math.min(route.length, s + this.ahead + REBUILD_M);
    const from = Math.max(0, s - BEHIND_M);
    const features = [];
    const poly = (k, ring, props = {}) => features.push({
      type: 'Feature', properties: { k, ...props }, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
    });
    const line = (k, coords) => {
      if (coords.length > 1) features.push({ type: 'Feature', properties: { k }, geometry: { type: 'LineString', coordinates: coords } });
    };

    const samples = [];
    for (let si = from; si <= end; si += SAMPLE_M) {
      samples.push({ s: si, frame: this._frame(si), n: this.countAt(si), lat: this.lateralAt(si) });
    }

    // Road surface, in short pieces so bends can't tangle a single big shape.
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      if (a.n < 2) continue;
      const half = (a.n * LANE_WIDTH) / 2 + SHOULDER_M;
      poly('road', [a.frame.at(-half, -0.3), a.frame.at(half, -0.3), b.frame.at(half, 0.3), b.frame.at(-half, 0.3)]);
    }

    // Lane dividers and road edges, unbroken while the lane count holds.
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        const n = run[0].n;
        for (let e = 0; e <= n; e++) {
          const x = (e - n / 2) * LANE_WIDTH;
          line(e === 0 || e === n ? 'edge' : 'divider', run.map((r) => r.frame.at(x, 0)));
        }
      }
      run = [];
    };
    for (const smp of samples) {
      if (smp.n < 2 || (run.length && run[0].n !== smp.n)) flush();
      if (smp.n >= 2) run.push(smp);
    }
    flush();

    // Junctions in view: lane tints, painted arrows, and a stop line.
    let from0 = null;
    for (const m of route.maneuvers) {
      if (m.beginDist < from || m.beginDist > end || [1, 2, 3, 4, 5, 6].includes(m.type)) continue;
      const n = this.countAt(m.beginDist - 5);
      if (n < 2) continue;
      const want = laneTarget(m, n, from0);
      const count = want ? want.count : n;
      const frameAt = (d) => this._frame(m.beginDist - d);

      const half = (count * LANE_WIDTH) / 2;
      const stop = frameAt(1);
      poly('paint', [stop.at(-half, -0.3), stop.at(half, -0.3), stop.at(half, 0.3), stop.at(-half, 0.3)]);

      if (want && want.view) {
        // Colour the lanes you can use, from where the lane change starts.
        const tintLen = Math.min(170, APPROACH_M);
        want.view.forEach((lane, i) => {
          if (lane.state === 'other') return;
          const x = laneOffset(i, count);
          for (let d = tintLen; d > 0; d -= SAMPLE_M * 2) {
            const a = frameAt(d), b = frameAt(Math.max(0, d - SAMPLE_M * 2));
            const w = LANE_WIDTH / 2 - 0.2;
            poly(lane.state === 'best' ? 'tint-best' : 'tint-ok', [a.at(x - w, 0), a.at(x + w, 0), b.at(x + w, 0.1), b.at(x - w, 0.1)]);
          }
        });
      }

      for (const d of [14, 70, 130]) {
        if (m.beginDist - d < from || m.beginDist - d > end) continue;
        const f = frameAt(d + 3);
        if (want && want.view) {
          want.view.forEach((lane, i) => {
            const c = lane.state === 'other' ? 'arrow-dim' : 'arrow';
            for (const name of [lane.direction, ...lane.others]) {
              this._paintArrow(poly, f, laneOffset(i, count), name, lane.state === 'other' || name === lane.direction ? c : 'arrow-dim');
            }
          });
        } else if (want) {
          this._paintArrow(poly, f, laneOffset(want.index, count), MANEUVER_ARROW[m.type] || 'straight', 'arrow');
        }
      }
      from0 = want ? want.index : from0;
    }

    // The carpet, and chevrons along it, from behind the car to the far end.
    const w = LANE_WIDTH * 0.36;
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      if (a.n < 2) continue;
      poly('carpet', [a.frame.at(a.lat - w, -0.3), a.frame.at(a.lat + w, -0.3), b.frame.at(b.lat + w, 0.3), b.frame.at(b.lat - w, 0.3)]);
    }
    for (let si = Math.ceil(from / 14) * 14; si <= end; si += 14) {
      if (this.countAt(si) < 2) continue;
      const f = this._frame(si);
      const x = this.lateralAt(si);
      const cw = w * 0.62, ch = 1.1, t = 0.8;
      poly('chevron', [f.at(x - cw, -ch), f.at(x, 0), f.at(x + cw, -ch), f.at(x + cw, -ch + t), f.at(x, t), f.at(x - cw, -ch + t)]);
    }

    this.trimS = end - 4;
    return { type: 'FeatureCollection', features };
  }

  _paintArrow(poly, frame, x, name, kind) {
    const [shape, flip] = ARROW_FOR[name] || ARROW_FOR.straight;
    const ring = ARROWS[shape].map(([ax, ay]) => frame.at(x + ax * flip, ay * 1.15));
    poly(kind, ring);
  }
}

const EMPTY = { type: 'FeatureCollection', features: [] };
export const NO_LANES = EMPTY;
