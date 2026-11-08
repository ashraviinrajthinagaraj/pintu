// Battery saver: on a long drive the map is most of what the phone does. With
// it on, the map is drawn a little less sharply and half as often, and the 3D
// buildings are left out. Directions, voice and GPS stay exactly the same.
// "Auto" turns it on by itself when the battery is low and not charging.
export const LOW = 0.2;
export const SAVER_FPS = 30;
export const SAVER_SETTINGS = ['auto', 'on', 'off'];

export function saverOn(setting, battery) {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return !!battery && battery.charging === false && battery.level <= LOW;
}

// Whether a frame is due, at thirty a second when saving.
export const frameDue = (now, last, saving) => !saving || now - last >= 1000 / SAVER_FPS - 4;

// Calls back with { level, charging } now and whenever either changes.
// Phones that won't say (iPhones, Firefox) never call back, and auto stays off.
export async function watchBattery(onChange, nav = globalThis.navigator) {
  try {
    const b = await nav?.getBattery?.();
    if (!b) return null;
    const read = () => onChange({ level: b.level, charging: b.charging });
    b.addEventListener?.('levelchange', read);
    b.addEventListener?.('chargingchange', read);
    read();
    return b;
  } catch { return null; }
}
