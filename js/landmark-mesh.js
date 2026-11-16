// Famous statues for the 3D map, built from numbers like the vehicles. The map's
// own data has the pedestals and the buildings around them, but not the figures
// that stand on them, so without these the Statue of Liberty is a bare plinth.
//
// Sizes are in metres, taken from published measurements where there are any:
// x to the figure's right, y the way it faces, z up from where it stands.
import { Builder, hexToRgb } from './car-mesh.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const times = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => times(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const middle = (pts) => times(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);

// A level ring of points: an ellipse, rippled where cloth falls in folds.
function ring([cx, cy, cz], rx, ry, n, { folds = 0, ripple = 0, turn = 0 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + ripple * Math.sin(folds * a + turn);
    return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k, cz];
  });
}

// Rings of the same size joined into a skin. Each band faces out from its own
// middle, which keeps bent and tapering shapes the right way out. The ends are closed.
function loft(b, rings, color, { gloss = 0.35, glow = 0, ends = true } = {}) {
  const mids = rings.map(middle);
  for (let r = 0; r + 1 < rings.length; r++) {
    const A = rings[r], B = rings[r + 1], n = A.length;
    b.part(times(add(mids[r], mids[r + 1]), 0.5), () => {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        b.quad(A[i], A[j], B[j], B[i], color, glow, gloss);
      }
    });
  }
  if (!ends) return;
  const cap = (R, mid, inside) => b.part(inside, () => {
    for (let i = 0; i < R.length; i++) b.tri(mid, R[i], R[(i + 1) % R.length], color, glow, gloss);
  });
  cap(rings[0], mids[0], mids[1]);
  cap(rings[rings.length - 1], mids[mids.length - 1], mids[mids.length - 2]);
}

// A level shape stacked from [height, half-width, half-depth, x, y, ripple] rows.
function stack(b, rows, color, { sides = 32, folds = 0, ...opts } = {}) {
  const rings = rows.map(([z, rx, ry, x = 0, y = 0, ripple = 0]) => ring([x, y, z], rx, ry, sides, { folds, ripple }));
  loft(b, rings, color, opts);
}

// A round limb along a path, thickness given at each point. The rings are
// carried along without twisting.
function tube(b, path, radii, color, { sides = 12, ...opts } = {}) {
  const r = (i) => (Array.isArray(radii) ? radii[i] : radii);
  const along = path.map((p, i) => unit(sub(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)])));
  let u = unit(cross(along[0], Math.abs(along[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const rings = path.map((p, i) => {
    const t = along[i];
    u = unit(sub(u, times(t, dot(u, t))));
    const v = cross(t, u);
    return Array.from({ length: sides }, (_, k) => {
      const a = (k / sides) * Math.PI * 2;
      return add(p, add(times(u, Math.cos(a) * r(i)), times(v, Math.sin(a) * r(i))));
    });
  });
  loft(b, rings, color, opts);
}

// A pointed spike from a base to a tip.
function spike(b, base, tip, radius, color, { sides = 5, gloss = 0.35, glow = 0 } = {}) {
  const t = unit(sub(tip, base));
  const u = unit(cross(t, Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const v = cross(t, u);
  const R = Array.from({ length: sides }, (_, k) => {
    const a = (k / sides) * Math.PI * 2;
    return add(base, add(times(u, Math.cos(a) * radius), times(v, Math.sin(a) * radius)));
  });
  b.part(add(base, times(sub(tip, base), 0.2)), () => {
    for (let i = 0; i < sides; i++) b.tri(R[i], R[(i + 1) % sides], tip, color, glow, gloss);
  });
  b.part(add(base, times(sub(tip, base), 0.5)), () => {
    for (let i = 0; i < sides; i++) b.tri(base, R[(i + 1) % sides], R[i], color, glow, gloss);
  });
}

// A flat block turned any way: a middle and its three half-sides.
function slab(b, c, ax, ay, az, color, { gloss = 0.35, glow = 0 } = {}) {
  const v = (i, j, k) => add(c, add(times(ax, i), add(times(ay, j), times(az, k))));
  const q = (p1, p2, p3, p4) => b.quad(p1, p2, p3, p4, color, glow, gloss);
  b.part(c, () => {
    q(v(-1, -1, -1), v(1, -1, -1), v(1, 1, -1), v(-1, 1, -1));
    q(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1));
    q(v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1));
    q(v(-1, 1, -1), v(1, 1, -1), v(1, 1, 1), v(-1, 1, 1));
    q(v(-1, -1, -1), v(-1, 1, -1), v(-1, 1, 1), v(-1, -1, 1));
    q(v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), v(1, -1, 1));
  });
}

// Three directions square to each other, from a long side and a rough facing.
function axes(long, facing) {
  const l = unit(long);
  const f = unit(sub(facing, times(l, dot(facing, l))));
  return { l, f, w: cross(l, f) };
}

// The Statue of Liberty, from its feet: 33.9 m to the top of the head, 46.05 m
// to the tip of the torch, right arm 12.8 m, tablet 7.19 by 4.14 m. Weathered
// copper all over, but for the torch's gold flame.
function liberty() {
  const b = new Builder();
  const COPPER = hexToRgb('#79b59f');
  const SHADE = hexToRgb('#69a48e');
  const FLAME = hexToRgb('#f6b73c');
  const skin = { gloss: 0.18 };

  // The robe falls in folds to the feet, widest at the hem, the mantle over the hips.
  stack(b, [
    [0, 4.55, 4.0, 0, 0.45, 0.07],
    [1.3, 4.35, 3.75, 0, 0.3, 0.075],
    [4.5, 4.1, 3.35, 0, 0.12, 0.07],
    [8.5, 3.95, 3.12, 0, 0, 0.06],
    [12.5, 4.05, 3.0, 0, -0.05, 0.05],
    [15.5, 4.2, 3.0, 0, -0.05, 0.04],
    [18.5, 3.9, 2.8, 0, 0, 0.03],
    [21.5, 4.0, 2.75, 0, 0.05, 0.02],
    [24.3, 4.15, 2.6, 0, 0, 0.012],
    [26.2, 3.95, 2.35, 0, -0.05, 0],
    [27.3, 2.9, 1.95, 0, -0.1, 0],
    [28.0, 1.6, 1.45, 0, -0.1, 0],
    [28.7, 1.22, 1.22, 0, -0.05, 0],
    [29.8, 1.18, 1.2, 0, 0.05, 0],
  ], COPPER, { sides: 44, folds: 11, ...skin });
  // The mantle's edge, across the body from the left shoulder to the right hip.
  tube(b, [[-3.3, 1.3, 26.4], [-1.6, 2.55, 23.6], [0.6, 2.9, 19.6], [2.6, 2.75, 16.2], [3.9, 1.9, 13.6]],
    [0.42, 0.5, 0.52, 0.48, 0.4], COPPER, { sides: 8, ...skin });
  // The right foot, stepping out from under the hem.
  b.ellipsoid(1.5, 3.7, 0.5, 1.0, 1.55, 0.5, COPPER, 0.18, 6, 10);

  // The head, with the hair gathered behind and the nose and brow in front.
  b.ellipsoid(0, 0.15, 31.2, 1.5, 1.7, 2.62, COPPER, 0.18, 10, 16);
  b.ellipsoid(0, -1.25, 31.5, 1.15, 0.95, 1.1, SHADE, 0.18, 6, 10);
  b.ellipsoid(0, 1.68, 31.0, 0.22, 0.3, 0.5, COPPER, 0.18, 5, 8);

  // The crown: a band round the head, and seven rays fanned out above it.
  stack(b, [[31.85, 1.62, 1.82, 0, 0.15], [32.3, 1.66, 1.86, 0, 0.15], [33.0, 1.5, 1.7, 0, 0.12]], COPPER, { sides: 20, ...skin });
  const crown = [0, 0.15, 32.55];
  for (let k = 0; k < 7; k++) {
    const side = -100 + (200 * k) / 6;               // degrees round from the front
    const a = (side * Math.PI) / 180;
    const up = ((14 + 46 * Math.cos(a)) * Math.PI) / 180;  // the middle ray rises most
    const flat = [Math.sin(a), Math.cos(a), 0];
    const dir = [flat[0] * Math.cos(up), flat[1] * Math.cos(up), Math.sin(up)];
    const base = add(crown, [flat[0] * 1.55, flat[1] * 1.75, 0.15]);
    spike(b, base, add(base, times(dir, 3.0)), 0.44, COPPER, { sides: 5, ...skin });
  }

  // The right arm, raised, its sleeve fallen to the shoulder, holding up the torch.
  tube(b, [[3.25, -0.1, 26.0], [3.85, 0.05, 29.4], [4.4, 0.3, 32.9], [4.75, 0.5, 35.7], [4.95, 0.65, 38.1]],
    [1.7, 1.42, 1.1, 0.88, 0.74], COPPER, { sides: 14, ...skin });
  b.ellipsoid(5.0, 0.7, 39.3, 0.95, 0.9, 1.2, COPPER, 0.18, 7, 10);
  tube(b, [[4.98, 0.66, 37.7], [5.06, 0.72, 40.4], [5.12, 0.76, 42.2]], [0.5, 0.55, 0.62], COPPER, { sides: 10, ...skin });
  // The torch's cup and the balcony round it.
  stack(b, [[41.7, 0.66, 0.66, 5.12, 0.76], [42.35, 1.25, 1.25, 5.12, 0.76], [42.75, 1.55, 1.55, 5.12, 0.76]], COPPER, { sides: 16, ...skin });
  stack(b, [[42.45, 2.0, 2.0, 5.12, 0.76], [42.7, 2.0, 2.0, 5.12, 0.76]], SHADE, { sides: 16, ...skin });
  // The flame, gold, and lit.
  stack(b, [
    [42.7, 1.15, 1.15, 5.12, 0.76, 0.1],
    [43.55, 1.28, 1.28, 5.12, 0.77, 0.14],
    [44.5, 1.02, 1.02, 5.13, 0.78, 0.16],
    [45.35, 0.58, 0.58, 5.14, 0.78, 0.12],
    [46.05, 0.04, 0.04, 5.15, 0.78, 0],
  ], FLAME, { sides: 20, folds: 5, gloss: 0.7, glow: 0.55 });

  // The left arm down by the side, the hand holding the tablet at its foot.
  tube(b, [[-3.3, -0.1, 25.9], [-4.1, 0.1, 23.2], [-4.5, 0.5, 20.6], [-4.15, 1.6, 19.7], [-3.9, 2.25, 19.45]],
    [1.6, 1.35, 1.15, 0.92, 0.8], COPPER, { sides: 12, ...skin });
  b.ellipsoid(-3.95, 2.45, 19.5, 0.95, 1.0, 0.9, COPPER, 0.18, 6, 10);
  // The tablet, 7.19 m by 4.14 m, held upright against the body, its top tipped out.
  const { l, f, w } = axes([-0.2, -0.12, 1], [-0.32, 1, 0]);
  slab(b, [-4.85, 1.35, 22.3], times(w, 2.07), times(l, 3.6), times(f, 0.31), SHADE, skin);
  return b.finish([0, 0, 23]);
}

// The Lord Murugan statue at Batu Caves, 42.7 m high and painted gold: standing
// on a low base, the vel (his spear) upright in his right hand, the left hand
// lowered and open, a tall crown.
function murugan() {
  const b = new Builder();
  const GOLD = hexToRgb('#e2ad35');
  const DEEP = hexToRgb('#bd8a22');
  const STONE = hexToRgb('#d4cdbd');
  const shine = { gloss: 0.75 };
  const f = 2.6;   // the top of the base, where his feet stand

  slab(b, [0, 0.4, 0.8], [6.4, 0, 0], [0, 5.4, 0], [0, 0, 0.8], STONE, { gloss: 0.1 });
  slab(b, [0, 0.4, 2.1], [5.6, 0, 0], [0, 4.7, 0], [0, 0, 0.5], STONE, { gloss: 0.1 });

  // The feet, and the veshti falling to the ankles.
  b.ellipsoid(1.25, 1.75, f + 0.45, 0.85, 1.5, 0.5, GOLD, 0.75, 6, 10);
  b.ellipsoid(-1.25, 1.75, f + 0.45, 0.85, 1.5, 0.5, GOLD, 0.75, 6, 10);
  stack(b, [
    [f + 0.5, 3.1, 2.35, 0, 0.15, 0.03],
    [f + 4.5, 2.95, 2.25, 0, 0.08, 0.04],
    [f + 9.5, 2.9, 2.15, 0, 0, 0.04],
    [f + 14.5, 3.2, 2.3, 0, 0, 0.03],
    [f + 17.0, 3.1, 2.25, 0, 0, 0.02],
    [f + 18.4, 2.92, 2.12, 0, 0, 0],
  ], GOLD, { sides: 40, folds: 9, ...shine });
  // The belt.
  stack(b, [[f + 18.1, 3.08, 2.28], [f + 19.3, 3.06, 2.26]], DEEP, { sides: 28, ...shine });

  // The body: bare chest, broad shoulders, the neck.
  stack(b, [
    [f + 18.4, 2.92, 2.12],
    [f + 21.2, 3.15, 2.25],
    [f + 23.8, 3.65, 2.4],
    [f + 25.8, 4.05, 2.3],
    [f + 26.8, 3.9, 2.1, 0, -0.05],
    [f + 27.6, 3.0, 1.85, 0, -0.1],
    [f + 28.3, 1.6, 1.45, 0, -0.05],
    [f + 29.6, 1.34, 1.32, 0, 0],
  ], GOLD, { sides: 32, ...shine });
  // A necklace hanging on the chest.
  tube(b, [[-2.3, 1.2, f + 27.6], [-1.6, 2.15, f + 26.3], [0, 2.55, f + 25.4], [1.6, 2.15, f + 26.3], [2.3, 1.2, f + 27.6]],
    0.3, DEEP, { sides: 8, ...shine });

  // The head and the ears.
  b.ellipsoid(0, 0.15, f + 31.2, 1.6, 1.8, 2.3, GOLD, 0.75, 10, 16);
  b.ellipsoid(1.62, 0.05, f + 31.0, 0.35, 0.55, 0.8, DEEP, 0.75, 5, 8);
  b.ellipsoid(-1.62, 0.05, f + 31.0, 0.35, 0.55, 0.8, DEEP, 0.75, 5, 8);
  b.ellipsoid(0, 1.88, f + 31.0, 0.3, 0.38, 0.55, GOLD, 0.75, 5, 8);

  // The crown, in tiers, narrowing to a point at the very top.
  stack(b, [
    [f + 32.1, 1.72, 1.9, 0, 0.12],
    [f + 32.9, 1.86, 2.02, 0, 0.12],
    [f + 33.2, 1.62, 1.78, 0, 0.1],
    [f + 34.3, 1.52, 1.66, 0, 0.1],
    [f + 34.6, 1.34, 1.46, 0, 0.08],
    [f + 35.7, 1.16, 1.26, 0, 0.06],
    [f + 36.0, 0.96, 1.04, 0, 0.05],
    [f + 37.1, 0.76, 0.82, 0, 0.04],
    [f + 37.4, 0.54, 0.58, 0, 0.03],
    [f + 38.6, 0.36, 0.38, 0, 0.02],
    [f + 39.2, 0.42, 0.42, 0, 0.02],
    [f + 39.7, 0.28, 0.28, 0, 0.02],
    [42.7, 0.03, 0.03, 0, 0.02],
  ], DEEP, { sides: 20, ...shine });

  // Round shoulders, with a band on each upper arm.
  b.ellipsoid(3.85, 0, f + 26.4, 1.5, 1.4, 1.5, GOLD, 0.75, 8, 12);
  b.ellipsoid(-3.85, 0, f + 26.4, 1.5, 1.4, 1.5, GOLD, 0.75, 8, 12);
  tube(b, [[4.25, 0.07, f + 25.0], [4.38, 0.12, f + 24.3]], 1.32, DEEP, { sides: 12, ...shine });
  tube(b, [[-4.25, 0.07, f + 25.0], [-4.38, 0.12, f + 24.3]], 1.32, DEEP, { sides: 12, ...shine });
  // The right arm, the hand closed round the vel's shaft in front of the hip.
  tube(b, [[3.95, 0, f + 27.0], [4.6, 0.2, f + 24.0], [5.0, 0.45, f + 21.4], [5.55, 1.6, f + 22.4], [6.05, 2.55, f + 23.2]],
    [1.42, 1.26, 1.08, 0.95, 0.82], GOLD, { sides: 12, ...shine });
  b.ellipsoid(6.3, 2.9, f + 23.4, 0.98, 0.98, 1.12, GOLD, 0.75, 6, 10);
  // The vel: a long shaft from the base, and its leaf-shaped blade above his head.
  tube(b, [[6.45, 3.05, f], [6.45, 3.05, 37.4]], 0.36, DEEP, { sides: 8, ...shine });
  stack(b, [
    [37.2, 0.48, 0.48, 6.45, 3.05],
    [37.65, 0.74, 0.74, 6.45, 3.05],
    [38.0, 0.36, 0.26, 6.45, 3.05],
    [38.7, 1.15, 0.26, 6.45, 3.05],
    [39.9, 1.55, 0.3, 6.45, 3.05],
    [41.1, 1.18, 0.26, 6.45, 3.05],
    [42.0, 0.55, 0.18, 6.45, 3.05],
    [42.6, 0.03, 0.03, 6.45, 3.05],
  ], GOLD, { sides: 16, ...shine });

  // The left arm lowered, the open hand turned out, palm forward.
  tube(b, [[-3.95, 0, f + 27.0], [-4.6, 0.2, f + 24.0], [-5.0, 0.35, f + 21.3], [-5.05, 1.3, f + 19.5], [-4.95, 2.05, f + 18.5]],
    [1.42, 1.26, 1.08, 0.95, 0.8], GOLD, { sides: 12, ...shine });
  const palm = axes([0.05, 0.25, -1], [0.05, 1, 0.25]);
  slab(b, [-4.95, 2.45, f + 17.4], times(palm.w, 0.78), times(palm.l, 1.15), times(palm.f, 0.24), GOLD, shine);
  return b.finish([0, 0, 22]);
}

export const LANDMARK_MODELS = { liberty, murugan };

// The model's vertices, and how tall it stands.
export function buildLandmark(kind) {
  const make = LANDMARK_MODELS[kind];
  if (!make) return null;
  const data = make();
  let top = 0;
  for (let i = 2; i < data.length; i += 11) top = Math.max(top, data[i]);
  return { data, top };
}
