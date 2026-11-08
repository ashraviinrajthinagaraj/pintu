import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { DriveLog, MAX_FIXES, lastDrive, recentErrors, rememberError, reportText, shareReport } = await import('../js/report.js');

test('errors are kept, the same one counted rather than repeated', () => {
  store.clear();
  rememberError('Boom', 'app.js:12', 1000);
  rememberError('Boom', 'app.js:12', 2000);
  rememberError('Other', '', 3000);
  for (let i = 0; i < 30; i++) rememberError(`e${i}`, '', 4000 + i);
  const list = recentErrors();
  assert.equal(list.length, 20, 'only the latest');
  store.clear();
  rememberError('Boom', 'app.js:12', 1000);
  rememberError('Boom', 'app.js:12', 2000);
  assert.deepEqual(recentErrors(), [{ t: 2000, m: 'Boom', w: 'app.js:12', n: 2 }]);
});

test('the last drive: every reading, kept small, saved now and then', () => {
  store.clear();
  const log = new DriveLog({ dest: { name: 'KLCC', lng: 101.712, lat: 3.158, extra: 'x' }, mode: 'car', version: '9', now: 0 });
  log.add({ lng: 101.7000004, lat: 3.15, accuracy: 8.6, speed: 11.26, heading: 91.4 }, 1000);
  assert.deepEqual(log.data.fixes[0], [1, 101.7, 3.15, 9, 11.3, 91]);
  assert.deepEqual(lastDrive().dest, { name: 'KLCC', lng: 101.712, lat: 3.158 }, 'saved at the first reading');
  log.event('reroute', 5000);
  for (let i = 0; i < MAX_FIXES + 10; i++) log.add({ lng: 101.7, lat: 3.15, speed: null }, 2000 + i);
  assert.equal(log.data.fixes.length, MAX_FIXES, 'only the latest two hours');
  log.save(99000);
  assert.equal(lastDrive().events[0][1], 'reroute');
  assert.equal(lastDrive().endedAt, 99000);
});

test('the report: plain lines, no places, and the drive only when attached', () => {
  const drive = { startedAt: Date.UTC(2026, 10, 8, 1), endedAt: Date.UTC(2026, 10, 8, 1, 42), fixes: new Array(2520), events: [[1, 'reroute'], [2, 'reroute'], [3, 'arrived']], dest: { name: 'KLCC', lng: 101.7, lat: 3.1 } };
  const text = reportText({
    version: '0.9.1', note: 'It said turn left too late', agent: 'Android', screen: '390×844 @3x', installed: true, online: true,
    lang: 'ms', theme: 'auto', voice: 'full, standard', gps: 'last accuracy 8 m', settings: '3D on', tomtom: '3 today', map: 'loaded',
    provider: 'fossgis', drive, attached: true, errors: [{ t: 0, m: 'TypeError: x', w: 'app.js:1', n: 3 }],
  });
  assert.match(text, /^Pintu 0\.9\.1: problem report/);
  assert.match(text, /What happened: It said turn left too late/);
  assert.match(text, /Last drive: .* 42 min, 2520 GPS readings, events: reroute ×2, arrived ×1 \(file attached\)/);
  assert.match(text, /TypeError: x \(×3\) @ app\.js:1/);
  assert.ok(!/KLCC|101\.7/.test(text), 'places only travel in the attached file');
});

test('shared through the phone, with the drive as a text file when it can be', async () => {
  const shared = [], copied = [];
  const clipboard = { writeText: async (t) => copied.push(t) };
  const nav = { share: async (d) => shared.push(d), canShare: () => true, clipboard };
  assert.equal(await shareReport({ text: 'hi', drive: { a: 1 } }, nav), 'shared-with-drive');
  assert.equal(shared[0].files[0].name, 'pintu-drive.txt');
  assert.equal(shared[0].files[0].type, 'text/plain');
  assert.deepEqual(copied, ['hi'], 'copied first, just in case');
  assert.equal(await shareReport({ text: 'hi', drive: null }, nav), 'shared');
});

test('a phone that refuses the file gets the words alone; one that refuses everything has them copied', async () => {
  const shared = [];
  const fussy = { canShare: () => true, clipboard: { writeText: async () => {} }, share: async (d) => {
    if (d.files) throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    shared.push(d);
  } };
  assert.equal(await shareReport({ text: 'hi', drive: { a: 1 } }, fussy), 'shared');
  assert.equal(shared.length, 1);
  const stubborn = { canShare: () => true, clipboard: { writeText: async () => {} }, share: async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); } };
  assert.equal(await shareReport({ text: 'hi', drive: { a: 1 } }, stubborn), 'copied');
  const closed = { clipboard: { writeText: async () => {} }, share: async () => { throw Object.assign(new Error('closed'), { name: 'AbortError' }); } };
  await assert.rejects(shareReport({ text: 'hi' }, closed), (e) => e.name === 'AbortError', 'closing the share sheet is not a failure');
  await assert.rejects(shareReport({ text: 'hi' }, {}), /neither share nor copy/);
});
