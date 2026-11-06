// Google's voices arrive as text: what kind of sound it is on the first line, then the
// sound itself, encoded. Often it's bare sound with no header, which a phone can't
// play until it's wrapped up as a WAV file.

export function decodeAudio(body) {
  const text = String(body || '').trim();
  const cut = text.indexOf('\n');
  const kind = cut > 0 ? text.slice(0, cut).trim().toLowerCase() : '';
  const raw = atob((cut > 0 ? text.slice(cut + 1) : text).trim());
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return audioBlob(bytes, kind);
}

const tagOf = (bytes) => String.fromCharCode(...bytes.subarray(0, 4));

// Sound a phone can play, whatever form it came in.
export function audioBlob(bytes, kind = '') {
  const tag = tagOf(bytes);
  if (tag === 'RIFF') return new Blob([bytes], { type: 'audio/wav' });
  if (tag === 'OggS') return new Blob([bytes], { type: 'audio/ogg' });
  if (tag === 'fLaC') return new Blob([bytes], { type: 'audio/flac' });
  if (tag.startsWith('ID3') || /mpeg|mp3/.test(kind)) return new Blob([bytes], { type: 'audio/mpeg' });
  // Bare sound: 16-bit samples at the rate it says. Google's is 24 kHz, one channel.
  const rate = Number(kind.match(/rate=(\d+)/)?.[1]) || 24000;
  const channels = Number(kind.match(/channels=(\d+)/)?.[1]) || 1;
  const length = bytes.length - (bytes.length % (2 * channels));
  return new Blob([wavHeader(length, rate, channels), bytes.subarray(0, length)], { type: 'audio/wav' });
}

export function wavHeader(length, rate, channels = 1) {
  const head = new DataView(new ArrayBuffer(44));
  const word = (at, s) => { for (let i = 0; i < 4; i++) head.setUint8(at + i, s.charCodeAt(i)); };
  word(0, 'RIFF');
  head.setUint32(4, 36 + length, true);
  word(8, 'WAVE');
  word(12, 'fmt ');
  head.setUint32(16, 16, true);
  head.setUint16(20, 1, true);
  head.setUint16(22, channels, true);
  head.setUint32(24, rate, true);
  head.setUint32(28, rate * channels * 2, true);
  head.setUint16(32, channels * 2, true);
  head.setUint16(34, 16, true);
  word(36, 'data');
  head.setUint32(40, length, true);
  return new Uint8Array(head.buffer);
}
