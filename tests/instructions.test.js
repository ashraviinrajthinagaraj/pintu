import test from 'node:test';
import assert from 'node:assert/strict';
import { describe as describeM, laneAdvice, laneView, phrase, speech } from '../js/instructions.js';

const TYPES = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,37,38];

test('every driving manoeuvre reads properly in both languages', () => {
  for (const lang of ['ms', 'en']) {
    for (const type of TYPES) {
      for (const m of [
        { type, street_names: ['Jalan Ampang'], instruction: 'x' },
        { type, instruction: 'x', roundabout_exit_count: 2 },
      ]) {
        const text = phrase(m, lang);
        assert.ok(text.length > 2, `${lang} ${type}`);
        assert.doesNotMatch(text, /undefined|null|NaN|\[object/, `${lang} ${type}: ${text}`);
      }
    }
  }
});

test('Malay directions', () => {
  assert.equal(phrase({ type: 15, street_names: ['Jalan Ampang'] }, 'ms'), 'Belok kiri ke Jalan Ampang');
  assert.equal(phrase({ type: 10 }, 'ms'), 'Belok kanan');
  assert.equal(phrase({ type: 12 }, 'ms'), 'Buat pusingan U');
  assert.equal(phrase({ type: 26, roundabout_exit_count: 2 }, 'ms'), 'Di bulatan, ambil jalan keluar kedua');
  assert.equal(phrase({ type: 6 }, 'ms'), 'Destinasi di sebelah kiri');
});

test('English directions', () => {
  assert.equal(phrase({ type: 15, street_names: ['Jalan Ampang'] }, 'en'), 'Turn left onto Jalan Ampang');
  assert.equal(phrase({ type: 26, roundabout_exit_count: 3 }, 'en'), 'At the roundabout, take the third exit');
});

test('road numbers are kept apart from road names', () => {
  const d = describeM({ type: 25, street_names: ['E2', 'Lebuhraya Utara-Selatan'] }, 'ms');
  assert.equal(d.road, 'Lebuhraya Utara-Selatan');
  assert.equal(d.ref, 'E2');
  assert.equal(phrase({ type: 25, street_names: ['E2'] }, 'ms'), 'Masuk ke E 2');
});

test('exits use the sign text', () => {
  const m = {
    type: 20,
    sign: {
      exit_number_elements: [{ text: '223' }],
      exit_toward_elements: [{ text: 'Seremban' }],
      exit_branch_elements: [{ text: 'E2' }],
    },
  };
  assert.equal(phrase(m, 'ms'), 'Keluar di susur 223 ke E2, menuju Seremban');
  assert.equal(phrase(m, 'en'), 'Take exit 223 onto E2, towards Seremban');
});

test('unknown types fall back to the server text', () => {
  assert.equal(phrase({ type: 99, instruction: 'Do the thing' }, 'ms'), 'Do the thing');
});

test('spoken sentences', () => {
  const ms = [{ type: 1 }, { type: 15, street_names: ['Jalan Ampang'] }, { type: 10 }, { type: 4 }];
  assert.equal(speech({ kind: 'far', index: 1, distance: 310 }, ms, 'ms'), 'Dalam 300 meter, belok kiri ke Jalan Ampang.');
  assert.equal(speech({ kind: 'now', index: 1, distance: 40 }, ms, 'ms'), 'Belok kiri ke Jalan Ampang.');
  assert.equal(speech({ kind: 'now', index: 1, distance: 40, thenIndex: 2 }, ms, 'ms'), 'Belok kiri ke Jalan Ampang, kemudian belok kanan.');
  assert.equal(speech({ kind: 'intro', index: 1, distance: 2000 }, ms, 'ms'), 'Terus sejauh 2 kilometer, kemudian belok kiri ke Jalan Ampang.');
  assert.equal(speech({ kind: 'continue', index: 2, distance: 5000 }, ms, 'ms'), 'Terus sejauh 5 kilometer.');
  assert.equal(speech({ kind: 'arrive', index: 3 }, ms, 'ms'), 'Anda telah sampai.');
  assert.equal(speech({ kind: 'far', index: 1, distance: 310 }, ms, 'en'), 'In 300 metres, turn left onto Jalan Ampang.');
  assert.equal(speech({ kind: 'repeat', index: 1, distance: 60 }, ms, 'en'), 'Turn left onto Jalan Ampang.');
});

test('stops have their own wording', () => {
  assert.equal(phrase({ type: 6, isStop: true }, 'ms'), 'Hentian di sebelah kiri');
  assert.equal(phrase({ type: 5, isStop: true }, 'en'), 'Your stop is on the right');
  assert.equal(phrase({ type: 4, isStop: true }, 'ms'), 'Hentian anda');
  assert.equal(speech({ kind: 'stop', index: 0 }, [{ type: 4, isStop: true }], 'ms'), 'Anda telah sampai di hentian.');
});

test('lanes follow the documented example', () => {
  const v = laneView([{ directions: 8, active: 8 }, { directions: 10, valid: 8 }]);
  assert.deepEqual(v, [
    { direction: 'left', others: [], state: 'best' },
    { direction: 'left', others: ['straight'], state: 'ok' },
  ]);
});

test('lanes that do not apply are shown as other lanes', () => {
  const v = laneView([{ directions: 2 }, { directions: 2 }, { directions: 64, active: 64 }]);
  assert.deepEqual(v.map((l) => l.state), ['other', 'other', 'best']);
  assert.deepEqual(v.map((l) => l.direction), ['straight', 'straight', 'right']);
});

test('a lane that does several things shows the one you need', () => {
  const v = laneView([{ directions: 10, active: 2 }, { directions: 64 }]);
  assert.equal(v[0].direction, 'straight');
});

test('no lane advice when it would not help', () => {
  assert.equal(laneView(undefined), null);
  assert.equal(laneView([]), null);
  assert.equal(laneView([{ directions: 2, active: 2 }]), null, 'only one lane');
  assert.equal(laneView([{ directions: 2 }, { directions: 2 }]), null, 'nothing marked');
  assert.equal(laneView([{ directions: 2, active: 2 }, { directions: 2, active: 2 }]), null, 'every lane is fine');
});

test('unmarked lane directions never break the display', () => {
  const v = laneView([{ directions: 0 }, { directions: 1 }, { directions: 256, active: 256 }]);
  assert.deepEqual(v.map((l) => l.direction), ['straight', 'straight', 'uturn']);
});

test('lane advice in words', () => {
  const lane = (active) => (active ? { directions: 2, active: 2 } : { directions: 2 });
  const says = (flags, lang = 'ms') => laneAdvice(flags.map(lane), lang);
  assert.equal(says([1, 0, 0]), 'Guna lorong paling kiri.');
  assert.equal(says([0, 0, 1]), 'Guna lorong paling kanan.');
  assert.equal(says([0, 1, 1]), 'Guna dua lorong kanan.');
  assert.equal(says([1, 1, 0]), 'Guna dua lorong kiri.');
  assert.equal(says([0, 1, 0]), 'Guna lorong tengah.');
  assert.equal(says([0, 0, 1], 'en'), 'Use the right lane.');
  assert.equal(says([0, 1, 1], 'en'), 'Use the two right lanes.');
  assert.equal(says([0, 1, 0], 'en'), 'Use the middle lane.');
  assert.equal(says([1, 1, 1]), '', 'any lane will do');
  assert.equal(says([1, 0, 1]), '', 'too awkward to say');
  assert.equal(laneAdvice(undefined, 'ms'), '');
});

test('directions include the lane to use', () => {
  const lanes = [{ directions: 2 }, { directions: 64, active: 64 }];
  const m = [{ type: 1 }, { type: 10, street_names: ['Jalan Ampang'], lanes }];
  assert.equal(speech({ kind: 'far', index: 1, distance: 310 }, m, 'ms'), 'Dalam 300 meter, belok kanan ke Jalan Ampang. Guna lorong paling kanan.');
  assert.equal(speech({ kind: 'repeat', index: 1, distance: 310 }, m, 'en'), 'In 300 metres, turn right onto Jalan Ampang. Use the right lane.');
  assert.equal(speech({ kind: 'now', index: 1, distance: 40 }, m, 'ms'), 'Belok kanan ke Jalan Ampang.');
});
