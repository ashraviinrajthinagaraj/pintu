// Trips by bus, train and on foot, from Transitous (https://transitous.org): a
// free, community-run journey planner fed with the operators' own timetables:
// Rapid KL, KTM and ETS, BAS.MY, Rapid Penang and Singapore's buses and MRT
// among them. Its rules for apps: open source and not for profit (Pintu is both),
// each request saying who is asking and how to reach them, a link to its
// sources, and no more than about 720 searches a day without asking first.
//
// Asking from here rather than the phone lets every request say who it's from
// (a page can't set that), keeps the phone's address from Transitous, and trims
// the answer to what Pintu shows: a long trip comes back as nearly 300 KB.

export const PLAN_URL = 'https://api.transitous.org/api/v6/plan';
// Who's asking: the app, the version of it on the phone, and where to find its makers.
export const agent = (version) => `Pintu/${/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version || '') ? version : 'web'} (+https://github.com/ashraviinrajthinagaraj/pintu)`;
export const DAILY_LIMIT = 600;
export const LANGS = ['ms', 'en', 'zh', 'ta'];

const point = (s) => {
  const m = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(String(s || '').trim());
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
};

// The address to ask, from what the page sent, or null if it doesn't make sense.
export function planUrl(params) {
  const from = point(params.get('from'));
  const to = point(params.get('to'));
  if (!from || !to || from === to) return null;
  const u = new URL(PLAN_URL);
  u.searchParams.set('fromPlace', from);
  u.searchParams.set('toPlace', to);
  const when = params.get('time');
  if (when) {
    const at = new Date(when);
    // Within a year either way; anything else is a mistake.
    if (Number.isNaN(at.getTime()) || Math.abs(at.getTime() - Date.now()) > 366 * 86400000) return null;
    u.searchParams.set('time', at.toISOString());
  }
  if (params.get('arriveBy') === '1') u.searchParams.set('arriveBy', 'true');
  const cursor = params.get('cursor');
  if (cursor) {
    if (!/^[\w|:+=.,-]{1,300}$/.test(cursor)) return null;
    u.searchParams.set('pageCursor', cursor);
  }
  const lang = params.get('lang');
  if (LANGS.includes(lang)) u.searchParams.set('language', lang);
  // Walking paths between stops, and up to 20 minutes' walk at either end.
  u.searchParams.set('detailedTransfers', 'true');
  u.searchParams.set('maxPreTransitTime', '1200');
  u.searchParams.set('maxPostTransitTime', '1200');
  return u;
}

const place = (p) => (p ? {
  name: p.name || '',
  lat: p.lat,
  lon: p.lon,
  at: p.departure || p.arrival || null,
  planned: p.scheduledDeparture || p.scheduledArrival || null,
  track: p.track || p.scheduledTrack || undefined,
  cancelled: p.cancelled || undefined,
} : null);

function leg(l) {
  const out = {
    mode: l.mode,
    from: place(l.from),
    to: place(l.to),
    start: l.startTime,
    end: l.endTime,
    planStart: l.scheduledStartTime,
    planEnd: l.scheduledEndTime,
    seconds: l.duration,
    line: l.legGeometry?.points || '',
    precision: l.legGeometry?.precision ?? 6,
  };
  if (l.mode === 'WALK' || l.mode === 'BIKE' || l.mode === 'CAR') {
    out.metres = Math.round(l.distance || 0);
    return out;
  }
  Object.assign(out, {
    live: !!l.realTime,
    cancelled: l.cancelled || undefined,
    name: l.routeShortName || l.displayName || l.tripShortName || '',
    long: l.routeLongName || '',
    colour: l.routeColor || '',
    text: l.routeTextColor || '',
    agency: l.agencyName || '',
    toward: l.tripTo?.name || l.headsign || '',
    stay: l.interlineWithPreviousLeg || undefined,
    stops: (l.intermediateStops || []).map((s) => [s.name || '', s.arrival || s.departure || null]),
  });
  return out;
}

const trip = (it) => ({
  start: it.startTime,
  end: it.endTime,
  seconds: it.duration,
  transfers: it.transfers,
  legs: (it.legs || []).map(leg),
});

// Only what Pintu shows: each trip, the walk there if it's close, and where the
// earlier and later trips are.
export function trimPlan(json) {
  return {
    trips: (json?.itineraries || []).slice(0, 6).map(trip),
    walk: json?.direct?.[0] ? trip(json.direct[0]) : null,
    earlier: json?.previousPageCursor || null,
    later: json?.nextPageCursor || null,
  };
}

// Searches asked of Transitous today, by this copy of the server.
let today = { day: '', n: 0 };
export function underDailyLimit(now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (today.day !== day) today = { day, n: 0 };
  today.n++;
  return today.n <= DAILY_LIMIT;
}
export const forgetDailyCount = () => { today = { day: '', n: 0 }; };

export async function transitRoute(url, origin, reply, { fetchImpl = (...a) => fetch(...a) } = {}) {
  const ask = planUrl(url.searchParams);
  if (!ask) return reply({ error: 'bad request' }, origin, 400);
  if (!underDailyLimit()) return reply({ error: 'daily limit' }, origin, 429, { 'retry-after': '3600' });
  let res;
  try {
    res = await fetchImpl(ask.href, { headers: { 'user-agent': agent(url.searchParams.get('v')), accept: 'application/json' }, cf: { cacheTtl: 60, cacheEverything: true } });
  } catch {
    return reply({ error: 'unavailable' }, origin, 502);
  }
  if (res.status === 429) return reply({ error: 'busy' }, origin, 429, { 'retry-after': '60' });
  // Somewhere it has no timetables for, or no way between.
  if (res.status === 400 || res.status === 404 || res.status === 422) return reply({ trips: [], walk: null, earlier: null, later: null }, origin, 200, { 'cache-control': 'no-store' });
  if (!res.ok) return reply({ error: 'unavailable' }, origin, 502);
  let json;
  try { json = await res.json(); } catch { return reply({ error: 'unavailable' }, origin, 502); }
  return reply(trimPlan(json), origin, 200, { 'cache-control': 'no-store' });
}
