// Spoken directions. A human-sounding recording from Pintu's server when there's
// one to be had, and the phone's own voice otherwise.
//
// A direction must never be lost or late, so a recording only gets a moment to
// arrive. If it isn't here in time, the phone speaks straight away.
import { CONFIG } from './config.js';
import { plainSpeech } from './delivery.js';

const synth = () => (typeof speechSynthesis !== 'undefined' ? speechSynthesis : null);

export const WAIT_TURN_MS = 700;      // the moment of a turn
export const WAIT_NORMAL_MS = 1500;   // an instruction with time to spare
export const WAIT_GREETING_MS = 4000; // the start of a trip, with nothing at stake yet
export const WAIT_JOKE_MS = 5000;     // only a joke, so it can wait for the real voice
export const WAIT_SAMPLE_MS = 8000;   // someone choosing a voice, listening for it

const STEP_BACK_MS = 60000;           // after a failure, stop waiting on the server
const SPEECH_VERSION = '1';           // matches the server's, so old recordings retire
const MAX_SPEECH = 420;               // the longest line the server takes
const CLIP_CACHE = 'pintu-voice-1';
const MAX_KEPT_CLIPS = 600;
const MAX_MEMORY_CLIPS = 80;
const AT_ONCE = 2;                    // recordings fetched at the same time, ahead of need
const MAX_WAITING = 8;

let muted = false;
let lang = 'ms';
let style = { pitch: 1, rate: 1 };
let character = 'standard';

let humanState = 'unknown';           // unknown, on, off, refused
let stepBackUntil = 0;
let ticket = 0;                       // the latest thing asked to be said
let waitingFor = 0;                   // how many spoken lines are still on their way
let muteCount = 0;

export const setVoiceLang = (l) => { lang = l; };
// How the current character sounds on the phone's voice, and who they are on the server.
export const setVoiceStyle = (s) => { style = s; };
export const setVoiceCharacter = (id) => { character = id; };

export function setMuted(v) {
  muted = v;
  if (v) {
    muteCount++;
    stopTalking();
  }
}

function voices() {
  try { return synth()?.getVoices() || []; } catch { return []; }
}

const norm = (s) => (s || '').toLowerCase().replace('_', '-');

// Malay if the phone has it. Indonesian is the closest stand-in and reads
// Malay road names far better than an English voice would.
export function chooseVoice(list, language) {
  const find = (prefix) => list.find((v) => norm(v.lang).startsWith(prefix));
  if (language === 'ms') {
    const ms = find('ms');
    if (ms) return { voice: ms, tag: ms.lang, match: 'exact' };
    const id = find('id');
    if (id) return { voice: id, tag: id.lang, match: 'near' };
    return { voice: null, tag: 'ms-MY', match: 'none' };
  }
  const en = find('en-my') || find('en-sg') || find('en-gb') || find('en');
  return en ? { voice: en, tag: en.lang, match: 'exact' } : { voice: null, tag: 'en-GB', match: 'none' };
}

export function voiceStatus(language = lang) {
  if (!synth()) return 'none';
  return chooseVoice(voices(), language).match;
}

/* ---------- The phone's own voice ---------- */

function phoneSpeak(text) {
  const s = synth();
  if (!s || !text) return;
  const { voice, tag } = chooseVoice(voices(), lang);
  const u = new SpeechSynthesisUtterance(text);
  u.lang = tag;
  if (voice) u.voice = voice;
  u.rate = style.rate;
  u.pitch = style.pitch;
  s.cancel();
  const mutes = muteCount;
  // Some Android browsers drop a sentence spoken straight after cancel().
  setTimeout(() => {
    if (mutes !== muteCount) return;
    try { s.speak(u); } catch { /* no voice today */ }
  }, 40);
}

/* ---------- Recordings ---------- */

let player = null;
const memory = new Map();   // address -> a playable address for the recording
const fetching = new Map(); // address -> the recording on its way

function thePlayer() {
  if (!player && typeof Audio !== 'undefined') player = new Audio();
  return player;
}

function stopTalking() {
  ticket++;
  synth()?.cancel();
  if (player) {
    player.onerror = null;
    try { player.pause(); } catch { /* wasn't playing */ }
  }
}

const humanPossible = () => !!CONFIG.server && humanState !== 'off' && humanState !== 'refused' && Date.now() >= stepBackUntil;

function clipAddress(text, who = character, language = lang) {
  const q = new URLSearchParams({ v: SPEECH_VERSION, who, lang: language, text });
  return `${CONFIG.server}/speak?${q}`;
}

function remember(address, blob) {
  const playable = URL.createObjectURL(blob);
  memory.set(address, playable);
  if (memory.size > MAX_MEMORY_CLIPS) {
    const [oldest, url] = memory.entries().next().value;
    memory.delete(oldest);
    URL.revokeObjectURL(url);
  }
  return playable;
}

async function shelf() {
  try { return typeof caches !== 'undefined' ? await caches.open(CLIP_CACHE) : null; } catch { return null; }
}

let keptSinceTrim = 0;
async function keep(box, address, blob) {
  try {
    await box.put(address, new Response(blob, { headers: { 'content-type': 'audio/mpeg' } }));
    if (++keptSinceTrim < 50) return;
    keptSinceTrim = 0;
    const all = await box.keys();
    for (const old of all.slice(0, Math.max(0, all.length - MAX_KEPT_CLIPS))) await box.delete(old);
  } catch { /* phone's storage is full; it'll just be fetched again */ }
}

// A recording already on this phone, if there is one.
async function keptClip(address) {
  if (memory.has(address)) return memory.get(address);
  const box = await shelf();
  const kept = await box?.match(address).catch(() => null);
  if (!kept) throw Object.assign(new Error('not kept'), { justThisLine: true });
  return remember(address, await kept.blob());
}

async function fetchClip(address) {
  const res = await fetch(address);
  if (res.status === 503) {
    // No key, or the key was refused. Nothing to wait for until that changes.
    humanState = 'off';
    throw new Error('no human voice');
  }
  if (res.status === 400) throw Object.assign(new Error('not this line'), { justThisLine: true });
  if (!res.ok) throw new Error(`voice ${res.status}`);
  const blob = await res.blob();
  humanState = 'on';
  const box = await shelf();
  if (box) keep(box, address, blob.slice());
  return remember(address, blob);
}

// A recording of this line: from the phone if it can be, or from the server.
function getClip(address) {
  if (fetching.has(address)) return fetching.get(address);
  const job = keptClip(address).catch(() => fetchClip(address)).catch((err) => {
    // Lost signal, usually. A pause keeps directions from waiting on nothing.
    if (humanState !== 'off' && !err.justThisLine) stepBackUntil = Date.now() + STEP_BACK_MS;
    throw err;
  }).finally(() => fetching.delete(address));
  fetching.set(address, job);
  return job;
}

export function speak(text, { evenIfMuted = false, wait = WAIT_NORMAL_MS } = {}) {
  if (!text || (muted && !evenIfMuted)) return;
  stopTalking();
  const mine = ticket;
  const words = plainSpeech(text);
  if (!CONFIG.server || text.length > MAX_SPEECH) {
    phoneSpeak(words);
    return;
  }
  const address = clipAddress(text);
  let settled = false;
  const usePhone = () => {
    if (settled) return;
    settled = true;
    waitingFor--;
    if (mine === ticket) phoneSpeak(words);
  };
  waitingFor++;
  const timer = setTimeout(usePhone, wait);
  // With the server out of reach, anything already on the phone can still be played.
  (humanPossible() ? getClip(address) : keptClip(address)).then(async (playable) => {
    if (settled) return;
    clearTimeout(timer);
    settled = true;
    waitingFor--;
    if (mine !== ticket) return;
    const p = thePlayer();
    if (!p) { phoneSpeak(words); return; }
    p.onerror = () => { if (mine === ticket) phoneSpeak(words); };
    p.src = playable;
    try {
      await p.play();
    } catch {
      if (mine === ticket) phoneSpeak(words);
    }
  }).catch(() => {
    clearTimeout(timer);
    usePhone();
  });
}

// Is something being said, or about to be? A joke waits its turn; a direction doesn't.
export function busy() {
  if (waitingFor > 0) return true;
  if (synth()?.speaking) return true;
  return !!player && !player.paused && !player.ended;
}

/* ---------- Getting lines ready ahead of time ---------- */

const queue = [];
let running = 0;

function runQueue() {
  if (!humanPossible()) queue.length = 0;
  while (running < AT_ONCE && queue.length) {
    const address = queue.shift();
    running++;
    getClip(address).catch(() => {}).finally(() => {
      running--;
      runQueue();
    });
  }
}

// So a direction is already on the phone when its moment comes.
export function prepare(text, who = character) {
  if (!text || text.length > MAX_SPEECH || muted || !CONFIG.server || !humanPossible()) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const address = clipAddress(text, who);
  if (memory.has(address) || fetching.has(address) || queue.includes(address)) return;
  queue.push(address);
  // Long-range plans go stale, so the oldest wish is the one to give up.
  if (queue.length > MAX_WAITING) queue.shift();
  runQueue();
}

/* ---------- Whether the human voice is available ---------- */

export const humanVoice = () => (CONFIG.server ? humanState : 'off');

export async function checkHumanVoice() {
  if (!CONFIG.server) return 'off';
  try {
    const res = await fetch(`${CONFIG.server}/speak?check=1`);
    if (!res.ok) {
      // A server from before human voices has no /speak yet.
      humanState = res.status === 404 ? 'off' : 'unknown';
      return humanState;
    }
    const { ready, reason } = await res.json();
    if (ready) {
      humanState = 'on';
      stepBackUntil = 0;
    } else if (reason === 'key refused') {
      humanState = 'refused';
    } else if (reason === 'no key') {
      humanState = 'off';
    } else {
      humanState = 'unknown';
    }
  } catch {
    humanState = 'unknown';
  }
  return humanState;
}

/* ---------- Tapping unlocks sound ---------- */

// A moment of silence, as a playable address.
const SILENCE = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

// Phones only allow sound after a tap, so a tap on Start unlocks both voices.
export function unlockVoice() {
  const s = synth();
  if (s) {
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      s.speak(u);
    } catch { /* nothing to unlock */ }
  }
  const p = thePlayer();
  if (p) {
    try {
      p.onerror = null;
      p.src = SILENCE;
      p.play()?.catch?.(() => {});
    } catch { /* it'll ask again next tap */ }
  }
}

export function onVoicesReady(fn) {
  const s = synth();
  if (s && s.addEventListener) s.addEventListener('voiceschanged', fn);
}
