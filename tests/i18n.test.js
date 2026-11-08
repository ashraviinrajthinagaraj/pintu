// Every word on screen exists in every language, so nobody sees a key name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { STRINGS_FOR_TEST as STRINGS } from '../js/i18n.js';

const langs = Object.keys(STRINGS);

test('every language has the same words', () => {
  const all = new Set(langs.flatMap((l) => Object.keys(STRINGS[l])));
  for (const l of langs) {
    const missing = [...all].filter((k) => !(k in STRINGS[l]));
    assert.deepEqual(missing, [], `${l} is missing these`);
  }
});

test('every word the app asks for exists', () => {
  const used = new Set();
  for (const file of readdirSync(new URL('../js/', import.meta.url)).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.size > 200, `found ${used.size}`);
  const missing = [...used].filter((k) => !(k in STRINGS.ms));
  assert.deepEqual(missing, []);
});

test('a placeholder in one language is in the others too', () => {
  const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const key of Object.keys(STRINGS.ms)) {
    if (typeof STRINGS.ms[key] !== 'string') continue;
    for (const l of langs) {
      if (typeof STRINGS[l][key] !== 'string') continue;
      assert.equal(holes(STRINGS[l][key]), holes(STRINGS.ms[key]), `${l}.${key}`);
    }
  }
});
