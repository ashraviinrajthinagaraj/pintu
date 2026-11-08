import { CONFIG } from './config.js';
import { sayDuration, fmtClock, fmtDistance, fmtDuration, localeOf, sayDistance } from './format.js';
import { clamp, haversine } from './geo.js';
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
import { DriveWatch, OVER_BY_KMH, RESTED_MS } from './drive-watch.js';
import { checkRouteWeather } from './weather.js';
import { cameraAhead, camerasOnRoute, fetchCameras } from './cameras.js';
import { fetchTolls, tollAhead, tollsOnRoute } from './tolls.js';
import { ALWAYS_SAY, JAM_SAY_M, TRAFFIC_EVERY_MS, delayAhead, fasterSaving, fetchTraffic, jamAhead, throughPoints } from './traffic.js';
import { evCar, fetchLimits, mergeResults, planCharging, searchAddresses } from './tomtom.js';
import { canSaveMap, saveRouteMap } from './offline.js';
import { DAILY_CAP, usage } from './usage.js';
import { DriveLog, forgetDrive, lastDrive, recentErrors, rememberError, reportText, shareReport } from './report.js';
import { findParking } from './parking.js';
import { leaveBy } from './leaveby.js';
import { JUNCTION_RANGE, junctionFor, junctionSvg } from './junction.js';
import { kindLabel } from './kinds.js';
import { NEARBY_ORDER, findNearby } from './nearby.js';
import { parseLocationText, readResolved, resolveShortLink } from './links.js';
import { fetchShops, mallFor, searchShops } from './malls.js';
import { parseCoordinates, reversePlace, searchPlaces } from './search.js';
import { load, remove, save } from './store.js';
import { DEFAULT_LOOKS, levelAfter, rangeLeft, rangeWarning, reserveKm, tripPlan } from './vehicle.js';
import { initVehicleUI } from './vehicle-ui.js';
import { GRADES, fetchFuelPrices, isStale, keptFuelPrices, priced } from './fuel-price.js';
import { canListen, listen, understand } from './voice-search.js';
import { CrawlClock, forgetTrips, keptTrips, monthSummary, recordTrip, tripMonths } from './trips.js';
import { frameDue, saverOn, watchBattery } from './battery.js';
import { REPORT_KINDS, REPORTS_EVERY_MS, fetchReports, justPassed, reportAhead, reportBox, reportsOnRoute, sendReport as sendRoadReport, voteReport } from './road-reports.js';
import { Convoy, TripShare, convoyOrder, watchTrip } from './together.js';
import { COMMUTE_DEFAULTS, DAY_ORDER, CommuteError, commuteOff, commuteOn, commuteTest } from './commute.js';
import { isCode } from './hub.js';
import * as voice from './voice.js';

const $ = (id) => document.getElementById(id);
// Bahasa Melayu, English, Chinese and Tamil. The characters' jokes and the human
// voices are in the first two only.
const LANGS = ['ms', 'en', 'zh', 'ta'];
const castSpeaks = () => getLang() === 'ms' || getLang() === 'en';

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
const CAR_KEEP_MS = 7 * 24 * 3600000;  // a car left longer than this is someone else's problem
const CAR_SAME_M = 300;                 // starting a drive this close to it means you're in it
const SAVED_FRESH_MS = 5 * 60000;  // a journey time this old is worth asking again
const SAVED_MOVED_M = 500;
const CAMERA_REFETCH_MS = 5 * 60000;
const MOMENT_KEEP_MS = 30000;   // a remark that can't be made by then isn't worth making
const TURNS_ONLY = new Set(['now', 'arrive', 'stop', 'repeat']);
const WEATHER_REFRESH_MS = 20 * 60000;
const RAIN_CHIP_M = 30000;     // far enough ahead to matter
const RAIN_SAY_M = 15000;
const HUD_CONTROLS_MS = 6000;
const HUD_BAR_M = 500;         // the bar fills over the last stretch before a turn
const HUD_INKS = ['white', 'green', 'blue', 'amber'];
const JAM_ICONS = { JAM: 'car', OTHER: 'car', ROAD_WORK: 'cone', ROAD_CLOSURE: 'closed', ACCIDENT: 'crash', FLOOD: 'waves', BREAKDOWN: 'hazard', HAZARD: 'hazard' };
const DRIVE_TIME_SAVE_MS = 30000;
const TRAFFIC_AGAIN_MS = 30000;      // after a new route, ask again this soon at the earliest

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
  settings: { lang: 'ms', theme: 'auto', muted: false, view3d: true, solat: true, simSpeed: 4, voiceLevel: 'full', voiceCharacter: 'standard', speedLimit: true, weather: true, hudMirror: true, hudInk: 'white', speedCameras: true, traffic: true, trafficMap: true, offlineMap: true, keepDrive: true, keepTrips: true, saver: 'auto', name: '', commute: { ...COMMUTE_DEFAULTS }, ...load('settings', {}) },
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
  fuel: keptFuelPrices(),   // this week's official pump prices
  ear: null,                // voice search, while listening
  battery: null,
  saving: false,            // battery saver on right now
  crawl: null,
  month: null,              // which month the summary shows
  share: null,              // this trip, shared live with a link
  pendingShare: null,       // a share from before the app was closed, for the resumed trip
  convoy: Convoy.resume(),
  watching: null,           // someone else's trip, being followed
  together: null,           // which the sharing sheet is about: 'share' or 'convoy'
  roadReports: [],
  roadPlaced: [],
  roadSaid: new Set(),
  roadAsked: new Set(),
  roadAt: 0,
  asking: null,
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
  getFuel: () => S.fuel,
  onDone: () => history.back(),
});

function vehicle() { return S.vehicles[S.mode] || null; }
// With this week's pump price filled in when you haven't typed one.
function pricedVehicle() { return priced(vehicle(), S.fuel); }
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
  for (const id of ['search-back', 'preview-back', 'settings-back', 'vehicle-back', 'pick-back', 'summary-back']) label($(id), t('back'), UI.back);
  label($('where-mic'), t('micSearch'), UI.mic);
  renderMic();
  $('where-mic').hidden = !canListen();
  $('search-mic').hidden = !canListen();
  $('set-summary-title').textContent = t('setSummary');
  $('summary-text').textContent = t('summaryText');
  $('summary-open').textContent = t('summaryOpen');
  $('keep-trips-label').textContent = t('keepTrips');
  $('summary-title').textContent = t('summaryTitle');
  label($('month-prev'), t('monthPrev'), UI.back);
  label($('month-next'), t('monthNext'), UI.back);
  $('month-days-label').textContent = t('monthDays');
  label($('btn-report'), t('roadTitle'), UI.hazard);
  label($('report-back'), t('back'), UI.close);
  label($('together-back'), t('back'), UI.close);
  label($('watch-back'), t('back'), UI.close);
  $('report-title').textContent = t('roadTitle');
  $('report-text').textContent = t('roadText');
  $('report-still').textContent = t('roadStill');
  $('report-gone').textContent = t('roadGone');
  $('name-title').textContent = t('nameTitle');
  $('name-text').textContent = t('nameText');
  $('name-input').placeholder = t('namePlaceholder');
  $('name-save').textContent = t('nameSave');
  $('name-cancel').textContent = t('back');
  $('join-name-label').textContent = t('nameTitle');
  $('join-name').placeholder = t('namePlaceholder');
  $('join-yes').textContent = t('convoyJoin');
  $('join-no').textContent = t('convoyNo');
  $('set-sharing-title').textContent = t('setSharing');
  $('sharing-text').textContent = t('sharingText');
  $('sharing-name').placeholder = t('namePlaceholder');
  $('sharing-name').value = S.settings.name || '';
  $('set-commute-title').textContent = t('setCommute');
  $('commute-text').textContent = t('commuteText');
  $('commute-on-label').textContent = t('commuteOn');
  $('commute-time-label').textContent = t('commuteTime');
  $('commute-days-label').textContent = t('commuteDays');
  $('commute-slow-label').textContent = t('commuteSlow');
  $('commute-test').textContent = t('commuteTest');
  renderCommute();
  renderShareBtn();
  $('set-saver-title').textContent = t('setSaver');
  $('saver-text').textContent = t('saverText');
  $('saver-auto').textContent = t('saverAuto');
  $('saver-on').textContent = t('saverOn');
  $('saver-off').textContent = t('saverOff');
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
  $('car-pill-icon').innerHTML = UI.car;
  $('car-note-label').textContent = t('carNoteLabel');
  $('car-note').placeholder = t('carNotePlaceholder');
  $('arrival-car-note').placeholder = t('carNotePlaceholder');
  $('car-found').textContent = t('carFound');
  $('car-here').textContent = t('carHere');
  label($('car-back'), t('back'), UI.close);
  label($('placecard-back'), t('back'), UI.close);
  label($('explore-back'), t('back'), UI.close);
  $('placecard-go').textContent = t('goHere');
  $('explore-title').textContent = t('exploreTitle');
  $('explore-row').setAttribute('aria-label', t('exploreAria'));
  for (const b of document.querySelectorAll('.explore-chip')) {
    b.innerHTML = CATEGORY_ICONS[b.dataset.cat];
    b.append(t(`near_${b.dataset.cat}`));
  }
  renderCarPill();
  $('set-camera-title').textContent = t('setCamera');
  $('camera-text').textContent = t('cameraText');
  $('camera-on-label').textContent = t('cameraOn');
  $('set-traffic-title').textContent = t('setTraffic');
  $('traffic-text').textContent = t('trafficText');
  $('traffic-on-label').textContent = t('trafficOn');
  $('traffic-map-on-label').textContent = t('trafficMapOn');
  $('set-report-title').textContent = t('setReport');
  $('report-text').textContent = t('reportText');
  $('report-note').placeholder = t('reportNote');
  $('report-drive-label').textContent = t('reportDrive');
  $('report-btn').textContent = t('reportBtn');
  $('keep-drive-label').textContent = t('keepDrive');
  $('set-offline-title').textContent = t('setOffline');
  $('offline-text').textContent = t('offlineText');
  $('offline-on-label').textContent = t('offlineOn');
  label($('btn-traffic'), t('trafficMapBtn'), UI.trafficLight);
  $('faster-yes').textContent = t('fasterYes');
  $('faster-no').textContent = t('fasterNo');
  $('camera-icon').innerHTML = UI.camera;
  $('set-saved-title').textContent = t('setSavedTitle');
  $('set-saved-text').textContent = t('setSavedText');
  $('saved-home-icon').innerHTML = UI.home;
  $('saved-work-icon').innerHTML = UI.work;
  $('plan-arrive-icon').innerHTML = UI.clock;
  $('plan-parking-icon').innerHTML = UI.parking;
  label($('plan-parking-clear'), t('parkingRemove'), UI.close);
  renderSaved();
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
  $('hm-toll-word').textContent = t('hudToll');
  $('hm-toll-card').textContent = t('hudTollCard');
  $('hm-rest-word').textContent = t('hudRest');
  for (const el of document.querySelectorAll('#hudmode [data-icon]')) el.innerHTML = UI[el.dataset.icon];
  renderHudInk();
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
  renderVersion();
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
  // Human voices and the characters' jokes are Malay and English only.
  const human = castSpeaks() ? voice.humanVoice() : 'off';
  const parts = !castSpeaks() ? [t(key)]
    : human === 'on' ? [t('voiceHuman')]
    : human === 'resting' ? [t('voiceHumanResting')]
    : human === 'refused' ? [t('voiceHumanRefused'), t(key)]
      : voice.humanVoicesOffered() ? [t('voiceHumanOff'), t(key)]
        : [t(key)];
  $('voice-status').textContent = parts.join(' ');
  const silent = human !== 'on' && key === 'voiceMissing';
  $('voice-test').hidden = silent;
  $('voice-try').hidden = silent || S.settings.voiceCharacter === 'standard' || !castSpeaks();
  $('voice-check').hidden = !voice.humanVoicesOffered() || !castSpeaks();
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
  $('camera-on').checked = S.settings.speedCameras;
  $('traffic-on').checked = S.settings.traffic;
  renderVersion();
  $('keep-drive').checked = S.settings.keepDrive;
  $('keep-trips').checked = S.settings.keepTrips;
  set('saver-auto', S.settings.saver === 'auto');
  set('saver-on', S.settings.saver === 'on');
  set('saver-off', S.settings.saver === 'off');
  renderSaverNow();
  renderFuelWeek();
  $('report-drive-row').hidden = !lastDrive();
  const used = usage();
  $('tomtom-use').textContent = t('tomtomUse', { today: used.today, month: used.month, cap: DAILY_CAP });
  $('offline-on').checked = S.settings.offlineMap;
  const kept = load('mapSaved', null);
  $('offline-last').hidden = !kept;
  if (kept) $('offline-last').textContent = t('offlineLast', { n: kept.tiles, mb: Math.max(1, Math.round(kept.bytes / 1e6)) });
  $('traffic-map-on').checked = S.settings.trafficMap;
  $('traffic-map-on').disabled = !S.settings.traffic;
  $('weather-on').checked = S.settings.weather;
  for (const l of LANGS) set(`lang-${l}`, S.settings.lang === l);
  $('lang-note').textContent = t('langNote');
  $('lang-note').hidden = !t('langNote');
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
  if (S.view === 'idle') renderSaved();
  if (S.view === 'preview' && S.routes[S.selected]) renderPlanArrive(S.routes[S.selected]);
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

// Sheets that open over the main screen, in place of its buttons.
const IDLE_SHEETS = new Set(['explore', 'placecard', 'car', 'watch']);

function show(view) {
  S.view = view;
  render();
  syncTrafficMap();
  renderShareBtn();
  renderConvoy();
  $('btn-report').hidden = view !== 'nav' || !togetherReady() || S.mode === 'walk';
}

/* ---------- Traffic on the map ---------- */

const trafficMapOn = () => !!(CONFIG.server && S.settings.traffic && S.settings.trafficMap);

function syncTrafficMap() {
  mapView?.setTraffic(trafficMapOn(), S.view === 'nav');
  const btn = $('btn-traffic');
  if (!btn) return;
  btn.hidden = !(CONFIG.server && S.settings.traffic);
  btn.setAttribute('aria-pressed', String(trafficMapOn()));
  btn.classList.toggle('is-on', trafficMapOn());
}

function toggleTrafficMap() {
  setSetting('trafficMap', !S.settings.trafficMap);
  $('traffic-map-on').checked = S.settings.trafficMap;
  syncTrafficMap();
  toast(t(S.settings.trafficMap ? 'trafficMapShown' : 'trafficMapHidden'));
}

function render() {
  const { view, overlay } = S;
  $('idle').hidden = view !== 'idle' || IDLE_SHEETS.has(overlay);
  $('explore').hidden = overlay !== 'explore';
  $('placecard').hidden = overlay !== 'placecard';
  $('car').hidden = overlay !== 'car';
  mapView?.setCarPin(view === 'idle' ? savedCar() : null);
  $('hud').hidden = view !== 'idle';
  $('scrim').hidden = !(view === 'idle' || view === 'nav');
  $('search').hidden = !((view === 'search' && overlay !== 'pickmap') || overlay === 'stopsearch' || overlay === 'endsearch');
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
  $('summary').hidden = overlay !== 'summary';
  $('report-sheet').hidden = overlay !== 'roadreport';
  $('together').hidden = overlay !== 'together';
  $('convoy-join').hidden = overlay !== 'convoyjoin';
  $('name-sheet').hidden = overlay !== 'name';
  $('watch').hidden = overlay !== 'watch';
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
  cancelEar();
  if (was === 'watch' && S.overlay !== 'watch') closeWatch();
  if (was === 'convoyjoin') S.joining = null;
  if (was === 'name' && S.overlay !== 'name' && !S.afterBack) S.afterName = null;
  if (was === 'vehicle' && S.overlay !== 'vehicle') vehicleUI.close();
  if (was === 'stops' && S.overlay !== 'stopsearch') closeStopsPanel();
  if (was === 'stopsearch' && !S.overlay) closeStopsPanel();
  if (was === 'endsearch' || was === 'stopsearch') S.searchFor = null;
  if (was === 'hudmode') leaveFullscreen();
  if (was === 'mall') S.mallCtrl?.abort();
  if (was === 'explore' && S.overlay !== 'explore') closeExplore();
  if (was === 'placecard' && S.overlay !== 'placecard' && S.view === 'idle') mapView?.setDestination(null);
  if (st.view === 'idle' && (S.view === 'preview' || S.view === 'search')) leaveDestination();
  // History can point at a trip that has already ended.
  const stale = (st.view === 'nav' && S.view !== 'nav') || (st.view === 'arrival' && S.view !== 'arrival') || (st.view === 'preview' && !S.dest);
  show(stale ? 'idle' : st.view);
  // Choosing on the map moved it. Put the route back in view.
  if (was === 'pickmap' && S.overlay !== 'pickmap' && S.view === 'preview') fitRoutes();
  if (S.afterBack) {
    const next = S.afterBack;
    S.afterBack = null;
    next();
  }
});

// Whatever covers the bottom of the map decides where the map's own controls sit.
const bottomObserver = 'ResizeObserver' in window ? new ResizeObserver(() => updateBottomInset()) : null;
function observeBottom() {
  if (bottomObserver) {
    bottomObserver.disconnect();
    for (const id of ['preview', 'nav-bar', 'where', 'saved-row', 'car-pill', 'stops', 'steps', 'weather', 'explore', 'placecard', 'car', 'watch']) bottomObserver.observe($(id));
  }
  updateBottomInset();
}

function bottomElement() {
  if (S.overlay === 'stops') return $('stops');
  if (IDLE_SHEETS.has(S.overlay)) return $(S.overlay);
  if (S.overlay === 'steps') return $('steps');
  if (S.overlay === 'weather') return $('weather');
  if (S.overlay === 'pickmap' || S.overlay === 'hudmode') return null;
  if (S.view === 'preview') return $('preview');
  if (S.view === 'nav') return $('nav-bar');
  if (S.view === 'idle') return savedCar() ? $('car-pill') : $('saved-row');
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
  // When the fix was taken, which is a little before it got here.
  const takenAt = performance.now() - (fix.lag || 0);
  if (S.view === 'nav' && !S.sim) S.driveLog?.add(fix);
  if (S.view === 'nav' && S.guidance) {
    onNavFix(fix, takenAt);
  } else {
    motion.offRoute(fix.lng, fix.lat, fix.heading, fix.motionSpeed ?? fix.speed ?? 0, takenAt);
  }
  if (S.wantCenter) {
    S.wantCenter = false;
    mapView?.centerOn(fix.lng, fix.lat);
  }
  if (S.view === 'preview' && S.start) renderActions();
  if (S.view === 'idle') { refreshSavedEtas(); renderCarPill(); }
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
  // Battery saver draws thirty frames a second instead of sixty.
  if (!frameDue(now, S.lastFrameAt, S.saving)) return;
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
      mapView.setRemaining(S.route, trimFrom);
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
  const text = t({ start: 'startSearch', home: 'savedSearchHome', work: 'savedSearchWork' }[S.searchFor] || 'searchPlaceholder');
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
  const pick = { stop: chooseStopFromSearch, start: chooseStartFromSearch, to: chooseToFromSearch, home: chooseSavedFromSearch, work: chooseSavedFromSearch }[S.searchFor] || chooseFromSearch;
  $('search-results').replaceChildren(...results.map((p) => placeButton(p, pick)));
  const empty = !$('search-input').value.trim();
  const recents = load('recents', []);
  $('recents-wrap').hidden = !empty || !recents.length;
  $('recents').replaceChildren(...recents.map((p) => placeButton(p, pick)));
  const choosingSpot = S.searchFor === 'start' || savingPlace();
  $('search-tip').hidden = !empty || choosingSpot;
  $('search-paste').hidden = !empty || !navigator.clipboard?.readText || savingPlace();
  $('search-quick').hidden = !empty || !choosingSpot;
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
  // A shortcut on the home screen: hold Pintu's icon.
  // Someone's live trip, or an invitation to drive together.
  const watch = q.get('watch');
  const convoy = q.get('convoy');
  if (isCode(watch, 10) || isCode(convoy, 10)) {
    history.replaceState(history.state, '', location.pathname);
    if (!togetherReady()) return;
    if (watch) openWatch(watch);
    else offerConvoy(convoy);
    return;
  }
  const go = q.get('go');
  if (go) {
    history.replaceState(history.state, '', location.pathname);
    if (go === 'home' || go === 'work') goSaved(go);
    else if (go === 'car') openCar();
    else if (go === 'search') openSearch();
    else if (NEARBY_ORDER.includes(go)) openExplore(go);
    return;
  }
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
    // Places by name from the usual search, street addresses from TomTom.
    let failed = null;
    const named = searchPlaces(q, { near: S.fix, signal: ctrl.signal }).catch((e) => { failed = e; return []; });
    const addresses = CONFIG.server && q.length >= 4 && !parseCoordinates(q)
      ? searchAddresses(q, S.fix, { signal: ctrl.signal }).catch(() => [])
      : Promise.resolve([]);
    const [a, b] = await Promise.all([named, addresses]);
    if (ctrl.signal.aborted) return;
    if (failed && !b.length) throw failed;
    const results = mergeResults(a, b, q);
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

function chooseSavedFromSearch(place) {
  $('search-input').blur();
  const kind = S.searchFor;
  S.afterBack = () => setSaved(kind, place);
  history.back();
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
  mapView?.setStopPins(stopPins());
  mapView?.clearRoutes();
  renderEnds();
  loadRoutes();
}

function openMapPick() {
  // The search box is still focused, and the phone's keyboard would cover the map.
  $('search-input').blur();
  const at = S.start || S.fix || S.dest;
  $('pick-hint').textContent = t(savingPlace() ? 'pickHintSaved' : 'pickHint', { name: t(S.searchFor === 'work' ? 'work' : 'home').toLowerCase() });
  openOverlay('pickmap');
  mapView?.level();
  if (at) mapView?.lookDownAt(at.lng, at.lat);
}

async function useMapPick() {
  const box = $('pick-pin').getBoundingClientRect();
  const where = mapView?.placeAt(box.left + box.width / 2, box.top + box.height / 2);
  if (!where) return;
  const place = { name: `${where.lat.toFixed(5)}, ${where.lng.toFixed(5)}`, detail: '', lng: where.lng, lat: where.lat, country: '' };
  if (savingPlace()) {
    const kind = S.searchFor;
    S.afterBack = () => setSaved(kind, { ...place, name: t(kind), detail: '' });
    history.go(-2);
    return;
  }
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

function openPreview(place, { keepParking = false } = {}) {
  if (!keepParking) S.parkAt = null;
  S.parkingOpen = false;
  S.dest = place;
  S.routes = [];
  S.selected = 0;
  if (!S.stops.some((st) => st.charge)) S.evPlan = null;
  mapView?.setDestination(place);
  mapView?.clearRoutes();
  mapView?.setStopPins(stopPins());
  $('dest-name').textContent = place.name;
  $('dest-detail').textContent = place.detail || '';
  $('dest-detail').hidden = !place.detail;
  renderEnds();
  show('preview');
  renderSegments();
  loadRoutes();
  loadParking(place);
  if (place.unnamed) nameDestination(place);
}

// Where the drive itself ends: a car park, if one was chosen, or the destination.
function routeEnd() { return S.parkAt || S.dest; }
function stopPins() { return S.parkAt ? [...S.stops, { ...S.parkAt, category: 'parking' }] : S.stops; }

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
  S.parkAt = null;
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
      from, to: routeEnd(), stops: S.stops, mode: S.mode, avoidTolls: S.avoidTolls, alternates: 2, signal: ctrl.signal,
    });
    if (ctrl.signal.aborted) return;
    S.routes = routes;
    S.selected = 0;
    S.routePicked = false;
    save('lastProvider', routes[0]?.provider || '');
    S.routeState = 'ready';
    renderRoutes();
    loadRouteTraffic(routes);
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

/* ---------- Traffic for each route choice ---------- */

const withTraffic = (r) => r.time + (r.traffic?.delay || 0);

function fastestNow(routes) {
  let best = 0;
  routes.forEach((r, i) => { if (withTraffic(r) < withTraffic(routes[best])) best = i; });
  return best;
}

function loadRouteTraffic(routes) {
  S.optionTrafficCtrl?.abort();
  if (!CONFIG.server || !S.settings.traffic || S.mode === 'walk' || S.noTrafficKey) return;
  const ctrl = new AbortController();
  S.optionTrafficCtrl = ctrl;
  const each = (r) => fetchTraffic(r, 0, { signal: ctrl.signal }).then((tr) => { r.traffic = tr; }).catch((e) => {
    // The server has no TomTom key: no point asking again this time round.
    if (e?.kind === 'no key') S.noTrafficKey = true;
  });
  Promise.all(routes.map(each)).then(() => {
    if (ctrl.signal.aborted || S.routes !== routes || S.view !== 'preview') return;
    // Unless you've already picked one, the quickest right now is chosen for you.
    const best = fastestNow(routes);
    if (!S.routePicked && best !== S.selected && withTraffic(routes[S.selected]) - withTraffic(routes[best]) >= 120) {
      S.selected = best;
      mapView?.showRoutes(routes, best);
    }
    renderRoutes();
  });
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
  const pv = S.mode === 'walk' ? null : pricedVehicle();
  list.replaceChildren(...S.routes.map((r, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'route-opt';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(i === S.selected));
    const time = document.createElement('span');
    time.className = 'route-time';
    time.textContent = fmtDuration(withTraffic(r), getLang());
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
    if (r.hasToll && S.mode !== 'motorcycle') tags.append(tag(r.tollKm >= 1 ? t('tollKm', { km: kmText(r.tollKm) }) : t('tollStill')));
    if (r.hasFerry) tags.append(tag(t('ferry')));
    const cost = pv ? tripPlan(pv, r.distanceKm)?.cost : null;
    if (cost != null) tags.append(tag(t(pv.kind === 'ev' ? 'costEv' : 'costFuel', { cost: money(cost) }), 'tag-cost'));
    if (r.traffic) {
      const slow = r.traffic.delay >= 120;
      tags.append(tag(slow ? t('trafficDelayTag', { time: fmtDuration(r.traffic.delay, getLang()) }) : t('trafficClearTag'), slow ? 'tag-slow' : 'tag-clear'));
      if (S.routes.length > 1 && S.routes.every((x) => x.traffic) && i === fastestNow(S.routes)) tags.append(tag(t('fastestNow'), 'tag-best'));
    }
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

function tag(text, kind = '') {
  const el = document.createElement('span');
  el.className = kind ? `tag ${kind}` : 'tag';
  el.textContent = text;
  return el;
}

function selectRoute(i) {
  if (!S.routes[i]) return;
  S.selected = i;
  S.routePicked = true;
  renderRoutes();
  mapView?.showRoutes(S.routes, i);
}

/* ---------- The plan: stops, fuel, prayer ---------- */

const refillWord = (kind) => t(kind === 'ev' ? 'refillEv' : 'refillFuel');
const kmText = (km) => fmtDistance(Math.max(0, km) * 1000);
const amountText = (n) => (n < 10 ? n.toFixed(1) : String(Math.round(n)));
const money = (n) => n.toFixed(2);
const locale = () => localeOf(getLang());
const dateText = (iso) => (iso ? new Date(`${iso}T12:00:00+08:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) : '');
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
    if (stop.charge) {
      const more = document.createElement('span');
      const c = stop.charge;
      more.textContent = t('evStopDetail', { time: c.minutes ? fmtDuration(c.minutes * 60, getLang()) : '?', to: c.to ?? '?', arrive: c.arrive ?? '?' });
      main.append(more);
    }
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'icon-btn';
    label(removeBtn, t('removeStop', { name: stop.name }), UI.close);
    removeBtn.addEventListener('click', () => {
      S.stops.splice(i, 1);
      if (!S.stops.some((st) => st.charge)) S.evPlan = null;
      mapView?.setStopPins(stopPins());
      loadRoutes();
    });
    row.append(icon, main, removeBtn);
    return row;
  }));

  renderPlanFuel(route);
  renderPlanArrive(route);
  renderPlanConvoy();
  renderPlanParking();
  renderPlanWeather(route);
  renderPlanMall();
  renderPlanPrayer(route);
  renderStrip($('preview-strip'), route, 0, false);
  // A line with nothing on it but the destination says nothing.
  $('preview-strip').hidden = !$('preview-strip').querySelector('.mark:not(.mark-end)');
}

function renderPlanFuel(route) {
  const v = pricedVehicle();
  const row = $('plan-fuel');
  row.hidden = S.mode === 'walk';
  const kind = v?.kind || 'petrol';
  $('plan-fuel-icon').innerHTML = kind === 'ev' ? UI.ev : UI.fuel;
  $('plan-fuel-edit').textContent = t(v ? 'vehEditBtn' : 'vehAddBtn');
  $('plan-level-row').hidden = !v?.range;
  $('plan-charge').hidden = true;
  $('plan-fuel-price').hidden = true;
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
      ? t('planUsedCost', { amount: amountText(plan.used), unit: plan.unit, cost: money(plan.cost) })
      : t('planUsed', { amount: amountText(plan.used), unit: plan.unit });
    // Where the price came from, when it wasn't typed in.
    if (plan.cost != null && v.priceFrom === 'official') {
      $('plan-fuel-price').hidden = false;
      $('plan-fuel-price').textContent = t(isStale(S.fuel) ? 'fuelPriceOld' : 'fuelPriceOfficial', { grade: t(`grade_${v.grade}`), price: money(v.price), date: dateText(S.fuel.date) });
    }
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
  // An electric car on a trip it can't make in one go: TomTom can say where to charge.
  const charging = S.stops.some((st) => st.charge);
  if (charging && S.evPlan) {
    detail = t('evArrive', { pct: S.evPlan.arrive ?? '?', time: fmtDuration(S.evPlan.charging * 60, getLang()) });
  }
  const canPlan = v.kind === 'ev' && !!CONFIG.server && !!evCar(v) && !charging && (plan.status === 'short' || plan.status === 'tight');
  $('plan-charge').hidden = !canPlan;
  $('plan-charge').textContent = t(S.evPlanning ? 'evPlanning' : 'evPlan');
  $('plan-charge').disabled = !!S.evPlanning;
  $('plan-fuel-detail').textContent = detail;
  row.classList.toggle('is-short', !charging && (plan.status === 'short' || plan.status === 'tight'));
  $('plan-level').value = String(v.level);
  $('plan-level-value').textContent = `${v.level}%`;
}

/* ---------- Charging stops for an electric car ---------- */

const chargeStop = (c) => ({
  name: c.name || t('evStopName'),
  lng: c.lng,
  lat: c.lat,
  category: 'ev',
  charge: { minutes: c.minutes, to: c.to, arrive: c.arrive },
});

async function planChargingStops() {
  const car = evCar(vehicle());
  const from = S.start || S.fix;
  if (!car || !from || S.evPlanning) return;
  S.evPlanning = true;
  renderPlanFuel(S.routes[S.selected]);
  try {
    const own = S.stops.filter((st) => !st.charge);
    const res = await planCharging({ from, to: routeEnd(), stops: own, car, avoidTolls: S.avoidTolls });
    if (S.view !== 'preview') return;
    if (!res.stops?.length) {
      toast(t('evNoneNeeded', { pct: res.arrive ?? '?' }));
      return;
    }
    // Each charger goes before whichever of your own stops comes next.
    const next = [];
    own.forEach((st, i) => {
      next.push(...res.stops.filter((c) => c.before === i).map(chargeStop), st);
    });
    next.push(...res.stops.filter((c) => c.before >= own.length).map(chargeStop));
    S.stops = next;
    S.evPlan = { arrive: res.arrive, charging: res.charging || 0 };
    mapView?.setStopPins(stopPins());
    toast(t('evPlanned', { n: res.stops.length }));
    loadRoutes();
  } catch (e) {
    toast(t(e?.kind === 'no way to charge' ? 'evNoWay' : 'evFailed'));
  } finally {
    S.evPlanning = false;
    if (S.view === 'preview' && S.routes[S.selected]) renderPlanFuel(S.routes[S.selected]);
  }
}

/* ---------- Leaving on time ---------- */

// When to leave, from how traffic usually is at that hour, as TomTom knows it.
function askLeave(route, arrive, key) {
  clearTimeout(S.leaveTimer);
  S.leaveAsk = { key, leave: null };
  S.leaveTimer = setTimeout(() => {
    fetchTraffic(route, 0, { arriveAt: arrive }).then((tr) => {
      if (S.leaveAsk?.key !== key || !tr.leave || Number.isNaN(tr.leave.getTime())) return;
      S.leaveAsk.leave = tr.leave;
      if (S.view === 'preview' && S.routes[S.selected] === route) renderPlanArrive(route);
    }).catch(() => { /* the plain estimate stands */ });
  }, 700);
}

function renderPlanArrive(route) {
  const lang = getLang();
  const time = $('plan-arrive-time').value;
  const now = Date.now();
  const plan = route ? leaveBy(now, time, withTraffic(route)) : null;
  let usual = false;
  if (plan && CONFIG.server && S.settings.traffic && S.mode !== 'walk') {
    const key = `${route.id}|${time}|${plan.arrive.getTime()}`;
    const known = S.leaveAsk?.key === key ? S.leaveAsk.leave : null;
    if (known) {
      const travel = (plan.arrive.getTime() - known.getTime()) / 1000;
      Object.assign(plan, { leave: known, late: known.getTime() < now, lateBy: Math.max(0, (now - known.getTime()) / 1000), arriveIfNow: new Date(now + travel * 1000) });
      usual = true;
    } else if (S.leaveAsk?.key !== key) {
      askLeave(route, plan.arrive, key);
    }
  }
  const clock = (date, tomorrow) => `${fmtClock(date, lang)}${tomorrow ? ` ${t('tomorrow')}` : ''}`;
  if (!plan) {
    $('plan-arrive-title').textContent = t('arriveTitle');
    $('plan-arrive-detail').textContent = t('arriveHint');
  } else if (plan.late) {
    $('plan-arrive-title').textContent = t('leaveLate', { time: fmtDuration(plan.lateBy, lang) });
    $('plan-arrive-detail').textContent = t('leaveLateDetail', { clock: fmtClock(plan.arriveIfNow, lang) });
  } else {
    $('plan-arrive-title').textContent = t('leaveBy', { clock: clock(plan.leave, plan.leave.getDate() !== new Date().getDate()) });
    $('plan-arrive-detail').textContent = t(usual ? 'leaveByUsual' : 'leaveByDetail', { clock: clock(plan.arrive, plan.tomorrow) });
  }
  $('plan-arrive').classList.toggle('is-late', !!plan?.late);
}

/* ---------- Parking at the destination ---------- */

function loadParking(place) {
  S.parkingCtrl?.abort();
  S.parking = null;
  if (S.mode === 'walk' || !place) return;
  const key = `${place.lng.toFixed(5)},${place.lat.toFixed(5)},${S.mode}`;
  const ctrl = new AbortController();
  S.parkingCtrl = ctrl;
  S.parking = { key, state: 'loading', list: [] };
  findParking(place, { mode: S.mode, signal: ctrl.signal, tileUrl: mapView?.tileUrl() }).then((list) => {
    if (S.parking?.key !== key) return;
    S.parking = { key, state: 'ready', list };
  }).catch(() => {
    if (S.parking?.key === key) S.parking = { key, state: 'error', list: [] };
  }).finally(() => {
    if (S.view === 'preview') renderPlanParking();
  });
}

function renderPlanParking() {
  const wrap = $('plan-parking-wrap');
  const found = S.parking;
  const park = S.parkAt;
  const show = S.mode !== 'walk' && !!S.dest && (!!park || found?.state === 'loading' || (found?.state === 'ready' && found.list.length > 0));
  wrap.hidden = !show;
  if (!show) return;
  const list = $('parking-list');
  $('plan-parking-clear').hidden = !park;
  if (park) {
    const walk = haversine([park.lng, park.lat], [S.dest.lng, S.dest.lat]);
    $('plan-parking-title').textContent = t('parkingChosen', { name: park.name || t('parkingUnnamed') });
    $('plan-parking-detail').textContent = t('parkingWalk', { distance: fmtDistance(walk) });
  } else if (found.state === 'loading') {
    $('plan-parking-title').textContent = t('parkingTitle');
    $('plan-parking-detail').textContent = t('parkingFinding');
  } else {
    const n = found.list.length;
    const distance = fmtDistance(found.list[0].distance);
    $('plan-parking-title').textContent = t('parkingTitle');
    $('plan-parking-detail').textContent = n === 1 ? t('parkingOne', { distance }) : t('parkingCount', { n, distance });
  }
  const open = !!S.parkingOpen && found?.state === 'ready' && found.list.length > 0;
  $('plan-parking').setAttribute('aria-expanded', String(open));
  list.hidden = !open;
  if (!open) return;
  list.replaceChildren(...found.list.map((p) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const name = document.createElement('strong');
    name.textContent = p.name || t('parkingUnnamed');
    const far = document.createElement('span');
    far.textContent = t('parkingFrom', { distance: fmtDistance(p.distance) });
    btn.append(name, far);
    btn.addEventListener('click', () => chooseParking(p));
    li.append(btn);
    return li;
  }));
}

function chooseParking(p) {
  S.parkAt = { name: p.name || t('parkingUnnamed'), detail: '', lng: p.lng, lat: p.lat, country: S.dest?.country || '' };
  S.parkingOpen = false;
  mapView?.setStopPins(stopPins());
  loadRoutes();
}

function clearParking() {
  S.parkAt = null;
  S.parkingOpen = false;
  mapView?.setStopPins(stopPins());
  loadRoutes();
}

/* ---------- Where's my car ---------- */

function savedCar() {
  const car = load('car', null);
  return car && Date.now() - car.at < CAR_KEEP_MS ? car : null;
}

function saveCar(spot, name = '') {
  save('car', { lng: spot.lng, lat: spot.lat, at: Date.now(), name, note: '' });
  renderCarPill();
}

function setCarNote(note) {
  const car = savedCar();
  if (car) save('car', { ...car, note: note.trim().slice(0, 60) });
  renderCarPill();
}

function forgetCar() {
  remove('car');
  mapView?.setCarPin(null);
  renderCarPill();
}

function carClock(car) {
  const lang = getLang();
  const at = new Date(car.at);
  const clock = fmtClock(at, lang);
  if (at.toDateString() === new Date().toDateString()) return clock;
  return `${clock}, ${at.toLocaleDateString(localeOf(lang), { day: 'numeric', month: 'short' })}`;
}

const carDistance = (car) => (S.fix ? haversine([S.fix.lng, S.fix.lat], [car.lng, car.lat]) : null);

function renderCarPill() {
  const car = savedCar();
  $('car-pill').hidden = !car;
  if (!car) return;
  const far = carDistance(car);
  const parts = [];
  if (far != null && far >= 30) parts.push(fmtDistance(far));
  parts.push(car.note || t('carParkedAt', { clock: carClock(car) }));
  $('car-pill-title').textContent = t('yourCar');
  $('car-pill-detail').textContent = parts.join(' · ');
  $('car-pill').setAttribute('aria-label', `${t('yourCar')}. ${parts.join(', ')}`);
}

function renderCarSheet() {
  const car = savedCar();
  $('car-title').textContent = car ? t('yourCar') : t('carSaveTitle');
  if (car) {
    const far = carDistance(car);
    $('car-detail').textContent = [
      car.name ? t('carNear', { place: car.name }) : '',
      t('carParkedAt', { clock: carClock(car) }),
      far != null && far >= 30 ? t('carAway', { distance: fmtDistance(far) }) : '',
    ].filter(Boolean).join('. ');
  } else {
    $('car-detail').textContent = t('carSaveText');
  }
  $('car-note-wrap').hidden = !car;
  $('car-note').value = car?.note || '';
  $('car-go').textContent = car ? t('carWalk') : t('carSaveHere');
  $('car-here').hidden = !car || !S.fix;
  $('car-found').hidden = !car;
}

function openCar() {
  renderCarSheet();
  openOverlay('car');
}

function saveCarHere() {
  if (!S.fix) {
    toast(t(S.gpsDenied ? 'gpsDenied' : 'gpsNone'), 6000);
    return;
  }
  const note = savedCar()?.note || '';
  saveCar(S.fix);
  if (note) setCarNote(note);
  mapView?.setCarPin(savedCar());
  renderCarSheet();
  toast(t('carSaved'));
}

function walkToCar() {
  const car = savedCar();
  if (!car) return;
  S.afterBack = () => {
    S.returnMode = S.mode === 'walk' ? (S.returnMode || load('mode', 'car')) : S.mode;
    S.mode = 'walk';
    S.carDirty = true;
    goTo({ name: t('yourCar'), detail: car.note || '', lng: car.lng, lat: car.lat, country: '', isCar: true }, { remember: false });
  };
  history.back();
}

/* ---------- Places on the map, and nearby ---------- */

// Straight to the route preview for a place.
function goTo(place, { remember = true } = {}) {
  gps.start();
  voice.unlockVoice();
  if (remember) addRecent(place);
  S.stops = [];
  S.start = null;
  pushHistory('preview');
  openPreview(place);
}

function onPlaceTap(place) {
  if (S.view !== 'idle' || (S.overlay && S.overlay !== 'placecard')) return;
  const lang = getLang();
  S.tapped = { name: place.name, detail: kindLabel(place.kind, lang), lng: place.lng, lat: place.lat, country: '' };
  $('placecard-name').textContent = place.name;
  const far = S.fix ? haversine([S.fix.lng, S.fix.lat], [place.lng, place.lat]) : null;
  $('placecard-detail').textContent = [S.tapped.detail, far != null ? t('placeAway', { distance: fmtDistance(far) }) : ''].filter(Boolean).join(' · ');
  mapView?.setDestination(place);
  if (S.overlay !== 'placecard') openOverlay('placecard');
}

function goTapped() {
  const place = S.tapped;
  if (!place) return;
  S.afterBack = () => goTo(place);
  history.back();
}

function openExplore(category) {
  gps.start();
  S.exploreCat = category;
  if (S.overlay !== 'explore') openOverlay('explore');
  renderExploreCats();
  loadNearby();
}

function renderExploreCats() {
  $('explore-cats').replaceChildren(...NEARBY_ORDER.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cat';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(c === S.exploreCat));
    b.innerHTML = CATEGORY_ICONS[c];
    b.append(t(`cat_${c}`));
    b.setAttribute('aria-label', t(`near_${c}`));
    b.addEventListener('click', () => {
      if (c === S.exploreCat) return;
      S.exploreCat = c;
      renderExploreCats();
      loadNearby();
    });
    return b;
  }));
}

async function loadNearby() {
  S.nearbyCtrl?.abort();
  const ctrl = new AbortController();
  S.nearbyCtrl = ctrl;
  const category = S.exploreCat;
  const home = CONFIG.home.center;
  const center = S.fix ? { lng: S.fix.lng, lat: S.fix.lat } : mapView?.center() || { lng: home[0], lat: home[1] };
  $('explore-where').textContent = t(S.fix ? 'nearYou' : 'nearMap');
  const status = $('explore-status');
  status.classList.remove('is-error');
  status.textContent = t('nearbySearching');
  $('explore-list').replaceChildren();
  mapView?.setPins([], pickNearby);
  try {
    const found = await findNearby(center, category, { signal: ctrl.signal, tileUrl: mapView?.tileUrl() });
    if (ctrl.signal.aborted) return;
    S.nearby = found.map((p) => ({ ...p, name: p.name || t(`unnamed_${category}`), category, label: p.name || t(`unnamed_${category}`) }));
    renderNearby(center);
    status.textContent = S.nearby.length ? '' : t('nearbyNone');
  } catch {
    if (ctrl.signal.aborted) return;
    status.classList.add('is-error');
    const msg = document.createElement('p');
    msg.textContent = t('nearbyFailed');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'link-btn';
    retry.textContent = t('retry');
    retry.addEventListener('click', loadNearby);
    status.replaceChildren(msg, retry);
  }
}

function renderNearby(center) {
  const lang = getLang();
  $('explore-list').replaceChildren(...S.nearby.map((p) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'place';
    const strong = document.createElement('strong');
    strong.textContent = p.name;
    const span = document.createElement('span');
    span.textContent = [fmtDistance(p.distance), kindLabel(p.kind, lang)].filter(Boolean).join(' · ');
    btn.append(strong, span);
    btn.addEventListener('click', () => pickNearby(p));
    li.append(btn);
    return li;
  }));
  mapView?.setPins(S.nearby, pickNearby);
  if (S.nearby.length) {
    const pad = { top: 120, bottom: $('explore').offsetHeight + 30, left: 40, right: 40 };
    mapView?.fit([[[center.lng, center.lat], ...S.nearby.slice(0, 12).map((p) => [p.lng, p.lat])]], pad);
  }
}

function pickNearby(p) {
  const place = { name: p.name, detail: kindLabel(p.kind, getLang()), lng: p.lng, lat: p.lat, country: '' };
  S.afterBack = () => goTo(place);
  history.back();
}

function closeExplore() {
  S.nearbyCtrl?.abort();
  mapView?.setPins([], pickNearby);
}

/* ---------- Home and work ---------- */

const SAVED_KINDS = ['home', 'work'];
const savedPlaces = () => load('saved', {});
const savingPlace = () => SAVED_KINDS.includes(S.searchFor);

function setSaved(kind, place) {
  const { name, detail, lng, lat, country } = place;
  save('saved', { ...savedPlaces(), [kind]: { name, detail: detail || '', lng, lat, country: country || '' } });
  delete S.savedEta?.[kind];
  renderSaved();
  toast(t('savedDone', { name: t(kind) }));
  refreshSavedEtas();
  // A morning alert follows home and work wherever they move to.
  changeCommute({});
}

function removeSaved(kind) {
  const all = savedPlaces();
  delete all[kind];
  save('saved', all);
  delete S.savedEta?.[kind];
  renderSaved();
  changeCommute({});
}

function openSavedSearch(kind) {
  gps.start();
  S.searchFor = kind;
  pushHistory('search');
  show('search');
  resetSearch();
}

function goSaved(kind) {
  const place = savedPlaces()[kind];
  if (!place) { openSavedSearch(kind); return; }
  voice.unlockVoice();
  S.stops = [];
  S.start = null;
  pushHistory('preview');
  openPreview({ ...place, name: place.name || t(kind) });
}

function renderSaved() {
  const all = savedPlaces();
  const lang = getLang();
  for (const kind of SAVED_KINDS) {
    const place = all[kind];
    const btn = $(`saved-${kind}`);
    btn.classList.toggle('is-unset', !place);
    $(`saved-${kind}-name`).textContent = t(kind);
    let detail = t('savedSet');
    if (place) {
      const eta = S.savedEta?.[kind];
      if (eta?.here) detail = t('savedHere');
      else if (eta?.time != null) detail = t('savedEta', { time: fmtDuration(eta.time, lang), clock: fmtClock(new Date(Date.now() + eta.time * 1000), lang) });
      else detail = place.name;
    }
    $(`saved-${kind}-detail`).textContent = detail;
    btn.setAttribute('aria-label', `${t(kind)}. ${detail}`);
  }
  $('saved-list').replaceChildren(...SAVED_KINDS.map((kind) => {
    const place = all[kind];
    const li = document.createElement('li');
    const what = document.createElement('div');
    what.className = 'saved-what';
    const title = document.createElement('strong');
    title.textContent = t(kind);
    const where = document.createElement('span');
    where.textContent = place ? place.name : t('savedNotSet');
    what.append(title, where);
    const change = document.createElement('button');
    change.type = 'button';
    change.className = 'link-btn';
    change.textContent = place ? t('savedChange') : t('savedSet');
    change.setAttribute('aria-label', t('savedChangeAria', { name: t(kind) }));
    // Out of settings first, then the search.
    change.addEventListener('click', () => { S.afterBack = () => openSavedSearch(kind); history.back(); });
    li.append(what, change);
    if (place) {
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'link-btn';
      drop.textContent = t('savedRemove');
      drop.setAttribute('aria-label', t('savedRemoveAria', { name: t(kind) }));
      drop.addEventListener('click', () => removeSaved(kind));
      li.append(drop);
    }
    return li;
  }));
}

// How long to get home, or to work, from here. Asked again after a while, or a move.
async function refreshSavedEtas() {
  const fix = S.fix;
  if (!fix || S.savedBusy) return;
  const all = savedPlaces();
  S.savedEta ??= {};
  S.savedBusy = true;
  try {
    for (const kind of SAVED_KINDS) {
      const place = all[kind];
      if (!place) continue;
      const here = [fix.lng, fix.lat];
      const known = S.savedEta[kind];
      if (known && Date.now() - known.at < SAVED_FRESH_MS && haversine(here, known.from) < SAVED_MOVED_M) continue;
      if (haversine(here, [place.lng, place.lat]) < 300) {
        S.savedEta[kind] = { at: Date.now(), from: here, here: true };
        continue;
      }
      try {
        const [route] = await fetchRoutes({ from: fix, to: place, stops: [], mode: driveMode(), avoidTolls: S.avoidTolls });
        S.savedEta[kind] = { at: Date.now(), from: here, time: route.time };
      } catch {
        // Tried, and not again straight away. The name is shown meanwhile.
        S.savedEta[kind] = { at: Date.now(), from: here };
      }
    }
  } finally {
    S.savedBusy = false;
    renderSaved();
  }
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
  mapView?.setStopPins(stopPins());
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
  save('trip', { dest: S.dest, parkAt: S.parkAt || null, stops: S.stops, mode: S.mode, avoidTolls: S.avoidTolls, at: Date.now() });
}

function startGuidance({ simulate }) {
  S.guidance = new Guidance(S.route, { walking: S.mode === 'walk' });
  S.greeted = false;
  // Driving time carries on into the next trip unless there was a proper rest.
  const before = load('driveTime', null);
  const carried = !simulate && before && Date.now() - before.at < RESTED_MS ? before.ms : 0;
  S.watch = new DriveWatch({ driving: carried });
  S.driveTimeSavedAt = 0;
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
  S.crawl = new CrawlClock();
  S.lastDrivenS = null;
  S.rangeSpoken = 0;
  S.lastSignKey = null;
  S.camerasSaid = new Set();
  S.cameraPool = [];
  S.cameras = [];
  S.cameraFetchedAt = 0;
  loadCameras(S.route);
  S.tollPool = [];
  S.tolls = [];
  S.tollFetchedAt = 0;
  loadTolls(S.route);
  // Traffic looked up while choosing the route needn't be asked for again yet.
  S.traffic = S.route.traffic?.from === 0 && S.mode !== 'walk' ? S.route.traffic : null;
  S.trafficAt = S.traffic ? S.traffic.at : 0;
  S.trafficStopped = false;
  S.jamsSaid = new Set();
  S.faster = null;
  S.fasterDeclined = null;
  renderFaster();
  loadTraffic();
  S.limitAsks = 0;
  loadLimits(S.route);
  saveMapAhead(S.route);
  S.driveLog = !simulate && S.settings.keepDrive ? new DriveLog({ dest: S.dest, mode: S.mode, version: CONFIG.version }) : null;
  S.roadReports = [];
  S.roadPlaced = [];
  S.roadSaid = new Set();
  S.roadAsked = new Set();
  S.roadAt = 0;
  S.roadCtrl?.abort();
  S.roadCtrl = null;
  answerReport(null);
  $('report-alert').hidden = true;
  loadRoadReports();
  // A trip shared before Pintu was closed carries on when the trip does.
  if (!simulate && S.pendingShare) S.share = S.pendingShare;
  S.pendingShare = null;
  S.awayWarned = false;
  $('camera-alert').hidden = true;
  $('junction').hidden = true;
  S.cam = { ...(mapView ? mapView.camera() : { zoom: 16, pitch: 0 }), lane: 0 };
  S.poseStale = true;
  mapView?.setStart(null);
  mapView?.showRoutes([S.route], 0);
  mapView?.setStopPins(stopPins());

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
    S.simPlan = { dest: S.dest, parkAt: S.parkAt, start: S.start, stops: [...S.stops], routes: S.routes, selected: S.selected, changed: false };
    S.sim = new SimulatedDrive(S.route, receiveFix, { factor: S.settings.simSpeed });
    renderSimPanel();
    S.sim.start();
    remove('trip');
  } else {
    S.simPlan = null;
    renderSimPanel();
    saveTrip();
    const car = savedCar();
    if (car && S.mode !== 'walk' && (!S.fix || haversine([S.fix.lng, S.fix.lat], [car.lng, car.lat]) < CAR_SAME_M)) forgetCar();
    if (S.fix) onNavFix({ ...S.fix, time: Date.now() }, performance.now());
  }
}

function onNavFix(fix, takenAt) {
  const st = S.guidance.update(fix);
  S.lastState = st;

  const speed = fix.motionSpeed ?? fix.speed ?? 0;
  if (st.onRoute) motion.onRoute(st.s, speed, takenAt);
  else motion.offRoute(fix.lng, fix.lat, fix.heading, speed, takenAt);

  if (S.lastDrivenS != null && st.s > S.lastDrivenS) {
    const km = (st.s - S.lastDrivenS) / 1000;
    S.drivenKm += km;
    S.tripKm += km;
  }
  S.lastDrivenS = st.s;
  if (!S.sim) S.crawl?.add(fix.time ?? Date.now(), fix.speed);

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
  renderCamera(st, fix);
  renderRoadReport(st, fix);
  if (Date.now() - (S.roadAt || 0) > REPORTS_EVERY_MS) loadRoadReports();
  if (Date.now() - (S.trafficAt || 0) > TRAFFIC_EVERY_MS && !S.sim) loadTraffic();
  renderJam(st);
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
  for (const prompt of S.guidance.upcoming(fix.speed, 3)) {
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
  if (!S.sim && Date.now() - S.driveTimeSavedAt > DRIVE_TIME_SAVE_MS) saveDriveTime();
  for (const key of moments) {
    // A word about speed matters more than a remark about the view.
    if (!S.moment || SPEED_MOMENT.test(key) || !SPEED_MOMENT.test(S.moment.key)) S.moment = { key, time: fix.time, limit };
  }
  sayMoment(st, fix);
}

function saveDriveTime() {
  if (!S.watch || S.sim) return;
  S.driveTimeSavedAt = Date.now();
  save('driveTime', { ms: S.watch.driving, at: Date.now() });
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
  mapView?.setStopPins(stopPins());
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
    $('sign-toward').textContent = d.toward ? t('towardSign', { to: d.toward }) : '';
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
  renderJunction(st);
}

// A picture of the exit or fork, so you know which way to go before you're there.
function renderJunction(st) {
  const box = $('junction');
  const next = st.next;
  const j = S.mode === 'walk' ? null : junctionFor(next);
  const range = next.highway || next.toll ? JUNCTION_RANGE.highway : JUNCTION_RANGE.road;
  if (!j || st.distanceToNext > range) {
    box.hidden = true;
    box.dataset.key = '';
    return;
  }
  box.hidden = false;
  const key = `${st.nextIndex}:${S.route.id}:${getLang()}`;
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.className = `junction take-${j.take}`;
    $('junction-pic').innerHTML = junctionSvg(j);
    $('junction-exit').textContent = j.exitNo ? `${t('exitWord')} ${j.exitNo}` : '';
    const where = [j.branch, j.toward].filter(Boolean).join(' · ') || describe(next, getLang()).road;
    $('junction-to').textContent = where;
    $('junction-board').hidden = !where && !j.exitNo;
  }
  $('junction-fill').style.width = `${Math.round(clamp(1 - st.distanceToNext / range, 0, 1) * 100)}%`;
}

// The lanes to show for the next turn, once it's close enough to matter.
function lanesNow(st) {
  const lanes = laneView(st.next?.lanes);
  const range = st.next?.highway || st.next?.toll ? LANE_RANGE_HIGHWAY : LANE_RANGE_ROAD;
  return lanes && st.distanceToNext <= range ? lanes : null;
}

function fillLanes(box, lanes) {
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

function renderLanes(st) {
  const lanes = lanesNow(st);
  const box = $('lanes');
  const showLanes = !!lanes;
  box.hidden = !showLanes;
  if (!showLanes) { box.dataset.key = ''; return; }
  fillLanes(box, lanes);
}

// Time still to go, with whatever the traffic ahead adds.
function timeLeft(st) {
  return st.remainingTime + (st.onRoute && S.settings.traffic ? delayAhead(S.traffic, st.s) : 0);
}

function renderEta(st) {
  const lang = getLang();
  const left = timeLeft(st);
  const clock = fmtClock(new Date(Date.now() + left * 1000), lang);
  $('eta-clock').textContent = fmtDuration(left, lang);
  $('eta-rest').textContent = t('arrivalIn', { distance: fmtDistance(st.remainingDistance), clock });
}

function currentLimit(st) {
  if (S.mode === 'walk' || !S.settings.speedLimit || !st.onRoute) return null;
  return limitAt(S.laneFetch?.limits, st.s) ?? limitAt(S.ttLimits, st.s);
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

/* ---------- Speed cameras ---------- */

function loadCameras(route) {
  S.cameraCtrl?.abort();
  if (!S.settings.speedCameras || S.mode === 'walk') return;
  const ctrl = new AbortController();
  S.cameraCtrl = ctrl;
  S.cameraFetchedAt = Date.now();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  fetchCameras(route, { signal: ctrl.signal }).then((found) => {
    S.cameraPool = found;
    if (S.view === 'nav' && S.route) S.cameras = camerasOnRoute(S.route, found);
  }).catch(() => { /* none known is the same as none mapped: nothing to warn about */ })
    .finally(() => clearTimeout(timer));
}

/* ---------- Live traffic, from TomTom ---------- */

function loadTraffic() {
  if (!S.settings.traffic || S.trafficStopped || S.noTrafficKey || S.mode === 'walk' || !S.route || S.trafficCtrl) return;
  const route = S.route;
  const from = S.lastState?.onRoute ? S.lastState.s : 0;
  const ctrl = new AbortController();
  S.trafficCtrl = ctrl;
  S.trafficAt = Date.now();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  // A quicker way is looked for only on a straight trip to one place.
  const better = !S.sim && S.mode !== 'walk' && !S.stops.length;
  fetchTraffic(route, from, { better, signal: ctrl.signal }).then((traffic) => {
    if (S.route !== route) return;
    S.traffic = traffic;
    considerFaster();
  }).catch((e) => {
    // No key, or a key TomTom won't take: stop asking for this trip.
    if (e?.kind === 'no key' || e?.kind === 'key refused' || e?.kind === 'daily limit') S.trafficStopped = true;
  }).finally(() => {
    clearTimeout(timer);
    if (S.trafficCtrl === ctrl) S.trafficCtrl = null;
  });
}

const FASTER_OFFER_MS = 30000;

async function considerFaster() {
  const traffic = S.traffic;
  const saving = fasterSaving(traffic);
  if (!saving || S.faster || S.fasterBusy || !S.fix) return;
  // Said no already: only ask again if it's become clearly better still.
  if (S.fasterDeclined != null && saving < S.fasterDeclined + 300) return;
  const through = throughPoints(traffic.better.path);
  if (!through.length) return;
  S.fasterBusy = true;
  try {
    const fix = S.fix;
    const [route] = await fetchRoutes({
      from: fix, to: routeEnd(), through, mode: S.mode, avoidTolls: S.avoidTolls,
      heading: (fix.speed ?? 0) > 3 ? fix.heading : null,
    });
    if (S.view !== 'nav' || S.traffic !== traffic) return;
    // It should follow TomTom's roads: about as long, not a detour of its own.
    const expected = traffic.better.length;
    if (expected && Math.abs(route.length - expected) > Math.max(1500, expected * 0.12)) return;
    S.faster = { route, saving };
    S.driveLog?.event('quicker way offered');
    renderFaster();
    clearTimeout(S.fasterTimer);
    S.fasterTimer = setTimeout(() => dismissFaster(), FASTER_OFFER_MS);
    if (S.settings.voiceLevel === 'full') speakText(t('fasterSay', { time: sayDuration(saving, getLang()) }), { wait: voice.WAIT_NORMAL_MS });
  } catch { /* stay on the current route */ } finally {
    S.fasterBusy = false;
  }
}

function renderFaster() {
  const box = $('faster');
  box.hidden = !S.faster;
  if (!S.faster) return;
  const lang = getLang();
  $('faster-title').textContent = t('fasterTitle', { time: fmtDuration(S.faster.saving, lang) });
  const via = S.faster.route.via?.length ? t('via', { road: S.faster.route.via.slice(0, 2).join(', ') }) : '';
  $('faster-detail').textContent = via;
  $('faster-detail').hidden = !via;
}

function dismissFaster() {
  clearTimeout(S.fasterTimer);
  S.faster = null;
  renderFaster();
}

function acceptFaster() {
  const offer = S.faster;
  if (!offer) return;
  dismissFaster();
  S.driveLog?.event('quicker way taken');
  useRoute(offer.route);
  toast(t('fasterTaken', { time: fmtDuration(offer.saving, getLang()) }));
}

function declineFaster() {
  if (S.faster) S.fasterDeclined = S.faster.saving;
  dismissFaster();
}

/* ---------- Speed limits from TomTom ---------- */

// OpenStreetMap's limits come first where they're mapped; TomTom fills the gaps.
function loadLimits(route) {
  S.limitsCtrl?.abort();
  S.ttLimits = [];
  if (!CONFIG.server || S.mode === 'walk' || !S.settings.speedLimit || (S.limitAsks || 0) >= 3) return;
  S.limitAsks = (S.limitAsks || 0) + 1;
  const ctrl = new AbortController();
  S.limitsCtrl = ctrl;
  fetchLimits(route, { signal: ctrl.signal }).then((limits) => {
    if (S.route === route) S.ttLimits = limits;
  }).catch(() => { /* only OpenStreetMap's, then */ });
}

function jamWords(near, lang) {
  return { kind: t(`jam_${near.jam.kind}`), distance: fmtDistance(Math.max(near.ahead, 10)), time: fmtDuration(near.delay, lang) };
}

function renderJam(st) {
  const box = $('jam-alert');
  const near = S.settings.traffic && st.onRoute && S.mode !== 'walk' ? jamAhead(S.traffic, st.s) : null;
  box.hidden = !near;
  if (!near) return;
  const lang = getLang();
  const words = jamWords(near, lang);
  const closed = near.jam.kind === 'ROAD_CLOSURE';
  box.dataset.kind = near.jam.kind;
  $('jam-icon').innerHTML = UI[JAM_ICONS[near.jam.kind]];
  $('jam-distance').textContent = near.inside ? t('jamLeft', { distance: fmtDistance(Math.max(near.left, 10)) }) : words.distance;
  $('jam-delay').hidden = closed || near.delay < 60;
  box.classList.toggle('is-dark-ink', near.jam.kind === 'BREAKDOWN' || near.jam.kind === 'HAZARD');
  $('jam-delay').textContent = t('jamDelay', { time: words.time });
  box.setAttribute('aria-label', t(near.inside ? 'jamAriaIn' : 'jamAria', { ...words, distance: near.inside ? fmtDistance(near.left) : words.distance }));
  const id = `${Math.round(near.jam.start / 50)}`;
  if (near.inside || near.ahead > JAM_SAY_M || S.jamsSaid.has(id)) return;
  if (!st.prompts.length && voice.busy()) return;
  S.jamsSaid.add(id);
  if (S.settings.voiceLevel !== 'full' || (S.sim && S.sim.factor >= SIM_FAST)) return;
  const say = { kind: words.kind, distance: sayDistance(near.ahead, lang), time: sayDuration(near.delay, lang) };
  const plain = closed || near.delay < 60;
  speakText(t(plain ? 'jamSayPlain' : 'jamSay', say), { wait: voice.WAIT_TURN_MS });
}

/* ---------- Toll plazas, for the HUD ---------- */

function loadTolls(route) {
  S.tollCtrl?.abort();
  if (S.mode === 'walk' || !route.hasToll) return;
  const ctrl = new AbortController();
  S.tollCtrl = ctrl;
  S.tollFetchedAt = Date.now();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  fetchTolls(route, { signal: ctrl.signal }).then((found) => {
    S.tollPool = found;
    if (S.view === 'nav' && S.route) S.tolls = tollsOnRoute(S.route, found);
  }).catch(() => { /* the HUD just won't mention plazas */ })
    .finally(() => clearTimeout(timer));
}

function renderCamera(st, fix) {
  const box = $('camera-alert');
  const near = S.settings.speedCameras && st.onRoute && S.mode !== 'walk' ? cameraAhead(S.cameras, st.s, fix.speed ?? 0) : null;
  box.hidden = !near;
  if (!near) return;
  const lang = getLang();
  const limit = near.camera.limit ?? currentLimit(st);
  const distance = fmtDistance(Math.max(near.ahead, 10));
  $('camera-distance').textContent = distance;
  box.setAttribute('aria-label', t('cameraAria', { distance }));
  $('camera-limit').hidden = !limit;
  $('camera-limit').textContent = limit ? String(limit) : '';
  if (S.camerasSaid.has(near.camera.id)) return;
  // Not over a direction that's being said, unless it's nearly too late.
  if (!st.prompts.length && voice.busy() && near.ahead > 150) return;
  S.camerasSaid.add(near.camera.id);
  if (S.settings.voiceLevel !== 'full' || (S.sim && S.sim.factor >= SIM_FAST)) return;
  const words = { distance: sayDistance(near.ahead, lang), limit };
  speakText(t(limit ? 'cameraSayLimit' : 'cameraSay', words), { wait: voice.WAIT_TURN_MS });
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
  S.driveLog?.event(added ? 'stop added' : 'reroute');
  if (!S.rerouteFailed && !added) speakText(dress(S.settings.voiceCharacter, 'reroute', t('rerouteSay'), getLang()));
  renderChips();
  try {
    const moving = (fix.speed ?? 0) > 3;
    const [route] = await fetchRoutes({
      from: fix,
      to: routeEnd(),
      stops: S.stops,
      mode: S.mode,
      avoidTolls: S.avoidTolls,
      heading: moving ? fix.heading : null,
    });
    if (S.view !== 'nav') return;
    useRoute(route);
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

// A new route mid-trip: everything that follows the route starts again on it.
function useRoute(route) {
  S.route = route;
  S.guidance = new Guidance(route, { walking: S.mode === 'walk' });
  motion.setRoute(route);
  startScene(route);
  S.cameras = camerasOnRoute(route, S.cameraPool || []);
  if (Date.now() - (S.cameraFetchedAt || 0) > CAMERA_REFETCH_MS) loadCameras(route);
  S.tolls = tollsOnRoute(route, S.tollPool || []);
  if (Date.now() - (S.tollFetchedAt || 0) > CAMERA_REFETCH_MS) loadTolls(route);
  placeRoadReports();
  // Traffic for the old route doesn't belong to this one.
  S.traffic = null;
  S.jamsSaid = new Set();
  S.trafficAt = Math.min(S.trafficAt || 0, Date.now() - TRAFFIC_EVERY_MS + TRAFFIC_AGAIN_MS);
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
  dismissFaster();
  loadLimits(route);
  saveMapAhead(route, S.lastState?.onRoute ? S.lastState.s : 0);
  if (S.fix) onNavFix({ ...S.fix, time: Date.now() }, performance.now());
}

// Which route server answered last, so it's easy to see the backups at work.
function renderVersion() {
  const from = { stadia: 'Stadia Maps', fossgis: 'FOSSGIS', tomtom: 'TomTom' }[load('lastProvider', '')];
  $('version').textContent = from ? t('versionFrom', { v: CONFIG.version, from }) : t('version', { v: CONFIG.version });
}

/* ---------- Problem reports ---------- */

function reportInfo() {
  const s = S.settings;
  const used = usage();
  const drive = lastDrive();
  const attach = !!drive && $('report-drive').checked && !$('report-drive-row').hidden;
  const on = (k) => (s[k] ? 'on' : 'off');
  return {
    version: CONFIG.version,
    note: $('report-note').value.trim(),
    agent: navigator.userAgent,
    screen: `${innerWidth}×${innerHeight} @${window.devicePixelRatio || 1}x`,
    installed: matchMedia('(display-mode: standalone)').matches,
    online: navigator.onLine !== false,
    lang: getLang(),
    theme: s.theme,
    voice: `${s.voiceLevel}, ${s.voiceCharacter || 'standard'}`,
    gps: S.gpsDenied ? 'refused' : S.fix ? `last accuracy ${Math.round(S.fix.accuracy ?? 0)} m` : 'no reading yet',
    settings: `3D ${on('view3d')}, traffic ${on('traffic')}, traffic map ${on('trafficMap')}, cameras ${on('speedCameras')}, limits ${on('speedLimit')}, offline map ${on('offlineMap')}`,
    tomtom: `${used.today} today, ${used.month} this month`,
    map: mapView ? 'loaded' : 'failed to load',
    provider: S.route?.provider || S.routes?.[S.selected]?.provider || '',
    drive,
    attached: attach,
    errors: recentErrors(),
  };
}

async function sendReport() {
  const info = reportInfo();
  try {
    const how = await shareReport({ text: reportText(info), drive: info.attached ? info.drive : null });
    if (how === 'copied') toast(t('reportCopied'));
    $('report-note').value = '';
  } catch (e) {
    // Closing the share sheet isn't a failure.
    if (e?.name === 'AbortError') return;
    rememberError(`report: ${e?.name || ''} ${e?.message || ''}`.trim(), 'share');
    toast(t('reportFailed', { why: e?.name || 'Error' }));
  }
}

/* ---------- The route's map, kept for no signal ---------- */

const MAP_SAVE_WAIT_MS = 4000;

function saveMapAhead(route, from = 0) {
  S.mapSaveCtrl?.abort();
  if (!S.settings.offlineMap || S.sim || !canSaveMap()) return;
  const template = mapView?.tileUrl() || CONFIG.poiTiles;
  if (!template) return;
  const ctrl = new AbortController();
  S.mapSaveCtrl = ctrl;
  // The map and the first directions come first; this can wait a moment.
  setTimeout(() => {
    if (ctrl.signal.aborted) return;
    saveRouteMap(route, template, { from, signal: ctrl.signal }).then((r) => {
      if (r.saved) save('mapSaved', { at: Date.now(), tiles: r.saved, bytes: r.bytes });
    }).catch(() => { /* the map works as before */ });
  }, MAP_SAVE_WAIT_MS);
}

function keepVehicleLevel() {
  const v = vehicle();
  if (!v || S.sim) return;
  v.level = levelAfter(v, S.drivenKm);
  saveVehicles();
  renderRangePill();
}

// A line for the monthly summary, kept on this phone.
function keepTripSummary() {
  if (S.sim || !S.guidance || S.mode === 'walk' || !S.settings.keepTrips) return;
  const plan = tripPlan(pricedVehicle(), S.tripKm);
  recordTrip({ km: S.tripKm, s: S.crawl?.span || (Date.now() - S.tripStart) / 1000, slow: S.crawl?.slow || 0, cost: plan?.cost ?? null, mode: S.mode, to: S.dest?.name || '' });
}

// The trip's over one way or another: put everything back.
function stopGuidance() {
  keepTripSummary();
  S.crawl = null;
  S.roadCtrl?.abort();
  S.roadCtrl = null;
  S.roadReports = [];
  S.roadPlaced = [];
  mapView?.setReports([], ROAD_ICONS);
  answerReport(null);
  $('report-alert').hidden = true;
  if (!S.sim) {
    stopSharing(!!S.arriving);
    // Friends see you've arrived; after that, nothing more is sent.
    const c = S.convoy;
    if (c && S.arriving) {
      c.send({ fix: S.fix, eta: Date.now(), remaining: 0 }).finally(() => c.stop());
      S.convoy = null;
      mapView?.setFriends([]);
    }
  }
  S.arriving = false;
  S.cameraCtrl?.abort();
  S.cameras = [];
  S.tollCtrl?.abort();
  S.tolls = [];
  S.trafficCtrl?.abort();
  S.trafficCtrl = null;
  S.traffic = null;
  $('jam-alert').hidden = true;
  dismissFaster();
  S.limitsCtrl?.abort();
  S.ttLimits = [];
  S.mapSaveCtrl?.abort();
  S.driveLog?.save();
  S.driveLog = null;
  saveDriveTime();
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
  const v = pricedVehicle();
  if (v?.consumption) {
    const plan = tripPlan(v, S.tripKm);
    parts.push(plan.cost != null
      ? t('statsUsedCost', { amount: amountText(plan.used), unit: plan.unit, cost: money(plan.cost) })
      : t('statsUsed', { amount: amountText(plan.used), unit: plan.unit }));
  }
  return parts.join(', ');
}

function finishTrip() {
  S.driveLog?.event('arrived');
  const place = S.dest;
  const onFoot = S.mode === 'walk';
  const simulated = !!S.sim;
  $('arrival-stats').textContent = arrivalStats();
  S.arriving = true;
  stopGuidance();
  mapView?.clearRoutes();
  mapView?.setDestination(null);
  mapView?.setStopPins([]);
  mapView?.flat();
  S.dest = null;
  S.start = null;
  S.parkAt = null;
  $('arrival-place').textContent = place ? place.name : '';
  S.arrivedAt = place;
  // A drive that ended here left the car here.
  const drove = !onFoot && !simulated;
  if (drove) {
    const spot = S.fix || place;
    if (spot) saveCar(spot, place?.name || '');
    $('arrival-car-text').textContent = t('carRemembered');
    $('arrival-car-note').value = '';
  }
  $('arrival-car').hidden = !drove;
  if (onFoot && !simulated && place?.isCar) forgetCar();
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
  S.parkAt = null;
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
  S.parkAt = plan.parkAt;
  S.start = plan.start;
  S.stops = plan.stops;
  S.routes = plan.routes;
  S.selected = plan.selected;
  S.overlay = null;
  mapView?.level();
  mapView?.setDestination(S.dest);
  mapView?.setStart(S.start);
  mapView?.setStopPins(stopPins());
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
    btn.append(name, about);
    // Accents come only with the human voices. The phone's voice is the same for all.
    if (voice.humanVoicesOffered()) {
      const tag = document.createElement('small');
      tag.textContent = characterTag(id, lang);
      btn.append(tag);
    }
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
    if (heard !== 'phone' || !voice.humanVoicesOffered() || !castSpeaks()) return;
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

function renderHudInk() {
  const ink = HUD_INKS.includes(S.settings.hudInk) ? S.settings.hudInk : 'white';
  $('hudmode').dataset.ink = ink;
  $('hm-inks').setAttribute('aria-label', t('hudInk'));
  $('hm-inks').replaceChildren(...HUD_INKS.map((name) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `hm-ink ink-${name}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(name === ink));
    b.setAttribute('aria-label', t(`ink_${name}`));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      setSetting('hudInk', name);
      renderHudInk();
      showHudControls();
    });
    return b;
  }));
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
  const left = timeLeft(st);
  $('hm-eta').replaceChildren(fmtDuration(left, lang));
  const rest = document.createElement('span');
  rest.textContent = fmtClock(new Date(Date.now() + left * 1000), lang);
  $('hm-eta').append(rest);

  const lanes = S.mode === 'walk' ? null : lanesNow(st);
  $('hm-lanes').hidden = !lanes;
  $('hm-face').classList.toggle('has-lanes', !!lanes);
  if (lanes) fillLanes($('hm-lanes'), lanes);
  else $('hm-lanes').dataset.key = '';

  const toll = st.onRoute && S.mode !== 'walk' ? tollAhead(S.tolls, st.s) : null;
  $('hm-toll').hidden = !toll;
  if (toll) $('hm-toll-distance').textContent = fmtDistance(Math.max(toll.ahead, 10));
  const jam = S.settings.traffic && st.onRoute && S.mode !== 'walk' ? jamAhead(S.traffic, st.s) : null;
  $('hm-jam').hidden = !jam;
  if (jam) {
    $('hm-jam-icon').innerHTML = UI[JAM_ICONS[jam.jam.kind]];
    $('hm-jam-word').textContent = t(`jam_${jam.jam.kind}`);
    $('hm-jam-distance').textContent = jam.inside ? '' : fmtDistance(Math.max(jam.ahead, 10));
    $('hm-jam-more').textContent = jam.jam.kind === 'ROAD_CLOSURE' || (!jam.inside && jam.delay < 60) ? ''
      : jam.inside ? t('jamLeft', { distance: fmtDistance(Math.max(jam.left, 10)) }) : t('jamDelay', { time: fmtDuration(jam.delay, lang) });
  }

  const tired = !!(S.watch?.tired && S.mode !== 'walk');
  $('hm-rest').hidden = !tired;
  // Upright there's only room for one, so the most pressing goes first.
  const first = [['hm-toll', toll], ['hm-jam', jam], ['hm-rest', tired]].find(([, on]) => on)?.[0];
  for (const id of ['hm-toll', 'hm-jam', 'hm-rest']) $(id).classList.toggle('is-first', id === first);
  if (tired) $('hm-rest-more').textContent = t('hudRestMore', { hours: Math.floor(S.watch.driving / 3600000) });
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
  mapView?.setStopPins(stopPins());
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
  mapView?.setRemaining(route, s);
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

window.addEventListener('error', (e) => rememberError(e.message, e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : ''));
window.addEventListener('unhandledrejection', (e) => rememberError(e.reason?.message || String(e.reason), 'promise'));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    S.hiddenAt = Date.now();
    if (S.view === 'nav' && !S.sim) {
      S.driveLog?.event('left the app');
      S.driveLog?.save();
      // A web page gets no location while another app is in front, so say so,
      // once a trip, while there's still a moment to speak.
      if (!S.awayWarned && S.settings.voiceLevel !== 'off' && window.speechSynthesis) {
        S.awayWarned = true;
        try {
          const u = new SpeechSynthesisUtterance(t('awaySay'));
          u.lang = voice.chooseVoice(window.speechSynthesis.getVoices?.() || [], getLang()).tag;
          window.speechSynthesis.speak(u);
        } catch { /* nothing to be done */ }
      }
    }
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
  S.parkAt = trip.parkAt || null;
  pushHistory('preview');
  openPreview(trip.dest, { keepParking: true });
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
  // The morning message comes in the language Pintu speaks.
  if (commuteSettings().on) changeCommute({});
}

function wire() {
  $('preview').addEventListener('animationend', updateBottomInset);
  $('where').addEventListener('click', openSearch);
  $('saved-home').addEventListener('click', () => goSaved('home'));
  $('car-pill').addEventListener('click', openCar);
  $('car-back').addEventListener('click', () => history.back());
  $('car-go').addEventListener('click', () => (savedCar() ? walkToCar() : saveCarHere()));
  $('car-here').addEventListener('click', saveCarHere);
  $('car-found').addEventListener('click', () => { forgetCar(); history.back(); });
  $('car-note').addEventListener('change', (e) => setCarNote(e.target.value));
  $('arrival-car-note').addEventListener('change', (e) => setCarNote(e.target.value));
  $('placecard-back').addEventListener('click', () => history.back());
  $('placecard-go').addEventListener('click', goTapped);
  $('explore-back').addEventListener('click', () => history.back());
  for (const b of document.querySelectorAll('.explore-chip')) b.addEventListener('click', () => openExplore(b.dataset.cat));
  $('saved-work').addEventListener('click', () => goSaved('work'));
  $('camera-on').addEventListener('change', (e) => {
    setSetting('speedCameras', e.target.checked);
    if (!e.target.checked) $('camera-alert').hidden = true;
  });
  $('offline-on').addEventListener('change', (e) => setSetting('offlineMap', e.target.checked));
  $('keep-drive').addEventListener('change', (e) => {
    setSetting('keepDrive', e.target.checked);
    if (!e.target.checked) {
      forgetDrive();
      S.driveLog = null;
      $('report-drive-row').hidden = true;
    }
  });
  $('report-btn').addEventListener('click', sendReport);
  $('keep-trips').addEventListener('change', (e) => setSetting('keepTrips', e.target.checked));
  $('summary-open').addEventListener('click', openSummary);
  $('summary-back').addEventListener('click', () => history.back());
  $('month-prev').addEventListener('click', () => shiftMonth(-1));
  $('month-next').addEventListener('click', () => shiftMonth(1));
  $('month-forget').addEventListener('click', forgetMonths);
  for (const value of ['auto', 'on', 'off']) $(`saver-${value}`).addEventListener('click', () => setSaverSetting(value));
  $('search-mic').addEventListener('click', voiceSearch);
  $('where-mic').addEventListener('click', () => {
    openSearch();
    voiceSearch();
  });
  $('traffic-map-on').addEventListener('change', (e) => {
    setSetting('trafficMap', e.target.checked);
    syncTrafficMap();
  });
  $('btn-traffic').addEventListener('click', toggleTrafficMap);
  $('faster-yes').addEventListener('click', acceptFaster);
  $('faster-no').addEventListener('click', declineFaster);
  $('plan-charge').addEventListener('click', planChargingStops);
  $('traffic-on').addEventListener('change', (e) => {
    setSetting('traffic', e.target.checked);
    $('traffic-map-on').disabled = !e.target.checked;
    syncTrafficMap();
    if (!e.target.checked) {
      $('jam-alert').hidden = true;
      $('hm-jam').hidden = true;
    } else if (S.view === 'nav') {
      loadTraffic();
    }
  });
  $('plan-arrive-time').addEventListener('input', () => renderPlanArrive(S.routes[S.selected]));
  $('plan-parking').addEventListener('click', () => {
    if (S.parkAt || S.parking?.state !== 'ready') return;
    S.parkingOpen = !S.parkingOpen;
    renderPlanParking();
  });
  $('plan-parking-clear').addEventListener('click', clearParking);
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
    if (savingPlace()) {
      const kind = S.searchFor;
      if (!S.fix) { toast(t(S.gpsDenied ? 'gpsDenied' : 'gpsNone'), 6000); return; }
      S.afterBack = () => setSaved(kind, { name: t(kind), detail: '', lng: S.fix.lng, lat: S.fix.lat, country: '' });
      history.back();
      return;
    }
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
  $('resume-no').addEventListener('click', () => {
    remove('trip');
    $('resume').hidden = true;
    S.pendingShare?.end(false);
    S.pendingShare = null;
  });
  $('btn-share').addEventListener('click', shareTrip);
  $('btn-report').addEventListener('click', openRoadReport);
  $('report-back').addEventListener('click', () => history.back());
  $('report-still').addEventListener('click', () => answerReport(true));
  $('report-gone').addEventListener('click', () => answerReport(false));
  $('together-back').addEventListener('click', () => history.back());
  $('together-share').addEventListener('click', togetherShare);
  $('together-stop').addEventListener('click', togetherStop);
  $('convoy-bar').addEventListener('click', () => openTogether('convoy'));
  $('plan-convoy').addEventListener('click', startConvoy);
  $('join-yes').addEventListener('click', joinConvoy);
  $('join-no').addEventListener('click', () => history.back());
  $('join-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinConvoy(); });
  $('name-save').addEventListener('click', saveName);
  $('name-cancel').addEventListener('click', () => history.back());
  $('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveName(); });
  $('watch-back').addEventListener('click', () => history.back());
  $('watch-go').addEventListener('click', goToWatched);
  $('sharing-name').addEventListener('change', (e) => setSetting('name', e.target.value.replace(/\s+/g, ' ').trim().slice(0, 30)));
  $('commute-on').addEventListener('change', (e) => switchCommute(e.target.checked));
  $('commute-time').addEventListener('change', (e) => { if (/^\d\d:\d\d$/.test(e.target.value)) changeCommute({ time: e.target.value }); });
  $('commute-slow').addEventListener('change', (e) => changeCommute({ slowOnly: e.target.checked }));
  $('commute-test').addEventListener('click', testCommute);

  for (const l of LANGS) $(`lang-${l}`).addEventListener('click', () => changeLanguage(l));
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

/* ---------- With other people: shared trips, convoys, road reports ---------- */

const FRIEND_COLORS = ['#E8590C', '#9C36B5', '#2B8A3E', '#C2255C', '#1971C2', '#5F3DC4', '#0C8599', '#A61E4D'];
const ROAD_ICONS = { police: UI.police, crash: UI.crash, hazard: UI.hazard, jam: UI.trafficLight, closed: UI.closed };
const togetherReady = () => !!CONFIG.server;

// Your name, asked for once, the first time someone else will see it.
function ensureName(then) {
  if (S.settings.name) { then(); return; }
  S.afterName = then;
  $('name-input').value = '';
  openOverlay('name');
  setTimeout(() => $('name-input').focus(), 50);
}

function saveName() {
  const name = $('name-input').value.replace(/\s+/g, ' ').trim().slice(0, 30);
  if (!name) { $('name-input').focus(); return; }
  setSetting('name', name);
  $('sharing-name').value = name;
  const next = S.afterName;
  S.afterName = null;
  S.afterBack = next;
  history.back();
}

// The phone's share sheet, or the clipboard where there isn't one.
async function shareLink(url, text, title) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return true;
    } catch (e) {
      if (e?.name === 'AbortError') return false;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast(t('shareCopied'), 5000);
    return true;
  } catch {
    toast(url, 10000);
    return false;
  }
}

function tripNumbers() {
  const st = S.lastState;
  if (S.view === 'nav' && st) return { eta: Date.now() + timeLeft(st) * 1000, remaining: Math.round(st.remainingDistance) };
  const r = S.routes?.[S.selected];
  if (S.view === 'preview' && r) return { eta: Date.now() + withTraffic(r) * 1000, remaining: Math.round(r.distanceKm * 1000) };
  return { eta: null, remaining: null };
}

// Once a second: send where you are to whoever is following, and hear from the convoy.
function tickTogether() {
  const now = Date.now();
  if (S.share && S.view === 'nav' && !S.sim && S.share.due(now) && S.fix) {
    S.share.send({ fix: S.fix, ...tripNumbers(), dest: S.dest }, now).then(() => {
      if (S.share?.over) S.share = null;
      renderShareBtn();
    });
  }
  const c = S.convoy;
  if (c && !S.sim && (S.view === 'nav' || S.view === 'preview' || S.view === 'idle') && c.due(now, S.view === 'nav')) {
    c.send({ fix: S.fix, ...tripNumbers() }, now).then(() => {
      if (c.over && S.convoy === c) {
        S.convoy = null;
        toast(t('convoyGone'));
      }
      renderConvoy();
    });
  }
}

/* ----- A live link to your trip ----- */

function renderShareBtn() {
  const btn = $('btn-share');
  btn.hidden = !togetherReady() || !!S.sim || S.view !== 'nav';
  const on = !!S.share;
  label(btn, t('shareTripAria'), UI.share);
  const word = document.createElement('span');
  word.textContent = t(on ? (S.share.watched ? 'shareWatched' : 'shareOn') : 'shareTrip');
  btn.append(word);
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', String(on));
}

function shareTrip() {
  if (S.share) { openTogether('share'); return; }
  ensureName(async () => {
    if (!S.fix || S.view !== 'nav') { toast(t('roadNoFix')); return; }
    try {
      const share = await new TripShare().start({ name: S.settings.name, dest: S.dest, fix: S.fix, ...tripNumbers() });
      S.share = share;
      renderShareBtn();
      const sent = await shareLink(share.link, t('shareText', { dest: S.dest?.name || '' }), t('shareTitle'));
      if (sent) toast(t('shareStarted'), 6000);
    } catch {
      toast(t('shareFailed'), 5000);
    }
  });
}

function stopSharing(arrived = false) {
  if (!S.share) return;
  S.share.end(arrived);
  S.share = null;
  renderShareBtn();
}

/* ----- Following someone's trip ----- */

function openWatch(id) {
  S.watching = { id, data: null, failures: 0, gone: false, fitted: false, timer: null };
  openOverlay('watch');
  renderWatch();
  pollWatch();
}

async function pollWatch() {
  const w = S.watching;
  if (!w) return;
  clearTimeout(w.timer);
  try {
    w.data = await watchTrip(w.id);
    w.failures = 0;
  } catch (e) {
    if (e?.status === 404) w.gone = true;
    else w.failures++;
  }
  if (S.watching !== w) return;
  renderWatch();
  if (!w.gone && !w.data?.ended) w.timer = setTimeout(pollWatch, 10000);
}

function renderWatch() {
  const w = S.watching;
  if (!w) return;
  const d = w.data;
  const lang = getLang();
  const name = d?.name || t('watchSomeone');
  $('watch-title').textContent = w.gone ? t('watchGone') : t('watchTitle', { name });
  $('watch-to').textContent = d?.dest?.name ? t('watchTo', { dest: d.dest.name }) : '';
  let eta = '';
  if (d?.arrived) eta = t('watchArrived', { name, dest: d.dest.name });
  else if (d?.ended) eta = t('watchEnded');
  else if (d?.eta) eta = t('watchEta', { clock: fmtClock(new Date(d.eta), lang), time: fmtDuration(Math.max(60, (d.eta - d.now) / 1000), lang) });
  $('watch-eta').textContent = eta;
  const ago = d ? Math.floor((d.now - d.at) / 60000) : 0;
  $('watch-at').textContent = w.failures ? t('watchFailed') : d && !d.ended ? t('watchAt', { ago: ago < 1 ? t('watchNow') : t('watchAgo', { n: ago }) }) : '';
  $('watch-go').hidden = !d?.dest;
  if (d?.dest) $('watch-go').textContent = t('watchGoThere', { dest: d.dest.name || '' });
  if (!d || !mapView) return;
  mapView.setFriends(d.pos && !d.arrived ? [{ id: 'watch', name, pos: d.pos, color: FRIEND_COLORS[0] }] : []);
  mapView.setDestination(d.dest);
  if (!w.fitted && d.pos) {
    w.fitted = true;
    mapView.fit([[[d.pos.lng, d.pos.lat], [d.dest.lng, d.dest.lat]]], { top: 120, bottom: $('watch').offsetHeight + 40, left: 50, right: 50 });
  }
}

function closeWatch() {
  if (!S.watching) return;
  clearTimeout(S.watching.timer);
  S.watching = null;
  mapView?.setFriends(convoyFriends());
  mapView?.setDestination(null);
}

function goToWatched() {
  const dest = S.watching?.data?.dest;
  if (!dest) return;
  S.afterBack = () => goTo({ name: dest.name, detail: '', lng: dest.lng, lat: dest.lat, country: '' });
  history.back();
}

/* ----- Convoys ----- */

function convoyFriends() {
  const c = S.convoy;
  if (!c) return [];
  return c.members.map((m, i) => ({ id: m.member, name: m.name, pos: m.pos, color: FRIEND_COLORS[i % FRIEND_COLORS.length], me: m.member === c.member }))
    .filter((m) => !m.me);
}

function convoyLine(m) {
  if (m.remaining === 0) return t('convoyArrived');
  if (m.gap == null) return m.pos ? '' : t('convoyUnknown');
  if (Math.abs(m.gap) < 150) return t('convoyNear');
  return t(m.gap > 0 ? 'convoyAhead' : 'convoyBehind', { distance: fmtDistance(Math.abs(m.gap)) });
}

function renderConvoy() {
  const c = S.convoy;
  const others = c ? convoyOrder(c.members, c.member, tripNumbers().remaining) : [];
  if (!S.watching) mapView?.setFriends(convoyFriends());
  const bar = $('convoy-bar');
  bar.hidden = !c || S.view !== 'nav';
  if (!bar.hidden) {
    $('convoy-bar-icon').innerHTML = UI.people;
    $('convoy-bar-text').textContent = others.length
      ? others.slice(0, 2).map((m) => [m.name, convoyLine(m)].filter(Boolean).join(' ')).join(' · ') + (others.length > 2 ? ` +${others.length - 2}` : '')
      : t('convoyAlone');
  }
  if (S.view === 'preview') renderPlanConvoy();
  if (S.overlay === 'together' && S.together === 'convoy') renderTogether();
}

function renderPlanConvoy() {
  const row = $('plan-convoy');
  row.hidden = !togetherReady() || S.mode === 'walk';
  if (row.hidden) return;
  $('plan-convoy-icon').innerHTML = UI.people;
  $('plan-convoy-chev').innerHTML = UI.chevron;
  const c = S.convoy;
  const names = c ? c.members.filter((m) => m.member !== c.member).map((m) => m.name).filter(Boolean) : [];
  $('plan-convoy-title').textContent = c ? t('convoyTitle') : t('convoyStart');
  $('plan-convoy-detail').textContent = !c ? t('convoyStartDetail') : names.length ? t('convoyBar', { names: names.join(', ') }) : t('convoyAlone');
}

function startConvoy() {
  if (S.convoy) { openTogether('convoy'); return; }
  ensureName(async () => {
    try {
      const c = await Convoy.start({ name: S.settings.name, dest: S.dest, fix: S.fix });
      S.convoy = c;
      renderConvoy();
      const sent = await shareLink(c.link, t('convoyText', { dest: S.dest?.name || '' }), t('convoyTitle'));
      if (sent) toast(t('convoyStarted'), 5000);
    } catch {
      toast(t('convoyFailed'), 5000);
    }
  });
}

async function leaveConvoy() {
  const c = S.convoy;
  if (!c) return;
  S.convoy = null;
  mapView?.setFriends([]);
  renderConvoy();
  toast(t('convoyLeft'));
  await c.leave();
}

async function offerConvoy(id) {
  if (S.convoy?.id === id) {
    goTo({ ...S.convoy.dest, detail: '', country: '' });
    return;
  }
  let peek;
  try {
    peek = await Convoy.peek(id);
  } catch (e) {
    toast(t(e?.status === 404 ? 'convoyGone' : 'convoyFailed'), 6000);
    return;
  }
  S.joining = { id, peek };
  const names = peek.members.map((m) => m.name).filter(Boolean);
  $('join-title').textContent = t('convoyJoinTitle', { dest: peek.dest.name });
  $('join-text').textContent = t('convoyJoinText', { names: names.length ? names.join(', ') : t('convoyJoinSomeone') });
  $('join-name').value = S.settings.name || '';
  openOverlay('convoyjoin');
}

async function joinConvoy() {
  const j = S.joining;
  if (!j) return;
  const name = $('join-name').value.replace(/\s+/g, ' ').trim().slice(0, 30);
  if (!name) { $('join-name').focus(); return; }
  setSetting('name', name);
  $('join-yes').disabled = true;
  try {
    if (S.convoy) await S.convoy.leave();
    const c = await Convoy.join(j.id, { name, fix: S.fix });
    S.convoy = c;
    S.joining = null;
    S.afterBack = () => goTo({ name: c.dest.name, detail: '', lng: c.dest.lng, lat: c.dest.lat, country: '' });
    history.back();
  } catch (e) {
    toast(t(e?.status === 409 ? 'convoyFull' : e?.status === 404 ? 'convoyGone' : 'convoyFailed'), 6000);
  } finally {
    $('join-yes').disabled = false;
  }
}

/* ----- The sheet for either ----- */

function openTogether(kind) {
  S.together = kind;
  openOverlay('together');
  renderTogether();
}

function renderTogether() {
  const kind = S.together;
  const share = kind === 'share';
  $('together-title').textContent = t(share ? 'shareMenuTitle' : 'convoyTitle');
  $('together-text').textContent = t(share ? 'shareMenuText' : 'convoyMenuText');
  $('together-share').textContent = t(share ? 'shareAgain' : 'convoyShare');
  $('together-stop').textContent = t(share ? 'shareStop' : 'convoyLeave');
  const c = S.convoy;
  const rows = !share && c ? convoyOrder(c.members, c.member, tripNumbers().remaining) : [];
  $('together-list').replaceChildren(...rows.map((m, i) => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'friend-dot';
    dot.style.setProperty('--friend', FRIEND_COLORS[c.members.indexOf(c.members.find((x) => x.member === m.member)) % FRIEND_COLORS.length] || FRIEND_COLORS[i]);
    dot.textContent = (m.name || '?').charAt(0).toUpperCase();
    const name = document.createElement('strong');
    name.textContent = m.name || t('convoyJoinSomeone');
    const where = document.createElement('span');
    where.textContent = convoyLine(m);
    li.append(dot, name, where);
    return li;
  }));
  $('together-list').hidden = !rows.length;
}

function togetherShare() {
  if (S.together === 'share' && S.share) shareLink(S.share.link, t('shareText', { dest: S.dest?.name || '' }), t('shareTitle'));
  if (S.together === 'convoy' && S.convoy) shareLink(S.convoy.link, t('convoyText', { dest: S.convoy.dest?.name || '' }), t('convoyTitle'));
}

function togetherStop() {
  const kind = S.together;
  S.afterBack = () => {
    if (kind === 'share') {
      stopSharing(false);
      toast(t('shareStopped'));
    } else {
      leaveConvoy();
    }
  };
  history.back();
}

/* ----- Road reports ----- */

function renderReportKinds() {
  $('report-kinds').replaceChildren(...REPORT_KINDS.map((kind) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `report-kind report-${kind}`;
    b.innerHTML = ROAD_ICONS[kind];
    const word = document.createElement('span');
    word.textContent = t(`road_${kind}`);
    b.append(word);
    b.addEventListener('click', () => {
      S.afterBack = () => submitReport(kind);
      history.back();
    });
    return b;
  }));
}

function openRoadReport() {
  renderReportKinds();
  openOverlay('roadreport');
}

async function submitReport(kind) {
  if (!S.fix) { toast(t('roadNoFix')); return; }
  try {
    const r = await sendRoadReport(kind, S.fix);
    // Your own report needn't be read back to you.
    if (r?.id != null) {
      S.roadSaid?.add(r.id);
      S.roadAsked?.add(r.id);
    }
    toast(t('roadSent', { kind: t(`road_${kind}`) }));
  } catch {
    toast(t('roadFailed'), 5000);
  }
}

function loadRoadReports() {
  if (!togetherReady() || S.mode === 'walk' || !S.route || S.roadCtrl) return;
  const route = S.route;
  const ctrl = new AbortController();
  S.roadCtrl = ctrl;
  S.roadAt = Date.now();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  const from = S.lastState?.onRoute ? S.lastState.s : 0;
  fetchReports(reportBox(route, from), { signal: ctrl.signal }).then((found) => {
    if (S.route !== route) return;
    S.roadReports = found;
    placeRoadReports();
  }).catch(() => { /* none heard is the same as none reported */ })
    .finally(() => {
      clearTimeout(timer);
      if (S.roadCtrl === ctrl) S.roadCtrl = null;
    });
}

function placeRoadReports() {
  S.roadPlaced = S.route ? reportsOnRoute(S.route, S.roadReports || []) : [];
  mapView?.setReports(S.view === 'nav' ? S.roadPlaced : [], ROAD_ICONS);
}

function renderRoadReport(st, fix) {
  const box = $('report-alert');
  const near = st.onRoute && S.mode !== 'walk' ? reportAhead(S.roadPlaced, st.s, fix.speed ?? 0) : null;
  box.hidden = !near;
  if (near) {
    const { report, ahead } = near;
    const lang = getLang();
    box.dataset.kind = report.kind;
    $('report-icon').innerHTML = ROAD_ICONS[report.kind];
    const distance = fmtDistance(Math.max(ahead, 10));
    $('report-distance').textContent = distance;
    box.setAttribute('aria-label', t('roadAhead', { kind: t(`road_${report.kind}`), distance }));
    if (!S.roadSaid.has(report.id) && !(voice.busy() && !st.prompts.length && ahead > 200)) {
      S.roadSaid.add(report.id);
      if (S.settings.voiceLevel === 'full' && !(S.sim && S.sim.factor >= SIM_FAST)) {
        speakText(t(`say_${report.kind}`, { distance: sayDistance(ahead, lang) }), { wait: voice.WAIT_TURN_MS });
      }
    }
  }
  // Just past one: is it still there? Not in a practice drive, where nobody's looking.
  if (!S.sim && !S.asking) {
    const passed = justPassed(S.roadPlaced, st.s, S.roadAsked);
    if (passed) askAboutReport(passed);
  }
}

function askAboutReport(report) {
  S.roadAsked.add(report.id);
  S.asking = report;
  $('report-ask-title').textContent = t('roadAsk', { kind: t(`road_${report.kind}`) });
  $('report-ask').hidden = false;
  clearTimeout(S.askTimer);
  S.askTimer = setTimeout(() => answerReport(null), 12000);
}

function answerReport(still) {
  const report = S.asking;
  S.asking = null;
  clearTimeout(S.askTimer);
  $('report-ask').hidden = true;
  if (!report || still == null) return;
  voteReport(report.id, still).catch(() => {});
  if (!still) {
    S.roadReports = (S.roadReports || []).filter((r) => r.id !== report.id);
    placeRoadReports();
  }
  toast(t('roadThanks'));
}

/* ----- Morning alerts ----- */

const commuteSettings = () => ({ ...COMMUTE_DEFAULTS, ...(S.settings.commute || {}) });
const homeAndWork = () => { const s = savedPlaces(); return s.home && s.work ? s : null; };

function nextAlertText(c, now = new Date()) {
  const [h, m] = c.time.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    if (!c.days.includes(d.getDay())) continue;
    if (i === 0 && now.getHours() * 60 + now.getMinutes() >= h * 60 + m) continue;
    const day = i === 0 ? t('today') : i === 1 ? t('tomorrow') : t(`dayLong_${d.getDay()}`);
    d.setHours(h, m, 0, 0);
    return t('commuteReady', { day, time: fmtClock(d, getLang()) });
  }
  return '';
}

function renderCommute(status) {
  const c = commuteSettings();
  const places = homeAndWork();
  const ready = togetherReady() && !!places;
  $('set-commute').hidden = !togetherReady();
  $('commute-on').checked = c.on;
  $('commute-on').disabled = !ready && !c.on;
  $('commute-more').hidden = !c.on;
  $('commute-time').value = c.time;
  $('commute-days').replaceChildren(...DAY_ORDER.map((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'day';
    b.textContent = t(`day_${d}`);
    b.setAttribute('aria-pressed', String(c.days.includes(d)));
    b.setAttribute('aria-label', t(`dayLong_${d}`));
    b.addEventListener('click', () => {
      const days = c.days.includes(d) ? c.days.filter((x) => x !== d) : [...c.days, d];
      if (!days.length) return;
      changeCommute({ days });
    });
    return b;
  }));
  $('commute-slow').checked = c.slowOnly;
  $('commute-status').textContent = status ?? (!places ? t('commuteNeedSaved') : c.on ? nextAlertText(c) : '');
}

async function workerReady() {
  if (!('serviceWorker' in navigator)) return null;
  return Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 6000))]);
}

async function sendCommute() {
  const c = commuteSettings();
  const places = homeAndWork();
  if (!places) throw new CommuteError('places');
  return commuteOn({ home: places.home, work: places.work, time: c.time, days: c.days, slowOnly: c.slowOnly, lang: getLang() }, await workerReady());
}

function commuteProblem(e) {
  if (e instanceof CommuteError) return t({ denied: 'commuteDenied', unsupported: 'commuteUnsupported', places: 'commuteNeedSaved' }[e.kind] || 'commuteFailed');
  return t('commuteFailed');
}

async function switchCommute(on) {
  if (!on) {
    setSetting('commute', { ...commuteSettings(), on: false });
    renderCommute();
    commuteOff(await workerReady());
    return;
  }
  renderCommute(t('commuteSaving'));
  try {
    await sendCommute();
    setSetting('commute', { ...commuteSettings(), on: true });
    renderCommute();
  } catch (e) {
    setSetting('commute', { ...commuteSettings(), on: false });
    renderCommute(commuteProblem(e));
  }
}

// A change to the time, the days or home and work goes to the server too.
function changeCommute(change) {
  setSetting('commute', { ...commuteSettings(), ...change });
  renderCommute();
  if (!commuteSettings().on) return;
  clearTimeout(S.commuteTimer);
  S.commuteTimer = setTimeout(() => {
    if (!homeAndWork()) { switchCommute(false); return; }
    sendCommute().then(() => renderCommute()).catch((e) => renderCommute(commuteProblem(e)));
  }, 800);
}

async function testCommute() {
  try {
    await commuteTest();
    toast(t('commuteSent'), 5000);
  } catch (e) {
    toast(t(e?.status === 429 ? 'commuteTooMany' : e?.status === 503 ? 'commuteNoKey' : 'commuteFailed'), 6000);
  }
}

/* ---------- Pump prices ---------- */

async function loadFuelPrices() {
  const fuel = await fetchFuelPrices();
  if (!fuel || fuel === S.fuel || (S.fuel && fuel.at === S.fuel.at)) return;
  S.fuel = fuel;
  renderFuelWeek();
  if (S.view === 'preview' && S.routeState === 'ready') renderRoutes();
}

function renderFuelWeek() {
  const el = $('fuel-week');
  const f = S.fuel;
  el.hidden = !f?.prices || isStale(f);
  if (el.hidden) return;
  const list = [...GRADES.petrol, ...GRADES.diesel]
    .filter((g) => f.prices[g])
    .map((g) => `${t(`grade_${g}`)} RM${money(f.prices[g])}`)
    .join(', ');
  el.textContent = t('fuelWeek', { date: dateText(f.date), list });
}

/* ---------- Saying where to go ---------- */

function renderMic() {
  const on = !!S.ear;
  const btn = $('search-mic');
  label(btn, t(on ? 'micStop' : 'micSearch'), UI.mic);
  btn.classList.toggle('is-listening', on);
  btn.setAttribute('aria-pressed', String(on));
}

function voiceSearch() {
  if (S.ear) {
    S.ear.stop();
    return;
  }
  const input = $('search-input');
  input.blur();
  clearTimeout(S.searchTimer);
  S.searchCtrl?.abort();
  input.value = '';
  renderSearch([]);
  input.placeholder = t('voiceListening');
  $('search-status').textContent = t('voiceHint');
  const forWhat = S.searchFor;
  S.ear = listen({
    lang: getLang(),
    onWords: (words) => { input.value = words; },
    onDone: (words) => {
      earDone();
      heard(words, forWhat);
    },
    onFail: (why) => {
      earDone();
      voiceFailed(why);
    },
  });
  renderMic();
}

function earDone() {
  S.ear = null;
  setSearchPrompt();
  renderMic();
}

function cancelEar() {
  if (!S.ear) return;
  S.ear.cancel();
  earDone();
}

function voiceFailed(why) {
  const key = why === 'not-allowed' || why === 'service-not-allowed' ? 'voiceMicDenied'
    : why === 'network' ? 'voiceNoNet'
      : why === 'no-speech' || why === 'aborted' ? 'voiceHeardNothing'
        : 'voiceFailed';
  $('search-status').textContent = t(key);
}

// What was said, done: home, work, your car and the nearest petrol station go
// straight there, and anything else is searched for.
function heard(words, forWhat) {
  // The search was closed or changed while listening.
  if (S.searchFor !== forWhat || $('search').hidden) return;
  const asked = understand(words);
  if (!asked) {
    voiceFailed('no-speech');
    return;
  }
  const input = $('search-input');
  // Choosing a stop, a start or your home, what you said is only ever searched for.
  if (forWhat !== 'destination' || asked.kind === 'search') {
    input.value = asked.kind === 'search' ? asked.query : words;
    onSearchInput();
    return;
  }
  input.value = words;
  if (asked.kind === 'saved') {
    const place = savedPlaces()[asked.which];
    if (!place) {
      S.searchFor = asked.which;
      resetSearch();
      $('search-status').textContent = t('voiceNotSet', { name: t(asked.which) });
      return;
    }
    input.blur();
    voice.unlockVoice();
    replaceHistory('preview');
    S.stops = [];
    S.start = null;
    openPreview({ ...place, name: place.name || t(asked.which) });
    return;
  }
  S.afterBack = asked.kind === 'car' ? () => openCar() : () => openExplore(asked.category);
  history.back();
}

/* ---------- The month in trips ---------- */

const monthIndex = (m) => m.year * 12 + m.month;

function openSummary() {
  const now = new Date();
  S.month = { year: now.getFullYear(), month: now.getMonth() };
  S.forgetArmed = false;
  openOverlay('summary');
  renderSummary();
}

function shiftMonth(by) {
  const i = monthIndex(S.month) + by;
  S.month = { year: Math.floor(i / 12), month: ((i % 12) + 12) % 12 };
  renderSummary();
}

function renderSummary() {
  if (!S.month) return;
  const lang = getLang();
  const trips = keptTrips();
  const months = tripMonths(trips);
  const now = new Date();
  const latest = monthIndex({ year: now.getFullYear(), month: now.getMonth() });
  const earliest = months.length ? Math.min(latest, monthIndex(months[months.length - 1])) : latest;
  const at = monthIndex(S.month);
  $('month-prev').disabled = at <= earliest;
  $('month-next').disabled = at >= latest;
  $('month-name').textContent = new Date(S.month.year, S.month.month, 1).toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
  const m = monthSummary(trips, S.month.year, S.month.month);
  $('month-empty').hidden = m.trips > 0;
  $('month-empty').textContent = t('monthEmpty');
  $('month-body').hidden = m.trips === 0;
  $('month-forget').hidden = !trips.length;
  $('month-forget').textContent = t(S.forgetArmed ? 'monthForgetSure' : 'monthForget');
  $('month-forget').classList.toggle('is-armed', !!S.forgetArmed);
  if (!m.trips) return;

  $('month-km').textContent = fmtDistance(m.km * 1000);
  $('month-trips').textContent = m.trips === 1 ? t('monthTripsOne') : t('monthTrips', { n: m.trips });
  const diff = m.km - m.prevKm;
  $('month-vs').hidden = !m.prevKm;
  $('month-vs').textContent = Math.abs(diff) < 1 ? t('monthVsSame') : t(diff > 0 ? 'monthVsMore' : 'monthVsLess', { km: fmtDistance(Math.abs(diff) * 1000) });

  const most = Math.max(...m.perDay, 0.1);
  $('month-days').replaceChildren(...m.perDay.map((km) => {
    const bar = document.createElement('span');
    bar.style.setProperty('--h', `${Math.max(km ? 4 : 0, Math.round((km / most) * 100))}%`);
    return bar;
  }));
  $('month-days-last').textContent = String(m.perDay.length);

  const share = Math.round((100 * m.slow) / Math.max(1, m.seconds));
  const rows = [
    [t('monthDriving'), fmtDuration(m.seconds, lang)],
    [t('monthSlow'), m.slow < 30 ? '0 min' : t('monthSlowShare', { time: fmtDuration(m.slow, lang), pct: share })],
    [t('monthCost'), m.cost == null ? t('monthCostNone') : m.costAll ? `RM${money(m.cost)}` : t('monthCostSome', { cost: money(m.cost), n: m.costed })],
  ];
  if (m.longest) rows.push([t('monthLongest'), m.longest.to ? t('monthLongestDetail', { km: fmtDistance(m.longest.km * 1000), to: m.longest.to }) : fmtDistance(m.longest.km * 1000)]);
  if (m.top) rows.push([t('monthTop'), t('monthTopDetail', { name: m.top.name, n: m.top.count })]);
  $('month-rows').replaceChildren(...rows.map(([name, value]) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = name;
    const dd = document.createElement('dd');
    dd.textContent = value;
    row.append(dt, dd);
    return row;
  }));
}

// Two taps, so one stray tap can't lose a year of trips.
function forgetMonths() {
  clearTimeout(S.forgetTimer);
  if (!S.forgetArmed) {
    S.forgetArmed = true;
    renderSummary();
    S.forgetTimer = setTimeout(() => {
      S.forgetArmed = false;
      if (S.overlay === 'summary') renderSummary();
    }, 4000);
    return;
  }
  S.forgetArmed = false;
  forgetTrips();
  toast(t('monthForgotten'));
  renderSummary();
}

/* ---------- Battery saver ---------- */

function applySaver() {
  const on = saverOn(S.settings.saver, S.battery);
  if (on !== S.saving) {
    S.saving = on;
    mapView?.setSaver(on);
    if (on && S.settings.saver === 'auto' && S.battery) toast(t('saverAutoOn', { pct: Math.round(S.battery.level * 100) }), 5000);
  }
  renderSaverNow();
}

function renderSaverNow() {
  const el = $('saver-now');
  el.hidden = !S.saving;
  if (S.saving) el.textContent = S.battery ? t('saverNowBattery', { pct: Math.round(S.battery.level * 100) }) : t('saverNow');
}

function setSaverSetting(value) {
  setSetting('saver', value);
  renderSegments();
  applySaver();
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
      onPlaceTap,
      onPuckTap: () => { if (S.view === 'idle' && !S.overlay) openCar(); },
      trafficTiles: CONFIG.server ? `${CONFIG.server}/tiles` : null,
    });
    await mapView.init();
    mapView.setSaver(S.saving);
    mapView.setCarOn(S.settings.view3d);
    syncTrafficMap();
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
  // A trip shared before Pintu was closed: kept for the trip if it's picked up again.
  const shared = TripShare.resume();
  if (shared) {
    if (S.resumeTrip) S.pendingShare = shared;
    else shared.end(false);
  }
  setInterval(tickTogether, 1000);
  watchBattery((b) => {
    S.battery = b;
    applySaver();
  });
  applySaver();
  requestAnimationFrame(frame);
  loadFuelPrices();
  await startMap();
  openIncoming();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main();
