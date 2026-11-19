import { CONFIG } from './config.js';
import { sayDuration, fmtClock, fmtDistance, fmtDuration, localeOf, sayDistance } from './format.js';
import { clamp, haversine } from './geo.js';
import { Guidance } from './guidance.js';
import { getLang, setLang, t } from './i18n.js';
import { CATEGORY_ICONS, UI, doorSvg, laneIcon, turnIcon } from './icons.js';
import { describe, laneView, roadNames, speech } from './instructions.js';
import { LaneScene, NO_LANES } from './lanes.js';
import { Gps, SimulatedDrive } from './location.js';
import { MapView } from './map.js';
import { Motion, pointAt } from './motion.js';
import { findAlongRoute, placeOnRoute, thinAlong } from './places.js';
import { NAMES, PrayerTimes, closePrayer, prayerDuringTrip } from './prayer.js';
import { RouteError, distanceAfter, fetchDriveTimes, fetchRoadDetails, fetchRoutes, limitAt, routeProviders, timeBetween } from './routing.js';
import { MAX_STOPS, suggestOrder } from './errands.js';
import { loadWildlife, zoneAhead, zonesOnRoute } from './wildlife.js';
import { CROSSINGS, crossingOf, fetchCameras as fetchCrossingCameras, throughFor } from './crossings.js';
import { ferryLegs, timetableSearch } from './ferries.js';
import { CHARACTER_IDS, characterAbout, characterName, characterTag, characterVoice, dress, pick, sample } from './characters.js';
import { plainSpeech } from './delivery.js';
import { DriveWatch, OVER_BY_KMH, RESTED_MS } from './drive-watch.js';
import { checkRouteWeather } from './weather.js';
import { cameraAhead, camerasOnRoute, fetchCameras } from './cameras.js';
import { fetchTolls, tollAhead, tollsOnRoute } from './tolls.js';
import { QUICK_WAITS, SLOW_WAITS, alongRoute, fetchAlong, findAlong, restsOnRoute } from './along.js';
import { dataNear, loadAlongData } from './along-data.js';
import { nextRest } from './rest-stop.js';
import { MARK_KINDS, fetchMarks, markCameras, markFeatures, marksBox, sendMark } from './marks.js';
import { StopWatch, lightsToAsk, rememberStop, settleSpot } from './stop-learn.js';
import { afterTolls, cleanBalance, tngCheck } from './tng.js';
import { CHOICES_MIN, parkingLeft, remindOff, remindOnServer, warnDue } from './parking-timer.js';
import { countLights, featureAhead, featuresOnRoute } from './road-features.js';
import { driverFare, fareAt, priceTolls, tollTotal } from './toll-fares.js';
import { vehiclePicture } from './car-art.js';
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
import { CrawlClock, forgetTrips, keptTrips, markLastTrip, monthSummary, recordTrip, tripMonths } from './trips.js';
import { DriveReport, MIN_KM as REPORT_MIN_KM, monthDriving } from './drive-report.js';
import { BUDI_GRADE, budiAfter, budiUsed, cleanBudi } from './budi.js';
import { careToShow, cleanCare, markSeen, odometerNow } from './car-care.js';
import { cleanRate, workCsv, workTotals, workTrips } from './worklog.js';
import { frameDue, saverOn, watchBattery } from './battery.js';
import { REPORT_KINDS, REPORTS_EVERY_MS, fetchReports, justPassed, reportAhead, reportBox, reportsOnRoute, sendReport as sendRoadReport, voteReport } from './road-reports.js';
import { Convoy, TripShare, convoyOrder, watchTrip } from './together.js';
import { COMMUTE_DEFAULTS, DAY_ORDER, CommuteError, commuteOff, commuteOn, commuteTest } from './commute.js';
import { deviceCode, get, isCode, post } from './hub.js';
import { inApp, nativePlugin } from './native.js';
import * as voice from './voice.js';
import { LABEL_BOX, clearOf, clearOfBoxes, labelSize, labelSpots, trafficBar, trafficGradient } from './route-labels.js';
import { loadStates, shapesOf, stretchIn } from './states.js';
import { arrowFor, turnArrow } from './turn-arrow.js';
import { JourneyError, journeyCoords, journeyFeatures, mergeTrips, planTrips, prepareTrips, summaryLegs } from './journeys.js';
import { LiveTransit, MIN_ZOOM as TRANSIT_MIN_ZOOM, lineFeatures, loadTransit, routeOf, stationFeatures, vehicleFeatures } from './transit.js';

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
  settings: { lang: 'ms', theme: 'auto', muted: false, view3d: true, solat: true, simSpeed: 4, voiceLevel: 'full', voiceCharacter: 'standard', speedLimit: true, weather: true, hudMirror: true, hudInk: 'white', speedCameras: true, camerasMap: true, satellite: false, transit: false, roadWarnings: true, sayLights: false, traffic: true, trafficMap: true, offlineMap: true, keepDrive: true, keepTrips: true, saver: 'auto', name: '', commute: { ...COMMUTE_DEFAULTS }, ...load('settings', {}) },
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
// On foot, or on buses and trains: the car and its looks still belong to how you drive.
const onFoot = () => S.mode === 'walk' || S.mode === 'transit';
function driveMode() { return onFoot() ? (S.returnMode || load('mode', 'car')) : S.mode; }
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
  $('mode-transit').textContent = t('modeTransit');
  const whenKind = $('journey-when-kind');
  for (const o of whenKind.options) o.textContent = t({ now: 'journeyNow', leave: 'journeyLeave', arrive: 'journeyArrive' }[o.value]);
  $('journey-earlier').textContent = t('journeyEarlier');
  $('journey-later').textContent = t('journeyLater');
  $('journey-back').replaceChildren();
  $('journey-back').insertAdjacentHTML('afterbegin', UI.back);
  $('journey-back').append(t('journeyAll'));
  $('journey-credit-text').textContent = t('journeyCredit');
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
  $('placecard-share').textContent = t('sharePlace');
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
  $('set-road-title').textContent = t('roadTitle');
  $('set-tng-title').textContent = t('setTng');
  $('set-budi-title').textContent = t('setBudi');
  $('budi-text').textContent = t('budiText');
  $('budi-limit-label').textContent = t('budiLimit');
  $('budi-actual-label').textContent = t('budiActual');
  $('budi-save').textContent = t('budiSave');
  $('set-care-title').textContent = t('careTitle');
  $('care-intro').textContent = t('careText');
  $('care-odo-label').textContent = t('careOdo');
  $('care-service-label').textContent = t('careService');
  $('care-tax-label').textContent = t('careRoadTax');
  $('care-ins-label').textContent = t('careInsurance');
  $('care-save').textContent = t('budiSave');
  $('set-work-title').textContent = t('workTitle');
  $('work-text').textContent = t('workText');
  $('work-rate-label').textContent = t('workRate');
  $('tng-text').textContent = t('tngText');
  $('tng-save').textContent = t('tngSave');
  $('sos-title').textContent = t('sosTitle');
  $('sos-call').textContent = t('sosCall');
  $('sos-where-label').textContent = t('sosWhere');
  $('sos-share').textContent = t('sosShare');
  $('sos-hosp-label').textContent = t('sosHospitals');
  $('road-text').textContent = t('roadText');
  $('road-on-label').textContent = t('roadOn');
  $('lights-say-label').textContent = t('lightsSay');
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
  $('plan-toll-icon').innerHTML = UI.toll;
  $('plan-other-icon').innerHTML = UI.route;
  $('plan-tng-icon').innerHTML = UI.card;
  $('sos-back').innerHTML = UI.back;
  $('btn-sos').setAttribute('aria-label', t('sosBtn'));
  $('btn-sos-nav').setAttribute('aria-label', t('sosBtn'));
  $('plan-toll-chev').innerHTML = UI.chevron;
  label($('plan-parking-clear'), t('parkingRemove'), UI.close);
  renderSaved();
  $('set-limit-title').textContent = t('setLimit');
  $('limit-text').textContent = t('limitText');
  $('limit-on-label').textContent = t('limitOn');
  $('set-weather-title').textContent = t('setWeather');
  $('weather-text').textContent = t('weatherText');
  $('weather-on-label').textContent = t('weatherOn');
  label($('weather-back'), t('back'), UI.close);
  label($('camview-back'), t('back'), UI.close);
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
  $('plan-warn-icon').innerHTML = UI.storm;
  $('plan-warn-chev').innerHTML = UI.chevron;
  label($('btn-cams'), t('camsMapBtn'), UI.camera);
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
  $('search-paste-label').textContent = t(S.backFromGoogle ? 'googleBack' : 'pasteLink');
  $('search-google-icon').innerHTML = UI.external;
  $('search-google-hint').textContent = t('googleHint');
  renderCharacters();
  $('set-look-title').textContent = t('setLook');
  $('look-map').textContent = t('lookMap');
  $('look-sat').textContent = t('lookSat');
  $('look-note').textContent = t('lookNote');
  label($('btn-sat'), t('satBtn'), UI.satellite);
  label($('btn-transit'), t('transitBtn'), UI.bus);
  $('set-theme-title').textContent = t('setTheme');
  $('theme-auto').textContent = t('themeAuto');
  $('theme-day').textContent = t('themeDay');
  $('theme-night').textContent = t('themeNight');
  $('set-solat-title').textContent = t('setSolat');
  $('solat-text').textContent = t('solatText');
  $('solat-on-label').textContent = t('solatOn');
  $('set-install-title').textContent = t('setInstall');
  $('app-link').textContent = t('appBtn');
  $('app-note').textContent = t('appNote');
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
  renderSatButton();
  renderTransitBtn();
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

// Photos from above for the map, through Pintu's server (TomTom's, from Maxar).
function setSatellite(on) {
  setSetting('satellite', !!on && !!CONFIG.server);
  mapView?.setSatellite(S.settings.satellite);
  renderSatButton();
  renderSegments();
  renderMapExtras();
}

function renderSatButton() {
  const b = $('btn-sat');
  b.hidden = !CONFIG.server;
  b.classList.toggle('is-on', !!S.settings.satellite);
  b.setAttribute('aria-pressed', String(!!S.settings.satellite));
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
  $('install-btn').hidden = standalone || !S.installEvent || inApp();
  // The Android app keeps guiding with the screen off, which a web page can't.
  const android = /android/i.test(navigator.userAgent);
  $('app-text').textContent = t(inApp() ? 'appIn' : 'appText');
  $('app-text').hidden = !android && !inApp();
  $('app-link').hidden = !android || inApp();
  $('app-note').hidden = !android || inApp();
  if (inApp()) $('install-text').textContent = '';
}

function renderSegments() {
  const set = (id, on) => $(id).setAttribute('aria-checked', String(on));
  set('mode-car', S.mode === 'car');
  set('mode-moto', S.mode === 'motorcycle');
  set('mode-walk', S.mode === 'walk');
  set('mode-transit', S.mode === 'transit');
  set('voice-full', S.settings.voiceLevel === 'full');
  set('voice-turns', S.settings.voiceLevel === 'turns');
  $('limit-on').checked = S.settings.speedLimit;
  $('camera-on').checked = S.settings.speedCameras;
  renderTngSetting();
  renderBudiSetting();
  renderCareSetting();
  if (document.activeElement !== $('work-rate')) $('work-rate').value = load('workRate', '') ?? '';
  $('road-on').checked = S.settings.roadWarnings;
  $('lights-say').checked = S.settings.sayLights;
  $('lights-say').disabled = !S.settings.roadWarnings;
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
  set('look-map', !S.settings.satellite);
  set('look-sat', !!S.settings.satellite);
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
const IDLE_SHEETS = new Set(['explore', 'placecard', 'car', 'watch', 'sos']);

function show(view) {
  S.view = view;
  render();
  syncTrafficMap();
  syncTransit();
  renderShareBtn();
  renderConvoy();
  $('btn-report').hidden = view !== 'nav' || !togetherReady() || onFoot();
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

/* ---------- Buses and trains ---------- */

// On the main map only: on the way somewhere, they'd be in the way.
const transitShown = () => !!S.settings.transit && S.view === 'idle';

function renderTransitBtn() {
  const b = $('btn-transit');
  b.classList.toggle('is-on', !!S.settings.transit);
  b.setAttribute('aria-pressed', String(!!S.settings.transit));
}

function toggleTransit() {
  setSetting('transit', !S.settings.transit);
  renderTransitBtn();
  S.transitToldNone = false;
  if (!S.settings.transit) toast(t('transitOff'));
  else toast(t((mapView?.zoom() ?? 0) < TRANSIT_MIN_ZOOM ? 'transitOnZoom' : 'transitOn'), 6000);
  syncTransit();
}

function syncTransit() {
  const on = transitShown();
  if (on && !S.transit) { loadTransitData(); return; }
  if (S.transit) {
    mapView?.setTransit(on, mapView.transitData === S.transit.features ? null : S.transit.features);
    if (mapView) mapView.transitData = S.transit.features;
  }
  clearInterval(S.transitTimer);
  S.transitTimer = null;
  if (on && S.transit) {
    S.transitTimer = setInterval(transitTick, 2000);
    renderVehicles();
    transitTick();
  }
}

function loadTransitData() {
  if (S.transitLoading) return;
  S.transitLoading = true;
  loadTransit().then((data) => {
    S.transit = {
      data,
      features: { lines: lineFeatures(data), stations: stationFeatures(data) },
      live: new LiveTransit({ feeds: data.feeds, onUpdate: renderVehicles }),
    };
    syncTransit();
  }).catch(() => {
    if (transitShown()) toast(t('transitFailed'));
  }).finally(() => { S.transitLoading = false; });
}

function transitTick() {
  if (!transitShown() || document.hidden || !S.transit || !mapView) return;
  const box = mapView.viewBox(), zoom = mapView.zoom();
  // Somewhere with no live feed at all: said once.
  if (zoom >= TRANSIT_MIN_ZOOM && box && !S.transit.live.inView(box).length && !S.transitToldNone) {
    S.transitToldNone = true;
    toast(t('transitNone'));
  }
  S.transit.live.poll(box, zoom);
}

function renderVehicles() {
  if (S.transit) mapView?.setTransitVehicles(vehicleFeatures(S.transit.live.vehicles()));
}

// What a tapped bus or train is, and how fresh its position is.
function onTransitTap({ feed, id }) {
  const v = S.transit?.live.vehicles().find((x) => x.feed.id === feed && x.id === id);
  if (!v) return;
  const r = routeOf(v, v.feed);
  const train = v.feed.kind === 'train';
  const what = r.number ? t(train ? 'vehTrain' : 'vehBus', { number: r.number }) : t(train ? 'vehTrainNone' : 'vehBusNone');
  const secs = Math.max(0, Math.round((Date.now() - v.at) / 1000));
  const ago = secs < 90 ? t('vehAgoSec', { n: Math.max(5, Math.round(secs / 5) * 5) }) : t('vehAgoMin', { n: Math.round(secs / 60) });
  const name = r.name && r.name !== r.number ? r.name : '';
  toast(t(name ? 'vehSay' : 'vehSayNoName', { what, op: v.feed.name, name, ago }), 6000);
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
  $('preview').hidden = view !== 'preview' || overlay === 'pickmap' || overlay === 'stops' || overlay === 'camview';
  $('map-pick').hidden = overlay !== 'pickmap';
  $('steps').hidden = overlay !== 'steps';
  $('weather').hidden = overlay !== 'weather';
  $('camview').hidden = overlay !== 'camview';
  $('mall').hidden = overlay !== 'mall';
  $('hudmode').hidden = overlay !== 'hudmode';
  $('nav').hidden = view !== 'nav';
  $('arrival').hidden = view !== 'arrival';
  $('settings').hidden = overlay !== 'settings';
  $('sos').hidden = overlay !== 'sos';
  $('vehicle').hidden = overlay !== 'vehicle';
  $('summary').hidden = overlay !== 'summary';
  $('report-sheet').hidden = overlay !== 'roadreport';
  $('together').hidden = overlay !== 'together';
  $('convoy-join').hidden = overlay !== 'convoyjoin';
  $('name-sheet').hidden = overlay !== 'name';
  $('watch').hidden = overlay !== 'watch';
  $('stops').hidden = overlay !== 'stops';
  renderMapExtras();
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
  if (was === 'sos') S.sosCtrl?.abort();
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
// Sheets slide up a little as they open, so they're measured again once in place:
// otherwise the map's credits end up just under the sheet's top edge.
addEventListener('animationend', (e) => { if (e.target?.classList?.contains('sheet')) updateBottomInset(); });
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
    // In landscape the map's credits sit 66 px up on the right: route labels go above them.
    if (landscape) { pad.left = $('preview').offsetWidth + 30; pad.bottom = 92; }
    else pad.bottom = updateBottomInset() + 30;
    // Clear of the camera switch in the top corner, which may come once the cameras are found.
    if (S.settings.speedCameras && !onFoot()) pad.right = 92;
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
  if (onFoot()) {
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
  const walking = onFoot();
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
  if (!route || onFoot() || !(S.settings.view3d || S.settings.speedLimit)) return;
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
  if (!S.settings.view3d || !st.onRoute || tooQuick || onFoot()) {
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
  mapView?.setJunctionRoads(S.view === 'nav' && !onFoot() && (on || !!S.settings.satellite));
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
  S.backFromGoogle = false;
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
  S.lastResults = results;
  const pick = { stop: chooseStopFromSearch, start: chooseStartFromSearch, to: chooseToFromSearch, home: chooseSavedFromSearch, work: chooseSavedFromSearch }[S.searchFor] || chooseFromSearch;
  $('search-results').replaceChildren(...results.map((p) => placeButton(p, pick)));
  const empty = !$('search-input').value.trim();
  const recents = load('recents', []);
  $('recents-wrap').hidden = !empty || !recents.length;
  $('recents').replaceChildren(...recents.map((p) => placeButton(p, pick)));
  const choosingSpot = S.searchFor === 'start' || savingPlace();
  $('search-tip').hidden = !empty || choosingSpot;
  // Just back from looking on Google Maps: the link is likely on the clipboard.
  $('search-paste').hidden = !navigator.clipboard?.readText || (!S.backFromGoogle && (!empty || savingPlace()));
  $('search-paste-label').textContent = t(S.backFromGoogle ? 'googleBack' : 'pasteLink');
  renderGoogleRow();
  $('search-quick').hidden = !empty || !choosingSpot;
}

// Google Maps finds places the open map data doesn't. Its results can't be shown
// on Pintu's map (Google's terms allow them only on a Google map), so the search
// opens there, and the place comes back by Share → Pintu, or a copied link pasted
// here: both of which Pintu already reads.
const GOOGLE_BACK_MS = 15 * 60e3;
const googleMapsUrl = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

function renderGoogleRow() {
  const q = $('search-input').value.trim();
  const row = $('search-google');
  const show = q.length >= 2 && !parseLocationText(q);
  row.hidden = !show;
  if (!show) return;
  row.href = googleMapsUrl(q);
  $('search-google-label').textContent = t('googleSearch', { q: q.length > 40 ? `${q.slice(0, 39)}…` : q });
}

// What's in the box, unless `raw` gives what was pasted with its lines still in
// it: a box keeps only one line, and the first is often the place's name.
function onSearchInput(raw) {
  const q = (typeof raw === 'string' ? raw : $('search-input').value).trim();
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
      // The link couldn't be followed, but the place's name came with it.
      if (found.name) {
        status.textContent = t('searching');
        runSearch(found.name);
        return;
      }
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
    runSearch(found.query, { near: found.near });
  } else if (found.kind === 'blocked') {
    status.textContent = t('linkBlocked');
    renderSearch([]);
  } else {
    status.textContent = t('linkUnknown');
    renderSearch([]);
  }
}

async function pasteLink() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) throw new Error('nothing to paste');
    S.backFromGoogle = false;
    S.googleAt = 0;
    $('search-input').value = oneLine(text);
    onSearchInput(text);
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
  $('search-input').value = oneLine(text);
  onSearchInput(text);
}

const oneLine = (text) => text.split('\n').map((s) => s.trim()).filter(Boolean).join(' ');

// Looked for around you, or around `near` when a shared link says roughly where.
async function runSearch(q, { near = null } = {}) {
  const ctrl = new AbortController();
  S.searchCtrl = ctrl;
  const around = near || S.fix;
  try {
    // Places by name from the usual search, street addresses from TomTom.
    let failed = null;
    const named = searchPlaces(q, { near: around, signal: ctrl.signal }).catch((e) => { failed = e; return []; });
    const addresses = CONFIG.server && q.length >= 4 && !parseCoordinates(q)
      ? searchAddresses(q, around, { signal: ctrl.signal }).catch(() => [])
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

// Like a map app: the map flies to the place and shows it first, with the way to
// go there. Back comes back to the list, to look at another.
function chooseFromSearch(place) {
  $('search-input').blur();
  if (!place.unnamed) addRecent(place);
  show('idle');
  showPlace(place, { from: 'search' });
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
  const other = otherChoice(S.routes[S.selected]);
  if (S.routes.length) mapView?.fit([...S.routes.map((r) => r.coords), ...(other ? [other.route.coords] : [])], mapPadding());
}

/* ---------- Route preview ---------- */

function openPreview(place, { keepParking = false } = {}) {
  if (!keepParking) S.parkAt = null;
  S.parkingOpen = false;
  S.tollOpen = false;
  S.alongPick = null;
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
  S.marks = null;
  S.otherCtrl?.abort();
  S.otherWay = null;
  S.alongCtrl?.abort();
  clearTimeout(S.alongTimer);
  S.along = null;
  S.dest = null;
  S.start = null;
  S.routes = [];
  S.stops = [];
  S.parkAt = null;
  mapView?.setStart(null);
  mapView?.setDestination(null);
  mapView?.setStopPins([]);
  mapView?.clearRoutes();
  S.journey = null;
  mapView?.setJourney(null);
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
  S.journey = null;
  mapView?.setJourney(null);
  if (S.mode === 'transit') mapView?.clearRoutes();
  renderRoutes();

  gps.start();
  const from = S.start || await waitForFix();
  if (ctrl.signal.aborted) return;
  S.routeFrom = from;
  if (!from) {
    S.routeState = 'error';
    S.routeError = S.gpsDenied ? 'gpsDenied' : 'gpsNone';
    renderRoutes();
    return;
  }

  S.routeState = 'loading';
  renderRoutes();
  if (S.mode === 'transit') {
    loadJourneys(from, ctrl);
    return;
  }
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
    stopsAlong(routes[0]);
    renderRoutes();
    loadRouteTraffic(routes);
    checkStopOrder();
    checkCrossings(routes);
    if (S.startWhenRouted) {
      S.startWhenRouted = false;
      S.route = routes[0];
      startGuidance({ simulate: false });
      return;
    }
    S.previewMoved = false;
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

/* ---------- By bus, train and on foot ---------- */

// When to go: now, leaving at a time, or arriving by one.
S.journeyWhen = { kind: 'now', at: null };

const localInput = (ms) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

function setJourneyWhen() {
  const kind = $('journey-when-kind').value;
  const input = $('journey-when-time');
  if (kind === 'now') S.journeyWhen = { kind, at: null };
  else {
    // A time not chosen yet: the next five minutes, as a start.
    let at = Date.parse(input.value);
    if (!Number.isFinite(at) || S.journeyWhen.kind === 'now') {
      at = Math.ceil((Date.now() + 60000) / 300000) * 300000;
      input.value = localInput(at);
    }
    S.journeyWhen = { kind, at };
  }
  if (S.mode === 'transit' && S.view === 'preview') loadRoutes();
  else renderJourney();
}

const journeyEnds = () => ({ from: S.start ? S.start.name : t('myLocation'), to: routeEnd()?.name || '' });

async function loadJourneys(from, ctrl, { cursor = null, dir = null } = {}) {
  const to = routeEnd();
  const when = S.journeyWhen;
  try {
    const json = await planTrips({
      server: CONFIG.server, from, to, when: when.kind === 'now' ? null : when.at, arriveBy: when.kind === 'arrive',
      cursor, lang: getLang(), version: CONFIG.version, signal: ctrl.signal,
    });
    if (ctrl.signal.aborted) return;
    const got = prepareTrips(json, journeyEnds());
    const before = dir && S.journey ? S.journey : null;
    S.journey = before ? {
      ...before,
      trips: mergeTrips(before.trips, got.trips),
      earlier: dir === 'earlier' ? got.earlier : before.earlier,
      later: dir === 'later' ? got.later : before.later,
      busy: null,
    } : { ...got, pick: 0, open: false, busy: null };
    if (!before) S.journey.pick = 0;
    else if (before.trips[before.pick]) S.journey.pick = S.journey.trips.findIndex((x) => x.key === before.trips[before.pick].key);
    S.routeState = 'ready';
    renderRoutes();
    if (!before) showJourneyOnMap({ fit: true });
  } catch (err) {
    if (ctrl.signal.aborted || err?.name === 'AbortError') return;
    if (dir && S.journey) {
      S.journey.busy = null;
      renderJourney();
      toast(t(err instanceof JourneyError && err.code === 'busy' ? 'journeyBusy' : 'journeyFailed'));
      return;
    }
    S.routeState = 'error';
    S.routeError = err instanceof JourneyError && err.code === 'busy' ? 'journeyBusy' : err?.code === 'offline' ? 'errOffline' : 'journeyFailed';
    renderRoutes();
  }
}

function moreJourneys(dir) {
  const j = S.journey;
  if (!j?.[dir] || j.busy || !S.routeFrom) return;
  S.routeCtrl?.abort();
  const ctrl = new AbortController();
  S.routeCtrl = ctrl;
  j.busy = dir;
  renderJourney();
  loadJourneys(S.routeFrom, ctrl, { cursor: j[dir], dir });
}

function showJourneyOnMap({ fit = false } = {}) {
  const trip = S.journey?.trips[S.journey.pick];
  mapView?.setJourney(trip ? journeyFeatures(trip) : null);
  if (trip && fit) {
    S.previewMoved = false;
    const coords = journeyCoords(trip);
    if (coords.length > 1) mapView?.fit([coords], mapPadding());
  }
}

function openJourneyTrip(i) {
  const j = S.journey;
  if (!j) return;
  if (i == null) j.open = false;
  else {
    j.pick = i;
    j.open = true;
  }
  renderJourney();
  showJourneyOnMap({ fit: i != null });
  $('preview').scrollTop = 0;
}

const journeyClock = (ms) => (Number.isFinite(ms) ? fmtClock(new Date(ms), getLang()) : '');
const KIND_ICONS = { bus: 'bus', train: 'train', metro: 'train', tram: 'train', ferry: 'boat', plane: 'plane', cable: 'train', other: 'bus' };

// A ride as a little sign in its line's colour: "[bus] N54".
function rideChip(leg) {
  const chip = document.createElement('span');
  chip.className = 'ride-chip';
  const icon = document.createElement('span');
  icon.className = 'ride-icon';
  icon.innerHTML = UI[KIND_ICONS[leg.kind]] || UI.bus;
  chip.append(icon);
  if (leg.name) {
    const name = document.createElement('span');
    name.className = 'ride-name';
    name.textContent = leg.name;
    name.style.background = leg.colour;
    name.style.color = leg.text;
    chip.append(name);
  } else {
    icon.style.color = leg.colour;
  }
  chip.setAttribute('aria-label', `${t(`journeyKind_${leg.kind}`)} ${leg.name}`.trim());
  return chip;
}

function walkChip(leg) {
  const chip = document.createElement('span');
  chip.className = 'ride-chip ride-walk';
  chip.innerHTML = UI.walk;
  const min = document.createElement('sub');
  min.textContent = String(Math.max(1, Math.round(leg.seconds / 60)));
  chip.append(min);
  chip.setAttribute('aria-label', t('journeyWalk', { time: fmtDuration(leg.seconds, getLang()) }));
  return chip;
}

// Running late, on time, or cancelled: only said when it's known.
function liveNote(leg) {
  if (!leg) return null;
  const el = document.createElement('span');
  if (leg.cancelled) {
    el.className = 'journey-live is-late';
    el.textContent = t('journeyCancelled');
  } else if (leg.late != null && leg.late >= 60) {
    el.className = 'journey-live is-late';
    el.textContent = t('journeyLate', { time: fmtDuration(leg.late, getLang()) });
  } else if (leg.live) {
    el.className = 'journey-live is-on-time';
    el.textContent = t('journeyOnTime');
  } else return null;
  return el;
}

function journeyCard(trip, i) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'route-opt journey-opt';
  btn.setAttribute('role', 'radio');
  btn.setAttribute('aria-checked', String(i === S.journey.pick));
  const times = document.createElement('span');
  times.className = 'journey-times';
  times.textContent = `${journeyClock(trip.start)} – ${journeyClock(trip.end)}`;
  const dur = document.createElement('span');
  dur.className = 'route-time journey-dur';
  dur.textContent = fmtDuration(trip.seconds, getLang());
  const chips = document.createElement('span');
  chips.className = 'journey-chips';
  summaryLegs(trip).forEach((leg, n) => {
    if (n) {
      const sep = document.createElement('span');
      sep.className = 'ride-sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '›';
      chips.append(sep);
    }
    chips.append(leg.kind === 'walk' ? walkChip(leg) : rideChip(leg));
  });
  const sub = document.createElement('span');
  sub.className = 'route-via journey-sub';
  const first = trip.first;
  sub.textContent = first ? t('journeyFrom', { place: first.from.name, clock: journeyClock(first.start) }) : '';
  const note = liveNote(first);
  if (note) sub.append(' ', note);
  btn.append(dur, times, chips, sub);
  btn.addEventListener('click', () => openJourneyTrip(i));
  li.append(btn);
  return li;
}

// One trip, step by step: each walk, and each ride from where you get on to
// where you get off.
function journeySteps(trip) {
  const lang = getLang();
  const items = [];
  trip.legs.forEach((leg, n) => {
    const li = document.createElement('li');
    li.className = `journey-step step-${leg.kind === 'walk' ? 'walk' : 'ride'}`;
    li.style.setProperty('--ride', leg.colour);
    const time = document.createElement('span');
    time.className = 'step-time';
    time.textContent = journeyClock(leg.start);
    const body = document.createElement('div');
    body.className = 'step-body';
    if (leg.kind === 'walk') {
      // A walk to the last place is to where you're going; one of no length is just a change.
      if (leg.seconds < 30 && n && n < trip.legs.length - 1) return;
      const p = document.createElement('p');
      p.textContent = t('journeyWalkTo', { time: fmtDuration(leg.seconds, lang), dist: fmtDistance(leg.metres), place: leg.to.name });
      body.append(p);
    } else {
      const head = document.createElement('p');
      head.className = 'step-head';
      head.append(rideChip(leg), ' ');
      const what = document.createElement('strong');
      what.textContent = leg.long && leg.long !== leg.name ? leg.long : t(`journeyKind_${leg.kind}`);
      head.append(what);
      if (leg.toward) {
        const toward = document.createElement('span');
        toward.className = 'step-toward';
        toward.textContent = t('journeyToward', { place: leg.toward });
        head.append(' ', toward);
      }
      const board = document.createElement('p');
      board.textContent = leg.stay ? t('journeyStay', { name: leg.name }) : t('journeyBoard', { place: leg.from.name });
      if (leg.from.track) {
        const track = document.createElement('span');
        track.className = 'step-track';
        track.textContent = t('journeyTrack', { n: leg.from.track });
        board.append(' ', track);
      }
      const note = liveNote(leg);
      if (note) board.append(' ', note);
      const ride = document.createElement('p');
      ride.className = 'step-stops';
      const rideTime = fmtDuration(leg.seconds, lang);
      ride.textContent = leg.stops.length ? t('journeyStops', { n: leg.stops.length + 1, time: rideTime }) : t('journeyStopsNone', { time: rideTime });
      const off = document.createElement('p');
      off.textContent = t('journeyAlight', { place: leg.to.name });
      const offTime = document.createElement('span');
      offTime.className = 'step-off-time';
      offTime.textContent = journeyClock(leg.end);
      off.prepend(offTime, ' ');
      body.append(head, board, ride, off);
    }
    li.append(time, body);
    items.push(li);
  });
  // Where you end up, and when.
  const end = document.createElement('li');
  end.className = 'journey-step step-end';
  const time = document.createElement('span');
  time.className = 'step-time';
  time.textContent = journeyClock(trip.end);
  const body = document.createElement('div');
  body.className = 'step-body';
  const p = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = routeEnd()?.name || '';
  p.append(strong);
  body.append(p);
  end.append(time, body);
  items.push(end);
  return items;
}

function renderJourney() {
  const on = S.mode === 'transit';
  $('preview').classList.toggle('is-transit', on);
  $('journey').hidden = !on;
  if (!on) return;
  const kind = S.journeyWhen.kind;
  $('journey-when-kind').value = kind;
  $('journey-when-time').hidden = kind === 'now';
  if (kind !== 'now' && S.journeyWhen.at && document.activeElement !== $('journey-when-time')) $('journey-when-time').value = localInput(S.journeyWhen.at);
  const j = S.routeState === 'ready' ? S.journey : null;
  const trips = j?.trips || [];
  const open = !!(j?.open && trips[j.pick]);
  const note = $('journey-note');
  const notes = [];
  if (j && !trips.length) notes.push(t('journeyNone'));
  if (j && S.stops.length) notes.push(t('journeyStopsIgnored'));
  // Walking there might be quickest of all.
  if (j?.walk && !open) notes.push(t('journeyWalkOnly', { time: fmtDuration(j.walk.seconds, getLang()) }));
  note.textContent = notes.join(' ');
  note.hidden = !notes.length;
  $('journey-list').hidden = open;
  $('journey-list').setAttribute('role', 'radiogroup');
  $('journey-list').replaceChildren(...(open ? [] : trips.map(journeyCard)));
  $('journey-earlier').hidden = open || !j?.earlier || !trips.length;
  $('journey-later').hidden = open || !j?.later || !trips.length;
  $('journey-earlier').disabled = !!j?.busy;
  $('journey-later').disabled = !!j?.busy;
  $('journey-detail').hidden = !open;
  if (open) {
    const trip = trips[j.pick];
    const changes = trip.transfers ? t('journeyChanges', { n: trip.transfers }) : t('journeyChangesNone');
    $('journey-head').textContent = `${journeyClock(trip.start)} – ${journeyClock(trip.end)} · ${fmtDuration(trip.seconds, getLang())} · ${changes}`;
    $('journey-steps').replaceChildren(...journeySteps(trip));
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
  if (!CONFIG.server || !S.settings.traffic || onFoot() || S.noTrafficKey) return;
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
  const pv = onFoot() ? null : pricedVehicle();
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
    // When you'd get there, and the main roads on the way.
    const via = document.createElement('span');
    via.className = 'route-via';
    const clock = arriveClock(withTraffic(r));
    via.textContent = r.via.length ? t('arriveVia', { clock, road: r.via.join(', ') }) : t('arriveOnly', { clock });
    btn.append(via);
    // Where the traffic is, along the whole way.
    if (r.traffic) {
      const bar = document.createElement('span');
      bar.className = 'route-bar';
      bar.setAttribute('aria-hidden', 'true');
      bar.style.background = trafficGradient(trafficBar(r.length, r.traffic), TRAFFIC_BAR);
      btn.append(bar);
    }
    const tags = document.createElement('span');
    tags.className = 'route-tags';
    // Motorcycles don't pay tolls in Malaysia, so the tag would only mislead.
    if (r.hasToll && S.mode !== 'motorcycle') tags.append(tag(tollTag(r)));
    if (r.hasFerry) tags.append(tag(t('ferry')));
    const cost = pv ? tripPlan(pv, r.distanceKm)?.cost : null;
    if (cost != null) tags.append(tag(t(pv.kind === 'ev' ? 'costEv' : 'costFuel', { cost: money(cost) }), 'tag-cost'));
    const lights = !onFoot() && alongOf(r) ? countLights(alongOf(r).features) : 0;
    if (lights) tags.append(tag(t('lightsCount', { n: lights }), 'tag-cost'));
    const cams = !onFoot() && S.settings.speedCameras ? alongOf(r)?.cameras.length || 0 : 0;
    if (cams) tags.append(tag(cams === 1 ? t('camerasOne') : t('camerasCount', { n: cams }), 'tag-cam'));
    if (r.traffic) {
      const slow = r.traffic.delay >= 120;
      tags.append(tag(slow ? t('trafficDelayTag', { time: fmtDuration(r.traffic.delay, getLang()) }) : t('trafficClearTag'), slow ? 'tag-slow' : 'tag-clear'));
    }
    // The quickest of the routes on offer: "now" once the traffic on each is known.
    if (S.routes.length > 1 && i === fastestNow(S.routes)) {
      tags.append(tag(t(S.routes.every((x) => x.traffic) ? 'fastestNow' : 'fastest'), 'tag-best'));
    }
    btn.append(tags);
    btn.addEventListener('click', () => selectRoute(i));
    li.append(btn);
    return li;
  }));

  const ready = S.routeState === 'ready' && S.routes.length > 0;
  if (ready) { loadAlong(); loadOtherWay(); }
  $('start').disabled = !ready;
  $('add-stop').disabled = !ready;
  renderActions();
  renderPlan();
  renderJourney();
  renderMapExtras();
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

// The clock time you'd arrive, leaving now.
function arriveClock(seconds) {
  const at = new Date(Date.now() + seconds * 1000);
  const later = at.toDateString() !== new Date().toDateString();
  return `${fmtClock(at, getLang())}${later ? ` ${t('tomorrow')}` : ''}`;
}

const TRAFFIC_BAR = { clear: '#2E9E5B', slow: '#F5A524', jam: '#D93025' };

/* ---------- On the map while choosing: labels, cameras, warnings ---------- */

// The other way (with or without tolls) only when it is a real choice.
function otherChoice(route) {
  const other = S.otherWay;
  if (other?.state !== 'ready' || S.mode !== 'car' || !route) return null;
  const differs = other.free ? !other.route.hasToll && route.hasToll : other.route.hasToll;
  return differs ? other : null;
}

function takeOtherWay() {
  const box = $('avoid-tolls');
  box.checked = !!S.otherWay?.free;
  box.dispatchEvent(new Event('change'));
}

// "RM27.10", "Tol" or "Tiada tol" beside a route on the map.
function mapTollNote(route, tolls) {
  if (S.mode !== 'car') return '';
  if (!route.hasToll) return t('noTolls');
  const sum = tolls ? tollTotal(tolls) : null;
  if (sum?.total != null) return `RM${money(sum.total)}${sum.unknown ? '+' : ''}`;
  return t('tollStill');
}

// Pixels a metre will be once these lines are fitted to the map, as fitRoutes does.
function fittedScale(lines) {
  let w = Infinity, e = -Infinity, so = Infinity, n = -Infinity;
  for (const c of lines) for (const [lng, lat] of c) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < so) so = lat;
    if (lat > n) n = lat;
  }
  if (!Number.isFinite(w)) return null;
  const pad = mapPadding();
  const k = Math.cos((((so + n) / 2) * Math.PI) / 180);
  const across = Math.max(1, (e - w) * k * 111320), down = Math.max(1, (n - so) * 111320);
  const room = [Math.max(80, innerWidth - pad.left - pad.right), Math.max(80, innerHeight - pad.top - pad.bottom)];
  return Math.min(room[0] / across, room[1] / down);
}

function renderMapLabels() {
  const ready = S.view === 'preview' && !S.overlay && S.routeState === 'ready' && S.routes.length > 0;
  if (!ready) {
    mapView.setRouteLabels([]);
    mapView.setOtherWay(null);
    return;
  }
  const lang = getLang();
  const other = otherChoice(S.routes[S.selected]);
  const lines = [...S.routes.map((r) => r.coords), ...(other ? [other.route.coords] : [])];
  const key = [...S.routes.map((r) => r.id), other ? other.route.id : ''].join(',');
  const words = [
    ...S.routes.map((r) => ({ time: fmtDuration(withTraffic(r), lang), note: mapTollNote(r, alongOf(r)?.tolls) })),
    ...(other ? [{ time: fmtDuration(other.route.time, lang), note: mapTollNote(other.route, other.tolls) }] : []),
  ];
  // Placed again when the routes change, or the words make a label much wider.
  const sizes = words.map((w) => labelSize(w.time, w.note));
  const sizeKey = sizes.map((z) => Math.round(z.w / 16)).join(',');
  if (S.labelSpots?.key !== key || S.labelSpots.sizeKey !== sizeKey) {
    S.labelSpots = { key, sizeKey, spots: labelSpots(lines, { pxPerM: fittedScale(lines), sizes }) };
  }
  const spots = S.labelSpots.spots;
  const labels = S.routes.map((r, i) => ({
    key: r.id,
    index: i,
    lng: spots[i][0],
    lat: spots[i][1],
    ...words[i],
    selected: i === S.selected,
  }));
  if (other) {
    const at = spots[S.routes.length];
    labels.push({ key: 'other', other: true, lng: at[0], lat: at[1], ...words[S.routes.length], selected: false });
  }
  mapView.setRouteLabels(labels, (l) => (l.other ? takeOtherWay() : selectRoute(l.index)));
  mapView.setOtherWay(other ? other.route.coords : null);
}

// Speed cameras on the map: on the chosen route while choosing, and on the way while driving.
function renderMapCameras() {
  if (!mapView) return;
  const on = S.settings.speedCameras && S.settings.camerasMap && !onFoot();
  let list = [];
  if (on && S.view === 'preview' && !S.overlay) list = alongOf(S.routes[S.selected] || {})?.cameras || [];
  if (on && S.view === 'nav') list = S.cameras || [];
  const key = list.map((c) => c.id ?? `${c.lng},${c.lat}`).join('|');
  if (key === S.camerasKey) return;
  S.camerasKey = key;
  mapView.setCameras(list);
}

function renderMapTools() {
  const route = S.routes[S.selected];
  const cams = route && !onFoot() && S.settings.speedCameras ? alongOf(route)?.cameras.length || 0 : 0;
  $('map-tools').hidden = !(S.view === 'preview' && !S.overlay && S.routeState === 'ready' && cams > 0);
  const btn = $('btn-cams');
  btn.setAttribute('aria-pressed', String(!!S.settings.camerasMap));
  btn.classList.toggle('is-on', !!S.settings.camerasMap);
}

function toggleMapCameras() {
  setSetting('camerasMap', !S.settings.camerasMap);
  renderMapTools();
  renderMapCameras();
  toast(t(S.settings.camerasMap ? 'camsShown' : 'camsHidden'));
}

// The states under an official warning that the chosen route goes through, lit
// up, and a storm where the route goes into the first of them.
function renderMapWarnings() {
  const route = S.routes[S.selected];
  const w = S.weather;
  const names = S.view === 'preview' && !S.overlay && route && w?.routeId === route.id && w.entries && !w.pending
    ? [...new Set((w.warnings || []).flatMap((x) => x.states))].filter((n) => w.entries.some((e) => e.name === n))
    : [];
  // The storm goes on the first warned stretch, clear of where you start and of the labels.
  const stretch = names.length ? stretchIn(w.entries, names, route.length) : null;
  const along = stretch ? Array.from({ length: 9 }, (_, i) => pointAt(route, stretch.from + ((stretch.to - stretch.from) * (i + 1)) / 10)) : [];
  const into = stretch ? clearOfLabels(along) : null;
  const key = names.length ? `${route.id}|${names.join(',')}|${getLang()}|${S.labelSpots?.key || ''}` : '';
  if (key === S.warnMapKey) return;
  S.warnMapKey = key;
  if (!names.length) { mapView.setWarnings([], null); return; }
  const warn = mainWarning(w.warnings);
  const label = warn ? t('warnOnRoute', { title: warnTitle(warn) }) : '';
  loadStates().then((states) => {
    if (S.warnMapKey !== key) return;
    mapView.setWarnings(shapesOf(states, names), into ? { lng: into[0], lat: into[1], label } : null);
  }).catch(() => { /* the card still says it */ });
}

// Of points along the route, one that no label covers: worked out on the screen
// when the map can say where things are, or by distance when it can't.
function clearOfLabels(points) {
  const spots = (S.labelSpots?.spots || []).filter(Boolean);
  const px = points.map(([lng, lat]) => mapView.screenPoint(lng, lat));
  const boxes = spots.map(([lng, lat]) => mapView.screenPoint(lng, lat));
  if (px.some((p) => !p) || boxes.some((b) => !b)) return clearOf(points, spots);
  const i = clearOfBoxes(px, boxes.map(([x, y]) => [x - LABEL_BOX.left, y - LABEL_BOX.up, x + LABEL_BOX.right, y + LABEL_BOX.down]));
  return points[i];
}

function renderMapExtras() {
  if (!mapView) return;
  mapView.setJunctionRoads(S.view === 'nav' && !onFoot() && (!!S.settings.view3d || !!S.settings.satellite));
  if (S.view !== 'nav') renderTurnArrow(null);
  if (S.view !== 'nav') renderRoadSigns({ onRoute: false });
  renderMapLabels();
  renderMapCameras();
  renderMapTools();
  renderMapWarnings();
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

  renderPlanWild(route);
  renderPlanFerry(route);
  renderPlanCross();
  renderPlanOrder();
  renderPlanAlong(route);
  renderPlanFuel(route);
  renderPlanToll(route);
  renderPlanTng(route);
  renderPlanOtherWay(route);
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
  row.hidden = onFoot();
  const look = S.looks[driveMode()] || DEFAULT_LOOKS.car;
  const lookKey = `${look.body}|${look.color}`;
  if ($('plan-car-pic').dataset.look !== lookKey) {
    $('plan-car-pic').dataset.look = lookKey;
    $('plan-car-pic').innerHTML = vehiclePicture(look);
  }
  $('plan-car-name').textContent = v?.name || t(S.mode === 'motorcycle' ? 'motoYours' : 'carYours');
  $('plan-fuel-edit').textContent = t(v ? 'vehEditBtn' : 'vehAddBtn');
  $('plan-level-row').hidden = !v?.range;
  $('plan-charge').hidden = true;
  $('plan-fuel-price').hidden = true;
  $('plan-car-gauges').hidden = true;
  row.classList.remove('is-short', 'is-tight');
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
  // Subsidised petrol: say so when this trip takes the month near its limit.
  $('plan-budi').hidden = true;
  if (v.grade === BUDI_GRADE && plan.used > 0 && plan.unit === 'L') {
    const after = budiAfter(budiUsed(keptTrips(), load('budi', null)), plan.used);
    if (after.near) {
      $('plan-budi').hidden = false;
      $('plan-budi').classList.toggle('is-over', after.over);
      $('plan-budi').textContent = t('budiPlan', { litres: amountText(after.litres), limit: after.limit });
    }
  }
  // How full the tank or battery will be on arrival, and how far it goes now.
  if (v.range && plan.rangeAtEnd != null) {
    const pct = Math.max(0, Math.round((plan.rangeAtEnd / v.range) * 100));
    $('plan-car-gauges').hidden = false;
    $('plan-car-arrive-fill').style.transform = `scaleX(${Math.min(1, pct / 100)})`;
    $('plan-car-arrive-text').textContent = t(v.kind === 'ev' ? 'carArriveEv' : 'carArrive', { pct });
    $('plan-car-range').textContent = t('carRange', { km: kmText(plan.rangeNow) });
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
  row.classList.toggle('is-short', !charging && plan.status === 'short');
  row.classList.toggle('is-tight', !charging && plan.status === 'tight');
  $('plan-level').value = String(v.level);
  $('plan-level-value').textContent = `${v.level}%`;
}

/* ---------- Tolls, R&Rs and cameras along each route ---------- */

const ALONG_RAIL_MAX = 40;
const ALONG_WAIT_MS = 500;
const ALONG_SLOW_MS = 8000;      // still looking after this long: say the map server is slow
const SHOW_LOADING_KM = 30;

// One request for every route on offer, a moment after they arrive.
function loadAlong() {
  if (S.view !== 'preview') return;
  const routes = onFoot() ? [] : S.routes.slice(0, 3);
  const opts = {
    tolls: S.mode !== 'motorcycle' && routes.some((r) => r.hasToll),
    cameras: !!S.settings.speedCameras,
    rests: true,
  };
  const key = `${routes.map((r) => r.id).join(',')}|${opts.tolls}|${opts.cameras}`;
  if (S.along?.key === key) return;
  S.alongCtrl?.abort();
  clearTimeout(S.alongTimer);
  if (!routes.length) { S.along = null; return; }
  const ctrl = new AbortController();
  S.alongCtrl = ctrl;
  S.along = { key, state: 'loading', byRoute: new Map() };
  S.alongPick = null;
  S.alongTimer = setTimeout(() => {
    const marks = togetherReady() ? fetchMarks(marksBox(routes), { signal: ctrl.signal }).catch(() => []) : Promise.resolve([]);
    // Taking a while: the map's servers are busy, and it's worth saying so.
    setTimeout(() => {
      if (S.along?.key !== key || S.along.state !== 'loading') return;
      S.along.slow = true;
      if (S.view === 'preview') renderRoutes();
    }, ALONG_SLOW_MS);
    // First what matters before setting off: tolls, cameras and R&Rs. Lights,
    // bumps and crossings, which are many more, are asked for after.
    Promise.all([findAlong(routes, { signal: ctrl.signal, waits: QUICK_WAITS, ...opts }), marks]).then(([found, fixes]) => {
      if (S.along?.key !== key) return;
      S.marks = fixes;
      const fixed = { ...found, features: [], cameras: markCameras(found.cameras, fixes) };
      const byRoute = new Map(routes.map((r) => {
        const on = alongRoute(r, fixed);
        return [r.id, { ...on, plazas: on.tolls, tolls: priceTolls(r, on.tolls, S.driverFares) }];
      }));
      S.along = { key, state: 'ready', byRoute, found: { ...found, features: [] }, features: 'loading' };
      askDriverFares(routes, key);
      loadAlongFeatures(routes, key, ctrl);
    }).catch(() => {
      if (S.along?.key === key && !ctrl.signal.aborted) S.along = { key, state: 'error', byRoute: new Map() };
    }).finally(() => {
      if (S.along?.key === key && S.view === 'preview') renderRoutes();
    });
  }, ALONG_WAIT_MS);
}

// Lights, bumps and railway crossings along each route, once the tolls are in.
function loadAlongFeatures(routes, key, ctrl) {
  fetchAlong(routes, { signal: ctrl.signal, waits: SLOW_WAITS, tolls: false, cameras: false, rests: false, features: true })
    .then((got) => {
      if (S.along?.key !== key) return;
      S.along.found = { ...S.along.found, features: got.features };
      const feats = markFeatures(got.features, S.marks || []);
      for (const r of routes) {
        const on = S.along.byRoute.get(r.id);
        if (on) on.features = featuresOnRoute(r, feats);
      }
      S.along.features = 'ready';
    })
    .catch(() => { if (S.along?.key === key) S.along.features = 'error'; })
    .finally(() => { if (S.along?.key === key && S.view === 'preview') renderRoutes(); });
}

// What Pintu's drivers paid at plazas with no announced fare, asked once per plaza.
async function askDriverFares(routes, key) {
  if (!CONFIG.server) return;
  S.driverFares ||= {};
  S.faresAsked ||= new Set();
  const ids = [];
  for (const r of routes) {
    for (const toll of S.along.byRoute.get(r.id)?.tolls || []) {
      if (toll.fare == null && !S.faresAsked.has(toll.id)) ids.push(toll.id);
    }
  }
  const want = [...new Set(ids)].slice(0, 80);
  if (!want.length) return;
  for (const id of want) S.faresAsked.add(id);
  let got;
  try { got = await get(`/fares?ids=${encodeURIComponent(want.join(','))}`); } catch { return; }
  Object.assign(S.driverFares, got?.fares || {});
  if (S.along?.key !== key || S.along.state !== 'ready') return;
  for (const r of routes) {
    const on = S.along.byRoute.get(r.id);
    if (on) on.tolls = priceTolls(r, on.plazas, S.driverFares);
  }
  if (S.view === 'preview') renderRoutes();
}

function retryAlong() {
  if (S.along) S.along.key = '';
  loadAlong();
  renderRoutes();
}

const alongOf = (route) => (S.along?.state === 'ready' ? S.along.byRoute.get(route.id) || null : null);

// The toll tag on a route option: its price when the plazas are known.
function tollTag(route) {
  const on = alongOf(route);
  const sum = on ? tollTotal(on.tolls) : null;
  if (sum?.total != null) return t(sum.unknown ? 'tollRmSome' : 'tollRm', { total: money(sum.total) });
  return route.tollKm >= 1 ? t('tollKm', { km: kmText(route.tollKm) }) : t('tollStill');
}

function renderPlanToll(route) {
  const wrap = $('plan-toll-wrap');
  const state = S.along?.state;
  const on = alongOf(route);
  const tolls = on?.tolls || [];
  const show = S.mode === 'car' && (route.hasToll || tolls.length > 0) && !!state;
  wrap.hidden = !show;
  if (!show) return;
  const sum = tollTotal(tolls);
  const title = $('plan-toll-title');
  const detail = $('plan-toll-detail');
  const canOpen = state === 'ready' && tolls.length > 0;
  if (state === 'loading') {
    title.textContent = t('tollCardTitle');
    detail.textContent = t(S.along.slow ? 'tollCardSlow' : 'tollCardLoading');
  } else if (state === 'error') {
    title.textContent = t('tollCardTitle');
    detail.textContent = t('tollCardFailed');
  } else if (!tolls.length) {
    title.textContent = t('tollCardRoad');
    detail.textContent = t('tollCardUnmapped');
  } else {
    title.textContent = sum.total == null ? t('tollCardNone', { n: sum.plazas })
      : t(sum.unknown ? 'tollCardSome' : 'tollCardAll', { total: money(sum.total) });
    const parts = [t('tollPlazaCount', { n: sum.plazas })];
    if (sum.roads.length) parts.push(t('tollFareFrom', { roads: sum.roads.join(', ') }));
    if (sum.byDrivers) parts.push(t('tollDriversCount', { n: sum.byDrivers }));
    parts.push(sum.priced ? (sum.unknown ? t('tollUnknownSome', { n: sum.unknown }) : '') : t('tollUnknownAll'));
    detail.textContent = parts.filter(Boolean).join(' · ');
  }
  const open = canOpen && !!S.tollOpen;
  $('plan-toll').setAttribute('aria-expanded', String(open));
  $('plan-toll').classList.toggle('is-open', open);
  $('plan-toll-chev').hidden = !canOpen;
  const list = $('toll-list');
  list.hidden = !open;
  if (!open) return;
  list.replaceChildren(...tolls.map((toll) => {
    const li = document.createElement('li');
    const km = document.createElement('span');
    km.className = 'toll-km';
    km.textContent = kmText(toll.along / 1000);
    const name = document.createElement('span');
    name.className = 'toll-name';
    const strong = document.createElement('strong');
    strong.textContent = toll.name || t(toll.gantry ? 'tollGantry' : 'tollPlazaUnnamed');
    name.append(strong);
    if (toll.road || toll.byDrivers) {
      const road = document.createElement('span');
      road.textContent = toll.road || t('tollByDrivers');
      name.append(road);
    }
    const fare = document.createElement('span');
    fare.className = toll.fare == null ? 'toll-fare is-unknown' : 'toll-fare';
    fare.textContent = toll.fare == null ? t('tollFareUnknown') : `RM${money(toll.fare)}`;
    li.append(km, name, fare);
    return li;
  }));
}

// The same trip the other way about tolls: what avoiding them costs in time,
// or what using them saves.
function loadOtherWay() {
  if (S.view !== 'preview' || S.mode !== 'car' || !S.routes.length || !S.routeFrom) return;
  const wantFree = !S.avoidTolls;
  const key = `${S.routes.map((r) => r.id).join(',')}|${wantFree}`;
  if (S.otherWay?.key === key) return;
  S.otherCtrl?.abort();
  if (wantFree && !S.routes.some((r) => r.hasToll)) { S.otherWay = null; return; }
  const ctrl = new AbortController();
  S.otherCtrl = ctrl;
  S.otherWay = { key, state: 'loading', free: wantFree };
  const finish = (next) => { if (S.otherWay?.key === key) S.otherWay = next; };
  // Only the free route servers: a comparison isn't worth TomTom's allowance.
  const providers = routeProviders().filter((p) => !p.plain);
  fetchRoutes({ from: S.routeFrom, to: routeEnd(), stops: S.stops, mode: S.mode, avoidTolls: wantFree, alternates: 0, id: 'pintu-compare', signal: ctrl.signal }, { providers })
    .then(async ([route]) => {
      if (!route) throw new Error('no route');
      let tolls = null;
      if (!wantFree && route.hasToll) {
        const found = await findAlong([route], { signal: ctrl.signal, tolls: true, cameras: false, rests: false }).catch(() => null);
        tolls = found ? priceTolls(route, alongRoute(route, found).tolls) : null;
      }
      finish({ key, state: 'ready', free: wantFree, route, tolls });
    })
    .catch(() => { if (!ctrl.signal.aborted) finish({ key, state: 'error', free: wantFree }); })
    .finally(() => {
      if (S.otherWay?.key !== key || S.view !== 'preview') return;
      renderRoutes();
      // Its label is worth seeing too, unless you've moved the map yourself.
      if (otherChoice(S.routes[S.selected]) && !S.previewMoved && !S.overlay) fitRoutes();
    });
}

// "RM4.10", "at least RM4.10", or nothing when no fare is known.
function tollMoney(tolls) {
  const sum = tolls ? tollTotal(tolls) : null;
  if (sum?.total == null) return null;
  return sum.unknown ? t('otherAtLeast', { total: money(sum.total) }) : `RM${money(sum.total)}`;
}

/* ---------- Ferries ---------- */

// The route counts the time on the water, not the wait for the next sailing.
function renderPlanFerry(route) {
  const legs = ferryLegs(route);
  $('plan-ferry').hidden = !legs.length;
  if (!legs.length) return;
  const lang = getLang();
  $('plan-ferry-icon').innerHTML = turnIcon({ type: 28 });
  const names = legs.map((l) => t('ferryLeg', { name: l.name || t('ferry'), time: fmtDuration(l.seconds, lang) })).join(', ');
  $('plan-ferry-title').textContent = names;
  $('plan-ferry-detail').textContent = t('ferryWait');
  const link = $('plan-ferry-times');
  link.href = timetableSearch(legs[0].name, t('ferryTimesWords'));
  link.textContent = t('ferryTimes');
}

/* ---------- Johor–Singapore crossings ---------- */

const CROSS_JAM_S = 5 * 60;      // a delay worth naming
const CAMERAS_FRESH_MS = 90e3;   // photos are asked for again after this

// The trip over each crossing, when it goes between Johor and Singapore.
async function checkCrossings(routes) {
  // With stops, which crossing comes where is the route's own business.
  const found = onFoot() || S.stops.length ? null : crossingOf(routes[0]);
  if (!found) { S.cross = null; renderPlanCross(); return; }
  const p = (x) => `${x.lat.toFixed(4)},${x.lng.toFixed(4)}`;
  const key = [p(S.routeFrom), ...S.stops.map(p), p(routeEnd()), S.mode, S.avoidTolls ? 'free' : ''].join('|');
  if (S.cross?.key === key) { renderPlanCross(); return; }
  S.crossCtrl?.abort();
  const ctrl = new AbortController();
  S.crossCtrl = ctrl;
  const cross = { key, intoSg: found.intoSg, list: CROSSINGS.map((c) => ({ c, state: 'loading' })) };
  S.cross = cross;
  renderPlanCross();
  loadCrossCameras();
  for (const item of cross.list) {
    try {
      // A route already offered may go this way; otherwise, one through the bridge.
      let route = routes.find((r) => crossingOf(r)?.crossing.id === item.c.id);
      if (!route) {
        const got = await fetchRoutes({
          from: S.routeFrom, to: routeEnd(), stops: S.stops, through: [throughFor(item.c, found.intoSg)],
          mode: S.mode, avoidTolls: S.avoidTolls, alternates: 0, id: 'pintu-crossing', signal: ctrl.signal,
        });
        route = got[0];
        if (crossingOf(route)?.crossing.id !== item.c.id) route = null;
      }
      if (ctrl.signal.aborted) return;
      if (route && !route.traffic && CONFIG.server && S.settings.traffic && !S.noTrafficKey) {
        route.traffic = await fetchTraffic(route, 0, { signal: ctrl.signal }).catch(() => null);
      }
      if (ctrl.signal.aborted) return;
      Object.assign(item, route ? { state: 'ready', route } : { state: 'none' });
    } catch {
      if (ctrl.signal.aborted) return;
      item.state = 'none';
    }
    if (S.cross === cross) renderPlanCross();
  }
}

function loadCrossCameras(force = false) {
  if (!force && S.crossCamsAt && Date.now() - S.crossCamsAt < CAMERAS_FRESH_MS) return;
  S.crossCamsAt = Date.now();
  fetchCrossingCameras().then((cams) => {
    S.crossCams = cams;
    renderPlanCross();
    if (S.overlay === 'camview') renderCamView();
  }).catch(() => { S.crossCamsAt = 0; });
}

function camThumb(id, onOpen) {
  const cam = S.crossCams?.get(id);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cross-thumb';
  btn.addEventListener('click', onOpen);
  if (cam) {
    const img = document.createElement('img');
    img.src = cam.image;
    img.alt = t(`cam_${id}`);
    img.loading = 'lazy';
    img.decoding = 'async';
    const when = document.createElement('span');
    when.textContent = cam.at ? fmtClock(new Date(cam.at), getLang()) : '';
    btn.append(img, when);
  }
  btn.setAttribute('aria-label', t('crossPhotos', { name: t(`cross_${id === '2701' || id === '2702' ? 'causeway' : 'second-link'}`) }));
  return btn;
}

function renderPlanCross() {
  const box = $('plan-cross');
  const cross = S.cross;
  const show = S.view === 'preview' && !!cross && S.routeState === 'ready';
  box.hidden = !show;
  if (!show) return;
  const lang = getLang();
  $('plan-cross-title').textContent = t(cross.intoSg ? 'crossTitleIn' : 'crossTitleOut');
  const ready = cross.list.filter((x) => x.state === 'ready');
  const quickest = ready.length > 1 ? ready.reduce((a, b) => (withTraffic(b.route) < withTraffic(a.route) ? b : a)) : null;
  $('plan-cross-status').textContent = cross.list.some((x) => x.state === 'loading') ? t('crossFinding') : '';
  const chosen = S.routes[S.selected];
  $('cross-list').replaceChildren(...cross.list.map((item) => {
    const li = document.createElement('li');
    li.append(camThumb(item.c.cameras[0], () => openCamView(item.c)));
    const main = document.createElement('div');
    main.className = 'cross-main';
    const name = document.createElement('strong');
    name.textContent = t(`cross_${item.c.id}`);
    const detail = document.createElement('span');
    if (item.state === 'loading') detail.textContent = t('crossFinding');
    else if (item.state === 'none') detail.textContent = t('crossNone');
    else {
      const delay = item.route.traffic?.delay || 0;
      detail.textContent = delay >= CROSS_JAM_S
        ? t('crossJam', { time: fmtDuration(withTraffic(item.route), lang), delay: fmtDuration(delay, lang) })
        : fmtDuration(withTraffic(item.route), lang);
      if (item === quickest) {
        const q = document.createElement('span');
        q.className = 'is-quick';
        q.textContent = t('crossQuickest');
        main.append(name, detail, q);
      }
    }
    if (!main.childNodes.length) main.append(name, detail);
    li.append(main);
    if (item.state === 'ready' && item.route === chosen) {
      const tag = document.createElement('span');
      tag.className = 'cross-this';
      tag.textContent = t('crossThis');
      li.append(tag);
    } else if (item.state === 'ready') {
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'link-btn';
      use.textContent = t('crossUse');
      use.addEventListener('click', () => useCrossing(item));
      li.append(use);
    } else {
      li.append(document.createElement('span'));
    }
    return li;
  }));
  $('cross-credit').textContent = t('crossCredit');
}

// Take the trip over this crossing: one of the routes offered, or added to them.
function useCrossing(item) {
  let i = S.routes.indexOf(item.route);
  if (i < 0) {
    S.routes = [...S.routes, item.route];
    i = S.routes.length - 1;
  }
  selectRoute(i);
  mapView?.fit(S.routes.map((r) => r.coords), mapPadding());
}

function openCamView(crossing) {
  S.camView = crossing;
  loadCrossCameras(true);
  openOverlay('camview');
  renderCamView();
}

function renderCamView() {
  const c = S.camView;
  if (!c) return;
  const lang = getLang();
  $('camview-title').textContent = t(`cross_${c.id}`);
  $('camview-detail').textContent = t('camviewDetail');
  $('camview-photos').replaceChildren(...c.cameras.map((id) => {
    const cam = S.crossCams?.get(id);
    const fig = document.createElement('figure');
    const img = document.createElement('img');
    img.alt = t(`cam_${id}`);
    if (cam) img.src = cam.image;
    const cap = document.createElement('figcaption');
    cap.textContent = cam?.at ? t('camAt', { name: t(`cam_${id}`), time: fmtClock(new Date(cam.at), lang) }) : t(`cam_${id}`);
    fig.append(img, cap);
    return fig;
  }));
  $('camview-credit').textContent = t('crossCredit');
}

/* ---------- Roads where wild elephants cross ---------- */

// The stretches of a route along one, worked out once the roads are known.
function wildOn(route) {
  if (!route || !S.wildlife) return [];
  route.wild ??= zonesOnRoute(route, S.wildlife);
  return route.wild;
}

function loadWild() {
  loadWildlife().then((zones) => {
    S.wildlife = zones;
    if (S.view === 'preview') renderPlan();
  }).catch(() => { /* nothing known, nothing said */ });
}

function renderPlanWild(route) {
  const row = $('plan-wild');
  const on = onFoot() ? [] : wildOn(route);
  row.hidden = !on.length;
  if (!on.length) return;
  $('plan-wild-icon').innerHTML = UI.elephant;
  $('plan-wild-title').textContent = t('wildTitle');
  const names = on.map((z) => t('wildStretch', { name: z.name, km: fmtDistance(z.toS - z.fromS) })).join(', ');
  $('plan-wild-detail').textContent = t('wildDetail', { names });
}

// While driving: the stretch coming up, or the one you're in, when nothing
// nearer (a light, a bump, a crossing) needs the space.
function renderWildAhead(st, fix) {
  const box = $('road-alert');
  const near = zoneAhead(wildOn(S.route), st.s, fix.speed ?? 0);
  if (!near) return false;
  const { zone, ahead, left } = near;
  S.roadNear = null;
  const lang = getLang();
  box.hidden = false;
  box.dataset.kind = zone.animal;
  $('road-alert-icon').innerHTML = UI.elephant;
  const distance = fmtDistance(Math.max(ahead > 0 ? ahead : left, 10));
  $('road-alert-distance').textContent = ahead > 0 ? distance : t('wildLeft', { distance });
  box.setAttribute('aria-label', ahead > 0 ? t('roadAria_elephant', { distance }) : t('wildAriaIn', { distance }));
  const key = `wild:${zone.id}:${Math.round(zone.fromS)}`;
  if (S.featuresSaid.has(key)) return true;
  if (!st.prompts.length && voice.busy()) return true;
  S.featuresSaid.add(key);
  if (S.settings.voiceLevel === 'full' && !(S.sim && S.sim.factor >= SIM_FAST)) {
    speakText(ahead > 0 ? t('roadSay_elephant', { distance: sayDistance(ahead, lang) }) : t('wildSayIn'), { wait: voice.WAIT_TURN_MS });
  }
  return true;
}

/* ---------- The best order for several stops ---------- */

// Each stop's distance along the route as now planned, so a stop added later
// goes in its place among them.
function stopsAlong(route) {
  const at = route?.maneuvers?.filter((m) => m.isStop).map((m) => m.beginDist) || [];
  if (at.length === S.stops.length) S.stops.forEach((st, i) => { st.along = at[i]; });
}

// The stops you chose yourself, two to eight of them, with nothing planned for
// you among them (charging stops have their own order).
function errandsKey() {
  if (onFoot() || !S.routeFrom || S.stops.some((st) => st.charge)) return null;
  if (S.stops.length < 2 || S.stops.length > MAX_STOPS) return null;
  const end = routeEnd();
  const p = (x) => `${x.lat.toFixed(5)},${x.lng.toFixed(5)}`;
  return [p(S.routeFrom), ...S.stops.map(p), p(end), S.mode, S.avoidTolls ? 'free' : ''].join('|');
}

async function checkStopOrder() {
  const key = errandsKey();
  if (!key || S.order?.key === key) { renderPlanOrder(); return; }
  S.orderCtrl?.abort();
  const ctrl = new AbortController();
  S.orderCtrl = ctrl;
  S.order = { key, pending: true };
  try {
    const times = await fetchDriveTimes([S.routeFrom, ...S.stops, routeEnd()], { signal: ctrl.signal, mode: S.mode, avoidTolls: S.avoidTolls });
    if (ctrl.signal.aborted || S.order?.key !== key) return;
    S.order = { key, ...(suggestOrder(times) || {}) };
  } catch {
    if (ctrl.signal.aborted) return;
    S.order = { key };
  }
  renderPlanOrder();
}

function renderPlanOrder() {
  const row = $('plan-order');
  const o = S.order;
  const show = S.view === 'preview' && !!o?.order && o.key === errandsKey();
  row.hidden = !show;
  if (!show) return;
  $('plan-order-icon').innerHTML = UI.swap;
  $('plan-order-title').textContent = t('orderTitle', { time: fmtDuration(Math.round(o.saving / 60) * 60, getLang()) });
  $('plan-order-detail').textContent = t('orderDetail', { order: o.order.map((i) => S.stops[i]?.name || '?').join(' → ') });
  $('plan-order-go').textContent = t('orderGo');
}

function useStopOrder() {
  const o = S.order;
  if (!o?.order || o.key !== errandsKey()) return;
  S.stops = o.order.map((i) => S.stops[i]);
  S.order = null;
  mapView?.setStopPins(stopPins());
  loadRoutes();
}

function renderPlanOtherWay(route) {
  const row = $('plan-other');
  // Avoiding tolls may still use one; with tolls may be the same road. Neither is a choice.
  const other = otherChoice(route);
  row.hidden = !other;
  if (!other) return;
  const lang = getLang();
  const dt = Math.round((other.route.time - route.time) / 60);
  const time = fmtDuration(Math.abs(dt) * 60, lang);
  const sameTime = Math.abs(dt) < 1;
  const dkm = other.route.distanceKm - route.distanceKm;
  const parts = [];
  if (other.free) {
    $('plan-other-title').textContent = sameTime ? t('otherFreeSame') : t(dt > 0 ? 'otherFreeSlower' : 'otherFreeFaster', { time });
    const on = alongOf(route);
    const saved = on ? tollMoney(on.tolls) : null;
    if (saved) parts.push(t('otherSaves', { amount: saved }));
    else if (on?.tolls.length) parts.push(t('otherSkips', { n: on.tolls.length }));
    $('plan-other-go').textContent = t('otherUseFree');
  } else {
    $('plan-other-title').textContent = sameTime ? t('otherTollSame') : t(dt < 0 ? 'otherTollFaster' : 'otherTollSlower', { time });
    const cost = tollMoney(other.tolls);
    if (cost) parts.push(t('otherCosts', { amount: cost }));
    $('plan-other-go').textContent = t('otherUseToll');
  }
  if (Math.abs(dkm) >= 1) parts.push(t(dkm > 0 ? 'otherFurther' : 'otherShorter', { km: kmText(Math.abs(dkm)) }));
  $('plan-other-detail').textContent = parts.join(' · ');
}

// What goes on the rail: every R&R, and cameras too while there's room.
function railItems(on) {
  const rests = on.rests.map((r) => ({ ...r, type: r.kind }));
  let cameras = on.cameras.map((c) => ({ ...c, type: 'camera' }));
  const room = ALONG_RAIL_MAX - rests.length;
  if (cameras.length > room) {
    const step = cameras.length / Math.max(1, room);
    cameras = room > 0 ? Array.from({ length: room }, (_, i) => cameras[Math.floor(i * step)]) : [];
  }
  return [...rests, ...cameras].sort((a, b) => a.along - b.along);
}

const railName = (item) => {
  if (item.type === 'camera') return item.limit ? t('alongCameraLimit', { limit: item.limit }) : t('alongCamera');
  return item.name || t(item.type === 'rnr' ? 'nameRest' : 'nameLayby');
};
const railIcon = (item) => (item.type === 'camera' ? UI.camera : item.type === 'rnr' ? UI.coffee : UI.rest);

function renderPlanAlong(route) {
  const wrap = $('plan-along');
  const state = S.along?.state;
  const on = alongOf(route);
  const items = on ? railItems(on) : [];
  const loadingLong = state === 'loading' && route.distanceKm >= SHOW_LOADING_KM;
  wrap.hidden = onFoot() || !(items.length || loadingLong);
  if (wrap.hidden) return;
  $('plan-along-title').textContent = t('alongTitle');
  $('plan-along-status').textContent = state === 'loading' ? t('alongLoading') : '';
  const pick = items.find((x) => x.id === S.alongPick) || null;
  const rail = $('along-rail');
  const key = JSON.stringify([route.id, getLang(), items.map((x) => x.id), pick?.id]);
  if (rail.dataset.key !== key) {
    rail.dataset.key = key;
    rail.replaceChildren(...items.map((item) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `along-stop along-${item.type}`;
      btn.setAttribute('aria-pressed', String(item === pick));
      const sign = document.createElement('span');
      sign.className = 'along-sign';
      sign.innerHTML = railIcon(item);
      const km = document.createElement('span');
      km.className = 'along-km';
      km.textContent = kmText(item.along / 1000);
      const name = document.createElement('span');
      name.className = 'along-name';
      name.textContent = railName(item);
      btn.append(sign, km, name);
      btn.addEventListener('click', () => {
        S.alongPick = S.alongPick === item.id ? null : item.id;
        renderPlanAlong(S.routes[S.selected]);
      });
      li.append(btn);
      return li;
    }));
  }
  const card = $('along-card');
  card.hidden = !pick;
  if (!pick) return;
  const clock = fmtClock(new Date(Date.now() + timeBetween(route, 0, pick.along) * 1000), getLang());
  const icon = $('along-card-icon');
  icon.className = `along-sign along-${pick.type}`;
  icon.innerHTML = railIcon(pick);
  $('along-card-name').textContent = railName(pick);
  $('along-card-when').textContent = t('alongReach', { clock, km: kmText(pick.along / 1000) });
  const add = $('along-card-add');
  add.hidden = pick.type === 'camera';
  add.textContent = t('alongAddStop');
  add.onclick = () => {
    S.alongPick = null;
    addStop({ id: pick.id, name: railName(pick), lat: pick.lat, lng: pick.lng, category: 'rest' });
    toast(t('stopAdded'));
  };
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
  if (plan && CONFIG.server && S.settings.traffic && !onFoot()) {
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
  if (onFoot() || !place) return;
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
  const show = !onFoot() && !!S.dest && (!!park || found?.state === 'loading' || (found?.state === 'ready' && found.list.length > 0));
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
  if (load('car', null)?.paidUntil) remindOff();
  save('car', { lng: spot.lng, lat: spot.lat, at: Date.now(), name, note: '' });
  renderCarPill();
}

function setCarNote(note) {
  const car = savedCar();
  if (car) save('car', { ...car, note: note.trim().slice(0, 60) });
  renderCarPill();
}

function forgetCar() {
  if (load('car', null)?.paidUntil) remindOff();
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
  const left = parkingLeft(car);
  if (left > 0) parts.push(t('carPaidPill', { clock: fmtClock(new Date(car.paidUntil), getLang()) }));
  else parts.push(car.note || t('carParkedAt', { clock: carClock(car) }));
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
  renderCarPaid(car);
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
    S.returnMode = onFoot() ? (S.returnMode || load('mode', 'car')) : S.mode;
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

// A place tapped on the map is shown as one found by searching: its card, and
// the map flown to it, close up, or for a town or a country, to see it whole.
function onPlaceTap(place) {
  if (S.view !== 'idle' || (S.overlay && S.overlay !== 'placecard')) return;
  showPlace({ name: place.name, detail: kindLabel(place.kind, getLang()), lng: place.lng, lat: place.lat, country: '' }, { zoom: place.zoom });
}

// A place to look at before deciding: its card, its pin, and, unless it was
// tapped where it already is on the map, the map flown there.
function showPlace(place, { from = 'map', fly = true, zoom = null } = {}) {
  // How far back the main screen is: past the search too, if it came from one.
  // A card already open keeps its own.
  if (S.overlay !== 'placecard') S.tappedBack = from === 'search' ? 2 : 1;
  S.tapped = place;
  fillPlaceCard(place);
  mapView?.setDestination(place);
  if (S.overlay !== 'placecard') openOverlay('placecard');
  if (fly) {
    S.wantCenter = false;
    flyToCard(place, zoom);
  }
  if (place.unnamed) nameTapped(place);
}

function fillPlaceCard(place) {
  const far = S.fix ? haversine([S.fix.lng, S.fix.lat], [place.lng, place.lat]) : null;
  $('placecard-name').textContent = place.name;
  $('placecard-detail').textContent = [place.detail, far != null ? t('placeAway', { distance: fmtDistance(far) }) : ''].filter(Boolean).join(' · ');
}

// Over the place, in the part of the map the card doesn't cover. The card is
// measured by its size, as it may still be sliding up.
function flyToCard(place, zoom = null) {
  const card = $('placecard');
  const offset = matchMedia(LANDSCAPE).matches
    ? [card.offsetWidth / 2, 0]
    : [0, (PLACE_TOP_PX - card.offsetHeight) / 2];
  mapView?.flyToPlace(place.lng, place.lat, offset, { zoom });
}
const PLACE_TOP_PX = 110;   // the clock and the chips across the top

// Only a position: the search service can usually put a name to it.
async function nameTapped(place) {
  try {
    const named = await reversePlace(place.lng, place.lat);
    if (!named || S.tapped !== place || S.overlay !== 'placecard') return;
    // Its name, but the exact spot.
    S.tapped = { ...named, lng: place.lng, lat: place.lat };
    fillPlaceCard(S.tapped);
  } catch { /* the position still works */ }
}

// Going there: back to the main screen first, so that back from the plan comes
// back there too, and nothing is left behind a trip.
function goTapped() {
  const place = S.tapped;
  if (!place) return;
  S.afterBack = () => goTo(place);
  history.go(-(S.tappedBack || 1));
}

// Anyone can open it: a map link with the exact spot, and the name in the message.
function sharePlace() {
  const p = S.tapped;
  if (!p) return;
  const url = `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  shareLink(url, [p.name, p.detail].filter(Boolean).join(', '), p.name);
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
  // Still waiting on what's along the routes: not needed once you're driving.
  if (S.along?.state === 'loading') {
    S.alongCtrl?.abort();
    clearTimeout(S.alongTimer);
    S.along = null;
  } else if (S.along?.features === 'loading') {
    // The lights are looked for along this one route instead, below.
    S.alongCtrl?.abort();
  }
  S.guidance = new Guidance(S.route, { walking: onFoot() });
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
  S.drive = new DriveReport();
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
  // Lights, bumps and crossings: the plan already asked, so only ask if it hadn't.
  S.tripFrom = savedNear(S.fix);
  S.featuresSaid = new Set();
  S.bumpSaidAt = -Infinity;
  const planned = S.along?.state === 'ready' ? S.along.found : null;
  const plannedFeatures = !!planned && S.along.features === 'ready';
  S.featurePool = plannedFeatures ? planned.features : [];
  S.restPool = planned?.rests || [];
  S.tollsPaid = new Map();
  S.lastPlaza = null;
  S.unpriced = [];
  hideRest();
  S.featureFetchedAt = plannedFeatures ? Date.now() : 0;
  S.features = placeFeatures(S.route);
  S.stopWatch = simulate ? null : new StopWatch();
  S.tripSpots = [];
  if (!S.marks && togetherReady()) loadMarks(S.route);
  if (!plannedFeatures) loadFeatures(S.route);
  warnTng();
  // Traffic looked up while choosing the route needn't be asked for again yet.
  S.traffic = S.route.traffic?.from === 0 && !onFoot() ? S.route.traffic : null;
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
  // In the Android app, location carries on with the screen off for the whole drive.
  if (!simulate && inApp()) gps.useBackground(nativePlugin('BackgroundGeolocation'), t('bgMessage'));
  // A trip shared before Pintu was closed carries on when the trip does.
  if (!simulate && S.pendingShare) S.share = S.pendingShare;
  S.pendingShare = null;
  S.awayWarned = false;
  $('camera-alert').hidden = true;
  $('road-alert').hidden = true;
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
    if (car && !onFoot() && (!S.fix || haversine([S.fix.lng, S.fix.lat], [car.lng, car.lat]) < CAR_SAME_M)) forgetCar();
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
  if (!S.sim && !onFoot()) S.drive?.add({ time: fix.time ?? Date.now(), speed: fix.speed, accuracy: fix.accuracy, limit: limitHere(st) });

  renderSign(st);
  renderEta(st);
  renderRoadNow(st);
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
  renderRoadFeature(st, fix);
  renderRoadSigns(st);
  renderTurnArrow(st);
  notePaidTolls(st);
  noteStop(st, fix);
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
  if (!S.watch || onFoot() || S.simScrub) return;
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
  if (moments.includes('longDrive')) offerRest(st);
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
  if (key !== 'longDrive') return dress(who, key, '', lang);
  const line = dress(who, key, t('restSay'), lang);
  const at = S.restTarget, s = S.lastState?.s ?? 0;
  return at && at.along > s ? `${line} ${t('restNext', { name: restName(at), distance: sayDistance(at.along - s, lang) })}` : line;
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
  const j = onFoot() ? null : junctionFor(next);
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

// When you'll get there, big, then how long and how far.
function renderEta(st) {
  const lang = getLang();
  const left = timeLeft(st);
  const clock = fmtClock(new Date(Date.now() + left * 1000), lang);
  $('eta-clock').textContent = clock;
  $('eta-clock').setAttribute('aria-label', t('arriveOnly', { clock }));
  $('eta-rest').textContent = `${fmtDuration(left, lang)} · ${fmtDistance(st.remainingDistance)}`;
}

// The name of the road you're on, at the foot of the map.
function renderRoadNow(st) {
  const box = $('road-now');
  const m = st.onRoute && !onFoot() ? S.route?.maneuvers[st.currentIndex] : null;
  const { name, ref } = m ? roadNames(m) : { name: '', ref: '' };
  const show = !!(name || ref) && S.overlay !== 'hudmode';
  box.hidden = !show;
  if (!show) return;
  $('road-now-name').textContent = name || ref;
  $('road-now-ref').textContent = name ? ref : '';
  $('road-now-ref').hidden = !(name && ref);
}

// The arrow painted on the road at the next turn, once it's close.
function renderTurnArrow(st) {
  const pick = st && S.view === 'nav' && !onFoot() ? arrowFor(S.route, st) : null;
  const key = pick ? `${S.route.id}|${pick.index}` : '';
  if (key === S.turnKey) return;
  S.turnKey = key;
  mapView?.setTurnArrow(pick ? turnArrow(S.route, pick.at) : null);
}

// Lights, humps and crossings standing on the road ahead, the next few.
const SIGNS_AHEAD_M = 900;
const SIGNS_MAX = 10;
function renderRoadSigns(st) {
  const on = S.view === 'nav' && S.settings.roadWarnings && st.onRoute && !onFoot();
  const list = on ? (S.features || []).filter((f) => f.along > st.s - 15 && f.along < st.s + SIGNS_AHEAD_M).slice(0, SIGNS_MAX) : [];
  const key = list.map((f) => f.id).join('|');
  if (key === S.signsKey) return;
  S.signsKey = key;
  mapView?.setRoadSigns(list);
}

function currentLimit(st) {
  if (!S.settings.speedLimit) return null;
  return limitHere(st);
}

// The speed limit where you are, if it's known, shown or not.
function limitHere(st) {
  if (onFoot() || !st?.onRoute) return null;
  return limitAt(S.laneFetch?.limits, st.s) ?? limitAt(S.ttLimits, st.s);
}

// How the drive went, for the arrival screen and the trip's line: only a real
// drive long enough to say anything about.
function driveReport() {
  if (S.sim || onFoot() || !S.drive || !(S.tripKm >= REPORT_MIN_KM)) return null;
  return S.drive.result;
}

function renderDriveReport(report) {
  const box = $('arrival-report');
  box.hidden = !report;
  if (!report) return;
  const lang = getLang();
  const parts = [];
  if (report.brakes) parts.push(t(report.brakes === 1 ? 'reportBrakeOne' : 'reportBrakes', { n: report.brakes }));
  if (report.starts) parts.push(t(report.starts === 1 ? 'reportStartOne' : 'reportStarts', { n: report.starts }));
  if (!report.brakes && !report.starts) parts.push(t('reportSmooth'));
  if (report.limitedS < 60) parts.push(t('reportNoLimit'));
  else parts.push(report.overS >= 30 ? t('reportOver', { time: fmtDuration(Math.round(report.overS / 60) * 60 || 60, lang) }) : t('reportWithin'));
  parts.push(t('reportTop', { kmh: report.topKmh }));
  $('arrival-report-title').textContent = t('reportTitle', { score: report.score });
  $('arrival-report-text').textContent = parts.join(' · ');
}

function renderSpeed(fix, st) {
  const known = fix.speed != null && !onFoot();
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

// Cameras or toll booths near the route, from the copy kept with the app.
async function fromData(route, kind) {
  const near = dataNear(await loadAlongData(), [route], { tolls: kind === 'tolls', cameras: kind === 'cameras', rests: false });
  return near[kind];
}

function loadCameras(route) {
  S.cameraCtrl?.abort();
  if (!S.settings.speedCameras || onFoot()) return;
  const ctrl = new AbortController();
  S.cameraCtrl = ctrl;
  S.cameraFetchedAt = Date.now();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  fromData(route, 'cameras').catch(() => fetchCameras(route, { signal: ctrl.signal })).then((found) => {
    S.cameraPool = found;
    if (S.view === 'nav' && S.route) S.cameras = placeCameras(S.route);
    renderMapCameras();
  }).catch(() => { /* none known is the same as none mapped: nothing to warn about */ })
    .finally(() => clearTimeout(timer));
}

/* ---------- Live traffic, from TomTom ---------- */

function loadTraffic() {
  if (!S.settings.traffic || S.trafficStopped || S.noTrafficKey || onFoot() || !S.route || S.trafficCtrl) return;
  const route = S.route;
  const from = S.lastState?.onRoute ? S.lastState.s : 0;
  const ctrl = new AbortController();
  S.trafficCtrl = ctrl;
  S.trafficAt = Date.now();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  // A quicker way is looked for only on a straight trip to one place.
  const better = !S.sim && !onFoot() && !S.stops.length;
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
  if (!CONFIG.server || onFoot() || !S.settings.speedLimit || (S.limitAsks || 0) >= 3) return;
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
  const near = S.settings.traffic && st.onRoute && !onFoot() ? jamAhead(S.traffic, st.s) : null;
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
  if (onFoot() || !route.hasToll) return;
  const ctrl = new AbortController();
  S.tollCtrl = ctrl;
  S.tollFetchedAt = Date.now();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  fromData(route, 'tolls').catch(() => fetchTolls(route, { signal: ctrl.signal })).then((found) => {
    S.tollPool = found;
    if (S.view === 'nav' && S.route) S.tolls = tollsOnRoute(S.route, found);
  }).catch(() => { /* the HUD just won't mention plazas */ })
    .finally(() => clearTimeout(timer));
}

function renderCamera(st, fix) {
  const box = $('camera-alert');
  const near = S.settings.speedCameras && st.onRoute && !onFoot() ? cameraAhead(S.cameras, st.s, fix.speed ?? 0) : null;
  box.hidden = !near;
  if (!near) return;
  S.cameraNear = near.camera;
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

/* ---------- Traffic lights, bumps and railway crossings ---------- */

const BUMP_SAY_KMH = 30;      // slower than this, you'll see it in time anyway
const BUMP_QUIET_M = 150;     // a row of bumps is said once
const ROAD_ICONS_AHEAD = { light: () => UI.signal, bump: () => UI.bump, rail: () => UI.railCross };

// Lights, bumps, crossings and places to rest, for a route the plan didn't ask about.
function loadFeatures(route) {
  S.featureCtrl?.abort();
  if (onFoot()) return;
  const ctrl = new AbortController();
  S.featureCtrl = ctrl;
  S.featureFetchedAt = Date.now();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  // R&Rs from the copy kept with the app; lights and bumps from a map server.
  findAlong([route], { signal: ctrl.signal, tolls: false, cameras: false, rests: true }).then((found) => {
    if (S.featureCtrl === ctrl) S.restPool = found.rests;
  }).catch(() => {});
  fetchAlong([route], { signal: ctrl.signal, waits: SLOW_WAITS, tolls: false, cameras: false, rests: false, features: true }).then((found) => {
    S.featurePool = found.features;
    if (S.view === 'nav' && S.route) S.features = placeFeatures(S.route);
  }).catch(() => { /* nothing known is nothing to warn about */ })
    .finally(() => clearTimeout(timer));
}

function renderRoadFeature(st, fix) {
  const box = $('road-alert');
  const on = S.settings.roadWarnings && st.onRoute && !onFoot();
  const near = on ? featureAhead(S.features, st.s, fix.speed ?? 0) : null;
  box.hidden = !near;
  if (!near) {
    if (on) renderWildAhead(st, fix);
    return;
  }
  const { feature, ahead } = near;
  S.roadNear = feature;
  const lang = getLang();
  const distance = fmtDistance(Math.max(ahead, 10));
  box.dataset.kind = feature.kind;
  $('road-alert-icon').innerHTML = ROAD_ICONS_AHEAD[feature.kind]();
  $('road-alert-distance').textContent = distance;
  box.setAttribute('aria-label', t(`roadAria_${feature.kind}`, { distance }));
  if (S.featuresSaid.has(feature.id)) return;
  if (!st.prompts.length && voice.busy() && ahead > 80) return;
  S.featuresSaid.add(feature.id);
  if (S.settings.voiceLevel !== 'full' || (S.sim && S.sim.factor >= SIM_FAST)) return;
  if (feature.kind === 'light' && !S.settings.sayLights) return;
  if (feature.kind === 'bump') {
    if ((fix.speed ?? 0) * 3.6 < BUMP_SAY_KMH || feature.along - S.bumpSaidAt < BUMP_QUIET_M) return;
    S.bumpSaidAt = feature.along;
  }
  speakText(t(`roadSay_${feature.kind}`, { distance: sayDistance(ahead, lang) }), { wait: voice.WAIT_TURN_MS });
}

/* ---------- Fixing the map ---------- */

const placeFeatures = (route) => featuresOnRoute(route, markFeatures(S.featurePool || [], S.marks || []));
const placeCameras = (route) => camerasOnRoute(route, markCameras(S.cameraPool || [], S.marks || []));
const MARK_ICONS = { light: () => UI.signal, bump: () => UI.bump, camera: () => UI.camera };

// For a drive started before the plan had asked.
function loadMarks(route) {
  fetchMarks(marksBox([route])).then((fixes) => {
    S.marks = fixes;
    if (S.view !== 'nav' || !S.route) return;
    S.features = placeFeatures(S.route);
    S.cameras = placeCameras(S.route);
    renderMapCameras();
  }).catch(() => { /* the map as it is, then */ });
}

function renderMarkKinds() {
  $('mark-title').textContent = t('markTitle');
  $('mark-kinds').replaceChildren(...MARK_KINDS.map((kind) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `report-kind mark-${kind}`;
    b.innerHTML = MARK_ICONS[kind]();
    const word = document.createElement('span');
    word.textContent = t(`mark_${kind}`);
    b.append(word);
    b.addEventListener('click', () => {
      S.afterBack = () => submitMark(kind, 'add', S.fix);
      history.back();
    });
    return b;
  }));
}

async function submitMark(kind, action, where, ref = null) {
  if (!where) { toast(t('roadNoFix')); return; }
  try {
    const r = await sendMark({ kind, action, fix: where, ref });
    S.marks = [...(S.marks || []), { id: r?.id ?? -1, kind, action, lng: where.lng, lat: where.lat, ref }];
    if (S.view === 'nav' && S.route) {
      S.features = placeFeatures(S.route);
      S.cameras = placeCameras(S.route);
      renderMapCameras();
    }
    toast(action === 'add' ? t('markSent', { kind: t(`mark_${kind}`) }) : t('markGoneSent'));
  } catch {
    toast(t('fareAskFailed'), 5000);
  }
}

// Tapping a warning: is it really not there?
function askNotHere(kind, thing) {
  if (!thing || !togetherReady() || !MARK_KINDS.includes(kind)) return;
  S.markAsk = { kind, thing };
  $('mark-ask-title').textContent = t(`markGone_${kind}`);
  $('mark-ask-yes').textContent = t('markGoneYes');
  $('mark-ask-no').textContent = t('markGoneNo');
  $('mark-ask').hidden = false;
  clearTimeout(S.markAskTimer);
  S.markAskTimer = setTimeout(() => { $('mark-ask').hidden = true; }, 15000);
}

function answerNotHere(gone) {
  $('mark-ask').hidden = true;
  clearTimeout(S.markAskTimer);
  const ask = S.markAsk;
  S.markAsk = null;
  if (!gone || !ask) return;
  const { kind, thing } = ask;
  const ref = /^(node|way|mark)\/\d+$/.test(thing.id || '') ? thing.id : null;
  submitMark(kind, 'gone', { lng: thing.lng, lat: thing.lat }, ref);
}

// Where a real drive stops like at a red light.
function noteStop(st, fix) {
  if (!S.stopWatch || !st.onRoute || onFoot()) return;
  if (st.s < 200 || st.remainingDistance < 200) return;
  const m = S.route.maneuvers[st.currentIndex];
  const stop = S.stopWatch.note({ time: fix.time, speed: fix.speed, lng: fix.lng, lat: fix.lat, road: m ? roadNames(m).name || roadNames(m).ref || '' : '' });
  if (!stop) return;
  save('lightSpots', rememberStop(load('lightSpots', []), stop));
  S.tripSpots.push(stop);
}

function renderLightAsk(drove) {
  const box = $('arrival-light');
  const known = markFeatures(S.featurePool || [], S.marks || []).filter((f) => f.kind === 'light');
  const here = (spot) => (S.tripSpots || []).some((p) => haversine([p.lng, p.lat], [spot.lng, spot.lat]) <= 30);
  const ask = drove && togetherReady() ? lightsToAsk(load('lightSpots', []), known, here)[0] : null;
  S.lightAsk = ask || null;
  box.hidden = !ask;
  if (!ask) return;
  $('arrival-light-title').textContent = ask.road ? t('lightAskTitle', { road: ask.road }) : t('lightAskHere');
  $('arrival-light-text').textContent = t('lightAskText', { n: ask.days.length });
  $('arrival-light-yes').textContent = t('lightAskYes');
  $('arrival-light-no').textContent = t('lightAskNo');
}

function answerLight(yes) {
  const spot = S.lightAsk;
  S.lightAsk = null;
  $('arrival-light').hidden = true;
  if (!spot) return;
  save('lightSpots', settleSpot(load('lightSpots', []), spot));
  if (yes) submitMark('light', 'add', { lng: spot.lng, lat: spot.lat });
}

/* ---------- Time to rest ---------- */

const REST_OFFER_MS = 90000;
const restName = (r) => r.name || t(r.kind === 'rnr' ? 'nameRest' : 'nameLayby');

function offerRest(st) {
  if (onFoot() || !S.route) return;
  const lang = getLang();
  const target = nextRest(restsOnRoute(S.route, S.restPool || []), st.s);
  S.restTarget = target;
  $('rest-title').textContent = t('restTitle', { time: fmtDuration(Math.round(S.watch.driving / 60000) * 60, lang) });
  $('rest-detail').textContent = target
    ? t('restAt', { name: restName(target), distance: fmtDistance(target.along - st.s), clock: fmtClock(new Date(Date.now() + timeBetween(S.route, st.s, target.along) * 1000), lang) })
    : t('restAnywhere');
  $('rest-yes').textContent = t(target ? 'restStop' : 'restOk');
  $('rest-no').textContent = t('restLater');
  $('rest-no').hidden = !target;
  $('rest-offer').hidden = false;
  clearTimeout(S.restTimer);
  S.restTimer = setTimeout(hideRest, REST_OFFER_MS);
}

function hideRest() {
  clearTimeout(S.restTimer);
  $('rest-offer').hidden = true;
}

function takeRest() {
  const target = S.restTarget;
  hideRest();
  if (!target || S.view !== 'nav') return;
  addStop({ id: target.id, name: restName(target), lat: target.lat, lng: target.lng, category: 'rest' });
}

/* ---------- Touch 'n Go ---------- */

const tngBalance = () => cleanBalance(load('tng', null));

// Plazas passed, with the fare where it's known.
function notePaidTolls(st) {
  if (S.sim || !st.onRoute || !S.tolls?.length || !S.tollsPaid) return;
  for (const toll of S.tolls) {
    if (toll.along > st.s - 30 || S.tollsPaid.has(toll.id)) continue;
    const prev = S.lastPlaza || null;
    const rm = fareAt(S.route, toll)?.rm ?? driverFare(S.driverFares?.[toll.id], prev);
    S.tollsPaid.set(toll.id, { rm, prev, name: toll.name || '', gantry: !!toll.gantry });
    S.lastPlaza = toll.id;
  }
}

function payTolls() {
  const passed = [...(S.tollsPaid?.entries() || [])];
  S.tollsPaid = null;
  S.lastPlaza = null;
  // Asked about when you arrive: the plazas nobody knew the fare of.
  S.unpriced = S.mode === 'car' ? passed.filter(([, p]) => p.rm == null).map(([id, p]) => ({ id, ...p })) : [];
  const paid = passed.map(([, p]) => p.rm).filter((rm) => Number.isFinite(rm));
  if (!paid.length) return;
  const next = afterTolls(load('tng', null), paid);
  if (next) save('tng', next);
}

function renderPlanTng(route) {
  const row = $('plan-tng');
  const tolls = alongOf(route)?.tolls || [];
  row.hidden = !(S.mode === 'car' && tolls.length);
  if (row.hidden) return;
  const bal = tngBalance();
  const check = tngCheck(bal, tolls);
  row.classList.toggle('is-short', check?.state === 'short');
  row.classList.toggle('is-maybe', check?.state === 'maybe');
  $('plan-tng-edit').textContent = t(bal ? 'tngEdit' : 'tngAdd');
  if (!bal) {
    $('plan-tng-title').textContent = t('tngUnset');
    $('plan-tng-detail').textContent = t('tngUnsetDetail');
    return;
  }
  $('plan-tng-title').textContent = t('tngRowTitle', { rm: money(bal.rm) });
  $('plan-tng-detail').textContent = check.state === 'short' ? t('tngShort', { need: money(check.need) })
    : check.state === 'maybe' ? t('tngMaybe') : t('tngOk');
}

function renderTngSetting() {
  const bal = tngBalance();
  if (document.activeElement !== $('tng-balance')) $('tng-balance').value = bal ? bal.rm.toFixed(2) : '';
  const d = bal ? new Date(bal.at) : null;
  const day = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
  $('tng-status').textContent = bal ? [t('tngStatus', { date: dateText(day) }), bal.guessed ? t('tngGuessed') : ''].filter(Boolean).join(' ') : '';
}

function saveTng() {
  const bal = cleanBalance({ rm: parseFloat($('tng-balance').value), at: Date.now() });
  if (!bal) return;
  save('tng', bal);
  renderTngSetting();
  toast(t('tngSaved'));
}

// Said as the drive starts, when the card may not cover the tolls.
function warnTng() {
  if (S.sim || S.mode !== 'car') return;
  const check = tngCheck(tngBalance(), alongOf(S.route)?.tolls || []);
  if (check?.state === 'short' || check?.state === 'maybe') speakText(t('tngSay'), { wait: voice.WAIT_TURN_MS });
}

/* ---------- Emergency ---------- */

function openSos() {
  gps.start();
  openOverlay('sos');
  renderSos();
  loadSosHospitals();
}

function renderSos() {
  const fix = S.fix;
  $('sos-coords').textContent = fix ? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}` : t('sosNoFix');
  $('sos-coords').classList.toggle('tip', !fix);
  $('sos-share').disabled = !fix;
}

async function loadSosHospitals() {
  S.sosCtrl?.abort();
  const list = $('sos-hospitals');
  const status = $('sos-hosp-status');
  const center = S.fix || await waitForFix();
  if (S.overlay !== 'sos') return;
  renderSos();
  if (!center) { status.textContent = t('sosNoFix'); list.replaceChildren(); return; }
  const ctrl = new AbortController();
  S.sosCtrl = ctrl;
  status.hidden = false;
  status.textContent = t('sosLooking');
  let found = [];
  try { found = await findNearby({ lng: center.lng, lat: center.lat }, 'hospital', { signal: ctrl.signal }); } catch { found = []; }
  if (ctrl.signal.aborted || S.overlay !== 'sos') return;
  status.hidden = found.length > 0;
  status.textContent = found.length ? '' : t('sosNone');
  list.replaceChildren(...found.slice(0, 3).map((p) => {
    const li = document.createElement('li');
    const what = document.createElement('span');
    what.className = 'sos-hosp';
    const name = document.createElement('strong');
    name.textContent = p.name || t('unnamed_hospital');
    const far = document.createElement('span');
    far.textContent = fmtDistance(p.distance);
    what.append(name, far);
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'plate plate-btn plate-small';
    go.textContent = t('sosGo');
    go.addEventListener('click', () => {
      const place = { name: p.name || t('unnamed_hospital'), detail: '', lng: p.lng, lat: p.lat, country: '' };
      S.afterBack = () => {
        if (S.view === 'nav') endTrip();
        goTo(place);
      };
      history.back();
    });
    li.append(what, go);
    return li;
  }));
}

function shareSos() {
  const fix = S.fix;
  if (!fix) return;
  const at = `${fix.lat.toFixed(5)},${fix.lng.toFixed(5)}`;
  shareLink(`https://maps.google.com/?q=${at}`, t('sosShareText'), t('sosTitle'));
}

/* ---------- Paid parking ---------- */

function renderCarPaid(car) {
  const box = $('car-paid');
  box.hidden = !car;
  if (!car) return;
  const lang = getLang();
  $('car-paid-label').textContent = t('carPaidLabel');
  const left = parkingLeft(car);
  if (!$('car-paid-choices').childElementCount || $('car-paid-choices').dataset.lang !== lang) {
    $('car-paid-choices').dataset.lang = lang;
    $('car-paid-choices').replaceChildren(...CHOICES_MIN.map((min) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.min = String(min);
      b.textContent = min < 60 ? t('carPaidMin', { n: min }) : t('carPaidHour', { n: min / 60 });
      b.addEventListener('click', () => setParking(min));
      return b;
    }));
  }
  for (const b of $('car-paid-choices').children) b.setAttribute('aria-pressed', String(Number(b.dataset.min) === car.paidMin && left > 0));
  $('car-paid-status').hidden = left == null;
  if (left == null) return;
  if (left > 0) {
    $('car-paid-left').textContent = `${t('carPaidUntil', { clock: fmtClock(new Date(car.paidUntil), lang) })} · ${t('carPaidLeft', { time: fmtDuration(Math.ceil(left / 60000) * 60, lang) })}`;
    $('car-paid-note').textContent = t(car.pushed ? 'carPaidPush' : 'carPaidOpen');
  } else {
    $('car-paid-left').textContent = t('carPaidOver');
    $('car-paid-note').textContent = '';
  }
  $('car-paid-stop').textContent = t('carPaidStop');
}

async function setParking(min) {
  const car = savedCar();
  if (!car) return;
  const until = Date.now() + min * 60000;
  save('car', { ...car, paidUntil: until, paidMin: min, warned: false, pushed: false });
  renderCarSheet();
  renderCarPill();
  // Closed, Pintu can only remind you through a notification from its server.
  if (inApp()) return;
  try {
    await remindOnServer(until, getLang(), await workerReady());
    const now = savedCar();
    if (now?.paidUntil === until) save('car', { ...now, pushed: true });
  } catch { /* reminded only while open, then */ }
  if (S.overlay === 'car') renderCarSheet();
}

function stopParking() {
  const car = savedCar();
  if (car) {
    const { paidUntil, paidMin, warned, pushed, ...rest } = car;
    save('car', rest);
  }
  remindOff();
  renderCarSheet();
  renderCarPill();
}

function checkParking() {
  const car = savedCar();
  if (!car?.paidUntil) return;
  if (warnDue(car)) {
    save('car', { ...car, warned: true });
    const words = t('parkSay', { n: Math.max(1, Math.round(parkingLeft(car) / 60000)) });
    toast(words, 8000);
    speakText(words);
  }
  renderCarPill();
  if (S.overlay === 'car') renderCarPaid(savedCar());
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
  S.guidance = new Guidance(route, { walking: onFoot() });
  motion.setRoute(route);
  startScene(route);
  S.cameras = placeCameras(route);
  renderMapCameras();
  if (Date.now() - (S.cameraFetchedAt || 0) > CAMERA_REFETCH_MS) loadCameras(route);
  S.tolls = tollsOnRoute(route, S.tollPool || []);
  if (Date.now() - (S.tollFetchedAt || 0) > CAMERA_REFETCH_MS) loadTolls(route);
  S.features = placeFeatures(route);
  if (Date.now() - (S.featureFetchedAt || 0) > CAMERA_REFETCH_MS) loadFeatures(route);
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
  if (S.sim || !S.guidance || onFoot() || !S.settings.keepTrips) return;
  const plan = tripPlan(pricedVehicle(), S.tripKm);
  const v = pricedVehicle();
  const report = driveReport();
  recordTrip({
    ...(report ? { b: report.brakes, a: report.starts, o: report.overS, sc: report.score } : {}),
    km: S.tripKm, s: S.crawl?.span || (Date.now() - S.tripStart) / 1000, slow: S.crawl?.slow || 0, cost: plan?.cost ?? null, mode: S.mode, to: S.dest?.name || '',
    l: plan?.unit === 'L' ? plan.used : null, g: v?.grade || null, from: S.tripFrom || '',
  });
}

// The trip's over one way or another: put everything back.
function stopGuidance() {
  keepTripSummary();
  gps.useBackground(null);
  S.crawl = null;
  S.drive = null;
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
  S.featureCtrl?.abort();
  S.features = [];
  hideRest();
  payTolls();
  $('road-alert').hidden = true;
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
  const walked = onFoot();
  const simulated = !!S.sim;
  $('arrival-stats').textContent = arrivalStats();
  renderDriveReport(driveReport());
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
  const drove = !walked && !simulated;
  if (drove) {
    const spot = S.fix || place;
    if (spot) saveCar(spot, place?.name || '');
    $('arrival-car-text').textContent = t('carRemembered');
    $('arrival-car-note').value = '';
  }
  $('arrival-car').hidden = !drove;
  renderFareAsk(drove ? S.unpriced : []);
  renderLightAsk(drove);
  const work = $('arrival-work');
  work.hidden = !drove || !S.settings.keepTrips;
  work.setAttribute('aria-pressed', 'false');
  work.textContent = t('workMark');
  if (walked && !simulated && place?.isCar) forgetCar();
  // Where the road ends isn't always where the door is.
  $('arrival-walk').hidden = walked || simulated || !place;
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
  if (!onFoot() || !S.returnMode) return;
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
  if (!S.settings.weather || onFoot()) {
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
  if (!S.settings.weather || onFoot() || S.simScrub) return;
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

// The warning worth showing first: a danger one, then a storm, then the rest.
function mainWarning(list) {
  const rank = (w) => (w.danger ? 0 : w.storm ? 1 : 2);
  return [...(list || [])].sort((a, b) => rank(a) - rank(b))[0] || null;
}
const warnTitle = (w) => w.title?.[getLang()] || w.title?.en || w.heading[getLang()] || w.heading.en;

// "Selangor: Sepang, Kuala Langat" for each state on the route the warning names.
function warnWhere(warn, entries) {
  const on = entries ? new Set(entries.map((e) => e.name)) : null;
  return warn.states
    .filter((name) => !on || on.has(name))
    .map((name) => (warn.places?.[name]?.length ? `${name}: ${warn.places[name].join(', ')}` : name))
    .join(' · ');
}

function renderPlanWarning(route) {
  const row = $('plan-warn');
  const w = S.weather;
  const warn = S.settings.weather && !onFoot() && route && w?.routeId === route.id && !w.pending ? mainWarning(w.warnings) : null;
  row.hidden = !warn;
  if (!warn) return;
  const lang = getLang();
  $('plan-warn-title').textContent = t('warnOnRoute', { title: warnTitle(warn) });
  const parts = [];
  if (warn.until) parts.push(t('warnUntilShort', { clock: fmtClock(new Date(warn.until), lang) }));
  parts.push('MET Malaysia');
  if (w.warnings.length > 1) parts.push(t('warningsMany', { n: w.warnings.length }));
  $('plan-warn-detail').textContent = parts.join(' · ');
  const where = warnWhere(warn, w.entries);
  $('plan-warn-where').textContent = where;
  $('plan-warn-where').hidden = !where;
  row.classList.toggle('is-danger', !!warn.danger);
}

function renderPlanWeather(route) {
  renderPlanWarning(route);
  if (S.view === 'preview') renderMapWarnings();
  const row = $('plan-weather');
  const w = S.weather;
  row.hidden = !S.settings.weather || onFoot();
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
  // The warnings have their own row above.
  detail.textContent = '';
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

  const lanes = onFoot() ? null : lanesNow(st);
  $('hm-lanes').hidden = !lanes;
  $('hm-face').classList.toggle('has-lanes', !!lanes);
  if (lanes) fillLanes($('hm-lanes'), lanes);
  else $('hm-lanes').dataset.key = '';

  const toll = st.onRoute && !onFoot() ? tollAhead(S.tolls, st.s) : null;
  $('hm-toll').hidden = !toll;
  if (toll) $('hm-toll-distance').textContent = fmtDistance(Math.max(toll.ahead, 10));
  const jam = S.settings.traffic && st.onRoute && !onFoot() ? jamAhead(S.traffic, st.s) : null;
  $('hm-jam').hidden = !jam;
  if (jam) {
    $('hm-jam-icon').innerHTML = UI[JAM_ICONS[jam.jam.kind]];
    $('hm-jam-word').textContent = t(`jam_${jam.jam.kind}`);
    $('hm-jam-distance').textContent = jam.inside ? '' : fmtDistance(Math.max(jam.ahead, 10));
    $('hm-jam-more').textContent = jam.jam.kind === 'ROAD_CLOSURE' || (!jam.inside && jam.delay < 60) ? ''
      : jam.inside ? t('jamLeft', { distance: fmtDistance(Math.max(jam.left, 10)) }) : t('jamDelay', { time: fmtDuration(jam.delay, lang) });
  }

  const tired = !!(S.watch?.tired && !onFoot());
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
  const awake = nativePlugin('KeepAwake');
  if (awake) {
    S.wake = { release: () => Promise.resolve(awake.allowSleep()).catch(() => {}) };
    Promise.resolve(awake.keepAwake()).catch(() => {});
    return;
  }
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
  // Back in Pintu soon after looking on Google Maps: offer to paste what was copied there.
  if (!document.hidden && S.googleAt && Date.now() - S.googleAt < GOOGLE_BACK_MS && !$('search').hidden) {
    S.backFromGoogle = true;
    renderSearch(S.lastResults || []);
  }
  if (document.hidden) {
    S.hiddenAt = Date.now();
    if (S.view === 'nav' && !S.sim) {
      S.driveLog?.event('left the app');
      S.driveLog?.save();
      // A web page gets no location while another app is in front, so say so,
      // once a trip, while there's still a moment to speak.
      if (!S.awayWarned && !gps.bg && S.settings.voiceLevel !== 'off' && window.speechSynthesis) {
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
  if (!S.sim && !gps.bg) gps.restart();
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
  $('placecard-share').addEventListener('click', sharePlace);
  $('plan-order-go').addEventListener('click', useStopOrder);
  $('explore-back').addEventListener('click', () => history.back());
  for (const b of document.querySelectorAll('.explore-chip')) b.addEventListener('click', () => openExplore(b.dataset.cat));
  $('saved-work').addEventListener('click', () => goSaved('work'));
  $('camera-on').addEventListener('change', (e) => {
    setSetting('speedCameras', e.target.checked);
    if (!e.target.checked) $('camera-alert').hidden = true;
  });
  $('road-on').addEventListener('change', (e) => {
    setSetting('roadWarnings', e.target.checked);
    $('lights-say').disabled = !e.target.checked;
    if (!e.target.checked) $('road-alert').hidden = true;
    else if (S.view === 'nav' && S.route && !S.featurePool?.length) loadFeatures(S.route);
  });
  $('lights-say').addEventListener('change', (e) => setSetting('sayLights', e.target.checked));
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
  $('plan-tng-edit').addEventListener('click', () => {
    openOverlay('settings');
    renderTngSetting();
    requestAnimationFrame(() => { $('set-tng-title').scrollIntoView({ block: 'center' }); $('tng-balance').focus(); });
  });
  $('tng-save').addEventListener('click', () => {
    saveTng();
    if (S.view === 'preview') renderRoutes();
  });
  $('tng-balance').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('tng-save').click(); });
  $('rest-yes').addEventListener('click', takeRest);
  $('road-alert').addEventListener('click', () => askNotHere(S.roadNear?.kind, S.roadNear));
  $('camera-alert').addEventListener('click', () => askNotHere('camera', S.cameraNear));
  $('mark-ask-yes').addEventListener('click', () => answerNotHere(true));
  $('mark-ask-no').addEventListener('click', () => answerNotHere(false));
  $('arrival-light-yes').addEventListener('click', () => answerLight(true));
  $('arrival-light-no').addEventListener('click', () => answerLight(false));
  $('arrival-work').addEventListener('click', toggleWorkTrip);
  $('arrival-tolls-send').addEventListener('click', sendFares);
  $('month-csv').addEventListener('click', downloadWork);
  $('budi-save').addEventListener('click', saveBudi);
  $('care-save').addEventListener('click', saveCare);
  $('care-ok').addEventListener('click', careSeen);
  $('work-rate').addEventListener('change', (e) => {
    const r = cleanRate(e.target.value);
    if (r == null) remove('workRate'); else save('workRate', r);
  });
  renderCareNote();
  $('rest-no').addEventListener('click', hideRest);
  $('btn-sos').addEventListener('click', openSos);
  $('btn-sos-nav').addEventListener('click', openSos);
  $('sos-back').addEventListener('click', () => history.back());
  $('sos-share').addEventListener('click', shareSos);
  $('car-paid-stop').addEventListener('click', stopParking);
  setInterval(checkParking, 30000);
  checkParking();
  $('plan-other-go').addEventListener('click', takeOtherWay);
  $('btn-cams').addEventListener('click', toggleMapCameras);
  $('plan-warn').addEventListener('click', openWeather);
  $('plan-toll').addEventListener('click', () => {
    if (S.along?.state === 'error') { retryAlong(); return; }
    if (S.along?.state !== 'ready') return;
    S.tollOpen = !S.tollOpen;
    renderPlanToll(S.routes[S.selected]);
  });
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
  $('search-input').addEventListener('input', () => onSearchInput());
  // A shared message pasted in: read with its lines, before the box joins them.
  $('search-input').addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text.includes('\n') || !parseLocationText(text)) return;
    e.preventDefault();
    $('search-input').value = oneLine(text);
    onSearchInput(text);
  });
  $('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(S.searchTimer);
      const q = $('search-input').value.trim();
      // A link is already being opened: searching for its letters would only
      // replace the place with "nothing found".
      if (parseLocationText(q)) return;
      if (q.length >= 2) runSearch(q);
    }
  });
  $('recents-clear').addEventListener('click', () => { remove('recents'); renderSearch([]); });

  $('preview-back').addEventListener('click', () => history.back());
  $('mode-car').addEventListener('click', () => setMode('car'));
  $('mode-moto').addEventListener('click', () => setMode('motorcycle'));
  $('mode-walk').addEventListener('click', () => setMode('walk'));
  $('mode-transit').addEventListener('click', () => setMode('transit'));
  $('journey-when-kind').addEventListener('change', setJourneyWhen);
  $('journey-when-time').addEventListener('change', setJourneyWhen);
  $('journey-earlier').addEventListener('click', () => moreJourneys('earlier'));
  $('journey-later').addEventListener('click', () => moreJourneys('later'));
  $('journey-back').addEventListener('click', () => openJourneyTrip(null));
  $('search-paste').addEventListener('click', pasteLink);
  $('search-google').addEventListener('click', () => { S.googleAt = Date.now(); });
  $('plan-weather').addEventListener('click', openWeather);
  $('plan-mall').addEventListener('click', openMall);
  $('weather-back').addEventListener('click', () => history.back());
  $('camview-back').addEventListener('click', () => history.back());
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
  $('look-map').addEventListener('click', () => setSatellite(false));
  $('look-sat').addEventListener('click', () => setSatellite(true));
  $('btn-transit').addEventListener('click', toggleTransit);
  $('btn-sat').addEventListener('click', () => {
    setSatellite(!S.settings.satellite);
    toast(t(S.settings.satellite ? 'satOn' : 'satOff'));
  });
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
  // The Android app's own share sheet: its web view has none.
  const appShare = nativePlugin('Share');
  if (appShare) {
    try {
      await appShare.share({ title, text, url, dialogTitle: title });
      return true;
    } catch {
      return false;
    }
  }
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
  row.hidden = !togetherReady() || onFoot();
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
  renderMarkKinds();
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
  if (!togetherReady() || onFoot() || !S.route || S.roadCtrl) return;
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
  const near = st.onRoute && !onFoot() ? reportAhead(S.roadPlaced, st.s, fix.speed ?? 0) : null;
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
  // Notifications need a browser: the Android app's web view has none.
  $('set-commute').hidden = !togetherReady() || inApp();
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
  const driving = monthDriving(trips.filter((x) => { const d = new Date(x.at); return d.getFullYear() === S.month.year && d.getMonth() === S.month.month; }));
  if (driving) {
    rows.push([t('monthDriving'), t('monthDrivingDetail', {
      score: driving.score, brakes: driving.brakes, over: fmtDuration(Math.round(driving.overS / 60) * 60, lang),
    })]);
  }
  const now2 = new Date();
  const thisMonth = S.month.year === now2.getFullYear() && S.month.month === now2.getMonth();
  if (thisMonth && trips.some((x) => x.g === BUDI_GRADE)) {
    const b = budiUsed(trips, load('budi', null));
    rows.push([t('setBudi'), `${t('budiStatus', { litres: amountText(b.litres), limit: b.limit })}${b.guessed ? ` ${t('budiGuess')}` : ''}`]);
  }
  const work = workTrips(trips, S.month.year, S.month.month);
  $('month-csv').hidden = !work.length;
  $('month-csv').textContent = t('workCsv');
  if (work.length) {
    const sum = workTotals(work, load('workRate', null));
    rows.push([t('workRow'), sum.claim != null ? t('workSumClaim', { n: sum.trips, km: fmtDistance(sum.km * 1000), claim: money(sum.claim) }) : t('workSum', { n: sum.trips, km: fmtDistance(sum.km * 1000) })]);
  }
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

/* ---------- Work trips, BUDI95 and the car ---------- */

// Home or work, if the drive started there.
function savedNear(fix) {
  if (!fix) return '';
  const saved = savedPlaces();
  for (const kind of ['home', 'work']) {
    const p = saved[kind];
    if (p && haversine([fix.lng, fix.lat], [p.lng, p.lat]) < 300) return t(kind);
  }
  return '';
}

/* ---------- Asking what a plaza cost ---------- */

function renderFareAsk(plazas) {
  const box = $('arrival-tolls');
  box.hidden = !plazas?.length || !CONFIG.server;
  if (box.hidden) return;
  S.fareAsk = plazas.slice(0, 8);
  $('arrival-tolls-title').textContent = t('fareAskTitle');
  $('arrival-tolls-text').textContent = t('fareAskText');
  $('arrival-tolls-send').textContent = t('fareAskSend');
  $('arrival-tolls-send').disabled = false;
  $('arrival-tolls-list').replaceChildren(...S.fareAsk.map((p, i) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    label.htmlFor = `fare-${i}`;
    label.textContent = p.name || t(p.gantry ? 'tollGantry' : 'tollPlazaUnnamed');
    const wrap = document.createElement('span');
    wrap.className = 'fare-in';
    const input = document.createElement('input');
    input.id = `fare-${i}`;
    input.className = 'text-input';
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = '0';
    input.max = '300';
    input.step = '0.01';
    wrap.append('RM', input);
    li.append(label, wrap);
    return li;
  }));
}

async function sendFares() {
  const paid = (S.fareAsk || []).map((p, i) => ({ plaza: p.id, prev: p.prev, rm: parseFloat($(`fare-${i}`).value) }))
    .filter((p) => Number.isFinite(p.rm) && p.rm >= 0 && p.rm <= 300);
  if (!paid.length) return;
  $('arrival-tolls-send').disabled = true;
  try {
    await post('/fares/add', { device: deviceCode(), paid });
    for (const p of paid) S.faresAsked?.delete(p.plaza);
    $('arrival-tolls').hidden = true;
    toast(t('fareAskThanks'));
  } catch {
    $('arrival-tolls-send').disabled = false;
    toast(t('fareAskFailed'), 5000);
  }
}

function toggleWorkTrip() {
  const btn = $('arrival-work');
  const on = btn.getAttribute('aria-pressed') !== 'true';
  if (!markLastTrip({ w: on })) return;
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = t(on ? 'workMarked' : 'workMark');
}

function downloadWork() {
  const list = workTrips(keptTrips(), S.month.year, S.month.month);
  if (!list.length) return;
  const head = ['csvDate', 'csvTime', 'csvFrom', 'csvTo', 'csvKm', 'csvFuel', 'csvClaim'].map((k) => t(k));
  const csv = workCsv(list, load('workRate', null), head);
  const name = `pintu-${S.month.year}-${String(S.month.month + 1).padStart(2, '0')}.csv`;
  if (inApp()) { shareLink('', csv, name); return; }
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function renderBudiSetting() {
  const b = cleanBudi(load('budi', null));
  if (document.activeElement !== $('budi-limit')) $('budi-limit').value = String(b.limit);
  const used = budiUsed(keptTrips(), b);
  $('budi-status').textContent = `${t('budiStatus', { litres: amountText(used.litres), limit: used.limit })}${used.guessed ? ` ${t('budiGuess')}` : ''}`;
}

function saveBudi() {
  const before = cleanBudi(load('budi', null));
  const limit = parseInt($('budi-limit').value, 10);
  const actual = $('budi-actual').value === '' ? null : parseFloat($('budi-actual').value);
  const d = new Date();
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const fixed = actual != null && Number.isFinite(actual) && actual >= 0 ? { month, litres: actual, at: Date.now() } : before.fixed;
  save('budi', cleanBudi({ limit: Number.isFinite(limit) ? limit : before.limit, fixed }));
  $('budi-actual').value = '';
  renderBudiSetting();
  toast(t('savedOk'));
}

function renderCareSetting() {
  const c = cleanCare(load('care', null));
  const fill = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v ?? ''; };
  const odo = odometerNow(c, keptTrips());
  fill('care-odo', odo);
  fill('care-service', c.serviceAt);
  fill('care-tax', c.roadTax);
  fill('care-ins', c.insurance);
  $('care-status').textContent = odo != null ? t('careOdoNow', { km: fmtDistance(odo * 1000) }) : '';
}

function saveCare() {
  const before = cleanCare(load('care', null));
  const odoTyped = $('care-odo').value;
  const odoNow = odometerNow(before, keptTrips());
  // Only a new reading moves the odometer's starting point.
  const newOdo = odoTyped !== '' && Number(odoTyped) !== odoNow;
  save('care', cleanCare({
    ...before,
    odometer: newOdo ? odoTyped : before.odometer,
    odometerAt: newOdo ? Date.now() : before.odometerAt,
    serviceAt: $('care-service').value,
    roadTax: $('care-tax').value || null,
    insurance: $('care-ins').value || null,
  }));
  renderCareSetting();
  renderCareNote();
  toast(t('savedOk'));
}

function careLine(d) {
  const lang = getLang();
  if (d.kind === 'service') {
    const c = cleanCare(load('care', null));
    return d.step === 'over' ? t('careService_over', { km: fmtDistance(Math.abs(d.kmLeft) * 1000) })
      : t('careService_soon', { km: fmtDistance(d.kmLeft * 1000), at: fmtDistance(c.serviceAt * 1000) });
  }
  const date = new Date(`${d.date}T12:00:00+08:00`).toLocaleDateString(localeOf(lang), { day: 'numeric', month: 'short', year: 'numeric' });
  return t(`care${d.kind === 'roadTax' ? 'RoadTax' : 'Insurance'}_${d.step === 'over' ? 'over' : 'soon'}`, { days: d.days, date });
}

function renderCareNote() {
  const due = careToShow(load('care', null), keptTrips());
  $('care-note').hidden = !due.length;
  if (!due.length) return;
  $('care-text').textContent = due.map(careLine).join(' ');
  $('care-ok').textContent = t('careOk');
}

function careSeen() {
  const care = load('care', null);
  save('care', markSeen(care, careToShow(care, keptTrips())));
  renderCareNote();
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
  if (mode !== 'walk' && mode !== 'transit') save('mode', mode);
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
      onOtherTap: () => takeOtherWay(),
      onPlaceTap,
      onPuckTap: () => { if (S.view === 'idle' && !S.overlay) openCar(); },
      onTransitTap,
      trafficTiles: CONFIG.server ? `${CONFIG.server}/tiles` : null,
      satelliteTiles: CONFIG.server ? `${CONFIG.server}/tiles` : null,
      satellite: S.settings.satellite,
    });
    await mapView.init();
    mapView.setSaver(S.saving);
    mapView.setCarOn(S.settings.view3d);
    syncTrafficMap();
    syncTransit();
  } catch {
    $('map-problem-text').textContent = t('mapFailed');
    $('map-problem').hidden = false;
  }
}

function onUserMove() {
  if (S.view === 'preview') S.previewMoved = true;
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
  loadWild();
  await startMap();
  openIncoming();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main();
