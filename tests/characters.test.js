import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_IDS, characterAbout, characterName, characterVoice, dress, pick, sample } from '../js/characters.js';

const ALWAYS = () => 0;       // every optional line, the first of each
const NEVER = () => 0.99;     // no optional lines
const FUNNY = CHARACTER_IDS.filter((id) => id !== 'standard');
const EVENTS = ['lead', 'tail', 'nowLead', 'start', 'arrive', 'stop', 'reroute', 'overspeed', 'rain', 'fuel'];

test('every character has a name, a description and a voice in both languages', () => {
  assert.ok(CHARACTER_IDS.length >= 6);
  for (const id of CHARACTER_IDS) {
    for (const lang of ['ms', 'en']) {
      assert.ok(characterName(id, lang), `${id} name`);
      assert.ok(characterAbout(id, lang), `${id} about`);
    }
    const { pitch, rate } = characterVoice(id);
    assert.ok(pitch >= 0 && pitch <= 2, `${id} pitch`);
    assert.ok(rate >= 0.5 && rate <= 1.5, `${id} rate`);
  }
});

test('every funny character has lines for every moment, in both languages', () => {
  for (const id of FUNNY) {
    for (const lang of ['ms', 'en']) {
      for (const event of EVENTS) {
        assert.ok(pick(id, event, lang, { vars: { limit: 90 } }), `${id} ${lang} ${event}`);
      }
    }
  }
});

test('each one sounds different from the others', () => {
  const voices = FUNNY.map((id) => JSON.stringify(characterVoice(id)));
  assert.equal(new Set(voices).size, voices.length);
  const lines = FUNNY.map((id) => pick(id, 'arrive', 'ms', { rand: ALWAYS }));
  assert.equal(new Set(lines).size, lines.length);
});

test('the standard voice is exactly the instruction, every time', () => {
  for (const kind of ['far', 'now', 'intro', 'arrive', 'stop', 'overspeed', 'reroute', 'rain', 'fuel']) {
    assert.equal(dress('standard', kind, 'Belok kiri.', 'ms', { rand: ALWAYS }), 'Belok kiri.');
  }
  assert.equal(pick('standard', 'arrive', 'ms'), '');
  assert.equal(dress('nobody', 'far', 'Belok kiri.', 'ms', { rand: ALWAYS }), 'Belok kiri.');
});

test('the instruction is never lost, whatever a character adds', () => {
  const base = 'Dalam 300 meter, belok kiri ke Jalan Ampang.';
  for (const id of FUNNY) {
    for (const lang of ['ms', 'en']) {
      for (let i = 0; i < 40; i++) {
        const text = dress(id, 'far', base, lang);
        assert.match(text.toLowerCase(), /dalam 300 meter, belok kiri ke jalan ampang\./, `${id}: ${text}`);
      }
    }
  }
});

test('at the moment of a turn, a character says at most a few words first', () => {
  const base = 'Belok kiri ke Jalan Ampang.';
  for (const id of FUNNY) {
    for (const lang of ['ms', 'en']) {
      for (let i = 0; i < 30; i++) {
        const text = dress(id, 'now', base, lang);
        assert.ok(text.toLowerCase().endsWith(base.toLowerCase()), `the instruction ends it: ${text}`);
        assert.ok(text.length - base.length <= 24, `${id}: ${text}`);
      }
    }
  }
  assert.equal(dress('captain', 'now', base, 'ms', { rand: NEVER }), base);
});

test('jokes only come after the instruction, where the next one can cut them off', () => {
  const base = 'Dalam 300 meter, belok kiri.';
  const tailOnly = () => { let n = 0; return () => (n++ === 0 ? 0.9 : 0); };
  const text = dress('makcik', 'far', base, 'ms', { rand: tailOnly() });
  assert.ok(text.startsWith(base), text);
  assert.ok(text.length > base.length, text);
});

test('a lead-in joins the sentence properly', () => {
  const text = dress('captain', 'now', 'Belok kiri ke Jalan Ampang.', 'ms', { rand: ALWAYS });
  assert.match(text, /^(Kru|Perhatian), belok kiri ke Jalan Ampang\.$/);
  const standalone = dress('agent', 'now', 'Turn left.', 'en', { rand: ALWAYS });
  assert.match(standalone, /^Now(, agent)?\. Turn left\.$/);
});

test('the speed limit is said, in the character\'s own words', () => {
  for (const id of FUNNY) {
    for (const lang of ['ms', 'en']) {
      const text = dress(id, 'overspeed', 'Had laju 90.', lang, { vars: { limit: 90 } });
      assert.match(text, /90/, `${id}: ${text}`);
      assert.doesNotMatch(text, /\{limit\}/);
    }
  }
});

test('nothing a character says encourages going faster', () => {
  const words = /\b(cepat|laju lagi|tekan minyak|hurry|faster|speed up|step on it)\b/i;
  for (const id of FUNNY) {
    for (const lang of ['ms', 'en']) {
      for (const event of EVENTS) {
        for (let i = 0; i < 12; i++) {
          const line = pick(id, event, lang, { vars: { limit: 90 } });
          assert.doesNotMatch(line, words, `${id} ${event}: ${line}`);
        }
      }
    }
  }
});

test('the same line doesn\'t come twice in a row', () => {
  let last = null;
  for (let i = 0; i < 50; i++) {
    const line = pick('captain', 'tail', 'ms', { rand: () => 0.1 });
    assert.notEqual(line, last);
    last = line;
  }
});

test('asked to repeat, it just repeats', () => {
  assert.equal(dress('adik', 'repeat', 'Belok kiri.', 'ms', { rand: ALWAYS }), 'Belok kiri.');
});

test('a sample still contains the direction', () => {
  for (const id of CHARACTER_IDS) assert.match(sample(id, 'ms', 'Belok kiri.'), /Belok kiri\./);
  assert.equal(sample('standard', 'ms', 'Belok kiri.'), 'Belok kiri.');
});
