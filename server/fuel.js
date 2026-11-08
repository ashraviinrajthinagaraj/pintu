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

// Without the filter too, in case data.gov.my ever stops understanding it: the
// newest few rows always include the newest price level.
export const FUEL_URL_PLAIN = 'https://api.data.gov.my/data-catalogue?id=fuelprice&sort=-date&limit=4';

async function latestPrices() {
  for (const url of [FUEL_URL, FUEL_URL_PLAIN]) {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; PintuHelper/1.0)' },
      cf: { cacheTtl: KEEP_S, cacheEverything: true },
    });
    if (!res.ok) { await res.body?.cancel(); continue; }
    let rows;
    try { rows = await res.json(); } catch { continue; }
    const fuel = readFuelPrices(rows);
    if (fuel) return fuel;
  }
  return null;
}

export async function fuelRoute(origin, reply) {
  const fuel = await latestPrices().catch(() => null);
  if (!fuel) return reply({ error: 'could not read the prices' }, origin, 502);
  return reply({ ...fuel, source: 'data.gov.my' }, origin, 200, { 'cache-control': `public, max-age=${KEEP_S}` });
}

// Opening /fuel?check=1 in a browser shows what Pintu would use, and nothing more.
export async function fuelCheck() {
  const fuel = await latestPrices().catch(() => null);
  const text = fuel
    ? `Fuel prices from data.gov.my, ${fuel.date || 'no date'}: ${Object.entries(fuel.prices).map(([k, v]) => `${k} RM${v.toFixed(2)}`).join(', ')}.`
    : 'Fuel prices: data.gov.my could not be read.';
  return new Response(text, { status: fuel ? 200 : 502, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
