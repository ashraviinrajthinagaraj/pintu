import test from 'node:test';
import assert from 'node:assert/strict';
import { canListen, listen, speechLang, understand } from '../js/voice-search.js';

test('home, work and your car go straight there, in either language', () => {
  for (const said of ['Rumah', 'pergi rumah', 'balik rumah', 'Bawa saya ke rumah.', 'take me home', 'Go home please', 'navigate to my house']) {
    assert.deepEqual(understand(said), { kind: 'saved', which: 'home' }, said);
  }
  for (const said of ['kerja', 'pergi kerja', 'ke pejabat', 'pergi ofis sekarang', 'take me to work', 'office']) {
    assert.deepEqual(understand(said), { kind: 'saved', which: 'work' }, said);
  }
  for (const said of ['kereta saya', 'mana kereta saya', 'where is my car', 'take me to my car']) {
    assert.deepEqual(understand(said), { kind: 'car' }, said);
  }
});

test('asking for the nearest petrol station opens the nearby list', () => {
  for (const said of ['stesen minyak terdekat', 'Cari stesen minyak', 'isi minyak', 'nearest petrol station', 'find a petrol station near me', 'Petronas terdekat', 'gas station']) {
    assert.deepEqual(understand(said), { kind: 'nearby', category: 'fuel' }, said);
  }
  assert.deepEqual(understand('pengecas terdekat'), { kind: 'nearby', category: 'ev' });
  assert.deepEqual(understand('tempat makan dekat sini'), { kind: 'nearby', category: 'food' });
  assert.deepEqual(understand('nearest hotel'), { kind: 'nearby', category: 'hotel' });
});

test('anything else is searched for, without the "take me to"', () => {
  assert.deepEqual(understand('Take me to KLCC'), { kind: 'search', query: 'KLCC', nearest: false });
  assert.deepEqual(understand('pergi ke Mid Valley Megamall'), { kind: 'search', query: 'Mid Valley Megamall', nearest: false });
  assert.deepEqual(understand('Tolong bawa saya ke Hospital Kuala Lumpur'), { kind: 'search', query: 'Hospital Kuala Lumpur', nearest: false });
  assert.equal(understand('McDonald\'s terdekat').nearest, true, 'a named place nearby');
  // A place whose name starts like a command word is still found.
  assert.equal(understand('Rumah Penghulu Abu Seman').query, 'Rumah Penghulu Abu Seman');
  assert.equal(understand('to'), null, 'nothing but "to"');
  assert.equal(understand('pergi'), null);
  assert.equal(understand(''), null);
  assert.equal(understand('   '), null);
});

test('the phone listens in the language Pintu speaks', () => {
  assert.equal(speechLang('ms'), 'ms-MY');
  assert.equal(speechLang('en'), 'en-MY');
  assert.equal(speechLang('xx'), 'ms-MY');
});

class FakeRecognition {
  static last = null;
  constructor() { FakeRecognition.last = this; this.started = false; }
  start() { this.started = true; }
  stop() { this.onend?.(); }
  abort() { this.aborted = true; }
  say(text, final = true) {
    this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal: final })] });
  }
}

test('listens once and hands back what was heard', () => {
  delete globalThis.webkitSpeechRecognition;
  assert.equal(canListen(), false);
  let failed = null;
  assert.equal(listen({ lang: 'ms', onFail: (why) => { failed = why; } }), null);
  assert.equal(failed, 'unsupported');

  globalThis.webkitSpeechRecognition = FakeRecognition;
  assert.equal(canListen(), true);
  const heard = [];
  let done = null;
  const ear = listen({ lang: 'en', onWords: (w) => heard.push(w), onDone: (w) => { done = w; } });
  const rec = FakeRecognition.last;
  assert.equal(rec.lang, 'en-MY');
  assert.equal(rec.started, true);
  rec.say('take me', false);
  rec.say('take me home');
  ear.stop();
  assert.deepEqual(heard, ['take me', 'take me home']);
  assert.equal(done, 'take me home');

  // Nothing said, or the microphone refused: the reason is passed on.
  let why = null;
  listen({ lang: 'ms', onFail: (w) => { why = w; } });
  FakeRecognition.last.onerror({ error: 'not-allowed' });
  FakeRecognition.last.onend();
  assert.equal(why, 'not-allowed');

  // Cancelling says nothing at all.
  let spoke = false;
  const c = listen({ lang: 'ms', onDone: () => { spoke = true; }, onFail: () => { spoke = true; } });
  FakeRecognition.last.say('rumah');
  c.cancel();
  assert.equal(FakeRecognition.last.aborted, true);
  FakeRecognition.last.onend?.();
  assert.equal(spoke, false);
  delete globalThis.webkitSpeechRecognition;
});
