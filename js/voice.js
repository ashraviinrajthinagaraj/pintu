// Spoken directions. A human-sounding recording from Pintu's server when there's
// one to be had, and the phone's own voice otherwise.
//
// A direction must never be lost or late, so a recording only gets a moment to
// arrive. If it isn't here in time, the phone speaks straight away.
import { CONFIG } from './config.js';
import { decodeAudio } from './audio.js';
import { plainSpeech } from './delivery.js';

const synth = () => (typeof speechSynthesis !== 'undefined' ? speechSynthesis : null);

export const WAIT_TURN_MS = 700;      // the moment of a turn
export const WAIT_NORMAL_MS = 2500;   // an instruction with time to spare
export const WAIT_GREETING_MS = 4000; // the start of a trip, with nothing at stake yet
export const WAIT_JOKE_MS = 5000;     // only a joke, so it can wait for the real voice
export const WAIT_SAMPLE_MS = 20000;  // someone choosing a voice, which may be being made

const STEP_BACK_MS = 60000;           // after a failure, stop waiting on the server
const BUSY_BACK_MS = 20000;           // the server is only busy for a moment
const REST_MS = 30 * 60000;           // today's free allowance has run out
const MAX_CLIP_MS = 30000;            // in case a phone never says a recording has ended
const SPEECH_VERSION = '3';           // matches the server's, so old recordings retire
const MAX_SPEECH = 420;               // the longest line the server takes
const CLIP_CACHE = 'pintu-voice-2';
const MAX_KEPT_CLIPS = 400;
const MAX_MEMORY_CLIPS = 80;
const AT_ONCE = 2;                    // recordings fetched at the same time, ahead of need
const MAX_WAITING = 8;

let muted = false;
let lang = 'ms';
let style = { pitch: 1, rate: 1 };
let character = 'standard';

let humanState = 'unknown';           // unknown, on, off, refused
let stepBackUntil = 0;
let restingUntil = 0;
let ticket = 0;                       // the latest thing asked to be said
let talking = 0;                      // how many lines are still being worked through
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
  if (language === 'zh') {
    const zh = find('zh-cn') || find('zh-hans') || find('cmn') || find('zh-sg') || find('zh-my');
    if (zh) return { voice: zh, tag: zh.lang, match: 'exact' };
    const any = find('zh');
    if (any) return { voice: any, tag: any.lang, match: 'near' };
    return { voice: null, tag: 'zh-CN', match: 'none' };
  }
  if (language === 'ta') {
    const ta = find('ta');
    return ta ? { voice: ta, tag: ta.lang, match: 'exact' } : { voice: null, tag: 'ta-IN', match: 'none' };
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

let cutOff = null;           // ends the clip now playing

function stopTalking() {
  ticket++;
  synth()?.cancel();
  cutOff?.();
  if (player) {
    try { player.pause(); } catch { /* wasn't playing */ }
  }
}

// The server to ask for human voices, if they're switched on at all.
const voiceServer = () => (CONFIG.humanVoices ? CONFIG.server : null);
export const humanVoicesOffered = () => !!voiceServer();

// The human voices speak Malay and English only.
const humanPossible = () => !!voiceServer() && (lang === 'ms' || lang === 'en') && humanState !== 'off' && humanState !== 'refused' && Date.now() >= Math.max(stepBackUntil, restingUntil);

function clipAddress(text, who = character, language = lang) {
  const q = new URLSearchParams({ v: SPEECH_VERSION, who, lang: language, text });
  return `${voiceServer()}/speak?${q}`;
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
    await box.put(address, new Response(blob, { headers: { 'content-type': blob.type || 'audio/wav' } }));
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

// Why the last recording didn't come, in words that can be read out over the phone.
let lastProblem = null;
export const voiceProblem = () => lastProblem;

async function fetchClip(address) {
  let res;
  try {
    res = await fetch(address);
  } catch {
    throw new Error('the server couldn\u2019t be reached, or it stopped');
  }
  if (!res.ok) {
    const { error, why } = await res.json().catch(() => ({}));
    const said = `server ${res.status}${error ? `: ${error}` : ''}${why ? ` (${why})` : ''}`;
    if (res.status === 503) {
      // No key, or the key was refused. Nothing to wait for until that changes.
      humanState = error === 'key refused' ? 'refused' : 'off';
      throw new Error(said);
    }
    if (res.status === 400) throw Object.assign(new Error(said), { justThisLine: true });
    if (res.status === 429) {
      if (error === 'daily') restingUntil = Date.now() + REST_MS;
      else stepBackUntil = Date.now() + BUSY_BACK_MS;
      throw Object.assign(new Error(said), { justThisLine: true });
    }
    throw new Error(said);
  }
  const type = res.headers.get('content-type') || '';
  // Google's audio arrives encoded, because the server's too small to decode it.
  const blob = /base64/.test(type) ? decodeAudio(await res.text()) : await res.blob();
  humanState = 'on';
  lastProblem = null;
  const box = await shelf();
  if (box) keep(box, address, blob.slice(0, blob.size, blob.type));
  return remember(address, blob);
}

// A recording of this line: from the phone if it can be, or from the server.
function getClip(address) {
  if (fetching.has(address)) return fetching.get(address);
  const job = keptClip(address).catch(() => fetchClip(address)).catch((err) => {
    lastProblem = err.message;
    // Lost signal, usually. A pause keeps directions from waiting on nothing.
    if (humanState !== 'off' && humanState !== 'refused' && !err.justThisLine) stepBackUntil = Date.now() + STEP_BACK_MS;
    throw err;
  }).finally(() => fetching.delete(address));
  fetching.set(address, job);
  return job;
}

// The recording if it turns up in time, and null if not.
function inTime(job, ms) {
  let timer;
  return Promise.race([job, new Promise((r) => { timer = setTimeout(() => r(null), ms); })]).finally(() => clearTimeout(timer));
}

// Plays one recording to its end. False if the phone wouldn't play it.
function playClip(playable) {
  const p = thePlayer();
  if (!p) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (played) => {
      clearTimeout(guard);
      p.onended = null;
      p.onerror = null;
      cutOff = null;
      resolve(played);
    };
    const guard = setTimeout(() => done(true), MAX_CLIP_MS);
    cutOff = () => done(true);
    p.onended = () => done(true);
    p.onerror = () => done(false);
    p.src = playable;
    try {
      p.play()?.catch?.(() => done(false));
    } catch {
      done(false);
    }
  });
}

// A whole line is one recording, so it flows the way a person says it.
async function playLine(text, mine, wait, onStart) {
  talking++;
  try {
    const address = clipAddress(text);
    // With the server out of reach, anything already on the phone can still be played.
    const job = (humanPossible() ? getClip(address) : keptClip(address)).catch(() => null);
    const playable = await inTime(job, wait);
    if (mine !== ticket) return 'cut off';
    if (playable) {
      onStart?.();
      if (await playClip(playable)) return mine === ticket ? 'human' : 'cut off';
      if (mine !== ticket) return 'cut off';
      lastProblem = 'the phone wouldn’t play the recording';
    }
    // Nothing is lost: the phone says it instead.
    onStart?.();
    phoneSpeak(plainSpeech(text));
    return 'phone';
  } finally {
    talking--;
  }
}

// Says a line, and finishes with which voice said it: human, phone, or cut off by the
// next line. Empty if there was nothing to say.
export function speak(text, { evenIfMuted = false, wait = WAIT_NORMAL_MS, onStart } = {}) {
  if (!text || (muted && !evenIfMuted)) return Promise.resolve('');
  stopTalking();
  if (!voiceServer() || text.length > MAX_SPEECH) {
    onStart?.();
    phoneSpeak(plainSpeech(text));
    return Promise.resolve('phone');
  }
  return playLine(text, ticket, wait, onStart);
}

// Is something being said, or about to be? A joke waits its turn; a direction doesn't.
export function busy() {
  if (talking > 0) return true;
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
  if (!text || muted || !voiceServer() || !humanPossible()) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (text.length > MAX_SPEECH) return;
  const address = clipAddress(text, who);
  if (memory.has(address) || fetching.has(address) || queue.includes(address)) return;
  queue.push(address);
  // Long-range plans go stale, so the oldest wish is the one to give up.
  if (queue.length > MAX_WAITING) queue.shift();
  runQueue();
}

/* ---------- Whether the human voice is available ---------- */

export function humanVoice() {
  if (!voiceServer() || (lang !== 'ms' && lang !== 'en')) return 'off';
  return Date.now() < restingUntil ? 'resting' : humanState;
}

export async function checkHumanVoice() {
  if (!voiceServer()) return 'off';
  try {
    const res = await fetch(`${voiceServer()}/speak?check=1`);
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

// Tries one real line through the server, for when voices aren't working and someone
// needs to see why. It uses one line of the day's allowance.
export async function testHumanVoice(who = character, language = lang) {
  if (!voiceServer()) return { kind: 'unreachable' };
  let res;
  try {
    res = await fetch(`${voiceServer()}/speak?${new URLSearchParams({ test: '1', who, lang: language })}`);
  } catch {
    return { kind: 'unreachable' };
  }
  // Servers from before this check don't know the question.
  if (res.status === 404 || res.status === 400) return { kind: 'old-server', report: { status: res.status } };
  const report = await res.json().catch(() => null);
  if (!res.ok || !report) return { kind: 'unreachable', report: { status: res.status } };
  if (report.ok) {
    humanState = 'on';
    stepBackUntil = 0;
    lastProblem = null;
    return { kind: 'works', report };
  }
  if (report.problem === 'no key') {
    humanState = 'off';
    return { kind: 'no-key', report };
  }
  if (report.problem === 'key' || report.status === 401 || report.status === 403) {
    humanState = 'refused';
    return { kind: 'key-refused', report };
  }
  if (report.status === 429) return { kind: report.problem === 'daily' ? 'daily' : 'busy', report };
  return { kind: 'failed', report };
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
  // Not over a clip already playing, which has unlocked things anyway.
  if (p && !cutOff) {
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
