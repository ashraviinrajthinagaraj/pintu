// The service worker's own copies of what lives elsewhere, kept in step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CONFIG } from '../js/config.js';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('every script is kept for opening without signal', () => {
  const listed = new Set([...sw.matchAll(/'(js\/[^']+\.js)'/g)].map((m) => m[1]));
  const files = [
    ...readdirSync(new URL('../js/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`),
    ...readdirSync(new URL('../js/cast/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `js/cast/${f}`),
  ];
  assert.deepEqual(files.filter((f) => !listed.has(f)), []);
});

test('the version matches the app\'s, so updates reach phones', () => {
  assert.equal(sw.match(/const VERSION = 'pintu-([^']+)'/)[1], CONFIG.version);
});

test('notifications ask the same server the app uses', () => {
  assert.equal(sw.match(/const SERVER = '([^']+)'/)[1], CONFIG.server);
});

test('a notification only ever opens Pintu itself', () => {
  assert.match(sw, /new URL\('\.\/\?go=work', self\.registration\.scope\)/);
});
