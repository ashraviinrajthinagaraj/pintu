// This week's official pump prices, from data.gov.my. The government sets them
// every Wednesday. data.gov.my answers only a few requests a minute, so the
// answer is kept for hours.
export const FUEL_URL = 'https://api.data.gov.my/data-catalogue?id=fuelprice&filter=level@series_type&sort=-date&limit=1';
const GRADES = ['ron95', 'ron97', 'diesel', 'diesel_eastmsia', 'ron95_budi95', 'ron95_skps'];
const KEEP_S = 6 * 3600;

// Only the figures, with anything odd left out.
export function readFuelPrices(answer) {
  // A plain list, or the list inside { data: [...] }.
  const rows = Array.isArray(answer) ? answer : answer?.data;
  const row = Array.isArray(rows) ? rows.find((r) => r && (r.series_type === 'level' || r.series_type == null)) : null;
  if (!row) return null;
  const prices = {};
  for (const grade of GRADES) {
    const n = Number(row[grade]);
    if (row[grade] != null && row[grade] !== '' && Number.isFinite(n) && n > 0 && n < 20) prices[grade] = n;
  }
  if (!Object.keys(prices).length) return null;
  const date = /^\d{4}-\d{2}-\d{2}/.test(String(row.date || '')) ? String(row.date).slice(0, 10) : null;
  return { date, prices };
}

export async function fuelRoute(origin, reply) {
  const res = await fetch(FUEL_URL, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; PintuHelper/1.0)' },
    cf: { cacheTtl: KEEP_S, cacheEverything: true },
  });
  if (!res.ok) return reply({ error: 'source unavailable' }, origin, 502);
  let rows;
  try { rows = await res.json(); } catch { return reply({ error: 'could not read the prices' }, origin, 502); }
  const fuel = readFuelPrices(rows);
  if (!fuel) return reply({ error: 'could not read the prices' }, origin, 502);
  return reply({ ...fuel, source: 'data.gov.my' }, origin, 200, { 'cache-control': `public, max-age=${KEEP_S}` });
}
