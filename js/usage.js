// How often this phone has asked TomTom for something, today and this month.
// The free allowance is shared by everyone using Pintu, so a phone stops
// asking for the day after a generous number, which only a fault or misuse
// would reach. Map tiles aren't counted: the phone and server keep those.
import { load, save } from './store.js';

export const DAILY_CAP = 500;

const dayOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function usage(now = new Date()) {
  const u = load('tomtomUse', null);
  const day = dayOf(now), month = day.slice(0, 7);
  return {
    today: u?.day === day ? u.today : 0,
    month: u?.month === month ? u.monthly : 0,
  };
}

export function countUse(now = new Date()) {
  const { today, month } = usage(now);
  const day = dayOf(now);
  save('tomtomUse', { day, month: day.slice(0, 7), today: today + 1, monthly: month + 1 });
}

export const overCap = (now = new Date()) => usage(now).today >= DAILY_CAP;
