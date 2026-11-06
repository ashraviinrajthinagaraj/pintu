import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_IDS, characterAbout, characterName, characterTag, characterVoice, dress, pick, sample } from '../js/characters.js';
import { MOODS, clipsOf, isDirection, plainSpeech } from '../js/delivery.js';

const ALWAYS = () => 0;       // every optional line, the first of each
const NEVER = () => 0.99;     // no optional lines
const FUNNY = CHARACTER_IDS.filter((id) => id !== 'standard');
const EVENTS = ['lead', 'tail', 'nowLead', 'start', 'arrive', 'stop', 'reroute', 'overspeed', 'overspeed2', 'overspeed3', 'slowed', 'rain', 'fuel', 'jam', 'jamLong', 'jamClear', 'longDrive', 'quiet'];
const JOKES = EVENTS.filter((e) => !['lead', 'nowLead'].includes(e));

// Every line a character has for a moment: asks until nothing new turns up.
function allLines(id, event, lang) {
  const seen = new Set();
  for (let n = 0; n < 200; n++) seen.add(pick(id, event, lang, { rand: () => (n % 41) / 41, vars: { limit: 90 } }));
  seen.delete('');
  return [...seen];
}

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

test('the speed limit is said at every level of warning, in the character\'s own words', () => {
  for (const id of FUNNY) {
    for (const lang of ['ms', 'en']) {
      for (const event of ['overspeed', 'overspeed2', 'overspeed3']) {
        for (const text of allLines(id, event, lang)) {
          assert.match(text, /90/, `${id} ${event}: ${text}`);
          assert.doesNotMatch(text, /\{limit\}/);
        }
      }
    }
  }
});

test('a joke for every moment, and more than one of each', () => {
  for (const id of FUNNY) {
    for (const lang of ['ms', 'en']) {
      for (const event of JOKES) {
        assert.ok(allLines(id, event, lang).length >= 3, `${id} ${lang} ${event}`);
      }
      assert.ok(allLines(id, 'tail', lang).length >= 6, `${id} ${lang} tail`);
    }
  }
});

test('both languages have the same number of lines, so neither gets short changed', () => {
  for (const id of FUNNY) {
    for (const event of EVENTS) {
      assert.equal(allLines(id, event, 'ms').length, allLines(id, event, 'en').length, `${id} ${event}`);
    }
  }
});

test('nobody has the same line twice, or borrows another character\'s', () => {
  const owner = new Map();
  for (const id of FUNNY) {
    for (const lang of ['ms', 'en']) {
      for (const event of JOKES) {
        for (const line of allLines(id, event, lang)) {
          const words = plainSpeech(line);
          assert.ok(!owner.has(words), `"${words}" for ${id} and ${owner.get(words)}`);
          owner.set(words, `${id} ${event}`);
        }
      }
    }
  }
});

test('lines are delivered in many ways, not one', () => {
  for (const id of FUNNY) {
    const used = new Set();
    for (const lang of ['ms', 'en']) {
      for (const event of JOKES) {
        for (const line of allLines(id, event, lang)) {
          for (const m of line.matchAll(/\[([a-z]+)\]/g)) used.add(m[1]);
        }
      }
    }
    assert.ok(used.size >= 5, `${id}: ${[...used]}`);
  }
});

test('delivery marks are ones the voices know, and are never read aloud or shown', () => {
  for (const id of FUNNY) {
    for (const lang of ['ms', 'en']) {
      for (const event of EVENTS) {
        for (const line of allLines(id, event, lang)) {
          for (const m of line.matchAll(/\[([^\]]*)\]/g)) assert.ok(MOODS.includes(m[1]), `${id}: ${line}`);
          assert.doesNotMatch(plainSpeech(line), /[[\]]/, line);
        }
      }
    }
  }
  assert.equal(plainSpeech('Belok kiri. [tease]Eh… kenapa? [whisper]Jangan.'), 'Belok kiri. Eh… kenapa? Jangan.');
  assert.equal(plainSpeech('[warm]Hai.'), 'Hai.');
  assert.equal(plainSpeech(''), '');
});

test('lines stay short enough to be said, and for the server to accept', () => {
  for (const id of FUNNY) {
    for (const lang of ['ms', 'en']) {
      const hello = Math.max(...allLines(id, 'start', lang).map((l) => l.length));
      const lead = Math.max(...allLines(id, 'lead', lang).map((l) => l.length));
      const tail = Math.max(...allLines(id, 'tail', lang).map((l) => l.length));
      assert.ok(hello + lead + tail + 90 <= 420, `${id} ${lang}: the longest possible greeting is ${hello + lead + tail + 90}`);
      for (const event of JOKES) {
        for (const line of allLines(id, event, lang)) assert.ok(line.length <= 150, `${id} ${event}: ${line}`);
      }
    }
  }
});

test('the standard voice has nothing to say about the drive, except when it matters', () => {
  for (const kind of ['slowed', 'jam', 'jamLong', 'jamClear', 'quiet']) {
    assert.equal(dress('standard', kind, '', 'ms'), '');
  }
  assert.equal(dress('standard', 'longDrive', 'Berhenti rehat.', 'ms'), 'Berhenti rehat.');
  assert.equal(dress('standard', 'overspeed3', 'Had laju 90.', 'ms'), 'Had laju 90.');
});

test('a character speaks for themselves about the drive', () => {
  assert.ok(dress('uncle', 'jam', '', 'ms'));
  assert.ok(dress('adik', 'jamClear', '', 'en'));
  assert.notEqual(dress('captain', 'longDrive', 'Berhenti rehat.', 'ms'), 'Berhenti rehat.');
  const text = dress('captain', 'overspeed3', 'Had laju 90.', 'ms', { vars: { limit: 90 } });
  assert.match(text, /90/);
});

test('everyone says who they sound like, and all five kinds of voice are here', () => {
  const tags = CHARACTER_IDS.map((id) => characterTag(id, 'en')).join(' ');
  for (const kind of [/Male/, /Female/, /Malay accent/, /Chinese accent/, /Indian accent/]) assert.match(tags, kind);
  for (const id of CHARACTER_IDS) assert.ok(characterTag(id, 'ms'), id);
});

test('nothing a character says encourages going faster', () => {
  const words = /\b(cepat|laju lagi|tekan minyak|hurry|faster|speed up|step on it|potong|overtake|cut in)\b/i;
  const allowed = /Jangan potong|No cutting/;
  for (const id of FUNNY) {
    for (const lang of ['ms', 'en']) {
      for (const event of EVENTS) {
        for (const line of allLines(id, event, lang)) {
          if (!allowed.test(line)) assert.doesNotMatch(line, words, `${id} ${event}: ${line}`);
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
  assert.match(sample('uncle', 'ms', 'Belok kiri.'), /\[plain\]Belok kiri\./, 'said in a normal voice, whatever came before');
});

test('a line becomes separate recordings wherever its delivery changes', () => {
  assert.deepEqual(clipsOf('Belok kiri.'), ['Belok kiri.']);
  assert.deepEqual(clipsOf('Belok kiri. [tease]Eh… kenapa?'), ['Belok kiri.', '[tease]Eh… kenapa?']);
  assert.deepEqual(clipsOf('[warm]Hai. [plain]Belok kiri. [sigh]Haih.'), ['[warm]Hai.', 'Belok kiri.', '[sigh]Haih.']);
  assert.deepEqual(clipsOf('Berhenti. [plain]Belok kiri.'), ['Berhenti.', 'Belok kiri.']);
  assert.deepEqual(clipsOf(''), []);
  assert.equal(isDirection('Belok kiri.'), true);
  assert.equal(isDirection('[tease]Eh.'), false);
});

test('every word of a line survives being split into recordings', () => {
  for (const id of FUNNY) {
    for (const lang of ['ms', 'en']) {
      const line = sample(id, lang, 'Belok kiri.');
      assert.equal(plainSpeech(clipsOf(line).join(' ')), plainSpeech(line), id);
    }
  }
});

test('the same joke is the same recording, whichever direction came before it', () => {
  const rand = () => 0.1;
  const tail = pick('uncle', 'tail', 'ms', { rand });
  assert.equal(clipsOf(`Belok kiri. ${tail}`)[1], clipsOf(`Belok kanan ke Jalan Ampang. ${tail}`)[1]);
});
