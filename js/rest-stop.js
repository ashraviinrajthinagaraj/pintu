// Where to rest when the two-hour reminder comes (DriveWatch keeps that count):
// the next R&R on your side of the road, or a lay-by if no R&R comes soon.

const AHEAD_MIN_M = 500;      // too close to turn in safely
const AHEAD_MAX_M = 60000;

// The next R&R or lay-by you could still turn into.
export function nextRest(rests, s, { min = AHEAD_MIN_M, max = AHEAD_MAX_M } = {}) {
  // An R&R is better than a lay-by if it isn't much further.
  const ahead = (rests || []).filter((r) => r.along - s >= min && r.along - s <= max);
  const rnr = ahead.find((r) => r.kind === 'rnr');
  const first = ahead[0] || null;
  if (rnr && first && rnr.along - first.along <= 20000) return rnr;
  return first;
}
