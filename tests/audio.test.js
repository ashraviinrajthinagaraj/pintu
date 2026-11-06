import test from 'node:test';
import assert from 'node:assert/strict';
import { audioBlob, decodeAudio, wavHeader } from '../js/audio.js';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const read = async (blob) => new Uint8Array(await blob.arrayBuffer());

test('a WAV header describes the sound exactly', () => {
  const head = new DataView(wavHeader(4800, 24000).buffer);
  const word = (at) => String.fromCharCode(...new Uint8Array(head.buffer, at, 4));
  assert.equal(word(0), 'RIFF');
  assert.equal(word(8), 'WAVE');
  assert.equal(word(36), 'data');
  assert.equal(head.getUint32(4, true), 36 + 4800);
  assert.equal(head.getUint16(20, true), 1, 'plain sound');
  assert.equal(head.getUint16(22, true), 1, 'one channel');
  assert.equal(head.getUint32(24, true), 24000);
  assert.equal(head.getUint32(28, true), 48000, 'bytes a second');
  assert.equal(head.getUint16(34, true), 16);
  assert.equal(head.getUint32(40, true), 4800);
});

test('bare sound from Google is wrapped so a phone can play it', async () => {
  const sound = new Uint8Array(4800).fill(7);
  const blob = decodeAudio(`audio/L16;codec=pcm;rate=24000\n${b64(sound)}`);
  assert.equal(blob.type, 'audio/wav');
  const bytes = await read(blob);
  assert.equal(bytes.length, 44 + 4800);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'RIFF');
  assert.equal(new DataView(bytes.buffer).getUint32(24, true), 24000);
  assert.deepEqual(bytes.subarray(44), sound);
});

test('the rate it says is the rate it plays at', async () => {
  const bytes = await read(decodeAudio(`audio/pcm;rate=16000\n${b64(new Uint8Array(100))}`));
  assert.equal(new DataView(bytes.buffer).getUint32(24, true), 16000);
});

test('with nothing said about it, bare sound is taken to be Google\'s usual', async () => {
  const bytes = await read(decodeAudio(b64(new Uint8Array(10))));
  assert.equal(new DataView(bytes.buffer).getUint32(24, true), 24000);
});

test('half a sample at the end is dropped, not played as noise', async () => {
  const bytes = await read(audioBlob(new Uint8Array(101), 'audio/l16'));
  assert.equal(bytes.length, 44 + 100);
});

test('sound that already has a header is left exactly as it is', async () => {
  const wav = new Uint8Array([...new TextEncoder().encode('RIFF'), 1, 2, 3, 4]);
  for (const kind of ['audio/wav', 'audio/L16;rate=24000', '']) {
    const blob = decodeAudio(`${kind}\n${b64(wav)}`.trim());
    assert.equal(blob.type, 'audio/wav');
    assert.deepEqual(await read(blob), wav);
  }
  const mp3 = new Uint8Array([...new TextEncoder().encode('ID3'), 9, 9]);
  assert.equal(audioBlob(mp3).type, 'audio/mpeg');
  assert.equal(audioBlob(new Uint8Array([0xff, 0xfb, 1, 2]), 'audio/mpeg').type, 'audio/mpeg');
  assert.equal(audioBlob(new Uint8Array([...new TextEncoder().encode('OggS'), 1])).type, 'audio/ogg');
});

test('quiet bare sound isn\'t mistaken for an MP3', () => {
  assert.equal(audioBlob(new Uint8Array([0xff, 0xff, 0xff, 0xff]), 'audio/l16;rate=24000').type, 'audio/wav');
  assert.equal(audioBlob(new Uint8Array([0xff, 0xff, 0xff, 0xff])).type, 'audio/wav');
});
