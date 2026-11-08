// When something goes wrong for someone using Pintu, they can send a report to
// whoever they like (usually whoever gave them Pintu), with the technical
// details needed to find the fault. Nothing is sent anywhere by itself.
import { load, save, remove } from './store.js';

const MAX_ERRORS = 20;
export const MAX_FIXES = 7200;          // two hours, at one a second
const SAVE_EVERY_MS = 30000;

/* ---------- Errors ---------- */

export function rememberError(message, where = '', now = Date.now()) {
  const text = String(message || 'unknown').slice(0, 240);
  const list = load('errors', []);
  const last = list[list.length - 1];
  // The same error over and over is one line with a count.
  if (last && last.m === text && last.w === where) {
    last.n = (last.n || 1) + 1;
    last.t = now;
  } else {
    list.push({ t: now, m: text, w: String(where).slice(0, 120) });
  }
  save('errors', list.slice(-MAX_ERRORS));
}

export const recentErrors = () => load('errors', []);
export const clearErrors = () => remove('errors');

/* ---------- The last drive ---------- */

// Every GPS reading of the latest real drive, kept on this phone only and
// replaced by the next drive. It lets a fault be replayed exactly.
export class DriveLog {
  constructor({ dest, mode, version, now = Date.now() }) {
    this.data = {
      v: 1,
      version,
      startedAt: now,
      mode,
      dest: dest ? { name: dest.name || '', lng: dest.lng, lat: dest.lat } : null,
      fixes: [],
      events: [],
    };
    this.savedAt = -Infinity;   // the first reading is saved straight away
  }

  add(fix, now = Date.now()) {
    const t = Math.round((now - this.data.startedAt) / 100) / 10;
    const r = (v, d) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
    this.data.fixes.push([t, r(fix.lng, 6), r(fix.lat, 6), r(fix.accuracy, 0), r(fix.speed, 1), r(fix.heading, 0)]);
    if (this.data.fixes.length > MAX_FIXES) this.data.fixes.splice(0, this.data.fixes.length - MAX_FIXES);
    if (now - this.savedAt > SAVE_EVERY_MS) this.save(now);
  }

  event(name, now = Date.now()) {
    this.data.events.push([Math.round((now - this.data.startedAt) / 100) / 10, name]);
    if (this.data.events.length > 500) this.data.events.shift();
  }

  save(now = Date.now()) {
    this.savedAt = now;
    this.data.endedAt = now;
    save('lastDrive', this.data);
  }
}

export const lastDrive = () => load('lastDrive', null);
export const forgetDrive = () => remove('lastDrive');

/* ---------- The report ---------- */

const when = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Plain lines anyone can paste into a message. No places, unless the drive is attached.
export function reportText(info, now = Date.now()) {
  const lines = [
    `Pintu ${info.version}: problem report, ${when(now)}`,
    '',
    `What happened: ${info.note || '(please write here)'}`,
    '',
    `Phone: ${info.agent}`,
    `Screen: ${info.screen}, ${info.installed ? 'installed app' : 'in the browser'}, ${info.online ? 'online' : 'offline'}`,
    `Language ${info.lang}, theme ${info.theme}, voice ${info.voice}`,
    `Location: ${info.gps}`,
    `Settings: ${info.settings}`,
    `TomTom from this phone: ${info.tomtom}`,
    `Map: ${info.map}`,
    `Last route from: ${info.provider || 'none yet'}`,
  ];
  const d = info.drive;
  if (d) {
    const mins = d.endedAt ? Math.round((d.endedAt - d.startedAt) / 60000) : 0;
    const counts = {};
    for (const [, name] of d.events || []) counts[name] = (counts[name] || 0) + 1;
    const ev = Object.entries(counts).map(([k, n]) => `${k} ×${n}`).join(', ') || 'none';
    lines.push(`Last drive: ${when(d.startedAt)}, ${mins} min, ${d.fixes.length} GPS readings, events: ${ev}${info.attached ? ' (file attached)' : ''}`);
  }
  const errs = info.errors || [];
  lines.push('', errs.length ? 'Recent errors:' : 'Recent errors: none');
  for (const e of errs.slice(-10)) lines.push(`- ${when(e.t)} ${e.m}${e.n > 1 ? ` (×${e.n})` : ''}${e.w ? ` @ ${e.w}` : ''}`);
  return lines.join('\n');
}

// Through the phone's own share sheet (WhatsApp, Telegram, email…). The
// words are copied first, so the report isn't lost whatever the phone does.
export async function shareReport({ text, drive }, nav = globalThis.navigator) {
  // Started, not waited for: the share sheet must open while the tap still counts.
  let copying = Promise.resolve(false);
  try {
    if (nav?.clipboard?.writeText) copying = nav.clipboard.writeText(text).then(() => true, () => false);
  } catch { /* not allowed here */ }
  const copied = () => Promise.race([copying, new Promise((r) => setTimeout(() => r(false), 1500))]);
  // Phones only share some kinds of file, and plain text is one of them.
  const files = drive ? [new File([JSON.stringify(drive)], 'pintu-drive.txt', { type: 'text/plain' })] : [];
  if (nav?.share) {
    const data = { title: 'Pintu', text };
    if (files.length && nav.canShare?.({ files })) data.files = files;
    try {
      await nav.share(data);
      return data.files ? 'shared-with-drive' : 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      // Some phones refuse a file: once more with just the words.
      if (data.files) {
        try {
          await nav.share({ title: 'Pintu', text });
          return 'shared';
        } catch (again) {
          if (again?.name === 'AbortError') throw again;
        }
      }
      if (await copied()) return 'copied';
      throw e;
    }
  }
  if (await copied()) return 'copied';
  throw new Error('This phone can neither share nor copy');
}
