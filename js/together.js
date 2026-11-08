// Driving with other people: a live link to your trip that anyone can open, and
// convoys, where friends heading to the same place see each other on the map.
import { get, isCode, linkFor, placeOf, posOf, post } from './hub.js';
import { load, remove, save } from './store.js';

export const SHARE_EVERY_MS = 15e3;
export const CONVOY_EVERY_MS = 5e3;      // while driving
export const CONVOY_WAIT_MS = 15e3;      // while still planning
export const SHARE_MS = 12 * 3600e3;

/* ---------- A live link to your trip ---------- */

export class TripShare {
  constructor(saved = {}) {
    this.id = saved.id || null;
    this.key = saved.key || null;
    this.started = saved.started || 0;
    this.sentAt = 0;
    this.busy = false;
    this.watched = false;
    this.over = false;
  }

  get link() { return this.id ? linkFor('watch', this.id) : null; }

  static resume(now = Date.now()) {
    const s = load('share', null);
    if (!s || !isCode(s.id, 10) || !isCode(s.key, 22) || now - s.started > SHARE_MS) return null;
    return new TripShare(s);
  }

  async start({ name, dest, fix, eta, remaining }, now = Date.now()) {
    const r = await post('/share/start', { name, dest: placeOf(dest), pos: posOf(fix), eta, remaining });
    this.id = r.id;
    this.key = r.key;
    this.started = now;
    this.sentAt = now;
    save('share', { id: this.id, key: this.key, started: now });
    return this;
  }

  due(now = Date.now()) { return !!this.id && !this.busy && !this.over && now - this.sentAt >= SHARE_EVERY_MS; }

  async send({ fix, eta, remaining, dest }, now = Date.now()) {
    if (!this.id || this.busy || this.over || !fix) return;
    this.busy = true;
    this.sentAt = now;
    try {
      const r = await post('/share/update', { id: this.id, key: this.key, pos: posOf(fix), eta, remaining, dest: dest ? placeOf(dest) : undefined });
      this.watched = !!r.watched;
    } catch (e) {
      // Ended on the server: twelve hours have passed, or it was stopped elsewhere.
      if (e.status === 404 || e.status === 410) this.stop();
    } finally {
      this.busy = false;
    }
  }

  stop() {
    this.over = true;
    remove('share');
  }

  async end(arrived = false) {
    const { id, key } = this;
    this.stop();
    if (id) await post('/share/end', { id, key, arrived }).catch(() => {});
  }
}

// What someone following sees.
export const watchTrip = (id, opts) => get(`/share?id=${id}`, opts);

/* ---------- Convoys ---------- */

export class Convoy {
  constructor({ id, member, key, dest, members = [] }) {
    this.id = id;
    this.member = member;
    this.key = key;
    this.dest = dest;
    this.members = members;
    this.sentAt = 0;
    this.busy = false;
    this.over = false;
  }

  get link() { return linkFor('convoy', this.id); }
  get others() { return this.members.filter((m) => m.member !== this.member); }

  static resume() {
    const c = load('convoy', null);
    if (!c || !isCode(c.id, 10) || !isCode(c.member, 6) || !isCode(c.key, 22)) return null;
    return new Convoy(c);
  }

  keep() { save('convoy', { id: this.id, member: this.member, key: this.key, dest: this.dest }); }

  static async start({ name, dest, fix }) {
    const c = new Convoy(await post('/convoy/start', { name, dest: placeOf(dest), pos: posOf(fix) }));
    c.keep();
    return c;
  }

  static peek(id, opts) { return get(`/convoy?id=${id}`, opts); }

  static async join(id, { name, fix }) {
    const c = new Convoy(await post('/convoy/join', { id, name, pos: posOf(fix) }));
    c.keep();
    return c;
  }

  due(now, driving) { return !this.busy && !this.over && now - this.sentAt >= (driving ? CONVOY_EVERY_MS : CONVOY_WAIT_MS); }

  async send({ fix, eta, remaining }, now = Date.now()) {
    if (this.busy || this.over) return false;
    this.busy = true;
    this.sentAt = now;
    try {
      const r = await post('/convoy/update', { id: this.id, member: this.member, key: this.key, pos: posOf(fix), eta, remaining });
      this.members = Array.isArray(r.members) ? r.members : [];
      return true;
    } catch (e) {
      if (e.status === 404) this.stop();
      return false;
    } finally {
      this.busy = false;
    }
  }

  stop() {
    this.over = true;
    remove('convoy');
  }

  async leave() {
    this.stop();
    await post('/convoy/leave', { id: this.id, member: this.member, key: this.key }).catch(() => {});
  }
}

// Where each friend is compared with you, by what's left of the same trip.
export function convoyOrder(members, me, myRemaining) {
  return members
    .filter((m) => m.member !== me)
    .map((m) => ({ ...m, gap: m.remaining != null && myRemaining != null ? myRemaining - m.remaining : null }))
    .sort((a, b) => (b.gap ?? -Infinity) - (a.gap ?? -Infinity));
}
