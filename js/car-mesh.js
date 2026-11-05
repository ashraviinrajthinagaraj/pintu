// Vehicles for the 3D map, built from numbers so there's nothing to download.
// These are body shapes, not any maker's real design. Sizes are in metres:
// x to the right, y forward from the rear of the car, z up.

export const BODIES = ['hatchback', 'sedan', 'suv', 'mpv', 'pickup', 'motorcycle'];

const BODY_SPECS = {
  hatchback: {
    length: 3.95, halfWidth: 0.85, belt: [[0, 0.8], [0.5, 0.98], [2.9, 0.97], [3.95, 0.72]],
    top: [[0, 0.82], [0.12, 1.06], [0.4, 1.36], [0.78, 1.49], [1.6, 1.53], [2.28, 1.46], [2.98, 1.03], [3.6, 0.9], [3.95, 0.7]],
    rear: [0.1, 0.78], front: [2.28, 2.98], roofScale: 0.76, ride: 0.17, wheels: [0.72, 3.15], wheelR: 0.3, pillars: [1.72],
  },
  sedan: {
    length: 4.45, halfWidth: 0.87, belt: [[0, 0.84], [0.5, 0.97], [3.4, 0.95], [4.45, 0.7]],
    top: [[0, 0.84], [0.12, 1.0], [0.74, 1.03], [1.36, 1.38], [2.0, 1.46], [2.78, 1.42], [3.42, 1.0], [4.05, 0.88], [4.45, 0.68]],
    rear: [0.76, 1.36], front: [2.78, 3.42], roofScale: 0.76, ride: 0.16, wheels: [0.86, 3.5], wheelR: 0.31, pillars: [2.05],
  },
  suv: {
    length: 4.5, halfWidth: 0.92, belt: [[0, 0.98], [0.5, 1.12], [3.55, 1.1], [4.5, 0.86]],
    top: [[0, 1.0], [0.1, 1.24], [0.42, 1.58], [0.92, 1.68], [2.3, 1.71], [2.95, 1.6], [3.56, 1.17], [4.1, 1.06], [4.5, 0.84]],
    rear: [0.1, 0.92], front: [2.95, 3.56], roofScale: 0.8, ride: 0.26, wheels: [0.86, 3.55], wheelR: 0.35, pillars: [1.55, 2.5],
  },
  mpv: {
    length: 4.45, halfWidth: 0.87, belt: [[0, 0.96], [0.5, 1.08], [3.5, 1.06], [4.45, 0.8]],
    top: [[0, 1.0], [0.1, 1.26], [0.3, 1.58], [0.8, 1.68], [2.6, 1.69], [3.25, 1.5], [3.82, 1.07], [4.2, 0.94], [4.45, 0.74]],
    rear: [0.1, 0.8], front: [2.6, 3.82], roofScale: 0.8, ride: 0.18, wheels: [0.8, 3.45], wheelR: 0.31, pillars: [1.3, 2.15],
  },
  pickup: {
    length: 5.2, halfWidth: 0.93, belt: [[0, 1.0], [0.4, 1.14], [4.1, 1.14], [5.2, 0.9]],
    top: [[0, 1.02], [0.08, 1.14], [1.78, 1.16], [1.88, 1.72], [2.02, 1.8], [3.08, 1.82], [3.66, 1.64], [4.2, 1.24], [4.8, 1.14], [5.2, 0.92]],
    rear: [1.82, 1.9], front: [3.08, 4.2], roofScale: 0.8, ride: 0.3, wheels: [1.0, 4.05], wheelR: 0.37, pillars: [2.6], bed: [0.12, 1.78],
  },
};

const DARK = [0.03, 0.035, 0.04];
const TRIM = [0.07, 0.075, 0.08];
const GLASS = [0.015, 0.03, 0.04];
const GLASS_SHINE = 0.55;
const RUBBER = [0.035, 0.035, 0.04];
const HUB = [0.62, 0.65, 0.68];
const HEADLIGHT = [1, 0.97, 0.86];
const TAILLIGHT = [0.85, 0.05, 0.05];

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  // Colours are chosen by eye as sRGB; lighting works in straight numbers.
  const conv = (c) => (c / 255) ** 2.2;
  return [conv((n >> 16) & 255), conv((n >> 8) & 255), conv(n & 255)];
}

function curve(points, y) {
  if (y <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (y <= points[i][0]) {
      const [y0, v0] = points[i - 1], [y1, v1] = points[i];
      return v0 + ((v1 - v0) * (y - y0)) / (y1 - y0 || 1);
    }
  }
  return points[points.length - 1][1];
}

class Builder {
  constructor() { this.tris = []; this.pivot = null; }

  tri(a, b, c, color, emissive = 0, gloss = 0.5) {
    this.tris.push({ a, b, c, color, emissive, gloss, pivot: this.pivot });
  }

  // Parts face outward from their own middle, not the whole vehicle's.
  part(pivot, draw) {
    this.pivot = pivot;
    draw();
    this.pivot = null;
  }

  quad(a, b, c, d, color, emissive = 0, gloss = 0.5) {
    this.tri(a, b, c, color, emissive, gloss);
    this.tri(a, c, d, color, emissive, gloss);
  }

  // Sharp edges only between different materials or at steep angles.
  finish(center) {
    const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const faces = [];
    for (const t of this.tris) {
      const n = cross(sub(t.b, t.a), sub(t.c, t.a));
      const area = Math.hypot(n[0], n[1], n[2]);
      if (area < 1e-7) continue;
      let unit = [n[0] / area, n[1] / area, n[2] / area];
      const mid = [(t.a[0] + t.b[0] + t.c[0]) / 3, (t.a[1] + t.b[1] + t.c[1]) / 3, (t.a[2] + t.b[2] + t.c[2]) / 3];
      const out = sub(mid, t.pivot || center);
      if (unit[0] * out[0] + unit[1] * out[1] + unit[2] * out[2] < 0) unit = [-unit[0], -unit[1], -unit[2]];
      faces.push({ ...t, normal: unit, area });
    }
    const key = (p, f) => `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}|${f.color.join()}`;
    const shared = new Map();
    for (const f of faces) {
      for (const p of [f.a, f.b, f.c]) {
        const k = key(p, f);
        if (!shared.has(k)) shared.set(k, []);
        shared.get(k).push(f);
      }
    }
    const SMOOTH = Math.cos((50 * Math.PI) / 180);
    const data = new Float32Array(faces.length * 3 * 11);
    let o = 0;
    for (const f of faces) {
      for (const p of [f.a, f.b, f.c]) {
        let nx = 0, ny = 0, nz = 0;
        for (const g of shared.get(key(p, f))) {
          if (g.normal[0] * f.normal[0] + g.normal[1] * f.normal[1] + g.normal[2] * f.normal[2] >= SMOOTH) {
            nx += g.normal[0] * g.area;
            ny += g.normal[1] * g.area;
            nz += g.normal[2] * g.area;
          }
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        data.set([p[0], p[1], p[2], nx / len, ny / len, nz / len, f.color[0], f.color[1], f.color[2], f.emissive, f.gloss], o);
        o += 11;
      }
    }
    return data;
  }

  cylinderX(cx, cy, cz, r, halfW, color, hub, sides = 14) {
    const ring = (x) => Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2;
      return [x, cy + Math.cos(a) * r, cz + Math.sin(a) * r];
    });
    const a = ring(cx - halfW), b = ring(cx + halfW);
    this.part([cx, cy, cz], () => {
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        this.quad(a[i], a[j], b[j], b[i], color, 0, 0.1);
        this.tri([cx + halfW, cy, cz], b[i], b[j], color, 0, 0.1);
        this.tri([cx - halfW, cy, cz], a[j], a[i], color, 0, 0.1);
      }
      // A hub on each outer face. A single wheel in the middle gets one each side.
      const faces = cx === 0 ? [1, -1] : [cx > 0 ? 1 : -1];
      for (const side of faces) {
        const x = cx + side * (halfW + 0.004);
        const hr = r * 0.58;
        const hubRing = Array.from({ length: sides }, (_, i) => {
          const t = (i / sides) * Math.PI * 2;
          return [x, cy + Math.cos(t) * hr, cz + Math.sin(t) * hr];
        });
        for (let i = 0; i < sides; i++) this.tri([x, cy, cz], hubRing[i], hubRing[(i + 1) % sides], hub, 0, 0.8);
      }
    });
  }

  box(cx, cy, cz, sx, sy, sz, color, emissive = 0, gloss = 0.4) {
    const v = (x, y, z) => [cx + x * sx, cy + y * sy, cz + z * sz];
    const q = (a, b, c, d) => this.quad(a, b, c, d, color, emissive, gloss);
    this.part([cx, cy, cz], () => {
      q(v(-1, -1, -1), v(1, -1, -1), v(1, 1, -1), v(-1, 1, -1));
      q(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1));
      q(v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1));
      q(v(-1, 1, -1), v(1, 1, -1), v(1, 1, 1), v(-1, 1, 1));
      q(v(-1, -1, -1), v(-1, 1, -1), v(-1, 1, 1), v(-1, -1, 1));
      q(v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), v(1, -1, 1));
    });
  }

  ellipsoid(cx, cy, cz, rx, ry, rz, color, gloss = 0.4, rows = 8, cols = 12) {
    const at = (i, j) => {
      const th = (i / rows) * Math.PI, ph = (j / cols) * Math.PI * 2;
      return [cx + rx * Math.sin(th) * Math.cos(ph), cy + ry * Math.sin(th) * Math.sin(ph), cz + rz * Math.cos(th)];
    };
    this.part([cx, cy, cz], () => {
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) this.quad(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), color, 0, gloss);
      }
    });
  }
}

function buildCar(spec, paint) {
  const b = new Builder();
  const { length: L, halfWidth: hw, ride, roofScale } = spec;

  // More slices near the ends and over the windscreens, where the shape changes.
  const stations = new Set();
  const N = 24;
  for (let i = 0; i <= N; i++) stations.add((L * (1 - Math.cos((i / N) * Math.PI))) / 2);
  for (const r of [spec.rear, spec.front, spec.bed].filter(Boolean)) { stations.add(r[0]); stations.add(r[1]); }
  for (const p of spec.pillars) { stations.add(p - 0.04); stations.add(p + 0.04); }
  for (const [y] of spec.top) stations.add(y);
  for (const wy of spec.wheels) {
    for (const d of [-1, -0.7, -0.35, 0, 0.35, 0.7, 1]) stations.add(wy + d * spec.wheelR * 1.15);
  }
  const ys = [...stations].filter((y) => y >= 0 && y <= L).sort((a, c) => a - c)
    .filter((y, i, all) => i === 0 || y - all[i - 1] > 0.012);

  const widthAt = (y) => {
    const u = Math.abs((2 * y) / L - 1);
    const e = y > L / 2 ? 4.2 : 5.5;   // the nose is rounder than the tail
    return hw * (1 - u ** e) ** (1 / e);
  };

  // One half of a cross-section, from under the car to the roof's centre.
  const section = (y) => {
    const w = Math.max(0.001, widthAt(y));
    const belt = curve(spec.belt, y);
    const top = Math.max(curve(spec.top, y), belt + 0.005);
    const glassH = top - belt;
    const g = Math.min(1, glassH / 0.25);
    const wr = w * roofScale;
    const crown = (1 - g) * 0.03;
    return [
      [0, ride],
      [w * 0.8, ride],
      [w * 0.965, ride + 0.12],
      [w, ride + 0.34],
      [w * 0.995, belt - 0.17],
      [w * 0.98, belt - 0.03],
      [w * 0.93, belt],
      [wr + (w * 0.86 - wr) * (1 - g), belt + glassH * 0.88],
      [(wr * 0.72) + (w * 0.5 - wr * 0.72) * (1 - g), belt + glassH * 0.985 + crown * 0.7],
      [0, top + crown],
    ];
  };

  const within = (r, y) => r && y >= r[0] - 1e-6 && y <= r[1] + 1e-6;
  const inArch = (y, z) => spec.wheels.some((wy) => Math.hypot(y - wy, z - spec.wheelR) < spec.wheelR * 1.16);

  const SEGS = 9;
  for (let i = 0; i < ys.length - 1; i++) {
    const y0 = ys[i], y1 = ys[i + 1];
    const yMid = (y0 + y1) / 2;
    const s0 = section(y0), s1 = section(y1);
    const glassH = curve(spec.top, yMid) - curve(spec.belt, yMid);
    const nearPillar = spec.pillars.some((p) => Math.abs(yMid - p) < 0.05);
    const inFront = within(spec.front, yMid), inRear = within(spec.rear, yMid);
    const inBed = spec.bed && within(spec.bed, yMid);
    const u = yMid / L;

    for (let j = 0; j < SEGS; j++) {
      let color = paint, emissive = 0, gloss = 0.75;
      const midZ = (s0[j][1] + s0[j + 1][1]) / 2;
      if (j === 0) { color = DARK; gloss = 0; }
      else if (j === 1) { color = TRIM; gloss = 0.1; }
      else if (j >= 2 && j <= 3 && inArch(yMid, midZ)) { color = DARK; gloss = 0; }
      else if (j === 6) {
        // Side windows, broken by the pillars.
        if (glassH > 0.16 && !nearPillar && !inFront && !(inRear && spec.rear[1] - spec.rear[0] > 0.2)) { color = GLASS; gloss = GLASS_SHINE; }
      } else if (j >= 7) {
        if ((inFront || inRear) && glassH > 0.05) { color = GLASS; gloss = GLASS_SHINE; }
        if (inBed) { color = DARK; gloss = 0; }
      }
      // A lamp at each corner, with a dark grille between the front pair.
      const nose = L - yMid, tail = yMid;
      const across = (s0[j][0] + s0[j + 1][0] + s1[j][0] + s1[j + 1][0]) / (4 * hw);
      if (j === 4 && nose < 0.36 && across > 0.44) { color = HEADLIGHT; emissive = 1; gloss = 1; }
      if ((j === 3 || j === 4) && nose < 0.2 && across <= 0.44) { color = DARK; gloss = 0.3; }
      if (j === 2 && nose < 0.12) { color = TRIM; gloss = 0.2; }
      if (j === 4 && tail < 0.24 && across > 0.4) { color = TAILLIGHT; emissive = 0.85; gloss = 1; }
      if (u < 0 || u > 1) continue;

      for (const side of [1, -1]) {
        const p = (s, k, y) => [s[k][0] * side, y, s[k][1]];
        b.quad(p(s0, j, y0), p(s0, j + 1, y0), p(s1, j + 1, y1), p(s1, j, y1), color, emissive, gloss);
      }
    }
  }

  for (const wy of spec.wheels) {
    for (const side of [1, -1]) {
      const x = side * (hw - 0.09);
      b.cylinderX(x, wy, spec.wheelR, spec.wheelR, 0.1, RUBBER, HUB);
    }
  }

  // Door mirrors, just ahead of the side windows.
  const my = spec.front[0] + (spec.front[1] - spec.front[0]) * 0.72;
  for (const side of [1, -1]) {
    b.box(side * (widthAt(my) * 0.93 + 0.06), my, curve(spec.belt, my) + 0.05, 0.07, 0.045, 0.045, paint, 0, 0.7);
  }

  return b.finish([0, L / 2, 0.75]);
}

function buildMotorcycle(paint) {
  const b = new Builder();
  const L = 2.05;
  b.cylinderX(0, 0.34, 0.33, 0.33, 0.055, RUBBER, HUB, 16);
  b.cylinderX(0, 1.71, 0.33, 0.33, 0.05, RUBBER, HUB, 16);
  // Frame and engine.
  b.box(0, 1.0, 0.42, 0.1, 0.38, 0.14, TRIM, 0, 0.3);
  // Fuel tank and seat.
  b.ellipsoid(0, 1.18, 0.82, 0.16, 0.3, 0.13, paint, 0.9);
  b.box(0, 0.62, 0.76, 0.12, 0.3, 0.05, DARK, 0, 0.1);
  b.box(0, 0.26, 0.74, 0.1, 0.14, 0.04, paint, 0, 0.8);
  // Front fork, headlamp, handlebars.
  b.box(0, 1.56, 0.68, 0.035, 0.1, 0.32, HUB, 0, 0.6);
  b.ellipsoid(0, 1.6, 1.0, 0.13, 0.13, 0.12, paint, 0.9);
  b.ellipsoid(0, 1.72, 1.0, 0.06, 0.03, 0.06, HEADLIGHT, 0.2, 6, 8);
  b.box(0, 1.46, 1.08, 0.34, 0.025, 0.025, DARK, 0, 0.3);
  // Tail lamp.
  b.box(0, 0.12, 0.76, 0.07, 0.02, 0.03, TAILLIGHT, 0.8, 0.5);
  // The rider.
  b.ellipsoid(0, 0.8, 1.16, 0.19, 0.15, 0.3, [0.12, 0.14, 0.17], 0.15);
  b.ellipsoid(0, 0.88, 1.56, 0.13, 0.14, 0.14, paint, 0.95);
  b.ellipsoid(0, 0.97, 1.57, 0.1, 0.07, 0.055, GLASS, GLASS_SHINE, 6, 8);
  b.box(0.22, 1.16, 1.14, 0.04, 0.26, 0.04, [0.12, 0.14, 0.17], 0, 0.1);
  b.box(-0.22, 1.16, 1.14, 0.04, 0.26, 0.04, [0.12, 0.14, 0.17], 0, 0.1);
  b.box(0.17, 0.9, 0.62, 0.05, 0.14, 0.17, [0.12, 0.14, 0.17], 0, 0.1);
  b.box(-0.17, 0.9, 0.62, 0.05, 0.14, 0.17, [0.12, 0.14, 0.17], 0, 0.1);
  return b.finish([0, L / 2, 0.8]);
}

// Interleaved triangles: position 3, normal 3, colour 3, glow 1, shine 1.
export const FLOATS_PER_VERTEX = 11;

export function buildVehicle(body, colorHex) {
  const paint = hexToRgb(colorHex);
  if (body === 'motorcycle') return { data: buildMotorcycle(paint), length: 2.05, width: 0.7 };
  const spec = BODY_SPECS[body] || BODY_SPECS.hatchback;
  return { data: buildCar(spec, paint), length: spec.length, width: spec.halfWidth * 2 };
}
