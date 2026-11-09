// Trips marked as work, for claiming mileage: a month's list as a CSV file a
// spreadsheet opens, with the claim at your rate per km if you set one.

export function cleanRate(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 20 ? Math.round(n * 100) / 100 : null;
}

const inMonth = (t, year, month) => { const d = new Date(t.at); return d.getFullYear() === year && d.getMonth() === month; };

export function workTrips(trips, year, month) {
  return (trips || []).filter((t) => t.w && inMonth(t, year, month)).sort((a, b) => a.at - b.at);
}

export function workTotals(list, rate) {
  const km = Math.round(list.reduce((sum, t) => sum + t.km, 0) * 10) / 10;
  const r = cleanRate(rate);
  return { trips: list.length, km, claim: r ? Math.round(km * r * 100) / 100 : null };
}

// A field as a spreadsheet reads it: quoted when it has to be, and never taken
// for a formula.
const cell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// `head` is the column names in the reader's language.
export function workCsv(list, rate, head) {
  const r = cleanRate(rate);
  const pad = (n) => String(n).padStart(2, '0');
  const rows = list.map((t) => {
    const d = new Date(t.at);
    return [
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      t.from || '', t.to || '',
      t.km.toFixed(1),
      t.cost != null ? t.cost.toFixed(2) : '',
      r ? (t.km * r).toFixed(2) : '',
    ];
  });
  const total = workTotals(list, r);
  rows.push(['', '', '', '', total.km.toFixed(1), '', total.claim != null ? total.claim.toFixed(2) : '']);
  // Excel needs the byte-order mark to read Malay, Chinese and Tamil names right.
  return `﻿${[head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
