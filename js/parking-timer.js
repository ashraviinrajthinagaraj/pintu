// Paid parking: how long you paid for, a countdown on the car, and a reminder
// ten minutes before it's up. While Pintu is open it reminds you itself; when
// it's closed, Pintu's server sends a notification, if the phone allows them.
import { CommuteError, canNotify, pushSubscription } from './commute.js';
import { post } from './hub.js';
import { load, remove, save } from './store.js';

export const CHOICES_MIN = [30, 60, 120, 180];
export const WARN_MS = 10 * 60e3;
export const MAX_MS = 24 * 3600e3;

export function parkingLeft(car, now = Date.now()) {
  if (!car?.paidUntil) return null;
  return car.paidUntil - now;
}

// Time to say so: within the last ten minutes, once.
export const warnDue = (car, now = Date.now()) => {
  const left = parkingLeft(car, now);
  return left != null && left > 0 && left <= WARN_MS && !car.warned;
};

export async function remindOnServer(until, lang, reg) {
  if (!canNotify() || !reg) throw new CommuteError('unsupported');
  const allowed = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (allowed !== 'granted') throw new CommuteError('denied');
  const sub = await pushSubscription(reg);
  const kept = load('parkingRemind', null);
  const r = await post('/remind/set', { id: kept?.id, key: kept?.key, sub: { endpoint: sub.endpoint }, until, lang });
  save('parkingRemind', { id: r.id, key: r.key });
  return r;
}

export async function remindOff() {
  const kept = load('parkingRemind', null);
  remove('parkingRemind');
  if (kept) await post('/remind/off', kept).catch(() => {});
}
