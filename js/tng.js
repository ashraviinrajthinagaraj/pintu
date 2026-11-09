// Touch 'n Go: the balance you typed, against what a trip's tolls might cost.
// After a drive, the plazas whose fare is known are taken off, so the balance
// stays close until you next check your card; it's then marked as a guess.
import { tollTotal } from './toll-fares.js';

const MAYBE_BELOW_RM = 30;   // with plazas of unknown fare, less than this may not be enough

export function cleanBalance(b) {
  const rm = Number(b?.rm);
  if (!Number.isFinite(rm) || rm < 0 || rm > 10000) return null;
  return { rm: Math.round(rm * 100) / 100, at: Number(b.at) || Date.now(), guessed: !!b.guessed };
}

// 'short' when the known fares alone are more than the balance, 'maybe' when
// unknown fares might take it over, 'ok' otherwise, or null with nothing to go on.
export function tngCheck(balance, tolls) {
  const b = cleanBalance(balance);
  if (!b || !tolls?.length) return null;
  const sum = tollTotal(tolls);
  const known = sum.total ?? 0;
  if (known > b.rm) return { state: 'short', need: Math.round((known - b.rm) * 100) / 100, sum, balance: b };
  if (sum.unknown && b.rm < Math.max(MAYBE_BELOW_RM, known + 10)) return { state: 'maybe', sum, balance: b };
  return { state: 'ok', sum, balance: b };
}

// What's left after paying the plazas you passed whose fare is known.
export function afterTolls(balance, paid) {
  const b = cleanBalance(balance);
  const spent = (paid || []).reduce((sum, rm) => sum + (Number.isFinite(rm) ? rm : 0), 0);
  if (!b || spent <= 0) return b;
  return { rm: Math.max(0, Math.round((b.rm - spent) * 100) / 100), at: Date.now(), guessed: true };
}
