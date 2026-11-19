// Ferries on a route: the car ferry to Langkawi, the boats to Penang or Tioman
// on foot. The route already counts the time on the water; what it can't know
// is when the next one sails, or how long the queue is, so the plan says so and
// offers a way to look the times up.

const FERRY_IN = 28, FERRY_OUT = 29;

// Each crossing on the route: { name, at (metres along), km, seconds }.
export function ferryLegs(route) {
  const ms = route?.maneuvers || [];
  const out = [];
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    if (m.type !== FERRY_IN) continue;
    // The crossing runs until you're off the ferry again.
    let km = m.length || 0, seconds = m.time || 0;
    for (let j = i + 1; j < ms.length && ms[j].type !== FERRY_OUT && ms[j].ferry; j++) {
      km += ms[j].length || 0;
      seconds += ms[j].time || 0;
    }
    const name = [].concat(m.street_names || []).find((n) => typeof n === 'string' && n.trim()) || '';
    out.push({ name: name.trim(), at: m.beginDist ?? 0, km, seconds });
  }
  return out;
}

// A web search for when this ferry sails, in the language of the app.
export function timetableSearch(name, words = 'ferry timetable') {
  const q = [name || 'ferry', words].join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
