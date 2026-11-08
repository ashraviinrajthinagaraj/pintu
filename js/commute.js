// Morning alerts: on the days and at the time you choose, a notification says
// how long the drive to work is today, compared with usual. Your home and work
// are sent to Pintu's server for this, and only while it's switched on.
import { get, post } from './hub.js';
import { load, remove, save } from './store.js';

export const COMMUTE_DEFAULTS = { on: false, time: '07:30', days: [1, 2, 3, 4, 5], slowOnly: false };
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const canNotify = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in globalThis;

export function keyBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const sameKey = (a, b) => {
  if (!a || !b) return false;
  const x = new Uint8Array(a), y = new Uint8Array(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

async function subscription(reg) {
  const { key } = await get('/push/key');
  const wanted = keyBytes(key);
  const existing = await reg.pushManager.getSubscription();
  if (existing && sameKey(existing.options?.applicationServerKey, wanted)) return existing;
  await existing?.unsubscribe();
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
}

export class CommuteError extends Error {
  constructor(kind) { super(kind); this.kind = kind; }
}

export async function commuteOn({ home, work, time, days, slowOnly, lang }, reg) {
  if (!canNotify() || !reg) throw new CommuteError('unsupported');
  const allowed = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (allowed !== 'granted') throw new CommuteError('denied');
  const sub = await subscription(reg);
  const kept = load('commuteId', null);
  const r = await post('/commute/set', {
    id: kept?.id, key: kept?.key,
    sub: { endpoint: sub.endpoint },
    home: { lng: home.lng, lat: home.lat },
    work: { lng: work.lng, lat: work.lat },
    time, days, slowOnly, lang,
  });
  save('commuteId', { id: r.id, key: r.key });
  return r;
}

export async function commuteOff(reg) {
  const kept = load('commuteId', null);
  remove('commuteId');
  if (kept) await post('/commute/off', kept).catch(() => {});
  try { await (await reg?.pushManager.getSubscription())?.unsubscribe(); } catch { /* already gone */ }
}

export function commuteTest() {
  const kept = load('commuteId', null);
  if (!kept) return Promise.reject(new CommuteError('off'));
  return post('/commute/test', kept);
}
