// Run after `npx cap add android`: what the plain Capacitor project needs
// for Pintu. Permissions for location with the screen off, the notification
// that goes with it, the version, and signing with Pintu's own key.
import { readFileSync, writeFileSync } from 'node:fs';

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
let manifest = readFileSync(manifestPath, 'utf8');
const permissions = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK',
];
const missing = permissions.filter((p) => !manifest.includes(`"${p}"`));
manifest = manifest.replace('</manifest>', `${missing.map((p) => `    <uses-permission android:name="${p}" />`).join('\n')}\n    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n</manifest>`);
writeFileSync(manifestPath, manifest);

const stringsPath = 'android/app/src/main/res/values/strings.xml';
let strings = readFileSync(stringsPath, 'utf8');
if (!strings.includes('capacitor_background_geolocation_notification_channel_name')) {
  strings = strings.replace('</resources>', '    <string name="capacitor_background_geolocation_notification_channel_name">Panduan memandu</string>\n</resources>');
}
writeFileSync(stringsPath, strings);

const gradlePath = 'android/app/build.gradle';
let gradle = readFileSync(gradlePath, 'utf8');
const code = Number(process.env.VERSION_CODE || 1);
const name = process.env.VERSION_NAME || '1.0';
gradle = gradle.replace(/versionCode \d+/, `versionCode ${code}`).replace(/versionName "[^"]*"/, `versionName "${name}"`);
if (process.env.PINTU_SIGN === '1' && !gradle.includes('signingConfigs')) {
  gradle = gradle.replace(/\n(\s*)buildTypes \{/, `
$1signingConfigs {
$1    release {
$1        storeFile file(System.getenv("PINTU_KEYSTORE"))
$1        storePassword System.getenv("PINTU_KEYSTORE_PASSWORD")
$1        keyAlias "pintu"
$1        keyPassword System.getenv("PINTU_KEYSTORE_PASSWORD")
$1        storeType "pkcs12"
$1    }
$1}
$1buildTypes {`);
  gradle = gradle.replace(/(buildTypes \{\s*release \{)/, '$1\n            signingConfig signingConfigs.release');
}
writeFileSync(gradlePath, gradle);
console.log(`Prepared Pintu ${name} (${code}), ${missing.length} permissions added.`);
