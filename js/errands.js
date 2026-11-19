// The best order for several stops: the drive time between every pair of
// places from the route server, then every order tried, the start and the end
// staying where they are. Exact for up to MAX_STOPS stops.
export const MAX_STOPS = 8;
// Worth suggesting only when it saves at least this much, and this share.
export const MIN_SAVING_S = 120;
export const MIN_SAVING_SHARE = 0.05;

// Seconds for visiting places 1…n of `matrix` in `order`, from place 0 to the
// last place. Infinity if any leg has no way through.
export function orderTime(matrix, order) {
  const end = matrix.length - 1;
  const path = [0, ...order, end];
  let total = 0;
  for (let k = 0; k + 1 < path.length; k++) {
    const leg = matrix[path[k]]?.[path[k + 1]];
    if (!Number.isFinite(leg)) return Infinity;
    total += leg;
  }
  return total;
}

// The quickest order of the stops (places 1…n, between start 0 and end n+1),
// by trying every set of stops visited so far ending at each one (Held–Karp).
export function bestOrder(matrix) {
  const n = matrix.length - 2;
  if (n < 1) return { order: [], time: orderTime(matrix, []) };
  if (n > MAX_STOPS) return null;
  const cost = (a, b) => (Number.isFinite(matrix[a]?.[b]) ? matrix[a][b] : Infinity);
  const FULL = (1 << n) - 1;
  // best[set][last]: quickest from the start through `set`, ending at stop `last`.
  const best = Array.from({ length: 1 << n }, () => new Float64Array(n).fill(Infinity));
  const prev = Array.from({ length: 1 << n }, () => new Int8Array(n).fill(-1));
  for (let i = 0; i < n; i++) best[1 << i][i] = cost(0, i + 1);
  for (let set = 1; set <= FULL; set++) {
    for (let last = 0; last < n; last++) {
      if (!(set & (1 << last)) || best[set][last] === Infinity) continue;
      for (let next = 0; next < n; next++) {
        if (set & (1 << next)) continue;
        const to = set | (1 << next);
        const t = best[set][last] + cost(last + 1, next + 1);
        if (t < best[to][next]) { best[to][next] = t; prev[to][next] = last; }
      }
    }
  }
  let time = Infinity, last = -1;
  for (let i = 0; i < n; i++) {
    const t = best[FULL][i] + cost(i + 1, n + 1);
    if (t < time) { time = t; last = i; }
  }
  if (last < 0) return null;
  const order = [];
  for (let set = FULL; last >= 0;) {
    order.unshift(last + 1);
    const p = prev[set][last];
    set &= ~(1 << last);
    last = p;
  }
  return { order, time };
}

// Whether the stops (in their order now) would be quicker in another order,
// and by how much: { order (indices into the stops), saving (seconds), now, best },
// or null when they're already as good as it gets, or nearly.
export function suggestOrder(matrix) {
  const n = matrix.length - 2;
  if (n < 2) return null;
  const found = bestOrder(matrix);
  if (!found) return null;
  const now = orderTime(matrix, Array.from({ length: n }, (_, i) => i + 1));
  const saving = now - found.time;
  if (!Number.isFinite(saving) || saving < MIN_SAVING_S || saving < now * MIN_SAVING_SHARE) return null;
  return { order: found.order.map((i) => i - 1), saving, now, best: found.time };
}
