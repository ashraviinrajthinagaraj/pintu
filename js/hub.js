// Talking to the hub on Pintu's server: live trips, road reports, convoys and
// morning alerts. Everything is sent as plain text, which a page can do without
// asking the server first, and every answer is checked.
import { CONFIG } from './config.js';
import { load, save } from './store.js';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randomCode(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}
export const isCode = (s, n) => typeof s === 'string' && s.length === n && [...s].every((c) => ALPHABET.includes(c));

// A random code for this phone, so a road report can be taken back by whoever made it.
export function deviceCode() {
  let code = load('device', null);
  if (!isCode(code, 16)) {
    code = randomCode(16);
    save('device', code);
  }
  return code;
}

export class HubError extends Error {
  constructor(status, why) {
    super(why || `hub ${status}`);
    this.status = status;
    this.why = why || '';
  }
}

async function answer(res) {
  let body = null;
  try { body = await res.json(); } catch { /* none */ }
  if (!res.ok) throw new HubError(res.status, body?.error);
  return body;
}

export const hubReady = () => !!CONFIG.server;

export function post(path, body, { signal, fetchImpl = globalThis.fetch } = {}) {
  if (!CONFIG.server) return Promise.reject(new HubError(0, 'no server'));
  return fetchImpl(`${CONFIG.server}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(body),
    signal,
  }).then(answer);
}

export function get(path, { signal, fetchImpl = globalThis.fetch } = {}) {
  if (!CONFIG.server) return Promise.reject(new HubError(0, 'no server'));
  return fetchImpl(`${CONFIG.server}${path}`, { signal }).then(answer);
}

// A position as the hub keeps it.
export const posOf = (fix) => (fix ? { lng: fix.lng, lat: fix.lat, heading: fix.heading ?? null, speed: fix.speed ?? null } : null);
export const placeOf = (p) => (p ? { name: p.name || '', lng: p.lng, lat: p.lat } : null);

// The link someone else opens.
export function linkFor(kind, id, base = `${location.origin}${location.pathname}`) {
  return `${base}?${kind}=${id}`;
}
