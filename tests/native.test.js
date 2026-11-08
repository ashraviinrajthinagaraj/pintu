import test from 'node:test';
import assert from 'node:assert/strict';
import { asPosition, inApp, nativePlugin } from '../js/native.js';

test('in a browser there is no app, and nothing changes', () => {
  delete globalThis.Capacitor;
  assert.equal(inApp(), false);
  assert.equal(nativePlugin('TextToSpeech'), null);
  globalThis.Capacitor = { isNativePlatform: () => false, Plugins: { TextToSpeech: {} } };
  assert.equal(nativePlugin('TextToSpeech'), null, 'a web build of Capacitor is still a browser');
});

test('in the app, its parts are found by name, and only if installed', () => {
  const tts = { speak() {} };
  globalThis.Capacitor = { isNativePlatform: () => true, isPluginAvailable: (n) => n === 'TextToSpeech', Plugins: { TextToSpeech: tts } };
  assert.equal(inApp(), true);
  assert.equal(nativePlugin('TextToSpeech'), tts);
  assert.equal(nativePlugin('KeepAwake'), null);
  delete globalThis.Capacitor;
});

test('the app\'s location reads like a browser\'s', () => {
  assert.deepEqual(asPosition({ latitude: 3.15, longitude: 101.7, accuracy: 6, speed: 12, bearing: 90, time: 5 }), {
    coords: { latitude: 3.15, longitude: 101.7, accuracy: 6, speed: 12, heading: 90 }, timestamp: 5,
  });
  assert.equal(asPosition({ latitude: 1, longitude: 2 }).coords.heading, null);
});

test('a drive in the app takes its location from the app, and gives it back after', async () => {
  const { Gps } = await import('../js/location.js');
  const fixes = [];
  const errors = [];
  let watching = 0;
  globalThis.navigator ??= {};
  const real = globalThis.navigator.geolocation;
  Object.defineProperty(globalThis.navigator, 'geolocation', { configurable: true, value: { watchPosition: () => ++watching, clearWatch: () => { watching--; } } });
  const calls = [];
  let cb = null;
  const plugin = {
    addWatcher: async (opts, f) => { calls.push(['add', opts.backgroundMessage]); cb = f; return 'w9'; },
    removeWatcher: async ({ id }) => { calls.push(['remove', id]); },
  };
  const gps = new Gps((f) => fixes.push(f), (e) => errors.push(e));
  gps.start();
  assert.equal(watching, 1, 'the browser\'s location while planning');
  gps.useBackground(plugin, 'Pintu sedang memandu bersama anda.');
  await new Promise((r) => setTimeout(r));
  assert.equal(watching, 0);
  assert.deepEqual(calls, [['add', 'Pintu sedang memandu bersama anda.']]);
  cb({ latitude: 3.15, longitude: 101.7, accuracy: 5, speed: 10, bearing: 45, time: Date.now() });
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].heading, 45);
  cb(null, { code: 'NOT_AUTHORIZED' });
  assert.deepEqual(errors, [{ code: 1 }]);
  gps.useBackground(null);
  await new Promise((r) => setTimeout(r));
  assert.deepEqual(calls[1], ['remove', 'w9']);
  assert.equal(watching, 1, 'back to the browser\'s after the drive');

  // An app whose location won't start falls back to the browser's.
  gps.stop();
  gps.useBackground({ addWatcher: () => Promise.reject(new Error('no')), removeWatcher: async () => {} }, 'x');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(watching, 1);
  assert.equal(gps.bg, null);
  if (real) Object.defineProperty(globalThis.navigator, 'geolocation', { configurable: true, value: real });
});
