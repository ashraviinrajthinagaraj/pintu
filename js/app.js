import { CONFIG } from './config.js';
import { fmtClock, fmtDistance, fmtDuration, sayDistance } from './format.js';
import { clamp, haversine, sliceFrom } from './geo.js';
import { Guidance } from './guidance.js';
import { getLang, setLang, t } from './i18n.js';
import { CATEGORY_ICONS, UI, doorSvg, laneIcon, turnIcon } from './icons.js';
import { describe, laneView, speech } from './instructions.js';
import { LaneScene, NO_LANES } from './lanes.js';
import { Gps, SimulatedDrive } from './location.js';
import { MapView } from './map.js';
import { Motion } from './motion.js';
import { findAlongRoute, placeOnRoute, thinAlong } from './places.js';
import { NAMES, PrayerTimes, closePrayer, prayerDuringTrip } from './prayer.js';
import { RouteError, distanceAfter, fetchRoadDetails, fetchRoutes, limitAt, timeBetween } from './routing.js';
import { CHARACTER_IDS, characterAbout, characterName, characterTag, characterVoice, dress, pick, sample } from './characters.js';
import { plainSpeech } from './delivery.js';
import { DriveWatch, OVER_BY_KMH } from './drive-watch.js';
import { checkRouteWeather } from './weather.js';
import { parseLocationText, readResolved, resolveShortLink } from './links.js';
import { fetchShops, mallFor, searchShops } from './malls.js';
import { reversePlace, searchPlaces } from './search.js';
import { load, remove, save } from './store.js';
import { DEFAULT_LOOKS, levelAfter, rangeLeft, rangeWarning, reserveKm, tripPlan } from './vehicle.js';
import { initVehicleUI } from './vehicle-ui.js';
import * as voice from './voice.js';

const $ = (id) => document.getElementById(id);

const RECENT_LIMIT = 8;
const TRIP_MAX_AGE = 3 * 60 * 60 * 1000;
// Phones often stop reporting while parked at a light, so only a phone that was
// moving when the reports stopped is treated as having lost its signal quickly.
const NO_GPS_MOVING = 15000;
const NO_GPS_STILL = 60000;
const LANDSCAPE = '(orientation: landscape) and (max-height: 520px)';
const LANE_RANGE_HIGHWAY = 2000;
const LANE_RANGE_ROAD = 600;
const LANE_CHUNK_M = 30000;
const LANE_RETRY_MS = 60000;
const CAR_PX = 64;             // how long the car looks when the map is zoomed out
const CAR_LANE_M = 7.6;        // and in the lane view, where it's drawn to scale with the road
const START_NEAR_M = 300;      // this close to a chosen start, you're there
const SIM_SPEEDS = [1, 4, 10, 30];
const SIM_FAST = 10;           // from here it's too quick to talk over, or to read lanes
const SIM_LEAD_M = 150;        // jumping to a turn lands this far before it
const SIM_END_GAP_M = 60;      // a jump doesn't end the trip by itself
const MOMENT_KEEP_MS = 30000;   // a remark that can't be made by then isn't worth making
const TURNS_ONLY = new Set(['now', 'arrive', 'stop', 'repeat']);
const WEATHER_REFRESH_MS = 20 * 60000;
const RAIN_CHIP_M = 30000;     // far enough ahead to matter
const RAIN_SAY_M = 15000;
const HUD_CONTROLS_MS = 6000;
const HUD_BAR_M = 500;         // the bar fills over the last stretch before a turn

const S = {
  view: 'idle',
  overlay: null,
  fix: null,
  realFix: null,
  dest: null,
  start: null,
  stops: [],
  routes: [],
  selected: 0,
  routeState: 'idle',
  routeError: null,
  mode: load('mode', 'car'),
  avoidTolls: load('avoidTolls', false),
  settings: { lang: 'ms', theme: 'auto', muted: false, view3d: true, solat: true, simSpeed: 4, voiceLevel: 'full', voiceCharacter: 'standard', speedLimit: true, weather: true, hudMirror: true, ...load('settings', {}) },
  vehicles: load('vehicles', {}),
  looks: { ...DEFAULT_LOOKS, ...load('looks', {}) },
  scene: null,
  laneFetch: { routeId: null, until: 0, busy: false, retryAt: 0, failures: 0, counts: [] },
  route: null,
  guidance: null,
  sim: null,
  simStops: [],
  simPlan: null,
  simScrub: false,
  greeted: false,
  overSince: null,
  lastOverSaid: 0,
  weather: null,
  weatherSaid: null,
  arrivedAt: null,
  returnMode: null,
  mall: null,
  following: true,
  followTimer: null,
  followPad: { top: 0, bottom: 0, left: 0, right: 0 },
  lastState: null,
  rerouting: false,
  rerouteFailed: false,
  lastReroute: 0,
  rerouteGap: 12000,
  lastFixAt: 0,
  wake: null,
  wakeWarned: false,
  hiddenAt: 0,
  endArmedTimer: null,
  searchCtrl: null,
  routeCtrl: null,
  stopsCtrl: null,
  searchTimer: null,
  wantCenter: false,
  fixWaiters: [],
  installEvent: null,
  startWhenRouted: false,
  stopCat: 'fuel',
  stopResults: [],
  drivenKm: 0,
  tripKm: 0,
  tripStart: 0,
  lastDrivenS: null,
  rangeSpoken: 0,
  cam: { zoom: 16, pitch: 0 },
  lastPose: null,
  lastCamera: null,
  lastFrameAt: 0,
  lastTrimAt: 0,
  lastTrimS: null,
};

const gps = new Gps(onGpsFix, onGpsError);
const motion = new Motion();
const prayers = new PrayerTimes({ onChange: renderPrayer });
let mapView;

const vehicleUI = initVehicleUI({
  getVehicle: () => vehicle(),
  getLook: () => S.looks[driveMode()],
  setLook: (look) => {
    S.looks[driveMode()] = look;
    save('looks', S.looks);
    S.lastPose = null;
  },
  setVehicle: (v) => {
    if (v) S.vehicles[driveMode()] = v;
    else delete S.vehicles[driveMode()];
    saveVehicles();
    renderAfterVehicleChange();
  },
  getMode: () => driveMode(),
  onDone: () => history.back(),
});

function vehicle() { return S.vehicles[S.mode] || null; }
// The vehicle in question, even while you're on foot.
function driveMode() { return S.mode === 'walk' ? (S.returnMode || load('mode', 'car')) : S.mode; }
function saveVehicles() { save('vehicles', S.vehicles); }

/* ---------- Words and icons ---------- */

function applyStaticText() {
  document.documentElement.lang = getLang();
  $('map').setAttribute('aria-label', t('mapLabel'));
  $('where-text').textContent = t('where');
  $('where-glyph').innerHTML = doorSvg('style="--knob:#00794A"');
  label($('btn-settings'), t('settings'), UI.settings);
  label($('btn-locate'), t('locate'), UI.locate);
  for (const id of ['search-back', 'preview-back', 'settings-back', 'vehicle-back', 'pick-back']) label($(id), t('back'), UI.back);
  for (const id of ['stops-back', 'steps-back']) label($(id), t('back'), UI.close);
  setSearchPrompt();
  label($('swap-ends'), t('swapEnds'), UI.swap);
  $('to-mark').innerHTML = doorSvg('style="--knob:#18B070"');
  $('quick-here-icon').innerHTML = UI.locate;
  $('quick-here-label').textContent = t('myLocation');
  $('quick-map-icon').innerHTML = UI.pin;
  $('quick-map-label').textContent = t('pickOnMap');
  $('pick-hint').textContent = t('pickHint');
  $('pick-use').textContent = t('pickUse');
  $('steps-title').textContent = t('stepsTitle');
  $('sim-seek').setAttribute('aria-label', t('simSeek'));
  label($('sim-next'), t('simNext'), UI.skip);
  label($('sim-list'), t('simList'), UI.list);
  $('sim-speeds').setAttribute('aria-label', t('simSpeed'));
  renderEnds();
  renderSimPanel();
  $('search-tip').textContent = t('searchTip');
  $('recents-title').textContent = t('recents');
  $('recents-clear').textContent = t('clear');
  $('mode-car').textContent = t('car');
  $('mode-moto').textContent = t('moto');
  $('mode-walk').textContent = t('walk');
  $('avoid-tolls-label').textContent = t('avoidTolls');
  $('add-stop-label').textContent = t('addStopShort');
  $('add-stop').setAttribute('aria-label', t('addStop'));
  $('add-stop-icon').innerHTML = UI.plus;
  $('plan-prayer-icon').innerHTML = UI.surau;
  $('plan-prayer-chev').innerHTML = UI.chevron;
  $('stops-title').textContent = t('addStop');
  $('stops-other').textContent = t('stopsOther');
  $('safety-title').textContent = t('safetyTitle');
  $('safety-text').textContent = t('safetyText');
  $('safety-ok').textContent = t('safetyOk');
  $('then-label').textContent = t('then');
  $('btn-end').textContent = t('end');
  $('speed-unit').textContent = t('speedUnit');
  label($('btn-recenter'), t('recenter'), UI.recenter);
  label($('btn-add-stop'), t('addStop'), UI.plus);
  $('arrival-title').textContent = t('arrived');
  $('arrival-done').textContent = t('done');
  $('resume-yes').textContent = t('resumeYes');
  $('resume-no').textContent = t('resumeNo');
  $('refill-yes').textContent = t('refillYes');
  $('refill-no').textContent = t('refillNo');
  $('map-retry').textContent = t('retry');
  $('settings-title').textContent = t('settingsTitle');
  $('set-vehicle-title').textContent = t('setVehicle');
  $('set-lang-title').textContent = t('setLang');
  $('set-voice-title').textContent = t('setVoice');
  $('voice-test').textContent = t('voiceTest');
  $('voice-check').textContent = t('voiceCheck');
  $('voice-try-label').textContent = t('voiceTryLabel');
  for (const b of document.querySelectorAll('#voice-try button')) b.textContent = t(`voiceTry_${b.dataset.moment}`);
  $('voice-level-label').textContent = t('setVoiceLevel');
  $('voice-full').textContent = t('voiceFull');
  $('voice-turns').textContent = t('voiceTurns');
  $('voice-char-label').textContent = t('setVoiceChar');
  $('voice-char-note').textContent = t('voiceCharNote');
  $('set-limit-title').textContent = t('setLimit');
  $('limit-text').textContent = t('limitText');
  $('limit-on-label').textContent = t('limitOn');
  $('set-weather-title').textContent = t('setWeather');
  $('weather-text').textContent = t('weatherText');
  $('weather-on-label').textContent = t('weatherOn');
  label($('weather-back'), t('back'), UI.close);
  label($('mall-back'), t('back'), UI.close);
  $('weather-title').textContent = t('weatherTitle');
  $('weather-note').textContent = t('weatherNote');
  $('weather-credit').textContent = t('weatherCredit');
  $('weather-rivers').textContent = t('checkRivers');
  $('weather-rivers').href = CONFIG.weather.riversUrl;
  $('weather-roads').textContent = t('checkRoads');
  $('weather-roads').href = CONFIG.weather.roadsUrl;
  $('plan-weather-icon').innerHTML = UI.rain;
  $('plan-weather-chev').innerHTML = UI.chevron;
  $('plan-mall-icon').innerHTML = UI.store;
  $('plan-mall-chev').innerHTML = UI.chevron;
  $('mall-map').textContent = t('mallMap');
  $('mall-list').textContent = t('mallList');
  $('mall-search').placeholder = t('mallSearch');
  $('mall-search').setAttribute('aria-label', t('mallSearch'));
  $('mall-note').textContent = t('mallNote');
  $('btn-hud').textContent = 'HUD';
  $('btn-hud').setAttribute('aria-label', t('hudOpen'));
  $('hm-unit').textContent = t('speedUnit');
  $('hm-tip').textContent = t('hudTip');
  $('hm-close').textContent = t('hudClose');
  renderHudMirror();
  $('arrival-walk').textContent = t('walkToDoor');
  $('search-paste-icon').innerHTML = UI.paste;
  $('search-paste-label').textContent = t('pasteLink');
  renderCharacters();
  $('set-theme-title').textContent = t('setTheme');
  $('theme-auto').textContent = t('themeAuto');
  $('theme-day').textContent = t('themeDay');
  $('theme-night').textContent = t('themeNight');
  $('set-solat-title').textContent = t('setSolat');
  $('solat-text').textContent = t('solatText');
  $('solat-on-label').textContent = t('solatOn');
  $('set-install-title').textContent = t('setInstall');
  $('install-btn').textContent = t('installBtn');
  $('set-privacy-title').textContent = t('setPrivacy');
  $('privacy-text').textContent = t('privacy');
  $('set-credits-title').textContent = t('setCredits');
  $('version').textContent = t('version', { v: CONFIG.version });
  $('veh-body-label').textContent = t('vehShape');
  $('veh-color-label').textContent = t('vehColor');
  $('veh-preset-label').textContent = t('vehPreset');
  $('veh-name-label').textContent = t('vehName');
  $('veh-kind-label').textContent = t('vehKind');
  $('veh-kind-petrol').textContent = t('vehPetrol');
  $('veh-kind-diesel').textContent = t('vehDiesel');
  $('veh-kind-ev').textContent = t('vehEv');
  $('veh-note').textContent = t('vehNote');
  $('veh-save').textContent = t('vehSave');
  $('veh-remove').textContent = t('vehRemove');
  render3DButtons();
  renderMute();
  renderVoiceStatus();
  renderInstall();
  renderClock();
  renderPrayer();
  renderVehicleSummary();
  renderRangePill();
}

function label(btn, text, icon) {
  btn.innerHTML = icon;
  btn.setAttribute('aria-label', text);
  btn.title = text;
}

function renderMute() {
  const m = S.settings.muted;
  label($('btn-mute'), t(m ? 'unmute' : 'mute'), m ? UI.soundOff : UI.sound);
  $('btn-mute').classList.toggle('is-off', m);
  $('btn-mute').setAttribute('aria-pressed', String(m));
}

function render3DButtons() {
  const on = S.settings.view3d;
  for (const id of ['btn-3d', 'btn-3d-idle']) {
    const b = $(id);
    b.textContent = on ? '3D' : '2D';
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-label', t(on ? 'threeDOn' : 'threeDOff'));
    b.title = b.getAttribute('aria-label');
  }
}

function renderVoiceStatus() {
  const status = voice.voiceStatus(getLang());
  const key = { exact: 'voiceExact', near: 'voiceNear', none: 'voiceNone' }[status] || 'voiceMissing';
  const human = voice.humanVoice();
  const parts = human === 'on' ? [t('voiceHuman')]
    : human === 'resting' ? [t('voiceHumanResting')]
    : human === 'refused' ? [t('voiceHumanRefused'), t(key)]
      : CONFIG.server ? [t('voiceHumanOff'), t(key)]
        : [t(key)];
  $('voice-status').textContent = parts.join(' ');
  const silent = human !== 'on' && key === 'voiceMissing';
  $('voice-test').hidden = silent;
  $('voice-try').hidden = silent || S.settings.voiceCharacter === 'standard';
  $('voice-check').hidden = !CONFIG.server;
}

function renderInstall() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('install-text').textContent = t(standalone ? 'installDone' : ios ? 'installIos' : 'installAndroid');
  $('install-btn').hidden = standalone || !S.installEvent;
}

function renderSegments() {
  const set = (id, on) => $(id).setAttribute('aria-checked', String(on));
  set('mode-car', S.mode === 'car');
  set('mode-moto', S.mode === 'motorcycle');
  set('mode-walk', S.mode === 'walk');
  set('voice-full', S.settings.voiceLevel === 'full');
  set('voice-turns', S.settings.voiceLevel === 'turns');
  $('limit-on').checked = S.settings.speedLimit;
  $('weather-on').checked = S.settings.weather;
  set('lang-ms', S.settings.lang === 'ms');
  set('lang-en', S.settings.lang === 'en');
  set('theme-auto', S.settings.theme === 'auto');
  set('theme-day', S.settings.theme === 'day');
  set('theme-night', S.settings.theme === 'night');
  $('avoid-tolls').checked = S.avoidTolls;
  $('solat-on').checked = S.settings.solat;
  // Motorcycles don't pay tolls in Malaysia, so the switch means nothing for them.
  $('toll-wrap').hidden = S.mode !== 'car';
}

function renderClock() {
  $('hud-clock').textContent = fmtClock(new Date(), getLang());
}

function renderVehicleSummary() {
  const v = vehicle();
  const name = v?.name || t('vehUnnamed');
  $('set-vehicle-text').textContent = !v ? t('vehNone')
    : v.range ? t('vehSummaryRange', { name, km: fmtDistance(v.range * 1000) }) : t('vehSummary', { name });
  $('set-vehicle-open').textContent = t(v ? 'vehOpenEdit' : 'vehOpenAdd');
}

let toastTimer;
function toast(text, ms = 3500, { top = false } = {}) {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('toast-top', top);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* ---------- Theme ---------- */

function currentTheme() {
  if (S.settings.theme !== 'auto') return S.settings.theme;
  const d = new Date();
  const h = d.getHours() + d.getMinutes() / 60;
  return h >= CONFIG.nightStartsAt || h < CONFIG.nightEndsAt ? 'night' : 'day';
}

function applyTheme() {
  const theme = currentTheme();
  document.documentElement.dataset.theme = theme;
  mapView?.setTheme(theme);
}

/* ---------- Views ---------- */

function show(view) {
  S.view = view;
  render();
}

function render() {
  const { view, overlay } = S;
  $('idle').hidden = view !== 'idle';
  $('hud').hidden = view !== 'idle';
  $('scrim').hidden = !(view === 'idle' || view === 'nav');
  $('search').hidden = !(view === 'search' || overlay === 'stopsearch' || overlay === 'endsearch');
  // The stops panel takes the same space, so there's no need to draw both.
  $('preview').hidden = view !== 'preview' || overlay === 'pickmap' || overlay === 'stops';
  $('map-pick').hidden = overlay !== 'pickmap';
  $('steps').hidden = overlay !== 'steps';
  $('weather').hidden = overlay !== 'weather';
  $('mall').hidden = overlay !== 'mall';
  $('hudmode').hidden = overlay !== 'hudmode';
  $('nav').hidden = view !== 'nav';
  $('arrival').hidden = view !== 'arrival';
  $('settings').hidden = overlay !== 'settings';
  $('vehicle').hidden = overlay !== 'vehicle';
  $('stops').hidden = overlay !== 'stops';
  observeBottom();
}

function pushHistory(view, extra = {}) { history.pushState({ view, ...extra }, ''); }
function replaceHistory(view, extra = {}) { history.replaceState({ view, ...extra }, ''); }

function openOverlay(name) {
  S.overlay = name;
  pushHistory(S.view, { overlay: name });
  render();
}

addEventListener('popstate', (e) => {
  const st = e.state || { view: 'idle' };
  if (S.view === 'nav' && st.view !== 'nav') {
    S.overlay = null;
    pushHistory('nav');
    render();
    toast(t('backBlocked'));
    return;
  }
  const was = S.overlay;
  S.overlay = st.overlay || null;
  if (was === 'vehicle' && S.overlay !== 'vehicle') vehicleUI.close();
  if (was === 'stops' && S.overlay !== 'stopsearch') closeStopsPanel();
  if (was === 'stopsearch' && !S.overlay) closeStopsPanel();
  if (was === 'endsearch' || was === 'stopsearch') S.searchFor = null;
  if (was === 'hudmode') leaveFullscreen();
  if (was === 'mall') S.mallCtrl?.abort();
  if (st.view === 'idle' && (S.view === 'preview' || S.view === 'search')) leaveDestination();
  // History can point at a trip that has already ended.
  const stale = (st.view === 'nav' && S.view !== 'nav') || (st.view === 'arrival' && S.view !== 'arrival') || (st.view === 'preview' && !S.dest);
  show(stale ? 'idle' : st.view);
  // Choosing on the map moved it. Put the route back in view.
  if (was === 'pickmap' && S.overlay !== 'pickmap' && S.view === 'preview') fitRoutes();
});

// Whatever covers the bottom of the map decides where the map's own controls sit.
const bottomObserver = 'ResizeObserver' in window ? new ResizeObserver(() => updateBottomInset()) : null;
function observeBottom() {
  if (bottomObserver) {
    bottomObserver.disconnect();
    for (const id of ['preview', 'nav-bar', 'where', 'stops', 'steps', 'weather']) bottomObserver.observe($(id));
  }
  updateBottomInset();
}

function bottomElement() {
  if (S.overlay === 'stops') return $('stops');
  if (S.overlay === 'steps') return $('steps');
  if (S.overlay === 'weather') return $('weather');
  if (S.overlay === 'pickmap' || S.overlay === 'hudmode') return null;
  if (S.view === 'preview') return $('preview');
  if (S.view === 'nav') return $('nav-bar');
  if (S.view === 'idle') return $('where');
  return null;
}

function updateBottomInset() {
  const el = bottomElement();
  const landscape = matchMedia(LANDSCAPE).matches;
  let inset = 0;
  if (el && (!landscape || S.view === 'idle')) inset = Math.max(0, innerHeight - el.getBoundingClientRect().top);
  if (landscape && S.view !== 'idle') inset = 0;
  document.documentElement.style.setProperty('--bottom-inset', `${inset}px`);
  S.followPad = followPadding(inset, landscape);
  return inset;
}

function mapPadding() {
  const landscape = matchMedia(LANDSCAPE).matches;
  const pad = { top: 70, bottom: 40, left: 40, right: 40 };
  if (S.view === 'preview') {
    if (landscape) pad.left = $('preview').offsetWidth + 30;
    else pad.bottom = updateBottomInset() + 30;
  }
  return pad;
}

function followPadding(inset, landscape) {
  const h = innerHeight;
  if (landscape) return { top: h * 0.3, bottom: 0, left: Math.min(innerWidth * 0.5, 390), right: 0 };
  // Puts you in the lower part of the screen with the road ahead in view.
  return { top: h * 0.46, bottom: inset, left: 0, right: 0 };
}

/* ---------- Location ---------- */

function onGpsFix(fix) {
  S.lastFixAt = Date.now();
  if (S.settings.solat) prayers.update(fix.lat, fix.lng);
  if (!S.sim) receiveFix(fix);
  else S.realFix = fix;
}

function onGpsError(err) {
  if (err.code === 1) {
    S.gpsDenied = true;
    gps.stop();
    flushFixWaiters(null);
    if (S.view === 'nav') renderChips();
    else if (S.view !== 'preview') toast(t('gpsDenied'), 6000);
  }
}

function receiveFix(fix) {
  S.gpsDenied = false;
  S.fix = fix;
  const now = performance.now();
  if (S.view === 'nav' && S.guidance) {
    onNavFix(fix, now);
  } else {
    motion.offRoute(fix.lng, fix.lat, fix.heading, fix.motionSpeed ?? fix.speed ?? 0, now);
  }
  if (S.wantCenter) {
    S.wantCenter = false;
    mapView?.centerOn(fix.lng, fix.lat);
  }
  if (S.view === 'preview' && S.start) renderActions();
  flushFixWaiters(fix);
}

function flushFixWaiters(fix) {
  const waiters = S.fixWaiters;
  S.fixWaiters = [];
  for (const w of waiters) w(fix);
}

function waitForFix(ms = 15000) {
  if (S.fix && Date.now() - S.lastFixAt < 60000) return Promise.resolve(S.fix);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(S.fix), ms);
    S.fixWaiters.push((f) => { clearTimeout(timer); resolve(f); });
  });
}

async function startGpsIfAllowed() {
  try {
    const p = await navigator.permissions.query({ name: 'geolocation' });
    if (p.state === 'granted') { S.wantCenter = true; gps.start(); }
  } catch { /* the phone will ask when it's first needed */ }
}

/* ---------- The arrow and the camera: one frame at a time ---------- */

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - S.lastFrameAt) / 1000);
  S.lastFrameAt = now;
  const pose = motion.frame(now);
  if (!pose || !mapView) return;

  // In the lane view, the car sits in its lane and turns into lane changes.
  const scene = S.view === 'nav' && S.settings.view3d && S.scene?.active ? S.scene : null;
  let { lng, lat, heading } = pose;
  if (scene && pose.s != null) {
    const off = scene.lateralAt(pose.s);
    const r = ((heading ?? 0) * Math.PI) / 180;
    lng += (Math.cos(r) * off) / (111320 * Math.cos((lat * Math.PI) / 180));
    lat -= (Math.sin(r) * off) / 110540;
    heading = (heading ?? 0) + scene.yawAt(pose.s);
  }

  const last = S.lastPose;
  const changed = !last || Math.abs(last.lng - lng) > 1e-7 || Math.abs(last.lat - lat) > 1e-7
    || (heading != null && Math.abs((last.heading ?? 0) - heading) > 0.05);
  if (changed) {
    mapView.setPuck(lng, lat, heading);
    S.lastPose = { lng, lat, heading };
  }
  let camMoved = false;
  if (S.view === 'nav') camMoved = navFrame({ ...pose, lng, lat, heading }, now, dt, changed, !!scene);
  if (changed || camMoved || S.carDirty) updateCar(lng, lat, heading);
}

function updateCar(lng, lat, heading) {
  S.carDirty = false;
  if (S.mode === 'walk') {
    mapView.setCarOn(false);
    return;
  }
  const look = S.looks[S.mode];
  const lane = S.cam.lane || 0;
  const lanePx = CAR_LANE_M / mapView.metresPerPixel(lat);
  mapView.setCarOn(S.settings.view3d);
  mapView.setCar({
    lng, lat, heading, body: look.body, color: look.color,
    theme: currentTheme(),
    lengthPx: CAR_PX + (lanePx - CAR_PX) * lane,
  });
}

function navFrame(pose, now, dt, moved, inLanes) {
  // Further out the faster a simulated drive goes, so the map can keep up.
  const speedUp = S.sim ? Math.max(0, Math.log2(S.sim.factor / 4)) * 0.65 : 0;
  // A paused simulated car is still on that road, so the view holds still.
  const speedNow = S.sim ? S.sim.roadSpeed : S.fix?.speed;
  const walking = S.mode === 'walk';
  const targetZoom = walking ? 18.4 : inLanes ? laneZoom(speedNow) : zoomForSpeed(speedNow) - speedUp;
  const targetPitch = !S.settings.view3d ? 0 : walking ? 45 : inLanes ? 68 : 60;
  const ease = 1 - Math.exp(-dt * (inLanes ? 1.4 : 1.1));
  const before = { ...S.cam };
  S.cam.zoom += (targetZoom - S.cam.zoom) * ease;
  S.cam.pitch += (targetPitch - S.cam.pitch) * (1 - Math.exp(-dt * 3));
  S.cam.lane = (S.cam.lane || 0) + ((inLanes ? 1 : 0) - (S.cam.lane || 0)) * ease;
  const camMoved = Math.abs(before.zoom - S.cam.zoom) > 0.001 || Math.abs(before.pitch - S.cam.pitch) > 0.02;

  // Further down the screen in the lane view, with more road ahead.
  const pad = { ...S.followPad, top: S.followPad.top + (innerHeight * 0.14) * S.cam.lane };
  if (S.following && (moved || camMoved || S.poseStale)) {
    S.poseStale = false;
    mapView.pose(pose.lng, pose.lat, pose.heading, S.cam.zoom, S.cam.pitch, pad);
  }

  // The line behind you and the progress bar don't need sixty updates a second.
  if (pose.s != null && S.route && now - S.lastTrimAt > 250) {
    S.lastTrimAt = now;
    if (S.lastTrimS == null || Math.abs(pose.s - S.lastTrimS) > 6) {
      S.lastTrimS = pose.s;
      // The lane view has its own line on the road; the ordinary one starts past it.
      const trimFrom = inLanes && S.scene ? Math.max(pose.s, S.scene.trimS) : pose.s;
      mapView.setRemaining(sliceFrom(S.route.coords, S.route.cum, trimFrom));
      setStripProgress($('nav-strip'), pose.s / S.route.length);
      if (S.sim) $('sim-seek').setAttribute('aria-valuenow', String(Math.round((pose.s / S.route.length) * 100)));
    }
  }
  return camMoved;
}

function laneZoom(speed) {
  const v = speed ?? 0;
  if (v < 12) return 20.1;
  if (v < 22) return 19.7;
  return 19.3;
}

/* ---------- The lane view ---------- */

function startScene(route) {
  S.scene = new LaneScene(route);
  S.laneFetch = { routeId: route.id, until: 0, busy: false, retryAt: 0, failures: 0, counts: [], limits: [] };
  mapView?.setLanes(NO_LANES);
}

// Lane counts and speed limits come a stretch at a time, as the road ahead needs them.
async function loadRoadDetails(s) {
  const f = S.laneFetch;
  const route = S.route;
  if (!route || S.mode === 'walk' || !(S.settings.view3d || S.settings.speedLimit)) return;
  if (f.busy || f.failures >= 3 || Date.now() < f.retryAt) return;
  if (s < f.until - 3000 || f.until >= route.length) return;
  f.busy = true;
  const from = Math.max(0, Math.max(s, f.until) - 50);
  const to = Math.min(route.length, from + LANE_CHUNK_M);
  try {
    const { counts, limits } = await fetchRoadDetails(route, from, to, { mode: S.mode });
    if (S.laneFetch !== f || !S.scene) return;
    f.counts.push(...counts);
    f.limits.push(...limits);
    f.until = to;
    f.failures = 0;
    S.scene.setCounts(f.counts);
    if (S.lastState && S.fix) {
      updateScene(S.lastState, S.fix);
      renderSpeed(S.fix, S.lastState);
      if (S.overlay === 'hudmode') renderHud(S.lastState, S.fix);
    }
  } catch {
    f.failures++;
    f.retryAt = Date.now() + LANE_RETRY_MS;
  } finally {
    f.busy = false;
  }
}

function updateScene(st, fix) {
  const scene = S.scene;
  if (!scene) return;
  const tooQuick = S.simScrub || (S.sim && S.sim.factor >= SIM_FAST);
  if (!tooQuick) loadRoadDetails(st.s);
  if (!S.settings.view3d || !st.onRoute || tooQuick || S.mode === 'walk') {
    if (scene.active) {
      scene.active = false;
      scene.builtAt = null;
      scene.keys = [];
      mapView?.setLanes(NO_LANES);
      S.lastTrimS = null;
    }
    return;
  }
  const wasActive = scene.active;
  if (scene.update(st.s, fix.speed)) {
    mapView?.setLanes(scene.features);
    S.lastTrimS = null;
  }
  if (scene.active && !wasActive && S.overlay !== 'hudmode' && !load('laneNoteSeen', false)) {
    save('laneNoteSeen', true);
    // Up high, so it never covers the car or the lanes it's talking about.
    toast(t('laneNote'), 7000, { top: true });
  }
}

function zoomForSpeed(speed) {
  const v = speed ?? 0;
  if (v < 8) return 17.2;
  if (v < 16) return 16.4;
  if (v < 25) return 15.4;
  return 14.6;
}

function toggle3D() {
  const on = !S.settings.view3d;
  setSetting('view3d', on);
  render3DButtons();
  mapView?.setView3D(on);
  mapView?.setCarOn(on);
  S.carDirty = true;
  if (S.view === 'idle') mapView?.tilt(on, S.fix ? [S.fix.lng, S.fix.lat] : null);
  S.poseStale = true;
}

/* ---------- Search ---------- */

function openSearch() {
  gps.start();
  S.searchFor = 'destination';
  pushHistory('search');
  show('search');
  resetSearch();
}

function openStopSearch() {
  S.searchFor = 'stop';
  openOverlay('stopsearch');
  resetSearch();
}

// Changing either end of a planned trip.
function openEndSearch(end) {
  S.searchFor = end;
  openOverlay('endsearch');
  resetSearch();
}

function setSearchPrompt() {
  const text = t(S.searchFor === 'start' ? 'startSearch' : 'searchPlaceholder');
  $('search-input').placeholder = text;
  $('search-input').setAttribute('aria-label', text);
}

function resetSearch() {
  setSearchPrompt();
  $('search-input').value = '';
  renderSearch([]);
  $('search-status').textContent = '';
  $('search-input').focus();
}

function placeButton(place, onPick) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'place';
  const strong = document.createElement('strong');
  strong.textContent = place.name;
  btn.append(strong);
  if (place.detail) {
    const span = document.createElement('span');
    span.textContent = place.detail;
    btn.append(span);
  }
  btn.addEventListener('click', () => onPick(place));
  li.append(btn);
  return li;
}

function renderSearch(results) {
  const pick = { stop: chooseStopFromSearch, start: chooseStartFromSearch, to: chooseToFromSearch }[S.searchFor] || chooseFromSearch;
  $('search-results').replaceChildren(...results.map((p) => placeButton(p, pick)));
  const empty = !$('search-input').value.trim();
  const recents = load('recents', []);
  $('recents-wrap').hidden = !empty || !recents.length;
  $('recents').replaceChildren(...recents.map((p) => placeButton(p, pick)));
  $('search-tip').hidden = !empty || S.searchFor === 'start';
  $('search-paste').hidden = !empty || !navigator.clipboard?.readText;
  $('search-quick').hidden = !empty || S.searchFor !== 'start';
}

function onSearchInput() {
  const q = $('search-input').value.trim();
  clearTimeout(S.searchTimer);
  S.searchCtrl?.abort();
  if (q.length < 2) {
    $('search-status').textContent = '';
    renderSearch([]);
    return;
  }
  const shared = parseLocationText(q);
  if (shared) {
    openShared(shared);
    return;
  }
  $('search-status').textContent = t('searching');
  S.searchTimer = setTimeout(() => runSearch(q), 350);
}

// A link or coordinates someone sent, ready to go to.
async function openShared(shared) {
  const status = $('search-status');
  const ctrl = new AbortController();
  S.searchCtrl = ctrl;
  let found = shared;
  if (found.kind === 'short') {
    if (!CONFIG.server) {
      status.textContent = t('linkNeedsServer');
      renderSearch([]);
      return;
    }
    status.textContent = t('linkOpening');
    renderSearch([]);
    try {
      found = readResolved(await resolveShortLink(found.url, { signal: ctrl.signal }), found.name);
    } catch {
      if (ctrl.signal.aborted) return;
      status.textContent = t('linkFailed');
      return;
    }
    if (ctrl.signal.aborted) return;
  }
  if (found.kind === 'place') {
    status.textContent = '';
    renderSearch([found.place]);
  } else if (found.kind === 'search') {
    status.textContent = t('searching');
    runSearch(found.query);
  } else {
    status.textContent = t('linkUnknown');
    renderSearch([]);
  }
}

async function pasteLink() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) throw new Error('nothing to paste');
    $('search-input').value = text.trim();
    onSearchInput();
  } catch {
    toast(t('pasteFailed'), 5000);
    $('search-input').focus();
  }
}

// Arriving with a link: shared to Pintu from another app, or opened from a message.
function openIncoming() {
  const q = new URLSearchParams(location.search);
  const text = q.get('to') || [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n');
  if (!text) return;
  history.replaceState(history.state, '', location.pathname);
  const shared = parseLocationText(text);
  if (shared?.kind === 'place') {
    if (q.get('name')) {
      shared.place.name = q.get('name');
      shared.place.unnamed = false;
    }
    gps.start();
    pushHistory('preview');
    S.stops = [];
    openPreview(shared.place);
    return;
  }
  openSearch();
  $('search-input').value = text;
  onSearchInput();
}

async function runSearch(q) {
  const ctrl = new AbortController();
  S.searchCtrl = ctrl;
  try {
    const results = await searchPlaces(q, { near: S.fix, signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    $('search-status').textContent = results.length ? '' : t('noResults', { q });
    renderSearch(results);
  } catch {
    if (ctrl.signal.aborted) return;
    $('search-status').textContent = t('searchFailed');
    renderSearch([]);
  }
}

function addRecent(place) {
  const { name, detail, lng, lat, country } = place;
  const key = (p) => `${p.name}|${p.lng.toFixed(4)}|${p.lat.toFixed(4)}`;
  const rest = load('recents', []).filter((p) => key(p) !== key(place));
  save('recents', [{ name, detail, lng, lat, country }, ...rest].slice(0, RECENT_LIMIT));
}

function chooseFromSearch(place) {
  $('search-input').blur();
  if (!place.unnamed) addRecent(place);
  replaceHistory('preview');
  S.stops = [];
  openPreview(place);
}

function chooseStopFromSearch(place) {
  $('search-input').blur();
  addRecent(place);
  history.go(-2);
  addStop({ ...place, category: null });
}

function chooseStartFromSearch(place) {
  $('search-input').blur();
  addRecent(place);
  history.back();
  setStart(place);
}

function chooseToFromSearch(place) {
  $('search-input').blur();
  addRecent(place);
  history.back();
  openPreview(place);
}

/* ---------- Where the trip starts ---------- */

// null means from wherever you are.
function setStart(place) {
  S.start = place;
  mapView?.setStart(place);
  mapView?.clearRoutes();
  renderEnds();
  loadRoutes();
}

function renderEnds() {
  const name = S.start ? S.start.name : t('myLocation');
  $('from-name').textContent = name;
  $('from-row').classList.toggle('is-custom', !!S.start);
  $('from-row').setAttribute('aria-label', t('fromAria', { place: name }));
  if (S.dest) $('to-row').setAttribute('aria-label', t('toAria', { place: S.dest.name }));
}

// You chose somewhere to start from, and aren't there. Driving this route isn't
// possible yet, so what's on offer is looking at it, or going there first.
function awayFromStart() {
  if (!S.start) return false;
  return !S.fix || haversine([S.fix.lng, S.fix.lat], [S.start.lng, S.start.lat]) > START_NEAR_M;
}

function renderActions() {
  const away = awayFromStart();
  const ready = S.routeState === 'ready' && S.routes.length > 0;
  $('start').textContent = t(away ? 'previewDrive' : 'start');
  $('try-sim').textContent = t(away ? 'driveToStart' : 'tryIt');
  // Going there first needs to know where you are.
  $('try-sim').hidden = !ready || (away && !S.fix);
  $('route-note').textContent = t(away ? 'startElsewhere' : 'routeNote');
  $('route-note').hidden = !ready;
}

function swapEnds() {
  const here = S.fix;
  if (!S.start && !here) {
    toast(t(S.gpsDenied ? 'gpsDenied' : 'gpsNone'), 6000);
    return;
  }
  const newDest = S.start || { name: t('myLocation'), detail: '', lng: here.lng, lat: here.lat, country: '', isHere: true };
  S.start = S.dest.isHere ? null : S.dest;
  S.stops.reverse();
  mapView?.setStart(S.start);
  openPreview(newDest);
}

// The chosen start becomes the first stop on a trip from where you really are.
function driveViaStart() {
  const p = S.start;
  S.stops.unshift({ id: 'start', name: p.name, detail: p.detail || '', lat: p.lat, lng: p.lng, category: null, along: 0 });
  S.start = null;
  mapView?.setStart(null);
  mapView?.setStopPins(S.stops);
  mapView?.clearRoutes();
  renderEnds();
  loadRoutes();
}

function openMapPick() {
  // The search box is still focused, and the phone's keyboard would cover the map.
  $('search-input').blur();
  const at = S.start || S.fix || S.dest;
  openOverlay('pickmap');
  mapView?.level();
  if (at) mapView?.lookDownAt(at.lng, at.lat);
}

async function useMapPick() {
  const box = $('pick-pin').getBoundingClientRect();
  const where = mapView?.placeAt(box.left + box.width / 2, box.top + box.height / 2);
  if (!where) return;
  const place = { name: `${where.lat.toFixed(5)}, ${where.lng.toFixed(5)}`, detail: '', lng: where.lng, lat: where.lat, country: '' };
  // Back past both the map and the search that led to it.
  history.go(-2);
  setStart(place);
  try {
    const named = await reversePlace(where.lng, where.lat);
    if (named && S.start === place) {
      // Its name, but the exact spot you chose.
      place.name = named.name;
      place.detail = named.detail;
      renderEnds();
      addRecent(place);
    }
  } catch { /* the coordinates still work */ }
}

function fitRoutes() {
  if (S.routes.length) mapView?.fit(S.routes.map((r) => r.coords), mapPadding());
}

/* ---------- Route preview ---------- */

function openPreview(place) {
  S.dest = place;
  S.routes = [];
  S.selected = 0;
  mapView?.setDestination(place);
  mapView?.clearRoutes();
  mapView?.setStopPins(S.stops);
  $('dest-name').textContent = place.name;
  $('dest-detail').textContent = place.detail || '';
  $('dest-detail').hidden = !place.detail;
  renderEnds();
  show('preview');
  renderSegments();
  loadRoutes();
  if (place.unnamed) nameDestination(place);
}

// All we have is a position. The search service can usually put a name to it.
async function nameDestination(place) {
  try {
    const named = await reversePlace(place.lng, place.lat);
    if (!named || S.dest !== place) return;
    S.dest = named;
    $('dest-name').textContent = named.name;
    $('dest-detail').textContent = named.detail || '';
    $('dest-detail').hidden = !named.detail;
    renderEnds();
    addRecent(named);
    renderPlanMall();
  } catch { /* the coordinates still work */ }
}

function leaveDestination() {
  S.routeCtrl?.abort();
  S.dest = null;
  S.start = null;
  S.routes = [];
  S.stops = [];
  mapView?.setStart(null);
  mapView?.setDestination(null);
  mapView?.setStopPins([]);
  mapView?.clearRoutes();
  renderRoutes();
}

async function onLongPress(lngLat) {
  if (S.view !== 'idle') return;
  const place = {
    name: `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`,
    detail: '',
    lng: lngLat.lng,
    lat: lngLat.lat,
    country: '',
    unnamed: true,
  };
  gps.start();
  pushHistory('preview');
  S.stops = [];
  openPreview(place);
}

async function loadRoutes() {
  S.routeCtrl?.abort();
  const ctrl = new AbortController();
  S.routeCtrl = ctrl;
  S.routes = [];
  S.routeState = 'locating';
  S.routeError = null;
  renderRoutes();

  gps.start();
  const from = S.start || await waitForFix();
  if (ctrl.signal.aborted) return;
  if (!from) {
    S.routeState = 'error';
    S.routeError = S.gpsDenied ? 'gpsDenied' : 'gpsNone';
    renderRoutes();
    return;
  }

  S.routeState = 'loading';
  renderRoutes();
  try {
    const routes = await fetchRoutes({
      from, to: S.dest, stops: S.stops, mode: S.mode, avoidTolls: S.avoidTolls, alternates: 2, signal: ctrl.signal,
    });
    if (ctrl.signal.aborted) return;
    S.routes = routes;
    S.selected = 0;
    S.routeState = 'ready';
    renderRoutes();
    if (S.startWhenRouted) {
      S.startWhenRouted = false;
      S.route = routes[0];
      startGuidance({ simulate: false });
      return;
    }
    mapView?.revealRoute(routes, 0);
    mapView?.fit(routes.map((r) => r.coords), mapPadding());
  } catch (err) {
    if (ctrl.signal.aborted || err.code === 'cancelled') return;
    S.startWhenRouted = false;
    S.routeState = 'error';
    S.routeError = routeErrorKey(err);
    renderRoutes();
  }
}

function routeErrorKey(err) {
  return { offline: 'errOffline', busy: 'errBusy', no_route: 'errNoRoute', too_far: 'errTooFar' }[err.code] || 'errOffline';
}

function renderRoutes() {
  const status = $('route-status');
  status.classList.toggle('is-error', S.routeState === 'error');
  status.replaceChildren();
  if (S.routeState === 'locating') status.textContent = t('findingYou');
  if (S.routeState === 'loading') status.textContent = t('findingRoutes');
  if (S.routeState === 'error') {
    const msg = document.createElement('p');
    msg.textContent = t(S.routeError);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'link-btn';
    retry.textContent = t('retry');
    retry.addEventListener('click', loadRoutes);
    status.append(msg, retry);
    // Without your location, a route can still start from somewhere you choose.
    if (S.routeError === 'gpsDenied' || S.routeError === 'gpsNone') {
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'link-btn';
      choose.textContent = t('chooseStart');
      choose.addEventListener('click', () => openEndSearch('start'));
      status.append(choose);
    }
  }

  const list = $('route-list');
  list.setAttribute('role', 'radiogroup');
  list.replaceChildren(...S.routes.map((r, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'route-opt';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(i === S.selected));
    const time = document.createElement('span');
    time.className = 'route-time';
    time.textContent = fmtDuration(r.time, getLang());
    const dist = document.createElement('span');
    dist.className = 'route-dist';
    dist.textContent = fmtDistance(r.distanceKm * 1000);
    btn.append(time, dist);
    if (r.via.length) {
      const via = document.createElement('span');
      via.className = 'route-via';
      via.textContent = t('via', { road: r.via.join(', ') });
      btn.append(via);
    }
    const tags = document.createElement('span');
    tags.className = 'route-tags';
    // Motorcycles don't pay tolls in Malaysia, so the tag would only mislead.
    if (r.hasToll && S.mode !== 'motorcycle') tags.append(tag(t('tollStill')));
    if (r.hasFerry) tags.append(tag(t('ferry')));
    btn.append(tags);
    btn.addEventListener('click', () => selectRoute(i));
    li.append(btn);
    return li;
  }));

  const ready = S.routeState === 'ready' && S.routes.length > 0;
  $('start').disabled = !ready;
  $('add-stop').disabled = !ready;
  renderActions();
  renderPlan();
  updateBottomInset();
}

function tag(text) {
  const el = document.createElement('span');
  el.className = 'tag';
  el.textContent = text;
  return el;
}

function selectRoute(i) {
  if (!S.routes[i]) return;
  S.selected = i;
  renderRoutes();
  mapView?.showRoutes(S.routes, i);
}

/* ---------- The plan: stops, fuel, prayer ---------- */

const refillWord = (kind) => t(kind === 'ev' ? 'refillEv' : 'refillFuel');
const kmText = (km) => fmtDistance(Math.max(0, km) * 1000);
const amountText = (n) => (n < 10 ? n.toFixed(1) : String(Math.round(n)));
const categoryName = (c) => ({ fuel: 'nameFuel', ev: 'nameEv', rest: 'nameRest', surau: 'nameSurau', food: 'nameFood' }[c]);

function renderPlan() {
  const route = S.routes[S.selected];
  const ready = S.routeState === 'ready' && route;
  $('plan').hidden = !ready;
  $('preview-strip').hidden = !ready;
  if (!ready) return;

  $('plan-stops').replaceChildren(...S.stops.map((stop, i) => {
    const row = document.createElement('div');
    row.className = 'stop-row';
    const icon = document.createElement('span');
    icon.className = 'plan-icon';
    icon.innerHTML = CATEGORY_ICONS[stop.category] || UI.plus;
    const main = document.createElement('div');
    main.className = 'plan-main';
    const name = document.createElement('strong');
    name.textContent = stop.name;
    main.append(name);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'icon-btn';
    label(removeBtn, t('removeStop', { name: stop.name }), UI.close);
    removeBtn.addEventListener('click', () => {
      S.stops.splice(i, 1);
      mapView?.setStopPins(S.stops);
      loadRoutes();
    });
    row.append(icon, main, removeBtn);
    return row;
  }));

  renderPlanFuel(route);
  renderPlanWeather(route);
  renderPlanMall();
  renderPlanPrayer(route);
  renderStrip($('preview-strip'), route, 0, false);
  // A line with nothing on it but the destination says nothing.
  $('preview-strip').hidden = !$('preview-strip').querySelector('.mark:not(.mark-end)');
}

function renderPlanFuel(route) {
  const v = vehicle();
  const row = $('plan-fuel');
  row.hidden = S.mode === 'walk';
  const kind = v?.kind || 'petrol';
  $('plan-fuel-icon').innerHTML = kind === 'ev' ? UI.ev : UI.fuel;
  $('plan-fuel-edit').textContent = t(v ? 'vehEditBtn' : 'vehAddBtn');
  $('plan-level-row').hidden = !v?.range;
  row.classList.remove('is-short');
  if (!v) {
    $('plan-fuel-title').textContent = t('vehAdd');
    $('plan-fuel-detail').textContent = t('vehAddDetail');
    return;
  }
  const plan = tripPlan(v, route.distanceKm);
  const refill = refillWord(v.kind);
  if (plan.used != null) {
    $('plan-fuel-title').textContent = plan.cost != null
      ? t('planUsedCost', { amount: amountText(plan.used), unit: plan.unit, cost: plan.cost.toFixed(2) })
      : t('planUsed', { amount: amountText(plan.used), unit: plan.unit });
  } else {
    $('plan-fuel-title').textContent = t('planRangeNow', { km: kmText(plan.rangeNow) });
  }
  let detail;
  if (plan.status === 'enough') detail = t('planEnough', { km: kmText(plan.rangeAtEnd) });
  else if (plan.status === 'tight') {
    detail = plan.refillWithinKm > 1 ? t('planTight', { refill, km: kmText(plan.refillWithinKm) }) : t('planTightNow', { refill });
  } else if (plan.status === 'short') {
    detail = plan.refillWithinKm > 1 ? t('planShort', { refill, km: kmText(plan.refillWithinKm) }) : t('planShortNow', { refill });
  } else detail = t('planNoRange', { refill });
  $('plan-fuel-detail').textContent = detail;
  row.classList.toggle('is-short', plan.status === 'short' || plan.status === 'tight');
  $('plan-level').value = String(v.level);
  $('plan-level-value').textContent = `${v.level}%`;
}

function renderPlanPrayer(route) {
  const row = $('plan-prayer');
  const data = S.settings.solat ? prayers.data : null;
  const now = Date.now();
  const close = closePrayer(data, now);
  const during = close ? null : prayerDuringTrip(data, now, route.time);
  row.hidden = !close && !during;
  if (close) {
    $('plan-prayer-title').textContent = prayerText(close);
    $('plan-prayer-detail').textContent = '';
  } else if (during) {
    $('plan-prayer-title').textContent = t('prayerDuring', { name: NAMES[during.name], clock: fmtClock(new Date(during.at), getLang()) });
    $('plan-prayer-detail').textContent = t('prayerDuringDetail');
  }
}

function prayerText(p) {
  const clock = fmtClock(new Date(p.at), getLang());
  const name = NAMES[p.name];
  return p.state === 'now' ? t('prayerNow', { name, clock }) : t('prayerSoon', { name, min: p.minutes, clock });
}

function renderPrayer() {
  const p = S.settings.solat ? closePrayer(prayers.data, Date.now()) : null;
  $('hud-prayer').hidden = !p;
  if (p) $('hud-prayer').textContent = prayerText(p);
  if (S.view === 'nav') renderChips();
  if (S.view === 'preview' && S.routes[S.selected]) renderPlan();
}

function renderRangePill() {
  const v = vehicle();
  const left = v ? rangeLeft(v, 0) : null;
  $('hud-range').hidden = left == null;
  if (left != null) {
    $('hud-range').innerHTML = v.kind === 'ev' ? UI.ev : UI.fuel;
    $('hud-range').append(kmText(left));
  }
}

function renderAfterVehicleChange() {
  renderVehicleSummary();
  renderRangePill();
  if (S.view === 'preview') renderRoutes();
}

// The trip as a line, with what's coming marked along it.
function tripMarks(route, fromS, drivenKm) {
  const marks = [];
  const len = route.length || 1;
  let stopIndex = 0;
  for (const m of route.maneuvers) {
    if (!m.isStop) continue;
    if (m.beginDist > fromS) {
      const stop = S.stops[stopIndex++];
      marks.push({ f: m.beginDist / len, kind: 'stop', icon: CATEGORY_ICONS[stop?.category] || '' });
    }
  }
  const v = vehicle();
  const left = v ? rangeLeft(v, drivenKm) : null;
  if (left != null) {
    const at = fromS + Math.max(0, left - reserveKm(v)) * 1000;
    if (at < route.length) marks.push({ f: at / len, kind: 'fuel', icon: v.kind === 'ev' ? UI.ev : UI.fuel });
  }
  const data = S.settings.solat ? prayers.data : null;
  const during = prayerDuringTrip(data, Date.now(), timeBetween(route, fromS, route.length));
  if (during) {
    marks.push({ f: distanceAfter(route, fromS, during.afterSeconds) / len, kind: 'prayer', icon: UI.surau });
  }
  marks.push({ f: 1, kind: 'end', icon: '' });
  return marks;
}

function renderStrip(el, route, fromS, withMe) {
  const marks = tripMarks(route, fromS, withMe ? S.drivenKm : 0);
  const key = JSON.stringify([withMe, marks.map((m) => [Math.round(m.f * 200), m.kind])]);
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  const fill = document.createElement('div');
  fill.className = 'strip-fill';
  const pieces = marks.map((m) => {
    const d = document.createElement('div');
    d.className = `mark mark-${m.kind}`;
    d.style.left = `${Math.min(100, m.f * 100)}%`;
    d.innerHTML = m.icon;
    return d;
  });
  el.replaceChildren(fill, ...pieces);
  if (withMe) {
    const me = document.createElement('div');
    me.className = 'mark mark-me';
    el.append(me);
    setStripProgress(el, fromS / (route.length || 1));
  }
}

function setStripProgress(el, f) {
  const clamped = Math.max(0, Math.min(1, f));
  const fill = el.querySelector('.strip-fill');
  const me = el.querySelector('.mark-me');
  if (fill) fill.style.transform = `scaleX(${clamped})`;
  if (me) me.style.left = `${clamped * 100}%`;
}

/* ---------- Choosing a stop ---------- */

const CATEGORY_ORDER = ['fuel', 'ev', 'rest', 'surau', 'food'];
const CATEGORY_LABELS = { fuel: 'catFuel', ev: 'catEv', rest: 'catRest', surau: 'catSurau', food: 'catFood' };

function tripRoute() { return S.route || S.routes[S.selected]; }
function tripFromS() { return S.view === 'nav' ? (S.lastState?.s ?? 0) : 0; }

function defaultCategory() {
  return vehicle()?.kind === 'ev' ? 'ev' : 'fuel';
}

function openStops(category = defaultCategory()) {
  if (!tripRoute()) return;
  S.stopCat = category;
  openOverlay('stops');
  renderStopCategories();
  loadStops();
}

function renderStopCategories() {
  $('stops-cats').replaceChildren(...CATEGORY_ORDER.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cat';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(c === S.stopCat));
    b.innerHTML = CATEGORY_ICONS[c];
    b.append(t(CATEGORY_LABELS[c]));
    b.addEventListener('click', () => {
      S.stopCat = c;
      renderStopCategories();
      loadStops();
    });
    return b;
  }));
}

async function loadStops() {
  S.stopsCtrl?.abort();
  const ctrl = new AbortController();
  S.stopsCtrl = ctrl;
  const route = tripRoute();
  const fromS = tripFromS();
  S.stopResults = [];
  S.stopsShown = '';
  $('stops-list').replaceChildren();
  mapView?.setPins([], pickStop);
  const status = $('stops-status');
  status.classList.remove('is-error');
  status.textContent = t('stopsSearching');
  const showFound = (found) => {
    S.stopResults = thinAlong(found).map((p) => ({ ...p, name: p.name || t(categoryName(p.category)) }));
    renderStopResults(route, fromS);
  };
  try {
    const found = await findAlongRoute(route, S.stopCat, fromS, {
      signal: ctrl.signal,
      tileUrl: mapView?.tileUrl(),
      // Worth showing straight away, while the rest of the road is still being read.
      onProgress: (list) => {
        if (ctrl.signal.aborted) return;
        status.textContent = t('stopsSearchingMore');
        showFound(list);
      },
    });
    if (ctrl.signal.aborted) return;
    showFound(found);
    status.textContent = S.stopResults.length ? '' : t('stopsNone');
  } catch {
    if (ctrl.signal.aborted) return;
    status.classList.add('is-error');
    const msg = document.createElement('p');
    msg.textContent = t('stopsFailed');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'link-btn';
    retry.textContent = t('retry');
    retry.addEventListener('click', loadStops);
    status.replaceChildren(msg, retry);
  }
}

function renderStopResults(route, fromS) {
  const shown = S.stopResults.map((p) => p.id).join();
  if (shown === S.stopsShown) return;
  S.stopsShown = shown;
  const v = vehicle();
  const left = v && (S.stopCat === 'fuel' || S.stopCat === 'ev') ? rangeLeft(v, S.drivenKm) : null;
  $('stops-list').replaceChildren(...S.stopResults.map((p) => {
    const clock = fmtClock(new Date(Date.now() + timeBetween(route, fromS, p.along) * 1000), getLang());
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'place';
    const strong = document.createElement('strong');
    strong.textContent = p.name;
    const a = document.createElement('span');
    a.textContent = t('stopAhead', { distance: fmtDistance(Math.max(p.ahead, 10)), clock });
    const b = document.createElement('span');
    b.textContent = p.side ? t(p.side === 'left' ? 'sideLeft' : 'sideRight', { distance: fmtDistance(p.off) }) : t('onRoute');
    btn.append(strong, a, b);
    if (left != null && p.ahead / 1000 > left) {
      const far = document.createElement('span');
      far.className = 'stop-far';
      far.textContent = t('stopFar');
      btn.append(far);
    }
    btn.addEventListener('click', () => pickStop(p));
    li.append(btn);
    return li;
  }));
  mapView?.setPins(S.stopResults.map((p) => ({ ...p, label: p.name })), pickStop);
}

function closeStopsPanel() {
  S.stopsCtrl?.abort();
  mapView?.setPins([], pickStop);
}

function pickStop(place) {
  history.back();
  addStop(place);
}

// Keep stops in the order you'll reach them.
function addStop(place) {
  const route = tripRoute();
  const fromS = tripFromS();
  const where = route ? placeOnRoute(route, place, fromS) : null;
  const stop = {
    id: place.id,
    name: place.name,
    detail: place.detail || '',
    lat: place.lat,
    lng: place.lng,
    category: place.category || null,
    along: where ? where.along : Infinity,
  };
  S.stops.push(stop);
  S.stops.sort((a, b) => a.along - b.along);
  mapView?.setStopPins(S.stops);
  if (S.sim) {
    S.simPlan.stops.push(stop);
    S.simPlan.changed = true;
  }
  if (S.view === 'nav') {
    S.lastReroute = 0;
    reroute(S.fix, { added: true });
    saveTrip();
  } else {
    loadRoutes();
  }
}

/* ---------- Guidance ---------- */

function beginTrip({ simulate }) {
  if (!load('safetySeen', false)) {
    $('safety').hidden = false;
    S.pendingSimulate = simulate;
    $('safety-ok').focus();
    return;
  }
  voice.unlockVoice();
  S.route = S.routes[S.selected];
  startGuidance({ simulate });
}

function saveTrip() {
  if (S.sim) return;
  save('trip', { dest: S.dest, stops: S.stops, mode: S.mode, avoidTolls: S.avoidTolls, at: Date.now() });
}

function startGuidance({ simulate }) {
  S.guidance = new Guidance(S.route, { walking: S.mode === 'walk' });
  S.greeted = false;
  S.watch = new DriveWatch();
  S.moment = null;
  S.lines = new Map();
  S.preparedFor = null;
  $('arrival-quip').textContent = '';
  S.carDirty = true;
  motion.setRoute(S.route);
  startScene(S.route);
  S.lastState = null;
  S.lastTrimS = null;
  S.following = true;
  S.rerouting = false;
  S.rerouteFailed = false;
  S.rerouteGap = 12000;
  S.lastFixAt = Date.now();
  S.drivenKm = 0;
  S.tripKm = 0;
  S.tripStart = Date.now();
  S.lastDrivenS = null;
  S.rangeSpoken = 0;
  S.lastSignKey = null;
  S.cam = { ...(mapView ? mapView.camera() : { zoom: 16, pitch: 0 }), lane: 0 };
  S.poseStale = true;
  mapView?.setStart(null);
  mapView?.showRoutes([S.route], 0);
  mapView?.setStopPins(S.stops);

  replaceHistory('nav');
  show('nav');
  $('btn-recenter').hidden = true;
  $('sign-then').hidden = true;
  $('lanes').hidden = true;
  $('refill').hidden = true;
  $('nav-strip').dataset.key = '';
  renderStrip($('nav-strip'), S.route, 0, true);
  clearEndArmed();
  renderChips();
  acquireWake();

  if (simulate) {
    S.realFix = S.fix;
    S.simStops = [...S.stops];
    // Ending a simulated drive comes back to this plan, ready to change or drive.
    S.simPlan = { dest: S.dest, start: S.start, stops: [...S.stops], routes: S.routes, selected: S.selected, changed: false };
    S.sim = new SimulatedDrive(S.route, receiveFix, { factor: S.settings.simSpeed });
    renderSimPanel();
    S.sim.start();
    remove('trip');
  } else {
    S.simPlan = null;
    renderSimPanel();
    saveTrip();
    if (S.fix) onNavFix({ ...S.fix, time: Date.now() }, performance.now());
  }
}

function onNavFix(fix, now) {
  const st = S.guidance.update(fix);
  S.lastState = st;

  const speed = fix.motionSpeed ?? fix.speed ?? 0;
  if (st.onRoute) motion.onRoute(st.s, speed, now);
  else motion.offRoute(fix.lng, fix.lat, fix.heading, speed, now);

  if (S.lastDrivenS != null && st.s > S.lastDrivenS) {
    const km = (st.s - S.lastDrivenS) / 1000;
    S.drivenKm += km;
    S.tripKm += km;
  }
  S.lastDrivenS = st.s;

  renderSign(st);
  renderEta(st);
  renderSpeed(fix, st);
  updateScene(st, fix);
  renderNavRange(st);
  keepWeatherFresh(st);
  renderChips();
  renderStrip($('nav-strip'), S.route, st.s, true);
  if (S.overlay === 'hudmode') renderHud(st, fix);

  // Two things due at once, like a stop and the next turn, are said as one line.
  S.gathering = [];
  for (const p of st.prompts) say(p);
  flushSpeech();
  if (!st.prompts.length) sayWeather(st);
  watchDrive(fix, st);
  prepareAhead(st, fix);
  if (st.stopReached != null) onStopReached();

  if (st.arrived) { finishTrip(); return; }
  if (st.offRoute) reroute(fix);
  else if (S.rerouteFailed) { S.rerouteFailed = false; S.rerouteGap = 12000; renderChips(); }
}

function say(prompt) {
  // Too quick to talk over, except to say you've arrived.
  if (S.sim && S.sim.factor >= SIM_FAST && prompt.kind !== 'arrive') return;
  if (S.settings.voiceLevel === 'turns' && !TURNS_ONLY.has(prompt.kind)) return;
  const lang = getLang();
  const who = S.settings.voiceCharacter;
  const base = speech(prompt, S.route.maneuvers, lang);
  if (!base) return;
  if (prompt.kind === 'arrive') {
    const quip = pick(who, 'arrive', lang);
    $('arrival-quip').textContent = plainSpeech(quip);
    speakText(quip ? `${base} ${quip}` : base, { wait: voice.WAIT_JOKE_MS });
    return;
  }
  let text = lineFor(prompt.kind, prompt.index, base);
  let wait = prompt.kind === 'now' ? voice.WAIT_TURN_MS : voice.WAIT_NORMAL_MS;
  // Once, at the start of a trip, and the instruction still follows at once.
  if (prompt.kind === 'intro' && !S.greeted) {
    S.greeted = true;
    const hello = pick(who, 'start', lang);
    if (hello) text = `${hello} [plain]${text}`;
    wait = voice.WAIT_GREETING_MS;
  }
  speakText(text, { wait });
}

// The same words whether they were fetched early or are said on the spot.
function lineFor(kind, index, base) {
  const who = S.settings.voiceCharacter;
  const key = `${who}|${kind}|${index}|${base}`;
  S.lines ??= new Map();
  if (!S.lines.has(key)) S.lines.set(key, dress(who, kind, base, getLang()));
  return S.lines.get(key);
}

// Directions to come, fetched while there's time so they're on the phone when needed.
function prepareAhead(st, fix) {
  if (voice.humanVoice() !== 'on' || S.settings.muted || S.simScrub || (S.sim && S.sim.factor >= SIM_FAST)) return;
  const mark = `${S.route.id}:${st.nextIndex}:${S.settings.voiceCharacter}`;
  if (S.preparedFor === mark) return;
  S.preparedFor = mark;
  const lang = getLang();
  for (const prompt of S.guidance.upcoming(fix.speed)) {
    if (S.settings.voiceLevel === 'turns' && !TURNS_ONLY.has(prompt.kind)) continue;
    const base = speech(prompt, S.route.maneuvers, lang);
    if (base) voice.prepare(lineFor(prompt.kind, prompt.index, base));
  }
}

function flushSpeech() {
  const lines = S.gathering;
  S.gathering = null;
  if (!lines?.length) return;
  speakText(lines.map((l) => l.text).join(' [plain]'), { wait: Math.min(...lines.map((l) => l.options?.wait ?? voice.WAIT_NORMAL_MS)) });
}

function speakText(text, options) {
  if (S.simScrub) return;
  if (S.gathering) {
    S.gathering.push({ text, options });
    return;
  }
  voice.speak(text, options);
  $('speak-live').textContent = plainSpeech(text);
  if (S.fixTime != null) S.watch?.heard(S.fixTime);
}

/* ---------- What a character makes of the drive ---------- */

const SPEED_MOMENT = /^overspeed/;

function watchDrive(fix, st) {
  S.fixTime = fix.time;
  if (!S.watch || S.mode === 'walk' || S.simScrub) return;
  const limit = currentLimit(st);
  const road = S.route.maneuvers[st.currentIndex];
  const roadKmh = limit ?? (road?.time > 0 ? (road.length / road.time) * 3600 : null);
  const moments = S.watch.update({
    time: fix.time,
    kmh: fix.speed == null ? null : fix.speed * 3.6,
    limit,
    roadKmh,
    nearTurn: st.distanceToNext < 120,
    nearEnd: st.remainingDistance < 300,
    clearAhead: st.distanceToNext,
  });
  for (const key of moments) {
    // A word about speed matters more than a remark about the view.
    if (!S.moment || SPEED_MOMENT.test(key) || !SPEED_MOMENT.test(S.moment.key)) S.moment = { key, time: fix.time, limit };
  }
  sayMoment(st, fix);
}

function sayMoment(st, fix) {
  const m = S.moment;
  if (!m) return;
  if (fix.time - m.time > MOMENT_KEEP_MS || S.settings.voiceLevel !== 'full' || (S.sim && S.sim.factor >= SIM_FAST)) {
    S.moment = null;
    return;
  }
  // Directions come first. A remark waits until nothing is being said.
  if (st.prompts.length || st.arrived || st.distanceToNext < 60 || voice.busy()) return;
  S.moment = null;
  const text = momentLine(m.key, m.limit);
  if (text) speakText(text, { wait: voice.WAIT_JOKE_MS });
}

function momentLine(key, limit) {
  const who = S.settings.voiceCharacter;
  const lang = getLang();
  if (SPEED_MOMENT.test(key)) return dress(who, key, t('overspeedSay', { limit }), lang, { vars: { limit } });
  return dress(who, key, key === 'longDrive' ? t('restSay') : '', lang);
}

function onStopReached() {
  const stop = S.stops.shift();
  mapView?.setStopPins(S.stops);
  saveTrip();
  if (stop && (stop.category === 'fuel' || stop.category === 'ev') && vehicle()?.range) {
    $('refill-text').textContent = t(stop.category === 'ev' ? 'refillAskEv' : 'refillAskFuel');
    $('refill').hidden = false;
  }
}

function renderSign(st) {
  const next = st.next;
  const d = describe(next, getLang());
  const sign = $('sign');
  // Green on expressways, blue on every other road, as on the real signs.
  sign.classList.toggle('blue', !(next.highway || next.toll));
  const key = `${st.nextIndex}:${getLang()}:${S.route.id}`;
  if (S.lastSignKey !== key) {
    S.lastSignKey = key;
    $('sign-icon').innerHTML = turnIcon(next);
    $('sign-action').textContent = d.action;
    $('sign-road').textContent = d.road;
    $('sign-ref').textContent = d.ref;
    $('sign-ref').hidden = !d.ref;
    $('sign-toward').textContent = d.toward ? `${getLang() === 'ms' ? 'Menuju' : 'Towards'} ${d.toward}` : '';
    $('sign-toward').hidden = !d.toward;
    sign.classList.remove('swap');
    void sign.offsetWidth;
    sign.classList.add('swap');
  }
  $('sign-distance').textContent = fmtDistance(st.distanceToNext);

  const then = $('sign-then');
  then.hidden = !st.then;
  if (st.then) $('then-icon').innerHTML = turnIcon(st.then);

  renderLanes(st);
}

function renderLanes(st) {
  const lanes = laneView(st.next.lanes);
  const range = st.next.highway || st.next.toll ? LANE_RANGE_HIGHWAY : LANE_RANGE_ROAD;
  const box = $('lanes');
  const showLanes = lanes && st.distanceToNext <= range;
  box.hidden = !showLanes;
  if (!showLanes) { box.dataset.key = ''; return; }
  const key = JSON.stringify(lanes);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren(...lanes.map((l) => {
    const el = document.createElement('div');
    el.className = `lane ${l.state}`;
    el.innerHTML = laneIcon(l.direction, l.others);
    return el;
  }));
}

function renderEta(st) {
  const lang = getLang();
  const clock = fmtClock(new Date(Date.now() + st.remainingTime * 1000), lang);
  $('eta-clock').textContent = fmtDuration(st.remainingTime, lang);
  $('eta-rest').textContent = t('arrivalIn', { distance: fmtDistance(st.remainingDistance), clock });
}

function currentLimit(st) {
  if (S.mode === 'walk' || !S.settings.speedLimit || !st.onRoute) return null;
  return limitAt(S.laneFetch?.limits, st.s);
}

function renderSpeed(fix, st) {
  const known = fix.speed != null && S.mode !== 'walk';
  $('speed').hidden = !known;
  if (known) $('speed-value').textContent = String(Math.round(fix.speed * 3.6));

  const limit = currentLimit(st);
  const sign = $('speed-limit');
  sign.hidden = !limit;
  if (limit) {
    sign.textContent = String(limit);
    sign.setAttribute('aria-label', t('limitAria', { limit }));
  }
  const over = known && limit && fix.speed * 3.6 > limit + OVER_BY_KMH;
  $('speed').classList.toggle('is-over', !!over);
}

function renderNavRange(st) {
  const v = vehicle();
  const left = v ? rangeLeft(v, S.drivenKm) : null;
  const pill = $('nav-range');
  pill.hidden = left == null;
  S.rangeWarning = null;
  if (left == null) return;
  const warning = rangeWarning(v, S.drivenKm, st.remainingDistance / 1000);
  S.rangeWarning = warning;
  pill.classList.toggle('is-low', !!warning);
  pill.innerHTML = v.kind === 'ev' ? UI.ev : UI.fuel;
  pill.append(kmText(left));
  if (warning) {
    const level = warning.urgent ? 2 : 1;
    if (S.rangeSpoken < level) {
      S.rangeSpoken = level;
      const km = sayDistance(warning.left * 1000, getLang());
      speakText(dress(S.settings.voiceCharacter, 'fuel', t(v.kind === 'ev' ? 'rangeSayEv' : 'rangeSayFuel', { km }), getLang()));
    }
  }
}

function renderChips() {
  const chips = [];
  if (S.sim) chips.push({ text: t('sim'), quiet: true });
  if (S.rerouting) chips.push({ text: t('rerouting') });
  else if (S.rerouteFailed) chips.push({ text: t('rerouteFail') });
  if (!S.sim) {
    if (S.gpsDenied) chips.push({ text: t('gpsDenied') });
    else if (Date.now() - S.lastFixAt > ((S.fix?.speed ?? 0) > 2 ? NO_GPS_MOVING : NO_GPS_STILL)) chips.push({ text: t('noGps') });
    else if (S.lastState?.weak) chips.push({ text: t('weakGps') });
  }
  if (S.rangeWarning) {
    const v = vehicle();
    const ev = v?.kind === 'ev';
    chips.push({
      text: t(ev ? 'rangeChipEv' : 'rangeChipFuel', { km: kmText(S.rangeWarning.left) }),
      action: () => openStops(ev ? 'ev' : 'fuel'),
    });
  }
  const rain = S.lastState ? rainAhead(S.lastState.s) : null;
  if (rain && rain.ahead <= RAIN_CHIP_M) {
    chips.push({ text: t(`${rain.kind}Chip`, { distance: fmtDistance(Math.max(rain.ahead, 100)) }), action: openWeather });
  }
  if (S.weather?.warnings?.length) chips.push({ text: t('warningsTitle'), quiet: true, action: openWeather });
  const p = S.settings.solat ? closePrayer(prayers.data, Date.now()) : null;
  if (p) chips.push({ text: `${prayerText(p)}. ${t('findSurau')}`, quiet: true, action: () => openStops('surau') });

  const key = chips.map((c) => c.text).join('|');
  if ($('chips').dataset.key === key) return;
  $('chips').dataset.key = key;
  $('chips').replaceChildren(...chips.map((c) => {
    const el = document.createElement(c.action ? 'button' : 'span');
    if (c.action) { el.type = 'button'; el.addEventListener('click', c.action); }
    el.className = `chip${c.quiet ? ' chip-quiet' : ''}`;
    el.textContent = c.text;
    return el;
  }));
}

async function reroute(fix, { added = false } = {}) {
  if (S.rerouting || !fix) return;
  const now = Date.now();
  if (now - S.lastReroute < S.rerouteGap) return;
  S.lastReroute = now;
  S.rerouting = true;
  const before = S.lastState ? S.lastState.remainingTime : null;
  if (!S.rerouteFailed && !added) speakText(dress(S.settings.voiceCharacter, 'reroute', t('rerouteSay'), getLang()));
  renderChips();
  try {
    const moving = (fix.speed ?? 0) > 3;
    const [route] = await fetchRoutes({
      from: fix,
      to: S.dest,
      stops: S.stops,
      mode: S.mode,
      avoidTolls: S.avoidTolls,
      heading: moving ? fix.heading : null,
    });
    if (S.view !== 'nav') return;
    S.route = route;
    S.guidance = new Guidance(route, { walking: S.mode === 'walk' });
    motion.setRoute(route);
    startScene(route);
    if (S.sim) {
      S.sim.setRoute(route);
      S.simStops = [...S.stops];
    }
    S.lastDrivenS = null;
    S.lastTrimS = null;
    S.lastSignKey = null;
    S.rerouteFailed = false;
    S.rerouteGap = 12000;
    mapView?.showRoutes([route], 0);
    S.rerouting = false;
    $('nav-strip').dataset.key = '';
    if (S.fix) onNavFix({ ...S.fix, time: Date.now() }, performance.now());
    if (added) {
      const extra = before != null ? Math.round((route.time - before) / 60) : 0;
      toast(extra >= 1 ? t('stopAddedMore', { time: fmtDuration(route.time - before, getLang()) }) : t('stopAdded'));
    }
  } catch {
    S.rerouteFailed = true;
    S.rerouteGap = Math.min(S.rerouteGap * 1.5, 45000);
    if (added) toast(t('stopFailed'));
  } finally {
    S.rerouting = false;
    if (S.view === 'nav') renderChips();
  }
}

function keepVehicleLevel() {
  const v = vehicle();
  if (!v || S.sim) return;
  v.level = levelAfter(v, S.drivenKm);
  saveVehicles();
  renderRangePill();
}

// The trip's over one way or another: put everything back.
function stopGuidance() {
  keepVehicleLevel();
  leaveFullscreen();
  S.weatherSaid = null;
  if (S.sim) {
    S.sim.stop();
    S.sim = null;
    S.simScrub = false;
    renderSimPanel();
    // A simulated drive must not leave you standing at its pretend finish.
    S.fix = S.realFix || null;
  }
  motion.clearRoute();
  if (S.fix) motion.offRoute(S.fix.lng, S.fix.lat, S.fix.heading, 0, performance.now());
  S.guidance = null;
  S.route = null;
  S.scene = null;
  mapView?.setLanes(NO_LANES);
  if (S.cam) S.cam.lane = 0;
  S.lastState = null;
  S.rangeWarning = null;
  S.stops = [];
  remove('trip');
  releaseWake();
  clearTimeout(S.followTimer);
  clearEndArmed();
  window.speechSynthesis?.cancel();
}

function arrivalStats() {
  const lang = getLang();
  const parts = [];
  const distance = fmtDistance(S.tripKm * 1000);
  parts.push(S.sim ? distance : t('statsDrive', { distance, time: fmtDuration((Date.now() - S.tripStart) / 1000, lang) }));
  const v = vehicle();
  if (v?.consumption) {
    const plan = tripPlan(v, S.tripKm);
    parts.push(t('statsUsed', { amount: amountText(plan.used), unit: plan.unit }));
  }
  return parts.join(', ');
}

function finishTrip() {
  const place = S.dest;
  const onFoot = S.mode === 'walk';
  const simulated = !!S.sim;
  $('arrival-stats').textContent = arrivalStats();
  stopGuidance();
  mapView?.clearRoutes();
  mapView?.setDestination(null);
  mapView?.setStopPins([]);
  mapView?.flat();
  S.dest = null;
  S.start = null;
  $('arrival-place').textContent = place ? place.name : '';
  S.arrivedAt = place;
  // Where the road ends isn't always where the door is.
  $('arrival-walk').hidden = onFoot || simulated || !place;
  S.mall = mallFor(place);
  $('arrival-mall').hidden = !S.mall;
  if (S.mall) $('arrival-mall').textContent = t('mallOpen', { name: S.mall.name });
  replaceHistory('arrival');
  S.overlay = null;
  show('arrival');
  $('arrival-done').focus();
}

function endTrip() {
  if (S.sim) {
    stopGuidance();
    backToPlan();
    return;
  }
  stopGuidance();
  backOnWheels();
  S.dest = null;
  S.start = null;
  S.routes = [];
  mapView?.clearRoutes();
  mapView?.setDestination(null);
  mapView?.setStopPins([]);
  mapView?.flat();
  replaceHistory('idle');
  S.overlay = null;
  show('idle');
  if (S.fix) mapView?.centerOn(S.fix.lng, S.fix.lat);
}

// After a simulated drive: the plan it came from, just as it was.
function backToPlan() {
  const plan = S.simPlan;
  S.simPlan = null;
  S.dest = plan.dest;
  S.start = plan.start;
  S.stops = plan.stops;
  S.routes = plan.routes;
  S.selected = plan.selected;
  S.overlay = null;
  mapView?.level();
  mapView?.setDestination(S.dest);
  mapView?.setStart(S.start);
  mapView?.setStopPins(S.stops);
  $('dest-name').textContent = S.dest.name;
  $('dest-detail').textContent = S.dest.detail || '';
  $('dest-detail').hidden = !S.dest.detail;
  renderEnds();
  replaceHistory('preview');
  show('preview');
  if (plan.changed) { loadRoutes(); return; }
  S.routeState = 'ready';
  renderRoutes();
  mapView?.showRoutes(S.routes, S.selected);
  fitRoutes();
  // A simulated walk ended here too, so you're back in the car.
  backOnWheels();
}

/* ---------- Walking to the door ---------- */

function walkToDoor() {
  const place = S.arrivedAt;
  if (!place) return;
  S.returnMode = S.mode;
  S.mode = 'walk';
  S.carDirty = true;
  S.startWhenRouted = true;
  S.stops = [];
  replaceHistory('preview');
  S.overlay = null;
  openPreview(place);
}

// Walking was only for this last bit. Next time, you're back in the car.
function backOnWheels() {
  if (S.mode !== 'walk' || !S.returnMode) return;
  S.mode = S.returnMode;
  S.returnMode = null;
  S.carDirty = true;
  renderSegments();
  renderRangePill();
}

/* ---------- Inside a mall ---------- */

function renderPlanMall() {
  const mall = mallFor(S.dest);
  S.mall = mall;
  $('plan-mall').hidden = !mall;
  if (!mall) return;
  $('plan-mall-title').textContent = t('mallOpen', { name: mall.name });
  $('plan-mall-detail').textContent = t('mallDetail');
}

function openMall() {
  const mall = S.mall;
  if (!mall) return;
  $('mall-title').textContent = mall.name;
  $('mall-map').href = mall.map;
  $('mall-list').href = mall.directory;
  $('mall-search').value = '';
  $('mall-results').replaceChildren();
  openOverlay('mall');
  loadShops(mall);
}

async function loadShops(mall) {
  const status = $('mall-status');
  const box = $('mall-search');
  box.hidden = true;
  if (!CONFIG.server) {
    status.textContent = t('mallNoServer');
    return;
  }
  S.mallCtrl?.abort();
  const ctrl = new AbortController();
  S.mallCtrl = ctrl;
  status.textContent = t('mallLoading');
  try {
    S.shops = await fetchShops(mall, { signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    status.textContent = '';
    box.hidden = false;
  } catch {
    if (!ctrl.signal.aborted) status.textContent = t('mallFailed');
  }
}

function renderShops() {
  const q = $('mall-search').value.trim();
  const found = searchShops(S.shops || [], q);
  $('mall-status').textContent = q && !found.length ? t('mallNone', { q }) : '';
  $('mall-results').replaceChildren(...found.map((shop) => {
    const li = document.createElement('li');
    li.className = 'shop';
    const name = document.createElement('strong');
    name.textContent = shop.name;
    const lot = document.createElement('span');
    lot.textContent = shop.lot;
    li.append(name, lot);
    return li;
  }));
}

/* ---------- Rain and floods ---------- */

async function loadWeather(route, fromS = 0) {
  if (!S.settings.weather || S.mode === 'walk') {
    S.weather = null;
    return;
  }
  S.weatherCtrl?.abort();
  const ctrl = new AbortController();
  S.weatherCtrl = ctrl;
  S.weather = { routeId: route.id, at: Date.now(), pending: true, warnings: [] };
  renderPlanWeather(route);
  try {
    const result = await checkRouteWeather(route, fromS, { signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    S.weather = { routeId: route.id, at: Date.now(), ...result };
  } catch {
    if (ctrl.signal.aborted) return;
    S.weather = { routeId: route.id, at: Date.now(), rain: null, rainFailed: true, warnings: [], warningsFailed: true };
  }
  renderPlanWeather(route);
  if (S.overlay === 'weather') renderWeatherSheet();
}

function keepWeatherFresh(st) {
  if (!S.settings.weather || S.mode === 'walk' || S.simScrub) return;
  const stale = S.weather?.routeId !== S.route.id || Date.now() - S.weather.at > WEATHER_REFRESH_MS;
  if (stale) loadWeather(S.route, st.s);
}

// The next rain still ahead of where you are now.
function rainAhead(s) {
  const first = S.weather?.rain?.first;
  if (!first || first.s < s - 1000) return null;
  return { ...first, ahead: Math.max(0, first.s - s) };
}

function rainLine(rain, ahead) {
  if (ahead < 1000) return t(`${rain.kind}Here`);
  return t(`${rain.kind}Ahead`, { distance: fmtDistance(ahead), clock: fmtClock(new Date(rain.at), getLang()) });
}

function renderPlanWeather(route) {
  const row = $('plan-weather');
  const w = S.weather;
  row.hidden = !S.settings.weather || S.mode === 'walk';
  if (row.hidden) return;
  if (route && w?.routeId !== route.id) {
    loadWeather(route);
    return;
  }
  const title = $('plan-weather-title');
  const detail = $('plan-weather-detail');
  row.classList.toggle('is-wet', !!(w?.rain?.first || w?.warnings?.length));
  if (!w || w.pending) {
    title.textContent = t('weatherChecking');
    detail.textContent = '';
    return;
  }
  if (w.rain?.first) title.textContent = rainLine(w.rain.first, w.rain.first.s);
  else title.textContent = t(w.rainFailed ? 'weatherFailed' : 'weatherClear');
  const n = w.warnings?.length || 0;
  detail.textContent = n === 1 ? t('warningsOne') : n > 1 ? t('warningsMany', { n }) : '';
}

function openWeather() {
  renderWeatherSheet();
  openOverlay('weather');
}

function renderWeatherSheet() {
  const w = S.weather;
  const lang = getLang();
  const s = S.lastState?.s ?? 0;
  const rain = $('weather-rain');
  if (!w || w.pending) rain.textContent = t('weatherChecking');
  else if (w.rainFailed) rain.textContent = t('weatherFailed');
  else if (!w.rain?.first) rain.textContent = t('weatherClear');
  else {
    const first = w.rain.first;
    rain.textContent = rainLine(first, Math.max(0, first.s - s));
    const worst = w.rain.worst;
    if (worst && worst.kind !== first.kind) {
      const more = document.createElement('span');
      more.textContent = t('worstLater', { what: rainLine(worst, Math.max(0, worst.s - s)) });
      rain.append(more);
    }
  }
  const box = $('weather-warnings');
  const parts = [];
  if (w?.warnings?.length) {
    const head = document.createElement('p');
    head.className = 'warnings-title';
    head.textContent = t('warningsTitle');
    parts.push(head);
    for (const item of w.warnings) {
      const card = document.createElement('div');
      card.className = `warning${item.danger ? ' is-danger' : ''}`;
      const strong = document.createElement('strong');
      strong.textContent = item.heading[lang] || item.heading.en;
      const text = document.createElement('p');
      text.textContent = item.text[lang] || item.text.en;
      card.append(strong, text);
      if (item.until) {
        const until = document.createElement('p');
        until.textContent = t('warningUntil', { when: fmtClock(new Date(item.until), lang) });
        card.append(until);
      }
      parts.push(card);
    }
    if (w.warnings.some((x) => x.flood)) {
      const flood = document.createElement('p');
      flood.className = 'warnings-title';
      flood.textContent = t('floodRisk');
      parts.push(flood);
    }
  } else if (w?.warningsFailed) {
    const failed = document.createElement('p');
    failed.className = 'tip';
    failed.textContent = t('warningsFailed');
    parts.push(failed);
  }
  box.replaceChildren(...parts);
}

function sayWeather(st) {
  if (S.settings.voiceLevel !== 'full' || S.simScrub || (S.sim && S.sim.factor >= SIM_FAST)) return;
  const rain = rainAhead(st.s);
  if (!rain || rain.ahead > RAIN_SAY_M || st.distanceToNext < 400) return;
  const key = `${S.route.id}:${rain.kind}`;
  if (S.weatherSaid === key) return;
  S.weatherSaid = key;
  const lang = getLang();
  const text = t(`${rain.kind}Say`, { distance: sayDistance(Math.max(rain.ahead, 200), lang) });
  speakText(dress(S.settings.voiceCharacter, 'rain', text, lang), { wait: voice.WAIT_JOKE_MS });
}

/* ---------- Who's talking ---------- */

function renderCharacters() {
  const lang = getLang();
  $('voice-chars').replaceChildren(...CHARACTER_IDS.map((id) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'char-opt';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(S.settings.voiceCharacter === id));
    const name = document.createElement('strong');
    name.textContent = characterName(id, lang);
    const about = document.createElement('span');
    about.textContent = characterAbout(id, lang);
    const tag = document.createElement('small');
    tag.textContent = characterTag(id, lang);
    btn.append(name, about, tag);
    btn.addEventListener('click', () => chooseCharacter(id));
    li.append(btn);
    return li;
  }));
}

function chooseCharacter(id) {
  setSetting('voiceCharacter', id);
  voice.setVoiceStyle(characterVoice(id));
  voice.setVoiceCharacter(id);
  renderCharacters();
  renderVoiceStatus();
  trySample();
}

// The first time a character speaks, their voice is being made, which takes a while.
// Afterwards it says if that wasn't a human voice, and why, so it's never a mystery.
function hearNow(line) {
  voice.unlockVoice();
  const hint = $('voice-wait');
  hint.textContent = voice.humanVoice() === 'on' ? t('voicePreparing') : '';
  voice.speak(line, { evenIfMuted: true, wait: voice.WAIT_SAMPLE_MS, onStart: () => { hint.textContent = ''; } }).then((heard) => {
    if (heard !== 'phone' || !CONFIG.server) return;
    const why = voice.voiceProblem() || (voice.humanVoice() === 'on' ? t('voiceTooSlow') : t('voiceNotConnected'));
    hint.textContent = t('voiceHeardPhone', { why });
    renderVoiceStatus();
  });
}

// Runs one real line through the server, and reports on it in full.
async function checkVoiceNow() {
  const box = $('voice-report');
  const check = $('voice-check');
  check.disabled = true;
  box.replaceChildren(t('voiceChecking'));
  const { kind, report } = await voice.testHumanVoice(S.settings.voiceCharacter, getLang());
  check.disabled = false;
  const summary = document.createElement('p');
  summary.className = kind === 'works' ? 'voice-good' : 'voice-bad';
  summary.textContent = t(`voiceReport_${kind.replace('-', '_')}`);
  const parts = [summary];
  if (report) {
    const details = document.createElement('pre');
    details.className = 'voice-trace';
    const steps = (report.steps || []).map((n) => [n.step, n.status, n.ms != null ? `${n.ms}ms` : '', n.voice, n.why].filter((x) => x != null && x !== '').join(' '));
    details.textContent = [`${report.engine ?? '-'} ${report.who ?? ''} ${report.lang ?? ''} ${report.where ?? ''} ${report.problem ?? ''} ${report.status ?? ''}`.replace(/\s+/g, ' ').trim(), ...steps].join('\n');
    parts.push(details);
  }
  box.replaceChildren(...parts);
  renderVoiceStatus();
  if (kind === 'works') trySample();
}

function trySample() {
  hearNow(sample(S.settings.voiceCharacter, getLang(), t('voiceSample')));
}

// Hear what a character would say, without having to break the speed limit to find out.
function tryMoment(key) {
  const who = S.settings.voiceCharacter;
  const lang = getLang();
  const limit = 90;
  let line;
  if (key === 'rain') line = dress(who, 'rain', t('rainSay', { distance: sayDistance(2000, lang) }), lang);
  else if (key === 'arrive') line = dress(who, 'arrive', t('arriveSample'), lang);
  else line = momentLine(key, limit);
  hearNow(line);
}

function setVoiceLevel(level) {
  setSetting('voiceLevel', level);
  renderSegments();
}

/* ---------- HUD: read in the windscreen ---------- */

function openHud() {
  openOverlay('hudmode');
  $('hudmode').classList.toggle('is-mirror', S.settings.hudMirror);
  document.documentElement.requestFullscreen?.()?.catch?.(() => {});
  S.hudKey = null;
  showHudControls();
  if (S.lastState && S.fix) renderHud(S.lastState, S.fix);
}

function leaveFullscreen() {
  clearTimeout(S.hudTimer);
  if (document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {});
}

function showHudControls() {
  $('hm-controls').classList.remove('is-hidden');
  clearTimeout(S.hudTimer);
  S.hudTimer = setTimeout(() => $('hm-controls').classList.add('is-hidden'), HUD_CONTROLS_MS);
}

function renderHudMirror() {
  $('hm-mirror').textContent = t(S.settings.hudMirror ? 'hudMirrorOn' : 'hudMirrorOff');
  $('hudmode').classList.toggle('is-mirror', S.settings.hudMirror);
}

function renderHud(st, fix) {
  const next = st.next;
  const key = `${st.nextIndex}:${S.route.id}:${getLang()}`;
  if (S.hudKey !== key) {
    S.hudKey = key;
    $('hm-arrow').innerHTML = turnIcon(next);
    const d = describe(next, getLang());
    $('hm-road').textContent = d.road || d.ref || d.action;
  }
  $('hm-distance').textContent = fmtDistance(st.distanceToNext);
  $('hm-bar-fill').style.transform = `scaleX(${clamp(1 - st.distanceToNext / HUD_BAR_M, 0, 1)})`;
  const known = fix.speed != null;
  const kmh = known ? Math.round(fix.speed * 3.6) : 0;
  $('hm-speed').textContent = known ? String(kmh) : '–';
  const limit = currentLimit(st);
  $('hm-limit').hidden = !limit;
  if (limit) $('hm-limit').textContent = String(limit);
  $('hm-speed').parentElement.classList.toggle('is-over', !!(limit && kmh > limit + OVER_BY_KMH));
  const lang = getLang();
  $('hm-eta').replaceChildren(fmtDuration(st.remainingTime, lang));
  const rest = document.createElement('span');
  rest.textContent = fmtClock(new Date(Date.now() + st.remainingTime * 1000), lang);
  $('hm-eta').append(rest);
}

/* ---------- Controlling a simulated drive ---------- */

function renderSimPanel() {
  const on = !!S.sim;
  $('sim-panel').hidden = !on;
  $('sim-seek').hidden = !on;
  $('nav-bar').classList.toggle('is-sim', on);
  if (!on) return;
  label($('sim-play'), t(S.sim.paused ? 'simPlay' : 'simPause'), S.sim.paused ? UI.play : UI.pause);
  $('sim-speeds').replaceChildren(...SIM_SPEEDS.map((factor) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(S.sim.factor === factor));
    b.textContent = `${factor}×`;
    b.addEventListener('click', () => setSimSpeed(factor));
    return b;
  }));
}

function setSimSpeed(factor) {
  if (!S.sim) return;
  S.sim.setFactor(factor);
  setSetting('simSpeed', factor);
  renderSimPanel();
}

function toggleSimPause() {
  if (!S.sim) return;
  if (S.sim.paused) S.sim.resume();
  else S.sim.pause(motion.s ?? S.sim.s);
  renderSimPanel();
}

// Put the simulated car anywhere on the route, without it counting as a detour.
function simSeek(target) {
  const route = S.route;
  if (!S.sim || !route || !S.guidance) return;
  const s = clamp(target, 0, Math.max(0, route.length - SIM_END_GAP_M));
  S.guidance.jumpTo(s);
  motion.jump(s, performance.now());
  // The car would have used this much by here, whichever way it got here.
  S.drivenKm = s / 1000;
  S.tripKm = s / 1000;
  S.lastDrivenS = s;
  S.rangeSpoken = 0;
  // Stops before here are behind you, and those after it are still to come.
  const passed = route.maneuvers.filter((m) => m.isStop && s >= m.beginDist - 25).length;
  S.stops = S.simStops.slice(passed);
  mapView?.setStopPins(S.stops);
  $('refill').hidden = true;
  S.following = true;
  S.poseStale = true;
  S.lastTrimS = null;
  S.lastSignKey = null;
  $('btn-recenter').hidden = true;
  clearTimeout(S.followTimer);
  $('nav-strip').dataset.key = '';
  // Lane counts may not have been fetched for the stretch you've landed on.
  if (!S.simScrub) S.laneFetch.until = 0;
  S.sim.seek(s);
  mapView?.setRemaining(sliceFrom(route.coords, route.cum, s));
  setStripProgress($('nav-strip'), s / route.length);
  $('sim-seek').setAttribute('aria-valuenow', String(Math.round((s / route.length) * 100)));
}

function simNextTurn() {
  const st = S.lastState;
  if (!S.sim || !st) return;
  const list = S.route.maneuvers;
  let i = st.nextIndex;
  // Already just before this one: on to the one after.
  if (st.distanceToNext <= SIM_LEAD_M + 10 && i < list.length - 1) i++;
  const to = list[i].beginDist - SIM_LEAD_M;
  if (to > st.s) simSeek(to);
}

function openSteps() {
  if (!S.sim || !S.route) return;
  renderSteps();
  openOverlay('steps');
  $('steps-list').querySelector('.is-next')?.scrollIntoView({ block: 'center' });
}

function renderSteps() {
  const at = S.lastState?.s ?? 0;
  const next = S.lastState?.nextIndex;
  const lang = getLang();
  // The first is only "head off", which is already behind you or right here.
  $('steps-list').replaceChildren(...S.route.maneuvers.map((m, i) => {
    if (i === 0) return null;
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `place step${m.beginDist < at ? ' is-past' : ''}${i === next ? ' is-next' : ''}`;
    const icon = document.createElement('span');
    icon.className = 'step-icon';
    icon.innerHTML = turnIcon(m);
    const text = document.createElement('span');
    text.className = 'step-text';
    const d = describe(m, lang);
    const strong = document.createElement('strong');
    strong.textContent = d.road ? `${d.action} ${d.road}` : d.action;
    const where = document.createElement('span');
    where.textContent = t('stepAt', { distance: fmtDistance(m.beginDist) });
    text.append(strong, where);
    btn.append(icon, text);
    btn.addEventListener('click', () => {
      history.back();
      simSeek(m.beginDist - SIM_LEAD_M);
    });
    li.append(btn);
    return li;
  }).filter(Boolean));
}

function wireSimSeek() {
  const el = $('sim-seek');
  const at = (e) => {
    const r = $('nav-strip').getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1) * S.route.length;
  };
  let dragging = false, lastS = 0, lastMove = 0;
  el.addEventListener('pointerdown', (e) => {
    if (!S.sim) return;
    dragging = true;
    el.setPointerCapture?.(e.pointerId);
    S.sim.held = true;
    S.simScrub = true;
    lastS = at(e);
    simSeek(lastS);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging || !S.sim) return;
    lastS = at(e);
    const now = performance.now();
    if (now - lastMove < 60) return;
    lastMove = now;
    simSeek(lastS);
  });
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    if (!S.sim) return;
    S.sim.held = false;
    S.simScrub = false;
    simSeek(lastS);
  };
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);
  el.addEventListener('keydown', (e) => {
    if (!S.sim) return;
    const step = S.route.length / 50;
    const now = S.lastState?.s ?? 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') simSeek(now + step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') simSeek(now - step);
    else return;
    e.preventDefault();
  });
}

function clearEndArmed() {
  clearTimeout(S.endArmedTimer);
  S.endArmedTimer = null;
  $('btn-end').classList.remove('is-armed');
  $('btn-end').textContent = t('end');
}

function onEndTap() {
  // Two taps, so a bump on a mount can't end the trip.
  if (S.endArmedTimer) { endTrip(); return; }
  $('btn-end').classList.add('is-armed');
  $('btn-end').textContent = t('endConfirm');
  S.endArmedTimer = setTimeout(clearEndArmed, 3500);
}

/* ---------- Keeping the screen on ---------- */

async function acquireWake() {
  if (S.view !== 'nav') return;
  try {
    S.wake = await navigator.wakeLock.request('screen');
    S.wake.addEventListener('release', () => { S.wake = null; });
  } catch {
    if (!S.wakeWarned) { S.wakeWarned = true; toast(t('noWake'), 6000); }
  }
}

function releaseWake() {
  try { S.wake?.release(); } catch { /* already gone */ }
  S.wake = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    S.hiddenAt = Date.now();
    return;
  }
  if (S.settings.theme === 'auto') applyTheme();
  renderClock();
  renderPrayer();
  if (S.view !== 'nav') return;
  acquireWake();
  if (!S.sim) gps.restart();
  const away = Date.now() - S.hiddenAt;
  if (away > 5000 && S.guidance) {
    toast(t('resumed'));
    const p = S.guidance.repeat();
    if (p) say(p);
  }
});

/* ---------- Picking up an interrupted trip ---------- */

function offerResume() {
  const trip = load('trip', null);
  if (!trip || !trip.dest || Date.now() - trip.at > TRIP_MAX_AGE) {
    remove('trip');
    return;
  }
  $('resume-text').textContent = t('resumeAsk', { place: trip.dest.name });
  $('resume').hidden = false;
  S.resumeTrip = trip;
}

function resumeTrip() {
  const trip = S.resumeTrip;
  $('resume').hidden = true;
  S.mode = trip.mode;
  S.avoidTolls = trip.avoidTolls;
  S.stops = trip.stops || [];
  S.start = null;
  voice.unlockVoice();
  S.startWhenRouted = true;
  pushHistory('preview');
  openPreview(trip.dest);
}

/* ---------- Wiring ---------- */

function setSetting(key, value) {
  S.settings[key] = value;
  save('settings', S.settings);
}

function changeLanguage(lang) {
  setSetting('lang', lang);
  setLang(lang);
  voice.setVoiceLang(lang);
  applyStaticText();
  renderSegments();
  renderRoutes();
  S.lastSignKey = null;
  if (S.lastState) { renderSign(S.lastState); renderEta(S.lastState); }
  $('chips').dataset.key = '';
  renderChips();
}

function wire() {
  $('preview').addEventListener('animationend', updateBottomInset);
  $('where').addEventListener('click', openSearch);
  $('btn-settings').addEventListener('click', () => {
    openOverlay('settings');
    renderVoiceStatus();
    voice.checkHumanVoice().then(renderVoiceStatus);
    renderInstall();
    renderSegments();
    renderVehicleSummary();
  });
  $('settings-back').addEventListener('click', () => history.back());
  $('btn-locate').addEventListener('click', () => {
    S.wantCenter = true;
    gps.start();
    if (S.fix) { S.wantCenter = false; mapView?.centerOn(S.fix.lng, S.fix.lat); }
    if (S.gpsDenied) toast(t('gpsDenied'), 6000);
  });
  for (const id of ['btn-3d', 'btn-3d-idle']) $(id).addEventListener('click', toggle3D);

  $('hud-prayer').addEventListener('click', () => {
    openSearch();
    $('search-input').value = 'surau';
    onSearchInput();
  });
  $('hud-range').addEventListener('click', openVehicle);

  $('search-back').addEventListener('click', () => history.back());
  $('search-input').addEventListener('input', onSearchInput);
  $('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(S.searchTimer);
      const q = $('search-input').value.trim();
      if (q.length >= 2) runSearch(q);
    }
  });
  $('recents-clear').addEventListener('click', () => { remove('recents'); renderSearch([]); });

  $('preview-back').addEventListener('click', () => history.back());
  $('mode-car').addEventListener('click', () => setMode('car'));
  $('mode-moto').addEventListener('click', () => setMode('motorcycle'));
  $('mode-walk').addEventListener('click', () => setMode('walk'));
  $('search-paste').addEventListener('click', pasteLink);
  $('plan-weather').addEventListener('click', openWeather);
  $('plan-mall').addEventListener('click', openMall);
  $('weather-back').addEventListener('click', () => history.back());
  $('mall-back').addEventListener('click', () => history.back());
  $('mall-search').addEventListener('input', renderShops);
  $('arrival-walk').addEventListener('click', walkToDoor);
  $('arrival-mall').addEventListener('click', openMall);
  $('btn-hud').addEventListener('click', openHud);
  $('hudmode').addEventListener('click', showHudControls);
  $('hm-close').addEventListener('click', (e) => { e.stopPropagation(); history.back(); });
  $('hm-mirror').addEventListener('click', (e) => {
    e.stopPropagation();
    setSetting('hudMirror', !S.settings.hudMirror);
    renderHudMirror();
    showHudControls();
  });
  $('voice-full').addEventListener('click', () => setVoiceLevel('full'));
  $('voice-turns').addEventListener('click', () => setVoiceLevel('turns'));
  $('limit-on').addEventListener('change', (e) => setSetting('speedLimit', e.target.checked));
  $('weather-on').addEventListener('change', (e) => {
    setSetting('weather', e.target.checked);
    S.weather = null;
  });
  $('avoid-tolls').addEventListener('change', (e) => {
    S.avoidTolls = e.target.checked;
    save('avoidTolls', S.avoidTolls);
    loadRoutes();
  });
  // Away from a chosen start, the main button shows the route instead of driving it.
  $('start').addEventListener('click', () => beginTrip({ simulate: awayFromStart() }));
  $('try-sim').addEventListener('click', () => {
    if (awayFromStart()) driveViaStart();
    else beginTrip({ simulate: true });
  });
  $('from-row').addEventListener('click', () => openEndSearch('start'));
  $('to-row').addEventListener('click', () => openEndSearch('to'));
  $('swap-ends').addEventListener('click', swapEnds);
  $('quick-here').addEventListener('click', () => {
    history.back();
    setStart(null);
  });
  $('quick-map').addEventListener('click', openMapPick);
  $('pick-back').addEventListener('click', () => history.back());
  $('pick-use').addEventListener('click', useMapPick);
  $('sim-play').addEventListener('click', toggleSimPause);
  $('sim-next').addEventListener('click', simNextTurn);
  $('sim-list').addEventListener('click', openSteps);
  $('steps-back').addEventListener('click', () => history.back());
  wireSimSeek();

  $('add-stop').addEventListener('click', () => openStops());
  $('btn-add-stop').addEventListener('click', () => openStops());
  $('stops-back').addEventListener('click', () => history.back());
  $('stops-other').addEventListener('click', openStopSearch);
  $('plan-prayer').addEventListener('click', () => openStops('surau'));
  $('plan-fuel-edit').addEventListener('click', openVehicle);
  $('plan-level').addEventListener('input', (e) => {
    const v = vehicle();
    if (!v) return;
    v.level = Number(e.target.value);
    saveVehicles();
    renderPlan();
    renderRangePill();
  });

  $('set-vehicle-open').addEventListener('click', openVehicle);
  $('vehicle-back').addEventListener('click', () => history.back());

  $('safety-ok').addEventListener('click', () => {
    save('safetySeen', true);
    $('safety').hidden = true;
    beginTrip({ simulate: S.pendingSimulate });
  });

  $('sign').addEventListener('click', () => {
    const p = S.guidance?.repeat();
    if (p) say(p);
  });
  $('btn-mute').addEventListener('click', () => {
    const muted = !S.settings.muted;
    setSetting('muted', muted);
    voice.setMuted(muted);
    renderMute();
  });
  $('btn-recenter').addEventListener('click', () => {
    S.following = true;
    S.poseStale = true;
    $('btn-recenter').hidden = true;
    clearTimeout(S.followTimer);
  });
  $('btn-end').addEventListener('click', onEndTap);

  $('refill-yes').addEventListener('click', () => {
    const v = vehicle();
    if (v) {
      v.level = 100;
      S.drivenKm = 0;
      S.rangeSpoken = 0;
      if (!S.sim) saveVehicles();
    }
    $('refill').hidden = true;
    $('nav-strip').dataset.key = '';
  });
  $('refill-no').addEventListener('click', () => { $('refill').hidden = true; });

  $('arrival-done').addEventListener('click', () => {
    if (S.simPlan) { backToPlan(); return; }
    backOnWheels();
    replaceHistory('idle');
    show('idle');
  });

  $('resume-yes').addEventListener('click', resumeTrip);
  $('resume-no').addEventListener('click', () => { remove('trip'); $('resume').hidden = true; });

  $('lang-ms').addEventListener('click', () => changeLanguage('ms'));
  $('lang-en').addEventListener('click', () => changeLanguage('en'));
  $('voice-test').addEventListener('click', trySample);
  $('voice-check').addEventListener('click', checkVoiceNow);
  for (const b of document.querySelectorAll('#voice-try button')) b.addEventListener('click', () => tryMoment(b.dataset.moment));
  for (const theme of ['auto', 'day', 'night']) {
    $(`theme-${theme}`).addEventListener('click', () => {
      setSetting('theme', theme);
      applyTheme();
      renderSegments();
    });
  }
  $('solat-on').addEventListener('change', (e) => {
    setSetting('solat', e.target.checked);
    if (e.target.checked && S.fix) prayers.update(S.fix.lat, S.fix.lng);
    renderPrayer();
  });
  $('install-btn').addEventListener('click', async () => {
    const ev = S.installEvent;
    if (!ev) return;
    S.installEvent = null;
    ev.prompt();
    await ev.userChoice;
    renderInstall();
  });
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    S.installEvent = e;
    renderInstall();
  });
  addEventListener('resize', () => {
    updateBottomInset();
    S.poseStale = true;
    mapView?.resize();
  });
  $('map-retry').addEventListener('click', startMap);

  voice.onVoicesReady(renderVoiceStatus);
  setInterval(() => {
    if (S.settings.theme === 'auto') applyTheme();
    renderPrayer();
  }, 30000);
  setInterval(renderClock, 15000);
  setInterval(() => { if (S.view === 'nav' && !S.sim) renderChips(); }, 5000);
}

function openVehicle() {
  openOverlay('vehicle');
  vehicleUI.open();
}

function setMode(mode) {
  if (S.mode === mode) return;
  S.mode = mode;
  S.returnMode = null;
  // You won't want to open Pintu on foot next time just because you did today.
  if (mode !== 'walk') save('mode', mode);
  S.carDirty = true;
  renderSegments();
  renderRangePill();
  loadRoutes();
}

async function startMap() {
  $('map-problem').hidden = true;
  try {
    mapView = new MapView($('map'), {
      theme: currentTheme(),
      view3d: S.settings.view3d,
      onLongPress,
      onUserMove,
      onAltTap: (i) => selectRoute(i),
    });
    await mapView.init();
    mapView.setCarOn(S.settings.view3d);
  } catch {
    $('map-problem-text').textContent = t('mapFailed');
    $('map-problem').hidden = false;
  }
}

function onUserMove() {
  if (S.view !== 'nav') return;
  S.following = false;
  $('btn-recenter').hidden = false;
  clearTimeout(S.followTimer);
  // Back to following by itself, so a stray touch can't leave you off the map.
  S.followTimer = setTimeout(() => {
    if (S.view === 'nav') $('btn-recenter').click();
  }, 15000);
}

async function main() {
  setLang(S.settings.lang);
  voice.setVoiceLang(S.settings.lang);
  voice.setMuted(S.settings.muted);
  voice.setVoiceStyle(characterVoice(S.settings.voiceCharacter));
  voice.setVoiceCharacter(S.settings.voiceCharacter);
  voice.checkHumanVoice();
  applyTheme();
  applyStaticText();
  renderSegments();
  wire();
  replaceHistory('idle');
  show('idle');
  offerResume();
  startGpsIfAllowed();
  requestAnimationFrame(frame);
  await startMap();
  openIncoming();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main();
