// Pintu's signing key, worked out the same way every time from a secret
// sentence, so each new app installs over the last one. The certificate that
// goes with it is public and is kept in this folder; the key never is.
import { createECDH, createHash, createPrivateKey } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const seed = process.env.ANDROID_SIGNING_SEED;
if (!seed || seed.length < 16) {
  console.error('ANDROID_SIGNING_SEED is missing or shorter than 16 characters.');
  process.exit(1);
}
const d = createHash('sha256').update(`pintu-android-signing:${seed}`).digest();
const ecdh = createECDH('prime256v1');
ecdh.setPrivateKey(d);
const pub = ecdh.getPublicKey(null, 'uncompressed');
const b64 = (buf) => buf.toString('base64url');
const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: b64(d), x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33)) }, format: 'jwk' });
writeFileSync(process.argv[2] || 'key.pem', key.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
console.log('Signing key ready.');
