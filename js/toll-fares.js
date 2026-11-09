// What a car pays at a toll plaza, for the few highways where that is simple:
// the same fixed fare at every plaza, whichever way you go. Each fare is the
// one announced for private cars (Class 1), with where it was announced.
//
// On long highways such as PLUS the fare depends on where you got on, and on
// some city highways it changes from plaza to plaza or by direction, so those
// stay unpriced. A plaza with no known fare is never counted as free: the total
// says how many plazas it leaves out.
import { roadNames } from './instructions.js';

export const FARES = [
  {
    road: 'DASH', refs: ['E31'], rm: 2.30, since: '2022-12-01',
    source: 'https://paultan.org/2022/11/30/dash-highway-toll-rates-announced-rm2-30-for-class-1-vehicles-at-all-toll-plazas-from-dec-1-2022',
  },
  {
    road: 'LDP', refs: ['E11'], rm: 2.10, since: '2015-10-15',
    source: 'https://paultan.org/2015/10/13/ldp-toll-rates-up-oct-15',
  },
  {
    road: 'KESAS', refs: ['E5'], rm: 2.00, since: '2013-01-14',
    source: 'https://paultan.org/2013/01/14/kesas-highway-toll-charges-down-by-20-sen-to-rm2/',
  },
  {
    road: 'BESRAYA', refs: ['E9'], rm: 1.85, since: '2023-01-01',
    source: 'https://paultan.org/2022/12/31/kadar-tol-besraya-dan-lekas-diturunkan-berkuatkuasa-12-01-t-malam-1-jan-2023-menteri-kkr/',
  },
];

// Route numbers as OpenStreetMap writes them: "E11", "E 11", "E11;FT2".
const refsOf = (m) => {
  const names = [...(m.street_names || []), ...(m.begin_street_names || [])];
  const { ref } = roadNames(m);
  if (ref) names.push(ref);
  return new Set(names.flatMap((n) => String(n).split(/[;,/]/)).map((n) => n.replace(/\s+/g, '').toUpperCase()));
};

function maneuverAt(route, s) {
  const ms = route.maneuvers || [];
  let i = 0;
  while (i < ms.length - 1 && (ms[i + 1].beginDist ?? 0) <= s) i++;
  return ms[i] || null;
}

// The fare for one plaza on this route, if the road it stands on has one.
export function fareAt(route, toll) {
  const m = maneuverAt(route, toll.along ?? 0);
  if (!m) return null;
  const refs = refsOf(m);
  return FARES.find((f) => f.refs.some((r) => refs.has(r))) || null;
}

const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// What drivers say they paid at a plaza (newest first), for the plaza before it
// on this trip. On a closed highway the exit fare depends on the entry, so a
// fare from the same entry counts; from other entries, only if they all agree,
// as they would at an open plaza.
export function driverFare(reports, prev) {
  if (!reports?.length) return null;
  const same = reports.filter((r) => (r.prev || null) === (prev || null)).slice(0, 5).map((r) => r.rm);
  if (same.length) return Math.round(median(same) * 100) / 100;
  const all = reports.slice(0, 7).map((r) => r.rm);
  const mid = median(all);
  return all.every((rm) => Math.abs(rm - mid) <= 0.1) ? Math.round(mid * 100) / 100 : null;
}

// `drivers` is what Pintu's server knows, by plaza: used where no fare was announced.
export function priceTolls(route, tolls, drivers = null) {
  return (tolls || []).map((toll, i, all) => {
    const fare = fareAt(route, toll);
    if (fare) return { ...toll, fare: fare.rm, road: fare.road };
    const told = drivers ? driverFare(drivers[toll.id], all[i - 1]?.id) : null;
    return { ...toll, fare: told, road: null, byDrivers: told != null };
  });
}

// What the plazas on a route come to, as far as is known.
export function tollTotal(priced) {
  const known = priced.filter((t) => t.fare != null);
  const total = Math.round(known.reduce((sum, t) => sum + t.fare, 0) * 100) / 100;
  return {
    plazas: priced.length,
    priced: known.length,
    unknown: priced.length - known.length,
    total: known.length ? total : null,
    roads: [...new Set(known.map((t) => t.road).filter(Boolean))],
    byDrivers: known.filter((t) => t.byDrivers).length,
  };
}
