// When Pintu runs inside its Android app (android-app/), the app's own parts
// take over where a web page can't: location and voice that carry on with the
// screen off or another app in front, and keeping the screen awake. In a
// browser none of this exists and Pintu works as it always has.
const cap = () => globalThis.Capacitor || null;

export const inApp = () => !!cap()?.isNativePlatform?.();

export function nativePlugin(name) {
  const c = cap();
  if (!c?.isNativePlatform?.()) return null;
  if (c.isPluginAvailable && !c.isPluginAvailable(name)) return null;
  return c.Plugins?.[name] || (c.registerPlugin ? c.registerPlugin(name) : null);
}

// The app's location, as a browser would give it, so the rest of Pintu needn't know.
export function asPosition(loc) {
  return {
    coords: {
      latitude: loc.latitude,
      longitude: loc.longitude,
      accuracy: loc.accuracy ?? 30,
      speed: loc.speed ?? null,
      heading: loc.bearing ?? null,
    },
    timestamp: loc.time || Date.now(),
  };
}
