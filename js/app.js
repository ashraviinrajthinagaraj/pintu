import { CONFIG } from './config.js';
import { fmtClock, fmtDistance, fmtDuration } from './format.js';
import { sliceFrom } from './geo.js';
import { Guidance } from './guidance.js';
import { getLang, setLang, t } from './i18n.js';
import { UI, doorSvg, turnIcon } from './icons.js';
import { describe, speech } from './instructions.js';
import { Gps, SimulatedDrive } from './location.js';
import { MapView } from './map.js';
import { RouteError, fetchRoutes } from './routing.js';
import { reversePlace, searchPlaces } from './search.js';
import { load, remove, save } from './store.js';
import * as voice from './voice.js';

const $ = (id) => document.getElementById(id);

const RECENT_LIMIT = 8;
const TRIP_MAX_AGE = 3 * 60 * 60 * 1000;
// Phones often stop reporting while parked at a light, so only a phone that was
// moving when the reports stopped is treated as having lost its signal quickly.
const NO_GPS_MOVING = 15000;
const NO_GPS_STILL = 60000;

const S = {
  view: 'idle',
  settingsOpen: false,
  fix: null,
  dest: null,
  routes: [],
  selected: 0,
  routeState: 'idle',
  routeError: null,
  mode: load('mode', 'car'),
  avoidTolls: load('avoidTolls', false),
  settings: { lang: 'ms', theme: 'auto', muted: false, ...load('settings', {}) },
  route: null,
  guidance: null,
  sim: null,
  following: true,
  followTimer: null,
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
  searchTimer: null,
  wantCenter: false,
  fixWaiters: [],
  installEvent: null,
};

const gps = new Gps(onGpsFix, onGpsError);
let mapView;

/* ---------- Words and icons ---------- */

function applyStaticText() {
  document.documentElement.lang = getLang();
  $('map').setAttribute('aria-label', t('mapLabel'));
  $('where-text').textContent = t('where');
  $('where-glyph').innerHTML = doorSvg('style="--knob:#00693E"');
  label($('btn-settings'), t('settings'), UI.settings);
  label($('btn-locate'), t('locate'), UI.locate);
  for (const id of ['search-back', 'preview-back', 'settings-back']) label($(id), t('back'), UI.back);
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
  $('safety-title').textContent = t('safetyTitle');
  $('safety-text').textContent = t('safetyText');
  $('safety-ok').textContent = t('safetyOk');
  $('then-label').textContent = t('then');
  $('btn-end').textContent = t('end');
  label($('btn-recenter'), t('recenter'), UI.recenter);
  $('arrival-title').textContent = t('arrived');
  $('arrival-done').textContent = t('done');
  $('resume-yes').textContent = t('resumeYes');
  $('resume-no').textContent = t('resumeNo');
  $('map-retry').textContent = t('retry');
  $('settings-title').textContent = t('settingsTitle');
  $('set-lang-title').textContent = t('setLang');
  $('set-voice-title').textContent = t('setVoice');
  $('voice-test').textContent = t('voiceTest');
  $('set-theme-title').textContent = t('setTheme');
  $('theme-auto').textContent = t('themeAuto');
  $('theme-day').textContent = t('themeDay');
  $('theme-night').textContent = t('themeNight');
  $('set-install-title').textContent = t('setInstall');
  $('install-btn').textContent = t('installBtn');
  $('set-privacy-title').textContent = t('setPrivacy');
  $('privacy-text').textContent = t('privacy');
  $('set-credits-title').textContent = t('setCredits');
  $('version').textContent = t('version', { v: CONFIG.version });
  renderMute();
  renderVoiceStatus();
  renderInstall();
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
  // Motorcycles don't pay tolls in Malaysia, so the switch means nothing for them.
  $('toll-wrap').hidden = S.mode === 'motorcycle';
}

let toastTimer;
function toast(text, ms = 3500) {
  const el = $('toast');
  el.textContent = text;
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
  document.querySelector('meta[name="theme-color"]').content = theme === 'night' ? '#20272A' : '#00693E';
  mapView?.setTheme(theme);
}

/* ---------- Views ---------- */

function show(view) {
  S.view = view;
  $('idle').hidden = view !== 'idle';
  $('search').hidden = view !== 'search';
  $('preview').hidden = view !== 'preview';
  $('nav').hidden = view !== 'nav';
  $('arrival').hidden = view !== 'arrival';
  $('settings').hidden = !S.settingsOpen;
  observeBottom();
}

function pushHistory(view, extra = {}) { history.pushState({ view, ...extra }, ''); }
function replaceHistory(view, extra = {}) { history.replaceState({ view, ...extra }, ''); }

addEventListener('popstate', (e) => {
  const st = e.state || { view: 'idle' };
  if (S.view === 'nav') {
    pushHistory('nav');
    toast(t('backBlocked'));
    return;
  }
  S.settingsOpen = !!st.settings;
  if (st.view === 'idle' && (S.view === 'preview' || S.view === 'search')) leaveDestination();
  // History can point at a trip that has already ended.
  const stale = st.view === 'nav' || st.view === 'arrival' || (st.view === 'preview' && !S.dest);
  show(stale ? 'idle' : st.view);
});

// Whatever covers the bottom of the map decides where the map's own controls sit.
const bottomObserver = 'ResizeObserver' in window ? new ResizeObserver(() => updateBottomInset()) : null;
function observeBottom() {
  if (bottomObserver) {
    bottomObserver.disconnect();
    for (const id of ['preview', 'nav-bar', 'where']) bottomObserver.observe($(id));
  }
  updateBottomInset();
}

function bottomElement() {
  if (S.view === 'preview') return $('preview');
  if (S.view === 'nav') return $('nav-bar');
  if (S.view === 'idle') return $('where');
  return null;
}

function updateBottomInset() {
  const el = bottomElement();
  const landscape = matchMedia('(orientation: landscape) and (max-height: 520px)').matches;
  let inset = 0;
  if (el && !landscape) inset = Math.max(0, innerHeight - el.getBoundingClientRect().top);
  document.documentElement.style.setProperty('--bottom-inset', `${inset}px`);
  return inset;
}

function mapPadding() {
  const landscape = matchMedia('(orientation: landscape) and (max-height: 520px)').matches;
  const pad = { top: 80, bottom: 40, left: 40, right: 40 };
  if (S.view === 'preview') {
    if (landscape) pad.left = $('preview').offsetWidth + 30;
    else pad.bottom = updateBottomInset() + 30;
  }
  return pad;
}

function followPadding() {
  const h = innerHeight;
  const landscape = matchMedia('(orientation: landscape) and (max-height: 520px)').matches;
  if (landscape) return { top: h * 0.25, bottom: 0, left: Math.min(innerWidth * 0.5, 390), right: 0 };
  return { top: h * 0.42, bottom: updateBottomInset(), left: 0, right: 0 };
}

/* ---------- Location ---------- */

function onGpsFix(fix) {
  S.lastFixAt = Date.now();
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
  mapView?.setPuck(fix.lng, fix.lat, fix.heading);
  if (S.wantCenter) {
    S.wantCenter = false;
    mapView?.centerOn(fix.lng, fix.lat);
  }
  flushFixWaiters(fix);
  if (S.view === 'nav' && S.guidance) onNavFix(fix);
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

/* ---------- Search ---------- */

function openSearch() {
  gps.start();
  pushHistory('search');
  show('search');
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
  const list = $('search-results');
  list.replaceChildren(...results.map((p) => placeButton(p, chooseFromSearch)));
  const empty = !$('search-input').value.trim();
  const recents = load('recents', []);
  $('recents-wrap').hidden = !empty || !recents.length;
  $('recents').replaceChildren(...recents.map((p) => placeButton(p, chooseFromSearch)));
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
  openPreview(place);
}

/* ---------- Route preview ---------- */

function openPreview(place) {
  S.dest = place;
  S.routes = [];
  S.selected = 0;
  mapView?.setDestination(place);
  mapView?.clearRoutes();
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
  mapView?.setDestination(null);
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
      from, to: S.dest, mode: S.mode, avoidTolls: S.avoidTolls, alternates: 2, signal: ctrl.signal,
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
    mapView?.showRoutes(routes, 0);
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
  $('try-sim').hidden = !ready;
  $('route-note').hidden = !ready;
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

function startGuidance({ simulate }) {
  S.guidance = new Guidance(S.route);
  S.lastState = null;
  S.lastLineS = null;
  S.following = true;
  S.rerouting = false;
  S.rerouteFailed = false;
  S.rerouteGap = 12000;
  S.lastFixAt = Date.now();
  mapView?.showRoutes([S.route], 0);

  replaceHistory('nav');
  show('nav');
  $('btn-recenter').hidden = true;
  $('sign-then').hidden = true;
  clearEndArmed();
  renderChips();
  acquireWake();

  if (simulate) {
    S.realFix = S.fix;
    S.sim = new SimulatedDrive(S.route, receiveFix);
    S.sim.start();
    remove('trip');
  } else {
    save('trip', { dest: S.dest, mode: S.mode, avoidTolls: S.avoidTolls, at: Date.now() });
    if (S.fix) onNavFix({ ...S.fix, time: Date.now() });
  }
}

function onNavFix(fix) {
  const st = S.guidance.update(fix);
  S.lastState = st;
  renderSign(st);
  renderEta(st);
  renderChips();

  if (S.lastLineS == null || Math.abs(st.s - S.lastLineS) > 8) {
    S.lastLineS = st.s;
    mapView?.setRemaining(sliceFrom(S.route.coords, S.route.cum, st.s));
  }
  const [lng, lat] = st.snapped;
  const heading = st.onRoute && st.roadBearing != null ? st.roadBearing : fix.heading;
  mapView?.setPuck(lng, lat, heading);
  if (S.following) mapView?.follow(lng, lat, heading, zoomForSpeed(fix.speed), followPadding());

  for (const p of st.prompts) say(p);

  if (st.arrived) { finishTrip(); return; }
  if (st.offRoute) reroute(fix);
  else if (S.rerouteFailed) { S.rerouteFailed = false; S.rerouteGap = 12000; renderChips(); }
}

function say(prompt) {
  const text = speech(prompt, S.route.maneuvers, getLang());
  if (!text) return;
  voice.speak(text);
  $('speak-live').textContent = text;
}

function zoomForSpeed(speed) {
  const v = speed ?? 0;
  if (v < 8) return 17;
  if (v < 16) return 16;
  if (v < 25) return 15;
  return 14.2;
}

function renderSign(st) {
  const next = st.next;
  const d = describe(next, getLang());
  const sign = $('sign');
  // Green on expressways, blue on every other road, as on the real signs.
  sign.classList.toggle('blue', !(next.highway || next.toll));
  $('sign-icon').innerHTML = turnIcon(next);
  $('sign-distance').textContent = fmtDistance(st.distanceToNext);
  $('sign-action').textContent = d.action;
  $('sign-road').textContent = d.road;
  $('sign-ref').textContent = d.ref;
  $('sign-ref').hidden = !d.ref;
  $('sign-toward').textContent = d.toward ? `${getLang() === 'ms' ? 'Menuju' : 'Towards'} ${d.toward}` : '';
  $('sign-toward').hidden = !d.toward;

  const then = $('sign-then');
  then.hidden = !st.then;
  if (st.then) $('then-icon').innerHTML = turnIcon(st.then);
}

function renderEta(st) {
  const lang = getLang();
  const clock = fmtClock(new Date(Date.now() + st.remainingTime * 1000), lang);
  $('eta-clock').textContent = fmtDuration(st.remainingTime, lang);
  $('eta-rest').textContent = t('arrivalIn', { distance: fmtDistance(st.remainingDistance), clock });
}

function renderChips() {
  const chips = [];
  if (S.sim) chips.push(t('sim'));
  if (S.rerouting) chips.push(t('rerouting'));
  else if (S.rerouteFailed) chips.push(t('rerouteFail'));
  if (!S.sim) {
    if (S.gpsDenied) chips.push(t('gpsDenied'));
    else if (Date.now() - S.lastFixAt > ((S.fix?.speed ?? 0) > 2 ? NO_GPS_MOVING : NO_GPS_STILL)) chips.push(t('noGps'));
    else if (S.lastState?.weak) chips.push(t('weakGps'));
  }
  const key = chips.join('|');
  if ($('chips').dataset.key === key) return;
  $('chips').dataset.key = key;
  $('chips').replaceChildren(...chips.map((c) => {
    const el = document.createElement('span');
    el.className = 'chip';
    el.textContent = c;
    return el;
  }));
}

async function reroute(fix) {
  if (S.rerouting) return;
  const now = Date.now();
  if (now - S.lastReroute < S.rerouteGap) return;
  S.lastReroute = now;
  S.rerouting = true;
  if (!S.rerouteFailed) {
    const text = t('rerouteSay');
    voice.speak(text);
    $('speak-live').textContent = text;
  }
  renderChips();
  try {
    const moving = (fix.speed ?? 0) > 3;
    const [route] = await fetchRoutes({
      from: fix,
      to: S.dest,
      mode: S.mode,
      avoidTolls: S.avoidTolls,
      heading: moving ? fix.heading : null,
    });
    if (S.view !== 'nav') return;
    S.route = route;
    S.guidance = new Guidance(route);
    S.lastLineS = null;
    S.rerouteFailed = false;
    S.rerouteGap = 12000;
    mapView?.showRoutes([route], 0);
    S.rerouting = false;
    if (S.fix) onNavFix({ ...S.fix, time: Date.now() });
  } catch (err) {
    S.rerouteFailed = true;
    S.rerouteGap = Math.min(S.rerouteGap * 1.5, 45000);
  } finally {
    S.rerouting = false;
    if (S.view === 'nav') renderChips();
  }
}

// The trip's over one way or another: put everything back.
function stopGuidance() {
  if (S.sim) {
    S.sim.stop();
    S.sim = null;
    // A simulated drive must not leave you standing at its pretend finish.
    S.fix = S.realFix || null;
    if (S.fix) mapView?.setPuck(S.fix.lng, S.fix.lat, S.fix.heading);
  }
  S.guidance = null;
  S.route = null;
  S.lastState = null;
  remove('trip');
  releaseWake();
  clearTimeout(S.followTimer);
  clearEndArmed();
  window.speechSynthesis?.cancel();
}

function finishTrip() {
  const place = S.dest;
  stopGuidance();
  mapView?.clearRoutes();
  mapView?.setDestination(null);
  mapView?.flat();
  S.dest = null;
  $('arrival-place').textContent = place ? place.name : '';
  replaceHistory('arrival');
  show('arrival');
  $('arrival-done').focus();
}

function endTrip() {
  stopGuidance();
  S.dest = null;
  S.routes = [];
  mapView?.clearRoutes();
  mapView?.setDestination(null);
  mapView?.flat();
  replaceHistory('idle');
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
  if (S.lastState) { renderSign(S.lastState); renderEta(S.lastState); }
  $('chips').dataset.key = '';
  renderChips();
}

function wire() {
  $('preview').addEventListener('animationend', updateBottomInset);
  $('where').addEventListener('click', openSearch);
  $('btn-settings').addEventListener('click', () => {
    S.settingsOpen = true;
    pushHistory(S.view, { settings: true });
    renderVoiceStatus();
    renderInstall();
    renderSegments();
    show(S.view);
  });
  $('settings-back').addEventListener('click', () => history.back());
  $('btn-locate').addEventListener('click', () => {
    S.wantCenter = true;
    gps.start();
    if (S.fix) { S.wantCenter = false; mapView?.centerOn(S.fix.lng, S.fix.lat); }
    if (S.gpsDenied) toast(t('gpsDenied'), 6000);
  });

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
    $('btn-recenter').hidden = true;
    const st = S.lastState;
    if (st) mapView?.follow(st.snapped[0], st.snapped[1], st.roadBearing, zoomForSpeed(S.fix?.speed), followPadding());
  });
  $('btn-end').addEventListener('click', onEndTap);

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
    mapView?.resize();
  });
  $('map-retry').addEventListener('click', startMap);

  voice.onVoicesReady(renderVoiceStatus);
  setInterval(() => {
    if (S.view === 'nav') renderChips();
    if (S.settings.theme === 'auto') applyTheme();
  }, 30000);
  setInterval(() => { if (S.view === 'nav' && !S.sim) renderChips(); }, 5000);
}

function setMode(mode) {
  if (S.mode === mode) return;
  S.mode = mode;
  save('mode', mode);
  renderSegments();
  loadRoutes();
}

async function startMap() {
  $('map-problem').hidden = true;
  try {
    mapView = new MapView($('map'), {
      theme: currentTheme(),
      onLongPress,
      onUserMove,
      onAltTap: (i) => selectRoute(i),
    });
    await mapView.init();
    if (S.fix) mapView.setPuck(S.fix.lng, S.fix.lat, S.fix.heading);
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
  await startMap();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main();
