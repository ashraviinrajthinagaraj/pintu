// The arrow painted on the road at the next turn: the route from a little before
// the turn to a little after it, with a head at the end, lying flat on the map.
import { pointAt } from './motion.js';

export const BEFORE_M = 30;
export const AFTER_M = 24;
export const SHOW_WITHIN_M = 600;

// Turns, ramps, exits, forks to one side and roundabouts: not "carry on", not the start or end.
const TURNS = new Set([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 24, 26, 27]);
export const wantsArrow = (m) => !!m && TURNS.has(m.type);

// The route between two distances along it, as a line.
export function slice(route, from, to) {
  const { coords, cum } = route;
  const a = Math.max(0, from), b = Math.min(route.length, to);
  if (!(b > a)) return [];
  const out = [pointAt(route, a)];
  for (let i = 0; i < coords.length; i++) if (cum[i] > a && cum[i] < b) out.push(coords[i]);
  out.push(pointAt(route, b));
  return out;
}

// The arrow for a turn at `at` metres along the route: the line, where it ends,
// and which way the head points there (degrees from north, clockwise). Or null.
export function turnArrow(route, at, { before = BEFORE_M, after = AFTER_M } = {}) {
  const line = slice(route, at - before, at + after);
  if (line.length < 2) return null;
  const end = line[line.length - 1];
  // Which way the arrow points: along the last few metres.
  const back = pointAt(route, Math.max(0, Math.min(route.length, at + after) - 5));
  const k = Math.cos((end[1] * Math.PI) / 180);
  const dx = (end[0] - back[0]) * k, dy = end[1] - back[1];
  if (!(Math.hypot(dx, dy) > 0)) return null;
  const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return { line, end, bearing };
}

// Which turn to draw for where you are: the one you're in the middle of, or the
// next one once it's close. Null when there's none worth an arrow.
export function arrowFor(route, st, { within = SHOW_WITHIN_M, after = AFTER_M } = {}) {
  if (!route || !st?.onRoute) return null;
  const ms = route.maneuvers;
  for (const i of [st.currentIndex, st.nextIndex]) {
    const m = ms[i];
    if (!wantsArrow(m)) continue;
    const ahead = m.beginDist - st.s;
    if (ahead <= within && ahead > -after) return { index: i, at: m.beginDist };
  }
  return null;
}
