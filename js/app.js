import { CONFIG } from './config.js';
import { fmtClock, fmtDistance, fmtDuration, sayDistance } from './format.js';
import { sliceFrom } from './geo.js';
import { Guidance } from './guidance.js';
import { getLang, setLang, t } from './i18n.js';
import { CATEGORY_ICONS, UI, doorSvg, laneIcon, turnIcon } from './icons.js';
import { describe, laneView, speech } from './instructions.js';
import { LaneScene, NO_LANES } from './lanes.js';
import { Gps, SimulatedDrive } from './location.js';
import { MapView } from './map.js';
import { Motion } from './motion.js';
import { findAlongRoute, placeOnRoute } from './places.js';
import { NAMES, PrayerTimes, closePrayer, prayerDuringTrip } from './prayer.js';
import { RouteError, distanceAfter, fetchLaneCounts, fetchRoutes, timeBetween } from './routing.js';
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

const S = {
  view: 'idle',
  overlay: null,
  fix: null,
  realFix: null,
  dest: null,
  stops: [],
  routes: [],
  selected: 0,
  routeState: 'idle',
  routeError: null,
  mode: load('mode', 'car'),
  avoidTolls: load('avoidTolls', false),
  settings: { lang: 'ms', theme: 'auto', muted: false, view3d: true, solat: true, ...load('settings', {}) },
  vehicles: load('vehicles', {}),
  looks: { ...DEFAULT_LOOKS, ...load('looks', {}) },
  scene: null,
  laneFetch: { routeId: null, until: 0, busy: false, retryAt: 0, failures: 0, counts: [] },
  route: null,
  guidance: null,
  sim: null,
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
  getLook: () => S.looks[S.mode],
  setLook: (look) => {
    S.looks[S.mode] = look;
    save('looks', S.looks);
    S.lastPose = null;
  },
  setVehicle: (v) => {
    if (v) S.vehicles[S.mode] = v;
    else delete S.vehicles[S.mode];
    saveVehicles();
    renderAfterVehicleChange();
  },
  getMode: () => S.mode,
  onDone: () => history.back(),
});

function vehicle() { return S.vehicles[S.mode] || null; }
function saveVehicles() { save('vehicles', S.vehicles); }

/* ---------- Words and icons ---------- */

function applyStaticText() {
  document.documentElement.lang = getLang();
  $('map').setAttribute('aria-label', t('mapLabel'));
  $('where-text').textContent = t('where');
  $('where-glyph').innerHTML = doorSvg('style="--knob:#00794A"');
  label($('btn-settings'), t('settings'), UI.settings);
  label($('btn-locate'), t('locate'), UI.locate);
  for (const id of ['search-back', 'preview-back', 'settings-back', 'vehicle-back']) label($(id), t('back'), UI.back);
  label($('stops-back'), t('back'), UI.close);
  $('search-input').placeholder = t('searchPlaceholder');
  $('search-input').setAttribute('aria-label', t('searchPlaceholder'));
  $('search-tip').textContent = t('searchTip');
  $('recents-title').textContent = t('recents');
  $('recents-clear').textContent = t('clear');
  $('mode-car').textContent = t('car');
  $('mode-moto').textContent = t('moto');
  $('avoid-tolls-label').textContent = t('avoidTolls');
  $('route-note').textContent = t('routeNote');
  $('start').textContent = t('start');
  $('try-sim').textContent = t('tryIt');
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
  $('voice-status').textContent = t(key);
  $('voice-test').hidden = key === 'voiceMissing';
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
  set('lang-ms', S.settings.lang === 'ms');
  set('lang-en', S.settings.lang === 'en');
  set('theme-auto', S.settings.theme === 'auto');
  set('theme-day', S.settings.theme === 'day');
  set('theme-night', S.settings.theme === 'night');
  $('avoid-tolls').checked = S.avoidTolls;
  $('solat-on').checked = S.settings.solat;
  // Motorcycles don't pay tolls in Malaysia, so the switch means nothing for them.
  $('toll-wrap').hidden = S.mode === 'motorcycle';
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
  $('search').hidden = !(view === 'search' || overlay === 'stopsearch');
  $('preview').hidden = view !== 'preview';
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
  if (st.view === 'idle' && (S.view === 'preview' || S.view === 'search')) leaveDestination();
  // History can point at a trip that has already ended.
  const stale = (st.view === 'nav' && S.view !== 'nav') || st.view === 'arrival' || (st.view === 'preview' && !S.dest);
  show(stale ? 'idle' : st.view);
});

// Whatever covers the bottom of the map decides where the map's own controls sit.
const bottomObserver = 'ResizeObserver' in window ? new ResizeObserver(() => updateBottomInset()) : null;
function observeBottom() {
  if (bottomObserver) {
    bottomObserver.disconnect();
    for (const id of ['preview', 'nav-bar', 'where', 'stops']) bottomObserver.observe($(id));
  }
  updateBottomInset();
}

function bottomElement() {
  if (S.overlay === 'stops') return $('stops');
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
  const targetZoom = inLanes ? laneZoom(S.fix?.speed) : zoomForSpeed(S.fix?.speed);
  const targetPitch = S.settings.view3d ? (inLanes ? 68 : 60) : 0;
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
  S.laneFetch = { routeId: route.id, until: 0, busy: false, retryAt: 0, failures: 0, counts: [] };
  mapView?.setLanes(NO_LANES);
}

// Lane counts come a stretch at a time, as the road ahead needs them.
async function loadLaneCounts(s) {
  const f = S.laneFetch;
  const route = S.route;
  if (!route || !S.settings.view3d || f.busy || f.failures >= 3 || Date.now() < f.retryAt) return;
  if (s < f.until - 3000 || f.until >= route.length) return;
  f.busy = true;
  const from = Math.max(0, Math.max(s, f.until) - 50);
  const to = Math.min(route.length, from + LANE_CHUNK_M);
  try {
    const segs = await fetchLaneCounts(route, from, to, { mode: S.mode });
    if (S.laneFetch !== f || !S.scene) return;
    f.counts.push(...segs);
    f.until = to;
    f.failures = 0;
    S.scene.setCounts(f.counts);
    if (S.lastState && S.fix) updateScene(S.lastState, S.fix);
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
  if (!S.settings.view3d || !st.onRoute) {
    if (scene.active) {
      scene.active = false;
      scene.builtAt = null;
      scene.keys = [];
      mapView?.setLanes(NO_LANES);
      S.lastTrimS = null;
    }
    return;
  }
  loadLaneCounts(st.s);
  const wasActive = scene.active;
  if (scene.update(st.s, fix.speed)) {
    mapView?.setLanes(scene.features);
    S.lastTrimS = null;
  }
  if (scene.active && !wasActive && !load('laneNoteSeen', false)) {
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

function resetSearch() {
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
  const pick = S.searchFor === 'stop' ? chooseStopFromSearch : chooseFromSearch;
  $('search-results').replaceChildren(...results.map((p) => placeButton(p, pick)));
  const empty = !$('search-input').value.trim();
  const recents = load('recents', []);
  $('recents-wrap').hidden = !empty || !recents.length;
  $('recents').replaceChildren(...recents.map((p) => placeButton(p, pick)));
  $('search-tip').hidden = !empty;
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
  $('search-status').textContent = t('searching');
  S.searchTimer = setTimeout(() => runSearch(q), 350);
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
  addRecent(place);
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
  show('preview');
  renderSegments();
  loadRoutes();
}

function leaveDestination() {
  S.routeCtrl?.abort();
  S.dest = null;
  S.routes = [];
  S.stops = [];
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
  };
  gps.start();
  pushHistory('preview');
  S.stops = [];
  openPreview(place);
  try {
    const named = await reversePlace(lngLat.lng, lngLat.lat);
    if (named && S.dest === place) {
      S.dest = named;
      $('dest-name').textContent = named.name;
      $('dest-detail').textContent = named.detail || '';
      $('dest-detail').hidden = !named.detail;
      addRecent(named);
    }
  } catch { /* the coordinates still work */ }
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
  const from = await waitForFix();
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
  $('try-sim').hidden = !ready;
  $('route-note').hidden = !ready;
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
  renderPlanPrayer(route);
  renderStrip($('preview-strip'), route, 0, false);
  // A line with nothing on it but the destination says nothing.
  $('preview-strip').hidden = !$('preview-strip').querySelector('.mark:not(.mark-end)');
}

function renderPlanFuel(route) {
  const v = vehicle();
  const row = $('plan-fuel');
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
  $('stops-list').replaceChildren();
  mapView?.setPins([], pickStop);
  const status = $('stops-status');
  status.classList.remove('is-error');
  status.textContent = t('stopsSearching');
  try {
    const found = await findAlongRoute(route, S.stopCat, fromS, { signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    S.stopResults = found.slice(0, 40).map((p) => ({ ...p, name: p.name || t(categoryName(p.category)) }));
    status.textContent = S.stopResults.length ? '' : t('stopsNone');
    renderStopResults(route, fromS);
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
  S.guidance = new Guidance(S.route);
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
    S.sim = new SimulatedDrive(S.route, receiveFix);
    S.sim.start();
    remove('trip');
  } else {
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
  renderSpeed(fix);
  updateScene(st, fix);
  renderNavRange(st);
  renderChips();
  renderStrip($('nav-strip'), S.route, st.s, true);

  for (const p of st.prompts) say(p);
  if (st.stopReached != null) onStopReached();

  if (st.arrived) { finishTrip(); return; }
  if (st.offRoute) reroute(fix);
  else if (S.rerouteFailed) { S.rerouteFailed = false; S.rerouteGap = 12000; renderChips(); }
}

function say(prompt) {
  const text = speech(prompt, S.route.maneuvers, getLang());
  if (!text) return;
  speakText(text);
}

function speakText(text) {
  voice.speak(text);
  $('speak-live').textContent = text;
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

function renderSpeed(fix) {
  const known = fix.speed != null;
  $('speed').hidden = !known;
  if (known) $('speed-value').textContent = String(Math.round(fix.speed * 3.6));
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
      speakText(t(v.kind === 'ev' ? 'rangeSayEv' : 'rangeSayFuel', { km }));
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
  if (!S.rerouteFailed && !added) speakText(t('rerouteSay'));
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
    S.guidance = new Guidance(route);
    motion.setRoute(route);
    startScene(route);
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
  if (S.sim) {
    S.sim.stop();
    S.sim = null;
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
  $('arrival-stats').textContent = arrivalStats();
  stopGuidance();
  mapView?.clearRoutes();
  mapView?.setDestination(null);
  mapView?.setStopPins([]);
  mapView?.flat();
  S.dest = null;
  $('arrival-place').textContent = place ? place.name : '';
  replaceHistory('arrival');
  S.overlay = null;
  show('arrival');
  $('arrival-done').focus();
}

function endTrip() {
  stopGuidance();
  S.dest = null;
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
  $('avoid-tolls').addEventListener('change', (e) => {
    S.avoidTolls = e.target.checked;
    save('avoidTolls', S.avoidTolls);
    loadRoutes();
  });
  $('start').addEventListener('click', () => beginTrip({ simulate: false }));
  $('try-sim').addEventListener('click', () => beginTrip({ simulate: true }));

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

  $('arrival-done').addEventListener('click', () => { replaceHistory('idle'); show('idle'); });

  $('resume-yes').addEventListener('click', resumeTrip);
  $('resume-no').addEventListener('click', () => { remove('trip'); $('resume').hidden = true; });

  $('lang-ms').addEventListener('click', () => changeLanguage('ms'));
  $('lang-en').addEventListener('click', () => changeLanguage('en'));
  $('voice-test').addEventListener('click', () => voice.speak(t('voiceSample'), { evenIfMuted: true }));
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
  save('mode', mode);
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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main();
