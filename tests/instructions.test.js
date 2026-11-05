import test from 'node:test';
import assert from 'node:assert/strict';
import { describe as describeM, phrase, speech } from '../js/instructions.js';

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
