// The few things Pintu's phones share with each other, held for hours, not kept:
//
//   a live trip someone has shared with a link   (gone 1 hour after it ends, or 12 hours on)
//   road reports: police, accidents, hazards    (each gone after an hour or a few)
//   convoys: friends driving to the same place  (gone 12 hours after the last move)
//   morning alerts: home, work and a time       (until switched off)
//   a parking reminder: when the time paid ends (gone an hour after it ends)
//   toll fares drivers say they paid, at a plaza and after which plaza (a year)
//
// One Durable Object holds it all in its own small SQLite database. Nothing here
// says who anyone is: names are whatever people type, and a phone is a random code.

// Malaysia has no summer time, so local time is always eight hours ahead.
export const LOCAL_OFFSET_MS = 8 * 3600e3;

export const SHARE_MS = 12 * 3600e3;
export const SHARE_AFTER_MS = 3600e3;         // "arrived" stays readable this long
export const SHARE_QUIET_MS = 30 * 60e3;      // no word from the phone in this long: over
export const CONVOY_MS = 12 * 3600e3;
export const MEMBER_STALE_MS = 10 * 60e3;
export const CONVOY_MAX = 12;
export const REPORT_LIFE_MIN = { police: 60, crash: 90, hazard: 180, jam: 45, closed: 360 };
export const REPORT_SAME_M = 150;
export const REPORTS_PER_HOUR = 12;
export const COMMUTE_PER_RUN = 15;
export const TESTS_PER_DAY = 5;
const MESSAGE_MS = 3 * 3600e3;
export const PARKING_WARN_MS = 10 * 60e3;     // the reminder comes this long before the time is up
export const PARKING_MAX_MS = 24 * 3600e3;
export const REMINDERS_PER_RUN = 30;
export const FARES_PER_DAY = 60;              // one phone, in a day
export const FARES_KEEP_MS = 400 * 86400e3;
export const FARES_SHOWN = 20;                // the newest, per plaza
const PLAZA = /^(node|way)\/\d{1,12}$/;
const PUSH_SUB = 'https://ashraviinrajthinagaraj.github.io/pintu/';

// Push services the server will send to, and nothing else.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, key TEXT, name TEXT, dest TEXT, pos TEXT, eta INTEGER, remaining INTEGER, started INTEGER, updated INTEGER, seen INTEGER, ended INTEGER, arrived INTEGER);
CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, lng REAL, lat REAL, heading REAL, at INTEGER, expires INTEGER, up INTEGER, down INTEGER, device TEXT);
CREATE INDEX IF NOT EXISTS reports_place ON reports (lat, lng);
CREATE TABLE IF NOT EXISTS convoys (id TEXT PRIMARY KEY, dest TEXT, started INTEGER, touched INTEGER);
CREATE TABLE IF NOT EXISTS members (convoy TEXT, member TEXT, key TEXT, name TEXT, pos TEXT, eta INTEGER, remaining INTEGER, at INTEGER, left INTEGER, PRIMARY KEY (convoy, member));
CREATE TABLE IF NOT EXISTS commuters (id TEXT PRIMARY KEY, key TEXT, endpoint TEXT UNIQUE, home TEXT, work TEXT, time TEXT, days TEXT, slow_only INTEGER, lang TEXT, sent_day TEXT, message TEXT, message_at INTEGER, tests_day TEXT, tests INTEGER);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS fares (id INTEGER PRIMARY KEY AUTOINCREMENT, plaza TEXT, prev TEXT, rm REAL, at INTEGER, device TEXT);
CREATE INDEX IF NOT EXISTS fares_plaza ON fares (plaza, at);
CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, key TEXT, endpoint TEXT UNIQUE, at INTEGER, until INTEGER, lang TEXT, sent INTEGER, message TEXT, message_at INTEGER);
`;

/* ---------- Checking what phones send ---------- */

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randomId(n = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}
const isId = (s, n) => typeof s === 'string' && s.length === n && [...s].every((c) => ALPHABET.includes(c));

const text = (s, max) => (typeof s === 'string' ? s.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const finite = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

export function cleanPoint(p) {
  const lng = finite(p?.lng, -180, 180), lat = finite(p?.lat, -90, 90);
  return lng == null || lat == null ? null : { lng: Math.round(lng * 1e6) / 1e6, lat: Math.round(lat * 1e6) / 1e6 };
}

export function cleanPos(p) {
  const at = cleanPoint(p);
  if (!at) return null;
  const heading = finite(p.heading, 0, 360);
  const speed = finite(p.speed, 0, 120);
  return { ...at, heading: heading == null ? null : Math.round(heading), speed: speed == null ? null : Math.round(speed * 10) / 10 };
}

export function cleanDest(d) {
  const at = cleanPoint(d);
  return at ? { name: text(d.name, 80), ...at } : null;
}

const cleanEta = (v, now) => (finite(v, now - 3600e3, now + 2 * 86400e3) == null ? null : Math.round(v));
const cleanRemaining = (v) => { const n = finite(v, 0, 5e6); return n == null ? null : Math.round(n); };

export function metres(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// The endpoint a phone's browser gave for notifications, if it's a real push service.
export function cleanSubscription(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1000) return null;
  let url;
  try { url = new URL(sub.endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !PUSH_HOSTS.test(url.hostname)) return null;
  return { endpoint: url.href };
}

const cleanTime = (s) => (typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null);
const cleanDays = (d) => {
  if (!Array.isArray(d)) return null;
  const days = [...new Set(d.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  return days.length ? days : null;
};

/* ---------- Local time ---------- */

export function localNow(now) {
  const d = new Date(now + LOCAL_OFFSET_MS);
  return {
    day: d.toISOString().slice(0, 10),
    weekday: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
// Due from the chosen minute until a quarter of an hour after, once a day.
export const COMMUTE_WINDOW_MIN = 15;
export function commuteDue(c, now) {
  const t = localNow(now);
  const days = JSON.parse(c.days || '[]');
  if (!days.includes(t.weekday) || c.sent_day === t.day) return false;
  const from = minutesOf(c.time);
  return t.minutes >= from && t.minutes < from + COMMUTE_WINDOW_MIN;
}

/* ---------- The morning message ---------- */

const mins = (s) => Math.max(1, Math.round(s / 60));
const UNITS = { ms: ['j', 'min'], en: ['hr', 'min'], zh: ['小时', '分钟'], ta: ['மணி', 'நிமி'] };
function duration(seconds, lang) {
  const m = mins(seconds);
  const [hour, min] = UNITS[lang] || UNITS.ms;
  if (m < 60) return `${m} ${min}`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} ${hour} ${r} ${min}` : `${h} ${hour}`;
}
function clock(ms, lang) {
  const d = new Date(ms + LOCAL_OFFSET_MS);
  let h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  if (lang === 'en') {
    const pm = h >= 12;
    h = h % 12 || 12;
    return `${h}:${m} ${pm ? 'pm' : 'am'}`;
  }
  if (lang === 'zh') return `${h < 12 ? '上午' : '下午'}${h % 12 || 12}:${m}`;
  if (lang === 'ta') return `${h < 12 ? 'காலை' : h < 15 ? 'மதியம்' : h < 19 ? 'மாலை' : 'இரவு'} ${h % 12 || 12}:${m}`;
  const part = h < 12 ? 'pg' : h < 14 ? 'tgh' : h < 19 ? 'ptg' : 'mlm';
  return `${h % 12 || 12}:${m} ${part}`;
}

const MORNING = {
  ms: {
    title: (t) => `Ke tempat kerja: ${t}`,
    slow: (x) => `${x} lebih lama daripada biasa.`, fast: () => 'Lebih lancar daripada biasa.', usual: () => 'Seperti biasa.',
    leave: (a) => `Bertolak sekarang, sampai lebih kurang ${a}.`,
  },
  en: {
    title: (t) => `To work: ${t}`,
    slow: (x) => `${x} longer than usual.`, fast: () => 'Quicker than usual.', usual: () => 'About as usual.',
    leave: (a) => `Leave now and you'll arrive about ${a}.`,
  },
  zh: {
    title: (t) => `去公司：${t}`,
    slow: (x) => `比平常慢 ${x}。`, fast: () => '比平常顺畅。', usual: () => '和平常差不多。',
    leave: (a) => `现在出发，大约 ${a} 到达。`,
  },
  ta: {
    title: (t) => `வேலைக்கு: ${t}`,
    slow: (x) => `வழக்கத்தைவிட ${x} அதிகம்.`, fast: () => 'வழக்கத்தைவிட விரைவாக உள்ளது.', usual: () => 'வழக்கம் போலவே.',
    leave: (a) => `இப்போது புறப்பட்டால் சுமார் ${a} மணிக்குச் சேர்வீர்கள்.`,
  },
};
export const MORNING_LANGS = Object.keys(MORNING);

const PARKING = {
  ms: { title: 'Masa parkir hampir tamat', body: (n, c) => `Parkir anda tamat dalam ${n} minit, jam ${c}.`, over: (c) => `Parkir anda tamat jam ${c}.` },
  en: { title: 'Parking nearly up', body: (n, c) => `Your parking ends in ${n} minutes, at ${c}.`, over: (c) => `Your parking ended at ${c}.` },
  zh: { title: '停车时间快到了', body: (n, c) => `您的停车时间将在 ${n} 分钟后（${c}）结束。`, over: (c) => `您的停车时间已在 ${c} 结束。` },
  ta: { title: 'பார்க்கிங் நேரம் முடியப்போகிறது', body: (n, c) => `உங்கள் பார்க்கிங் ${n} நிமிடங்களில், ${c} மணிக்கு முடியும்.`, over: (c) => `உங்கள் பார்க்கிங் ${c} மணிக்கு முடிந்தது.` },
};

// What a parking reminder says, worked out when it's sent: cron runs every
// five minutes, so the minutes left are counted then, not when it was set.
export function parkingMessage(until, now, lang = 'ms') {
  const l = PARKING[lang] ? lang : 'ms';
  const w = PARKING[l];
  const left = Math.round((until - now) / 60e3);
  return { title: w.title, body: left >= 1 ? w.body(left, clock(until, l)) : w.over(clock(until, l)), url: './?go=car', tag: 'parking' };
}

// What to say, from TomTom's live and usual times for the trip.
export function commuteMessage({ travel, usual }, now, lang = 'ms') {
  const w = MORNING[lang] || MORNING.ms;
  const l = MORNING[lang] ? lang : 'ms';
  const extra = usual ? travel - usual : 0;
  const how = extra >= 5 * 60 ? w.slow(duration(extra, l)) : extra <= -5 * 60 ? w.fast() : w.usual();
  const gap = l === 'zh' ? '' : ' ';
  return { title: w.title(duration(travel, l)), body: `${how}${gap}${w.leave(clock(now + travel * 1000, l))}`, slow: extra >= 5 * 60, url: './?go=work' };
}

/* ---------- Notifications ---------- */

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const utf8 = (s) => new TextEncoder().encode(s);

// The key that says notifications come from this server. Made once and kept.
export async function vapidKeys(load, store) {
  const kept = load();
  if (kept) {
    const v = JSON.parse(kept);
    const key = await crypto.subtle.importKey('jwk', v.private, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    return { key, public: v.public };
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  store(JSON.stringify({ public: pub, private: priv }));
  return { key: pair.privateKey, public: pub };
}

export async function vapidHeader(endpoint, keys, now) {
  const head = b64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(utf8(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: PUSH_SUB })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.key, utf8(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64url(sig)}, k=${keys.public}`;
}

/* ---------- TomTom, for the morning trip ---------- */

const loc = (p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
export async function commuteTimes(home, work, key, fetchImpl = fetch) {
  const q = new URLSearchParams({ key, traffic: 'true', computeTravelTimeFor: 'all', travelMode: 'car', routeType: 'fastest' });
  const res = await fetchImpl(`https://api.tomtom.com/routing/1/calculateRoute/${loc(home)}:${loc(work)}/json?${q}`);
  if (!res.ok) return null;
  const sum = (await res.json())?.routes?.[0]?.summary;
  if (!Number.isFinite(sum?.travelTimeInSeconds)) return null;
  const usual = sum.historicTrafficTravelTimeInSeconds ?? sum.noTrafficTravelTimeInSeconds ?? null;
  return { travel: sum.travelTimeInSeconds, usual: Number.isFinite(usual) ? usual : null };
}

/* ---------- The Durable Object ---------- */

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const nope = (error, status = 400) => json({ error }, status);

export class Hub {
  constructor(state, env, { fetchImpl = (...a) => fetch(...a), clock: now = () => Date.now() } = {}) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.sql.exec(SCHEMA);
  }

  rows(query, ...args) { return [...this.sql.exec(query, ...args)]; }
  row(query, ...args) { return this.rows(query, ...args)[0] || null; }
  run(query, ...args) { this.sql.exec(query, ...args); }

  async fetch(request) {
    const url = new URL(request.url);
    let body = null;
    if (request.method === 'POST') {
      try { body = JSON.parse(await request.text()); } catch { return nope('not understood'); }
      if (!body || typeof body !== 'object') return nope('not understood');
    }
    const q = url.searchParams;
    switch (url.pathname) {
      case '/share/start': return this.shareStart(body);
      case '/share/update': return this.shareUpdate(body);
      case '/share/end': return this.shareEnd(body);
      case '/share': return this.shareGet(q.get('id'));
      case '/reports': return this.reportList(q.get('bbox'));
      case '/reports/add': return this.reportAdd(body);
      case '/reports/vote': return this.reportVote(body);
      case '/convoy/start': return this.convoyStart(body);
      case '/convoy/join': return this.convoyJoin(body);
      case '/convoy/update': return this.convoyUpdate(body);
      case '/convoy/leave': return this.convoyLeave(body);
      case '/convoy': return this.convoyGet(q.get('id'));
      case '/push/key': return json({ key: (await this.vapid()).public });
      case '/commute/set': return this.commuteSet(body);
      case '/commute/off': return this.commuteOff(body);
      case '/commute/test': return this.commuteTest(body);
      case '/commute/message': return this.commuteMessageFor(body);
      case '/remind/set': return this.remindSet(body);
      case '/fares/add': return this.faresAdd(body);
      case '/fares': return this.faresGet(q.get('ids'));
      case '/remind/off': return this.remindOff(body);
      case '/cron': return json(await this.cron());
      default: return nope('not found', 404);
    }
  }

  /* ----- A live trip, shared with a link ----- */

  shareStart(b) {
    const pos = cleanPos(b?.pos);
    const dest = cleanDest(b?.dest);
    if (!pos || !dest) return nope('not a trip');
    const now = this.now();
    const id = randomId(10), key = randomId(22);
    this.run('INSERT INTO shares (id, key, name, dest, pos, eta, remaining, started, updated, seen, ended, arrived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)',
      id, key, text(b.name, 30), JSON.stringify(dest), JSON.stringify(pos), cleanEta(b.eta, now), cleanRemaining(b.remaining), now, now);
    return json({ id, key, until: now + SHARE_MS });
  }

  ownShare(b) {
    if (!isId(b?.id, 10) || !isId(b?.key, 22)) return null;
    const s = this.row('SELECT * FROM shares WHERE id = ?', b.id);
    return s && s.key === b.key ? s : null;
  }

  shareUpdate(b) {
    const s = this.ownShare(b);
    const pos = cleanPos(b?.pos);
    if (!s) return nope('no such trip', 404);
    if (!pos) return nope('no position');
    const now = this.now();
    if (s.ended || now - s.started > SHARE_MS) return nope('ended', 410);
    const dest = b.dest ? cleanDest(b.dest) : null;
    this.run('UPDATE shares SET pos = ?, eta = ?, remaining = ?, updated = ?, dest = COALESCE(?, dest) WHERE id = ?',
      JSON.stringify(pos), cleanEta(b.eta, now), cleanRemaining(b.remaining), now, dest ? JSON.stringify(dest) : null, s.id);
    return json({ ok: true, watched: now - s.seen < 60e3 });
  }

  shareEnd(b) {
    const s = this.ownShare(b);
    if (!s) return nope('no such trip', 404);
    this.run('UPDATE shares SET ended = ?, arrived = ? WHERE id = ?', this.now(), b.arrived ? 1 : 0, s.id);
    return json({ ok: true });
  }

  shareGet(id) {
    if (!isId(id, 10)) return nope('no such trip', 404);
    const s = this.row('SELECT * FROM shares WHERE id = ?', id);
    const now = this.now();
    if (!s || now - s.started > SHARE_MS + SHARE_AFTER_MS || (s.ended && now - s.ended > SHARE_AFTER_MS)) return nope('ended', 404);
    this.run('UPDATE shares SET seen = ? WHERE id = ?', now, id);
    const quiet = now - s.updated > SHARE_QUIET_MS;
    return json({
      name: s.name, dest: JSON.parse(s.dest), pos: JSON.parse(s.pos), eta: s.eta, remaining: s.remaining,
      at: s.updated, now, ended: !!s.ended || quiet || now - s.started > SHARE_MS, arrived: !!s.arrived,
    });
  }

  /* ----- Road reports ----- */

  reportList(bbox) {
    const box = String(bbox || '').split(',').map(Number);
    if (box.length !== 4 || box.some((n) => !Number.isFinite(n))) return nope('no area');
    const [w, s, e, n] = box;
    if (e < w || n < s || e - w > 2 || n - s > 2) return nope('area too big');
    const now = this.now();
    const found = this.rows('SELECT id, kind, lng, lat, heading, at, up, down FROM reports WHERE expires > ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? ORDER BY at DESC LIMIT 200',
      now, s, n, w, e);
    return json({ reports: found, now });
  }

  reportAdd(b) {
    const kind = Object.hasOwn(REPORT_LIFE_MIN, b?.kind) ? b.kind : null;
    const at = cleanPoint(b);
    const device = isId(b?.device, 16) ? b.device : null;
    if (!kind || !at || !device) return nope('not a report');
    const now = this.now();
    const recent = this.row('SELECT COUNT(*) AS n FROM reports WHERE device = ? AND at > ?', device, now - 3600e3).n;
    if (recent >= REPORTS_PER_HOUR) return nope('too many', 429);
    const life = REPORT_LIFE_MIN[kind] * 60e3;
    // The same thing reported again nearby is the same report, seen again.
    const d = 0.002;
    const near = this.rows('SELECT * FROM reports WHERE kind = ? AND expires > ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?',
      kind, now, at.lat - d, at.lat + d, at.lng - d, at.lng + d).find((r) => metres(r, at) <= REPORT_SAME_M);
    if (near) {
      this.run('UPDATE reports SET up = up + 1, expires = MAX(expires, ?) WHERE id = ?', now + life, near.id);
      return json({ id: near.id, again: true });
    }
    const heading = finite(b.heading, 0, 360);
    this.run('INSERT INTO reports (kind, lng, lat, heading, at, expires, up, down, device) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)',
      kind, at.lng, at.lat, heading == null ? null : Math.round(heading), now, now + life, device);
    return json({ id: this.row('SELECT last_insert_rowid() AS id').id });
  }

  reportVote(b) {
    const id = Number.isInteger(b?.id) ? b.id : null;
    const device = isId(b?.device, 16) ? b.device : null;
    if (id == null || !device) return nope('not a vote');
    const now = this.now();
    const r = this.row('SELECT * FROM reports WHERE id = ? AND expires > ?', id, now);
    if (!r) return json({ gone: true });
    if (b.still) {
      const life = REPORT_LIFE_MIN[r.kind] * 60e3;
      this.run('UPDATE reports SET up = up + 1, expires = MAX(expires, ?) WHERE id = ?', now + life / 2, id);
      return json({ ok: true });
    }
    const down = r.down + 1;
    // Gone if whoever reported it says so, or enough others do.
    const gone = r.device === device || down >= 2 || down > r.up;
    this.run('UPDATE reports SET down = ?, expires = ? WHERE id = ?', down, gone ? now : r.expires, id);
    return json({ gone });
  }

  /* ----- Convoys ----- */

  convoyStart(b) {
    const dest = cleanDest(b?.dest);
    const pos = cleanPos(b?.pos);
    if (!dest) return nope('no destination');
    const now = this.now();
    const id = randomId(10);
    this.run('INSERT INTO convoys (id, dest, started, touched) VALUES (?, ?, ?, ?)', id, JSON.stringify(dest), now, now);
    return this.addMember(id, b, pos, now, dest);
  }

  addMember(convoy, b, pos, now, dest) {
    const member = randomId(6), key = randomId(22);
    this.run('INSERT INTO members (convoy, member, key, name, pos, eta, remaining, at, left) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 0)',
      convoy, member, key, text(b?.name, 30), pos ? JSON.stringify(pos) : null, pos ? now : 0);
    return json({ id: convoy, member, key, dest, members: this.membersOf(convoy, now) });
  }

  liveConvoy(id) {
    if (!isId(id, 10)) return null;
    const c = this.row('SELECT * FROM convoys WHERE id = ?', id);
    return c && this.now() - c.touched < CONVOY_MS ? c : null;
  }

  membersOf(convoy, now) {
    return this.rows('SELECT member, name, pos, eta, remaining, at FROM members WHERE convoy = ? AND left = 0', convoy)
      .map((m) => ({ ...m, pos: m.pos && now - m.at < MEMBER_STALE_MS ? JSON.parse(m.pos) : null }));
  }

  convoyGet(id) {
    const c = this.liveConvoy(id);
    if (!c) return nope('ended', 404);
    const now = this.now();
    return json({ id: c.id, dest: JSON.parse(c.dest), members: this.membersOf(c.id, now).map(({ member, name, pos }) => ({ member, name, pos })) });
  }

  convoyJoin(b) {
    const c = this.liveConvoy(b?.id);
    if (!c) return nope('ended', 404);
    const now = this.now();
    if (this.row('SELECT COUNT(*) AS n FROM members WHERE convoy = ? AND left = 0', c.id).n >= CONVOY_MAX) return nope('full', 409);
    this.run('UPDATE convoys SET touched = ? WHERE id = ?', now, c.id);
    return this.addMember(c.id, b, cleanPos(b?.pos), now, JSON.parse(c.dest));
  }

  ownMember(b) {
    const c = this.liveConvoy(b?.id);
    if (!c || !isId(b?.member, 6) || !isId(b?.key, 22)) return null;
    const m = this.row('SELECT * FROM members WHERE convoy = ? AND member = ? AND left = 0', c.id, b.member);
    return m && m.key === b.key ? { c, m } : null;
  }

  convoyUpdate(b) {
    const own = this.ownMember(b);
    if (!own) return nope('ended', 404);
    const now = this.now();
    const pos = cleanPos(b.pos);
    if (pos) {
      this.run('UPDATE members SET pos = ?, eta = ?, remaining = ?, at = ? WHERE convoy = ? AND member = ?',
        JSON.stringify(pos), cleanEta(b.eta, now), cleanRemaining(b.remaining), now, own.c.id, own.m.member);
      this.run('UPDATE convoys SET touched = ? WHERE id = ?', now, own.c.id);
    }
    return json({ dest: JSON.parse(own.c.dest), members: this.membersOf(own.c.id, now), now });
  }

  convoyLeave(b) {
    const own = this.ownMember(b);
    if (own) this.run('UPDATE members SET left = 1 WHERE convoy = ? AND member = ?', own.c.id, own.m.member);
    return json({ ok: true });
  }

  /* ----- Morning alerts ----- */

  async vapid() {
    if (!this.keys) {
      this.keys = await vapidKeys(
        () => this.row("SELECT v FROM settings WHERE k = 'vapid'")?.v,
        (v) => this.run("INSERT OR REPLACE INTO settings (k, v) VALUES ('vapid', ?)", v),
      );
    }
    return this.keys;
  }

  commuteSet(b) {
    const sub = cleanSubscription(b?.sub);
    const home = cleanPoint(b?.home), work = cleanPoint(b?.work);
    const time = cleanTime(b?.time), days = cleanDays(b?.days);
    if (!sub) return nope('notifications not supported here');
    if (!home || !work || !time || !days) return nope('not an alert');
    if (metres(home, work) < 300) return nope('home and work are the same place');
    const lang = MORNING_LANGS.includes(b.lang) ? b.lang : 'ms';
    const known = isId(b.id, 10) && isId(b.key, 22) ? this.row('SELECT * FROM commuters WHERE id = ?', b.id) : null;
    const mine = known && known.key === b.key;
    const id = mine ? known.id : randomId(10);
    const key = mine ? known.key : randomId(22);
    // A browser has one endpoint, so setting it again replaces the old alert.
    this.run('DELETE FROM commuters WHERE endpoint = ? AND id != ?', sub.endpoint, id);
    this.run(`INSERT INTO commuters (id, key, endpoint, home, work, time, days, slow_only, lang, sent_day, message, message_at, tests_day, tests)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, 0)
      ON CONFLICT(id) DO UPDATE SET endpoint = excluded.endpoint, home = excluded.home, work = excluded.work, time = excluded.time,
        days = excluded.days, slow_only = excluded.slow_only, lang = excluded.lang`,
    id, key, sub.endpoint, JSON.stringify(home), JSON.stringify(work), time, JSON.stringify(days), b.slowOnly ? 1 : 0, lang);
    return json({ id, key });
  }

  ownCommuter(b) {
    if (!isId(b?.id, 10) || !isId(b?.key, 22)) return null;
    const c = this.row('SELECT * FROM commuters WHERE id = ?', b.id);
    return c && c.key === b.key ? c : null;
  }

  commuteOff(b) {
    const c = this.ownCommuter(b);
    if (c) this.run('DELETE FROM commuters WHERE id = ?', c.id);
    return json({ ok: true });
  }

  // The service worker asks what to show, giving the endpoint it was woken on.
  // A phone has one endpoint for both, so whichever was sent last is the one it was woken for.
  commuteMessageFor(b) {
    const sub = cleanSubscription(b);
    if (!sub) return nope('nothing', 404);
    const found = [
      this.row('SELECT message, message_at FROM commuters WHERE endpoint = ?', sub.endpoint),
      this.row('SELECT message, message_at FROM reminders WHERE endpoint = ?', sub.endpoint),
    ].filter((r) => r?.message && this.now() - r.message_at <= MESSAGE_MS).sort((a, b) => b.message_at - a.message_at);
    if (!found.length) return nope('nothing', 404);
    return json(JSON.parse(found[0].message));
  }

  /* ----- Toll fares drivers paid ----- */

  // What a car paid at each plaza on one trip. `prev` is the plaza before it on
  // that trip: on a closed highway the fare at the exit depends on the entry.
  faresAdd(b) {
    const device = isId(b?.device, 16) ? b.device : null;
    const paid = Array.isArray(b?.paid) ? b.paid.slice(0, 20) : null;
    if (!device || !paid?.length) return nope('not fares');
    const clean = paid.map((p) => ({
      plaza: typeof p?.plaza === 'string' && PLAZA.test(p.plaza) ? p.plaza : null,
      prev: typeof p?.prev === 'string' && PLAZA.test(p.prev) ? p.prev : null,
      rm: finite(p?.rm, 0, 300),
    }));
    if (clean.some((p) => !p.plaza || p.rm == null)) return nope('not fares');
    const now = this.now();
    const today = this.row('SELECT COUNT(*) AS n FROM fares WHERE device = ? AND at > ?', device, now - 86400e3).n;
    if (today + clean.length > FARES_PER_DAY) return nope('too many', 429);
    for (const p of clean) {
      this.run('INSERT INTO fares (plaza, prev, rm, at, device) VALUES (?, ?, ?, ?, ?)', p.plaza, p.prev, Math.round(p.rm * 100) / 100, now, device);
    }
    return json({ ok: true, added: clean.length });
  }

  faresGet(ids) {
    const list = [...new Set(String(ids || '').split(',').filter((id) => PLAZA.test(id)))].slice(0, 80);
    if (!list.length) return nope('which plazas?');
    const out = {};
    for (const plaza of list) {
      const rows = this.rows('SELECT prev, rm, at FROM fares WHERE plaza = ? ORDER BY at DESC LIMIT ?', plaza, FARES_SHOWN);
      if (rows.length) out[plaza] = rows.map((r) => ({ prev: r.prev, rm: r.rm, at: r.at }));
    }
    return json({ fares: out });
  }

  /* ----- Parking reminders ----- */

  remindSet(b) {
    const sub = cleanSubscription(b?.sub);
    if (!sub) return nope('notifications not supported here');
    const now = this.now();
    const until = finite(b?.until, now + 60e3, now + PARKING_MAX_MS);
    if (until == null) return nope('not a time');
    const lang = MORNING_LANGS.includes(b.lang) ? b.lang : 'ms';
    const known = isId(b.id, 10) && isId(b.key, 22) ? this.row('SELECT * FROM reminders WHERE id = ?', b.id) : null;
    const mine = known && known.key === b.key;
    const id = mine ? known.id : randomId(10);
    const key = mine ? known.key : randomId(22);
    this.run('DELETE FROM reminders WHERE endpoint = ? AND id != ?', sub.endpoint, id);
    this.run(`INSERT INTO reminders (id, key, endpoint, at, until, lang, sent, message, message_at) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 0)
      ON CONFLICT(id) DO UPDATE SET endpoint = excluded.endpoint, at = excluded.at, until = excluded.until, lang = excluded.lang, sent = 0`,
    id, key, sub.endpoint, Math.round(Math.max(now, until - PARKING_WARN_MS)), Math.round(until), lang);
    return json({ id, key, at: Math.round(Math.max(now, until - PARKING_WARN_MS)) });
  }

  remindOff(b) {
    if (!isId(b?.id, 10) || !isId(b?.key, 22)) return json({ ok: true });
    const r = this.row('SELECT * FROM reminders WHERE id = ?', b.id);
    if (r && r.key === b.key) this.run('DELETE FROM reminders WHERE id = ?', r.id);
    return json({ ok: true });
  }

  // Wakes a phone. It then asks what to show.
  async wake(endpoint, now, ttl) {
    const keys = await this.vapid();
    try {
      return await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: { TTL: String(ttl), Urgency: 'high', Authorization: await vapidHeader(endpoint, keys, now), 'Content-Length': '0' },
      });
    } catch {
      return null;
    }
  }

  async commuteTest(b) {
    const c = this.ownCommuter(b);
    if (!c) return nope('no such alert', 404);
    const now = this.now();
    const today = localNow(now).day;
    const tests = c.tests_day === today ? c.tests : 0;
    if (tests >= TESTS_PER_DAY) return nope('too many', 429);
    this.run('UPDATE commuters SET tests_day = ?, tests = ? WHERE id = ?', today, tests + 1, c.id);
    const sent = await this.alert(c, now, { force: true });
    return sent.ok ? json({ ok: true }) : nope(sent.why, sent.status || 502);
  }

  async alert(c, now, { force = false } = {}) {
    const key = this.env?.TOMTOM_API_KEY;
    if (!key) return { ok: false, why: 'no traffic key', status: 503 };
    let times;
    try { times = await commuteTimes(JSON.parse(c.home), JSON.parse(c.work), key, this.fetchImpl); } catch { times = null; }
    if (!times) return { ok: false, why: 'traffic unavailable' };
    const message = commuteMessage(times, now, c.lang);
    if (c.slow_only && !message.slow && !force) return { ok: true, quiet: true };
    this.run('UPDATE commuters SET message = ?, message_at = ? WHERE id = ?', JSON.stringify(message), now, c.id);
    const res = await this.wake(c.endpoint, now, 1800);
    if (!res) return { ok: false, why: 'could not reach the phone' };
    // The phone has turned notifications off or uninstalled: forget the alert.
    if (res.status === 404 || res.status === 410) {
      this.run('DELETE FROM commuters WHERE id = ?', c.id);
      return { ok: false, why: 'notifications were turned off', status: 410 };
    }
    return res.ok ? { ok: true } : { ok: false, why: `push ${res.status}` };
  }

  async cron() {
    const now = this.now();
    // Tidy away what's over.
    this.run('DELETE FROM shares WHERE started < ? OR (ended > 0 AND ended < ?)', now - SHARE_MS - SHARE_AFTER_MS, now - SHARE_AFTER_MS);
    this.run('DELETE FROM reports WHERE expires < ?', now - 3600e3);
    const old = this.rows('SELECT id FROM convoys WHERE touched < ?', now - CONVOY_MS).map((r) => r.id);
    for (const id of old) {
      this.run('DELETE FROM members WHERE convoy = ?', id);
      this.run('DELETE FROM convoys WHERE id = ?', id);
    }
    this.run('DELETE FROM reminders WHERE until < ?', now - 3600e3);
    this.run('DELETE FROM fares WHERE at < ?', now - FARES_KEEP_MS);
    const due = this.rows('SELECT * FROM commuters').filter((c) => commuteDue(c, now)).slice(0, COMMUTE_PER_RUN);
    let sent = 0;
    for (const c of due) {
      this.run('UPDATE commuters SET sent_day = ? WHERE id = ?', localNow(now).day, c.id);
      const r = await this.alert(c, now);
      if (r.ok && !r.quiet) sent++;
    }
    const reminders = this.rows('SELECT * FROM reminders WHERE sent = 0 AND at <= ? ORDER BY at LIMIT ?', now, REMINDERS_PER_RUN);
    for (const r of reminders) {
      this.run('UPDATE reminders SET sent = 1, message = ?, message_at = ? WHERE id = ?', JSON.stringify(parkingMessage(r.until, now, r.lang)), now, r.id);
      const res = await this.wake(r.endpoint, now, Math.max(60, Math.round((r.until - now) / 1000)));
      if (res && (res.status === 404 || res.status === 410)) this.run('DELETE FROM reminders WHERE id = ?', r.id);
      else if (res?.ok) sent++;
    }
    return { due: due.length + reminders.length, sent };
  }
}
