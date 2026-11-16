import { CONFIG } from './config.js';
import { carLayer } from './car-gl.js';
import { landmarkLayer } from './landmarks.js';
import { boundsOf, sliceBetween, sliceFrom } from './geo.js';
import { INCIDENTS, drawIncident, flowFilter, flowPaint, incidentFilter, incidentImageId } from './traffic-map.js';
import { CATEGORY_ICONS, UI, destPinSvg, puckSvg } from './icons.js';

const load = (tag, attrs) => new Promise((resolve, reject) => {
  const el = document.createElement(tag);
  Object.assign(el, attrs);
  el.onload = resolve;
  el.onerror = reject;
  document.head.append(el);
});

export async function loadMapLibre() {
  if (window.maplibregl) return window.maplibregl;
  const { version, cdns } = CONFIG.maplibre;
  for (const cdn of cdns) {
    const base = `${cdn}${version}/dist/`;
    try {
      await load('script', { src: `${base}maplibre-gl.js`, crossOrigin: 'anonymous' });
      if (!window.maplibregl) continue;
      load('link', { rel: 'stylesheet', href: `${base}maplibre-gl.css`, crossOrigin: 'anonymous' }).catch(() => {});
      return window.maplibregl;
    } catch { /* try the next one */ }
  }
  throw new Error('map library unavailable');
}

const COLORS = {
  day: { route: '#1668E3', glow: '#4A9BFF', casing: '#FFFFFF', alt: '#8695A0', altCasing: '#FFFFFF', building: '#DCD8CF', road: '#3B444B', edge: '#FFFFFF', carpet: '#1E7BFF', tintBest: '#2F8BFF', tintOk: '#7FB6FF', arrowDim: '#8A949B' },
  night: { route: '#5AA6FF', glow: '#2F7FF0', casing: '#0A1F3C', alt: '#74838B', altCasing: '#141A1D', building: '#2B3439', road: '#23292E', edge: '#DDE3E6', carpet: '#3C97FF', tintBest: '#2F8BFF', tintOk: '#5E9BE8', arrowDim: '#6D777E' },
};

const EMPTY = { type: 'FeatureCollection', features: [] };
const line = (coords, properties = {}) => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: coords } });
const collection = (features) => ({ type: 'FeatureCollection', features });
const point = (lng, lat, properties = {}) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [lng, lat] } });

// Signs standing on the road ahead while driving: a traffic light, a hump and a
// railway crossing, drawn upright like the real thing.
export function drawRoadSign(kind, ratio = 2) {
  const W = 22, H = kind === 'light' ? 46 : 34;
  const canvas = document.createElement('canvas');
  canvas.width = W * ratio;
  canvas.height = H * ratio;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  const round = (x, y, w, h, r) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  };
  // The pole.
  ctx.fillStyle = '#9AA3A8';
  ctx.fillRect(W / 2 - 1, H - 10, 2, 10);
  if (kind === 'light') {
    round(3, 1, W - 6, 34, 6);
    ctx.fillStyle = '#15191C';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    [['#FF4D4D', 8], ['#FFC233', 18], ['#3DDC6F', 28]].forEach(([colour, y]) => {
      ctx.beginPath();
      ctx.arc(W / 2, y, 3.9, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
    });
  } else if (kind === 'bump') {
    // A yellow diamond with a hump on it.
    ctx.save();
    ctx.translate(W / 2, 12);
    ctx.rotate(Math.PI / 4);
    round(-8, -8, 16, 16, 2.5);
    ctx.fillStyle = '#FFC233';
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#15191C';
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(W / 2 - 6, 15);
    ctx.quadraticCurveTo(W / 2, 6.5, W / 2 + 6, 15);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#15191C';
    ctx.stroke();
  } else {
    // A railway crossing: a white cross with a red edge.
    ctx.save();
    ctx.translate(W / 2, 12);
    for (const angle of [Math.PI / 4, -Math.PI / 4]) {
      ctx.save();
      ctx.rotate(angle);
      round(-10, -2.6, 20, 5.2, 1);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#D93025';
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, pixelRatio: ratio };
}
export const SIGN_KINDS = ['light', 'bump', 'rail'];

// The roads around you while driving, drawn as roads: asphalt the width of their
// lanes, white edges and dashed lane lines. The map doesn't say how many lanes
// most roads have, so it's judged from the kind of road; the route's own lanes,
// which are known, are drawn over these.
const LANE_M = 3.3;
const PX_PER_M_15 = 0.4187, PX_PER_M_22 = 53.59;     // at the equator; Malaysia is close enough
// Faded in as the map comes close enough for real widths to make sense.
const fadeIn = (to = 1) => ['interpolate', ['linear'], ['zoom'], 15, 0, 16, to];
const metresWide = (m) => ['interpolate', ['exponential', 2], ['zoom'], 15, ['*', m, PX_PER_M_15], 22, ['*', m, PX_PER_M_22]];
const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'];
export const JUNCTION_LAYERS = ['pintu-jr-shadow', 'pintu-jr-surface', 'pintu-jr-edge', 'pintu-jr-lane-1', 'pintu-jr-lane-2', 'pintu-jr-lane-3'];
export const lanesGuess = ['case',
  ['==', ['get', 'ramp'], 1], 1,
  ['==', ['get', 'oneway'], 1], ['match', ['get', 'class'], 'motorway', 3, 'trunk', 2, 'primary', 2, 'secondary', 2, 1],
  ['match', ['get', 'class'], 'motorway', 4, 'trunk', 4, 'primary', 2, 'secondary', 2, 'tertiary', 2, 'minor', 2, 1],
];

// The head of the arrow at the next turn: white, edged dark, pointing up (the
// map turns it to the road's direction). 64 px across before it's sized.
export function drawTurnHead(ratio = 2) {
  const W = 64, H = 52;
  const canvas = document.createElement('canvas');
  canvas.width = W * ratio;
  canvas.height = H * ratio;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  ctx.beginPath();
  ctx.moveTo(W / 2, 3);
  ctx.lineTo(W - 4, H - 3);
  ctx.lineTo(4, H - 3);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#0B1B2E';
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, pixelRatio: ratio };
}

// A speed camera on the map: a violet badge with a white camera, like the signs.
export const CAMERA_VIOLET = '#6B3FD6';
export function drawCameraBadge(ratio = 2) {
  const size = 26 * ratio;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  ctx.beginPath();
  ctx.arc(13, 13, 11.5, 0, Math.PI * 2);
  ctx.fillStyle = CAMERA_VIOLET;
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(6, 9.5, 10, 7, 1.6) : ctx.rect(6, 9.5, 10, 7);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(16, 12); ctx.lineTo(20.5, 9.8); ctx.lineTo(20.5, 16.2); ctx.lineTo(16, 14); ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(10.5, 13, 1.9, 0, Math.PI * 2);
  ctx.fillStyle = CAMERA_VIOLET;
  ctx.fill();
  return { width: size, height: size, data: ctx.getImageData(0, 0, size, size).data, pixelRatio: ratio };
}
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Phones with very sharp screens would otherwise draw the map at three times
// the pixels or more, which slows every frame for detail nobody can see while
// driving. Twice is still crisp.
export const MAX_PIXEL_RATIO = 2;
// Battery saver draws a little less sharply still.
export const SAVER_PIXEL_RATIO = 1.5;
export const mapPixelRatio = (saving = false) => Math.min(window.devicePixelRatio || 1, saving ? SAVER_PIXEL_RATIO : MAX_PIXEL_RATIO);

// As you drive, the line behind you is taken away several times a second. Only
// the next few kilometres are sent again each time; the rest of the trip, which
// can be hundreds of kilometres, is sent only now and then.
export const NEAR_M = 4000;
export const NEAR_REFRESH_M = 1500;

const placeName = (p = {}) => p.name || p['name:latin'] || p.name_en || p['name:en'] || '';

export class MapView {
  constructor(el, { theme, view3d, onLongPress, onUserMove, onAltTap, onOtherTap, onPlaceTap, onPuckTap, trafficTiles = null, satelliteTiles = null, satellite = false }) {
    this.el = el;
    this.trafficTiles = trafficTiles;   // where TomTom's traffic tiles come from, if anywhere
    this.satelliteTiles = satelliteTiles; // where the photos from above come from, if anywhere
    this.satellite = !!satellite && !!satelliteTiles;
    this.trafficOn = false;
    this.trafficDriving = false;
    this.theme = theme;
    this.view3d = view3d;
    this.saving = false;    // battery saver: no 3D buildings, fewer pixels
    this.onLongPress = onLongPress;
    this.onUserMove = onUserMove;
    this.onAltTap = onAltTap;
    this.onOtherTap = onOtherTap;
    this.onPlaceTap = onPlaceTap;
    this.onPuckTap = onPuckTap;
    this.carPin = null;
    this.carKey = '';
    this.map = null;
    this.data = { active: EMPTY, far: EMPTY, alts: EMPTY, lanes: EMPTY, other: EMPTY, cams: EMPTY, warn: EMPTY, signs: EMPTY, turn: EMPTY };
    this.junctionRoads = false;
    this.routeLabels = [];
    this.routeLabelKey = '';
    this.stormPin = null;
    this.trim = null;       // where the often-sent part of the line ends
    this.puckHeading = null;
    this.carPose = null;
    this.carReady = false;
    this.carOn = false;
    this.puck = null;
    this.dest = null;
    this.pins = [];
    this.stopPins = [];
    this.pressTimer = null;
    this.revealRaf = null;
  }

  async init() {
    const lib = await loadMapLibre();
    this.lib = lib;
    this.map = new lib.Map({
      container: this.el,
      style: CONFIG.mapStyles[this.theme],
      center: CONFIG.home.center,
      zoom: CONFIG.home.zoom,
      attributionControl: { compact: true, customAttribution: 'Traffic © TomTom' },
      fadeDuration: 120,
      maxPitch: 70,
      pixelRatio: mapPixelRatio(this.saving),
    });
    this.map.on('style.load', () => this._addLayers());
    this.map.on('dragstart', () => this.onUserMove?.());
    for (const ev of ['rotatestart', 'pitchstart', 'zoomstart']) {
      this.map.on(ev, (e) => { if (e.originalEvent) this.onUserMove?.(); });
    }
    this._wireLongPress();
    this.map.on('click', 'pintu-alt-hit', (e) => {
      const f = e.features && e.features[0];
      if (f) this.onAltTap?.(f.properties.index);
    });
    this.map.on('click', 'pintu-other-hit', () => this.onOtherTap?.());
    this.map.on('click', (e) => this._placeTap(e));
  }

  // A tap on a named place on the map, as in other map apps. A little leeway around
  // the finger, because labels are small.
  _placeTap(e) {
    if (!e.point) return;
    const { x, y } = e.point;
    // Your own position, whether it's the dot or the 3D car drawn in its place.
    const you = this.carPose ? [this.carPose.lng, this.carPose.lat] : this.puck?.getLngLat?.();
    if (you && this.onPuckTap && this.map.project) {
      const p = this.map.project(you);
      if (Math.hypot(p.x - x, p.y - y) < 34) { this.onPuckTap(); return; }
    }
    if (!this.onPlaceTap || !this.map.queryRenderedFeatures) return;
    let hits = [];
    try { hits = this.map.queryRenderedFeatures([[x - 14, y - 14], [x + 14, y + 14]]) || []; } catch { return; }
    if (hits.some((h) => h.layer?.id === 'pintu-alt-hit' || h.layer?.id === 'pintu-other-hit')) return;
    const f = hits.find((h) => (h.sourceLayer === 'poi' || h.sourceLayer === 'aerodrome_label') && placeName(h.properties));
    if (!f) return;
    const point = f.geometry?.type === 'Point' ? f.geometry.coordinates : [e.lngLat.lng, e.lngLat.lat];
    const props = f.properties || {};
    this.onPlaceTap({
      name: placeName(props),
      kind: [props.subclass, props.class, f.sourceLayer === 'aerodrome_label' ? 'aerodrome' : ''].filter(Boolean),
      lng: point[0],
      lat: point[1],
    });
  }

  center() {
    const c = this.map?.getCenter?.();
    return c ? { lng: c.lng, lat: c.lat } : null;
  }

  // Where the car was left, while it's worth showing.
  setCarPin(place) {
    if (!this.map) return;
    const key = place ? `${place.lng},${place.lat}` : '';
    if (key === this.carKey) return;
    this.carKey = key;
    if (this.carPin) { this.carPin.remove(); this.carPin = null; }
    if (!place) return;
    const el = document.createElement('div');
    el.className = 'map-pin is-car';
    el.innerHTML = UI.car;
    this.carPin = new this.lib.Marker({ element: el }).setLngLat([place.lng, place.lat]).addTo(this.map);
  }

  setTheme(theme) {
    if (theme === this.theme) return;
    this.theme = theme;
    // diff: false forces a full reload, which is what fires 'style.load' and
    // lets the route layers go back on top of the new style.
    this.map?.setStyle(CONFIG.mapStyles[theme], { diff: false });
  }

  // The route has to sit above every road (bridges come late in the list), and
  // above the buildings so they never hide it, but below the place names.
  _routeInsertPoint(layers) {
    let lastRoad = -1;
    layers.forEach((l, i) => {
      if (l['source-layer'] === 'transportation' && l.type === 'line') lastRoad = i;
    });
    const buildings = layers.findIndex((l) => l.id === 'building-3d');
    const from = Math.max(lastRoad, buildings) + 1;
    return layers.slice(from).find((l) => l.type === 'symbol')?.id;
  }

  _addLayers() {
    const m = this.map;
    const c = COLORS[this.theme];
    const beforeId = this._routeInsertPoint(m.getStyle().layers);
    this._addSatellite(m.getStyle().layers, beforeId);
    this._addTrafficLayers(beforeId);

    // One set of 3D buildings for day and night, so the switch behaves the same.
    if (m.getLayer('building-3d')) m.setLayoutProperty('building-3d', 'visibility', 'none');
    if (m.getSource('openmaptiles') && !m.getLayer('pintu-3d')) {
      m.addLayer({
        id: 'pintu-3d',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        filter: ['!', ['has', 'hide_3d']],
        layout: { visibility: this._buildingsShown() ? 'visible' : 'none' },
        paint: {
          'fill-extrusion-color': c.building,
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, ['get', 'render_height']],
          'fill-extrusion-base': ['step', ['zoom'], 0, 15.5, ['get', 'render_min_height']],
          'fill-extrusion-opacity': 0.9,
        },
      }, beforeId);
    }
    // Famous statues on their pedestals, which the map's buildings stop short of.
    if (m.getLayer('pintu-3d') && !m.getLayer('pintu-landmarks')) {
      m.addLayer(landmarkLayer(this.lib, {
        shown: () => this._buildingsShown(),
        theme: () => this.theme,
      }), beforeId);
    }

    // Areas under an official weather warning, softly lit, under every route.
    if (!m.getSource('pintu-warn')) m.addSource('pintu-warn', { type: 'geojson', data: this.data.warn, tolerance: 0.6 });
    if (!m.getLayer('pintu-warn-fill')) m.addLayer({ id: 'pintu-warn-fill', type: 'fill', source: 'pintu-warn', paint: { 'fill-color': '#FF8A1F', 'fill-opacity': 0.1 } }, beforeId);
    if (!m.getLayer('pintu-warn-glow')) m.addLayer({ id: 'pintu-warn-glow', type: 'line', source: 'pintu-warn', layout: { 'line-join': 'round' }, paint: { 'line-color': '#FF9A2E', 'line-width': 9, 'line-blur': 7, 'line-opacity': 0.55 } }, beforeId);
    if (!m.getLayer('pintu-warn-edge')) m.addLayer({ id: 'pintu-warn-edge', type: 'line', source: 'pintu-warn', layout: { 'line-join': 'round' }, paint: { 'line-color': '#F07A12', 'line-width': 1.6 } }, beforeId);

    // On the ground, under the buildings, so a road behind one stays hidden.
    this._addJunctionRoads(m.getLayer('pintu-3d') ? 'pintu-3d' : beforeId, c);

    if (!m.getSource('pintu-other')) m.addSource('pintu-other', { type: 'geojson', data: this.data.other });
    if (!m.getSource('pintu-alts')) m.addSource('pintu-alts', { type: 'geojson', data: this.data.alts });
    if (!m.getSource('pintu-active')) m.addSource('pintu-active', { type: 'geojson', data: this.data.active });
    if (!m.getSource('pintu-far')) m.addSource('pintu-far', { type: 'geojson', data: this.data.far });
    const layout = { 'line-cap': 'round', 'line-join': 'round' };
    // Wider up close, so the line stays easy to see when the map is tilted.
    const width = (a, b) => ['interpolate', ['linear'], ['zoom'], 8, a, 16, b, 18, b * 1.7];
    const add = (id, source, paint, look = layout) => {
      if (!m.getLayer(id)) m.addLayer({ id, type: 'line', source, layout: look, paint }, beforeId);
    };
    // The other way, with or without tolls, dashed: it's there to compare.
    add('pintu-other-casing', 'pintu-other', { 'line-color': c.altCasing, 'line-width': width(5, 11), 'line-opacity': 0.8 });
    add('pintu-other', 'pintu-other', { 'line-color': c.alt, 'line-width': width(3, 7), 'line-dasharray': [1.4, 1.1] }, { 'line-cap': 'butt', 'line-join': 'round' });
    add('pintu-other-hit', 'pintu-other', { 'line-color': '#000', 'line-opacity': 0, 'line-width': 28 });
    add('pintu-alt-casing', 'pintu-alts', { 'line-color': c.altCasing, 'line-width': width(6, 13) });
    add('pintu-alt', 'pintu-alts', { 'line-color': c.alt, 'line-width': width(3.5, 9) });
    add('pintu-alt-hit', 'pintu-alts', { 'line-color': '#000', 'line-opacity': 0, 'line-width': 28 });
    // The line comes in two parts that meet end to end. The see-through glow has
    // square ends, so it isn't doubled where they meet.
    const glow = { 'line-color': c.glow, 'line-opacity': 0.4, 'line-blur': 7, 'line-width': width(12, 28) };
    const glowLook = { 'line-cap': 'butt', 'line-join': 'round' };
    add('pintu-far-glow', 'pintu-far', glow, glowLook);
    add('pintu-glow', 'pintu-active', glow, glowLook);
    add('pintu-far-casing', 'pintu-far', { 'line-color': c.casing, 'line-width': width(8, 16) });
    add('pintu-casing', 'pintu-active', { 'line-color': c.casing, 'line-width': width(8, 16) });
    add('pintu-far-route', 'pintu-far', { 'line-color': c.route, 'line-width': width(5, 11) });
    add('pintu-route', 'pintu-active', { 'line-color': c.route, 'line-width': width(5, 11) });
    this._addLaneLayers(beforeId, c);

    // The arrow at the next turn, painted on the road over the route.
    if (!m.getSource('pintu-turn')) m.addSource('pintu-turn', { type: 'geojson', data: this.data.turn });
    // Its shaft and its head keep the same shape at every zoom.
    const turnLine = ['==', ['get', 'part'], 'line'], turnHead = ['==', ['get', 'part'], 'head'];
    const turnLayer = (layer) => { if (!m.getLayer(layer.id)) m.addLayer({ source: 'pintu-turn', ...layer }, beforeId); };
    const shaft = (grow) => ['interpolate', ['exponential', 2], ['zoom'], 15, 2.5 + grow, 17, 5 + grow, 19, 10 + grow * 1.5, 20, 15 + grow * 2, 22, 40 + grow * 4];
    if (!m.hasImage?.('pintu-turn-head')) {
      try {
        const img = drawTurnHead(Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 2))));
        if (img) m.addImage?.('pintu-turn-head', { width: img.width, height: img.height, data: img.data }, { pixelRatio: img.pixelRatio });
      } catch { /* the line alone still shows the way */ }
    }
    this.turnShown = undefined;
    turnLayer({ id: 'pintu-turn-casing', type: 'line', filter: turnLine, layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': '#0B1B2E', 'line-width': shaft(3) } });
    turnLayer({ id: 'pintu-turn-line', type: 'line', filter: turnLine, layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': shaft(0) } });
    turnLayer({
      id: 'pintu-turn-head',
      type: 'symbol',
      filter: turnHead,
      layout: {
        'icon-image': 'pintu-turn-head',
        'icon-anchor': 'bottom',
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        // Sized with the shaft, about three shafts across.
        'icon-size': ['interpolate', ['exponential', 2], ['zoom'], 15, 0.12, 17, 0.23, 19, 0.47, 20, 0.7, 22, 1.9],
      },
    });
    this._syncTurnArrow();

    // Speed cameras, on top of the route.
    if (!m.getSource('pintu-cams')) m.addSource('pintu-cams', { type: 'geojson', data: this.data.cams });
    if (!m.hasImage?.('pintu-camera')) {
      try {
        const img = drawCameraBadge(Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 2))));
        if (img) m.addImage?.('pintu-camera', { width: img.width, height: img.height, data: img.data }, { pixelRatio: img.pixelRatio });
      } catch { /* the badges are a nicety */ }
    }
    if (!m.getLayer('pintu-cams')) {
      m.addLayer({
        id: 'pintu-cams',
        type: 'symbol',
        source: 'pintu-cams',
        layout: {
          'icon-image': 'pintu-camera',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.7, 12, 0.9, 16, 1.1],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      }, beforeId);
    }

    // Lights, humps and crossings ahead, standing on the road.
    if (!m.getSource('pintu-signs')) m.addSource('pintu-signs', { type: 'geojson', data: this.data.signs });
    for (const kind of SIGN_KINDS) {
      if (m.hasImage?.(`pintu-sign-${kind}`)) continue;
      try {
        const img = drawRoadSign(kind, Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 2))));
        if (img) m.addImage?.(`pintu-sign-${kind}`, { width: img.width, height: img.height, data: img.data }, { pixelRatio: img.pixelRatio });
      } catch { /* the signs are a nicety */ }
    }
    if (!m.getLayer('pintu-signs')) {
      m.addLayer({
        id: 'pintu-signs',
        type: 'symbol',
        source: 'pintu-signs',
        minzoom: 13,
        layout: {
          'icon-image': ['concat', 'pintu-sign-', ['get', 'k']],
          'icon-anchor': 'bottom',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 17, 0.95, 19, 1.25],
          'icon-pitch-alignment': 'viewport',
          'icon-rotation-alignment': 'viewport',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'symbol-z-order': 'viewport-y',
        },
      }, beforeId);
    }

    // The car goes on top of everything.
    if (!m.getLayer('pintu-car')) {
      m.addLayer(carLayer(this.lib, {
        pose: () => (this.carOn ? this.carPose : null),
        onReady: (ok) => { this.carReady = ok; this._syncPuck(); },
      }));
    }
  }

  // Traffic goes under the route, so the way you're going is always on top.
  _addTrafficLayers(beforeId) {
    const m = this.map;
    if (!this.trafficTiles) return;
    const tiles = (kind) => [`${this.trafficTiles}/${kind}/{z}/{x}/{y}.pbf`];
    // Asked for no closer than this and stretched beyond, which keeps the
    // number of tiles, and of requests to TomTom, down.
    if (!m.getSource('pintu-flow')) m.addSource('pintu-flow', { type: 'vector', tiles: tiles('flow'), minzoom: 6, maxzoom: 14 });
    if (!m.getSource('pintu-incidents')) m.addSource('pintu-incidents', { type: 'vector', tiles: tiles('incidents'), minzoom: 6, maxzoom: 14 });
    const visibility = this.trafficOn ? 'visible' : 'none';
    if (!m.getLayer('pintu-flow')) {
      m.addLayer({
        id: 'pintu-flow',
        type: 'line',
        source: 'pintu-flow',
        'source-layer': 'Traffic flow',
        minzoom: 9,
        filter: flowFilter(this.trafficDriving),
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility },
        paint: flowPaint(),
      }, beforeId);
    }
    for (const code of Object.keys(INCIDENTS)) {
      const id = incidentImageId(code);
      if (m.hasImage?.(id)) continue;
      try {
        const img = drawIncident(Number(code), Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 2))));
        if (img) m.addImage?.(id, { width: img.width, height: img.height, data: img.data }, { pixelRatio: img.pixelRatio });
      } catch { /* markers are a nicety */ }
    }
    if (!m.getLayer('pintu-incidents')) {
      m.addLayer({
        id: 'pintu-incidents',
        type: 'symbol',
        source: 'pintu-incidents',
        'source-layer': 'Traffic incident POI',
        minzoom: 10,
        filter: incidentFilter,
        layout: {
          visibility,
          'icon-image': ['concat', 'pintu-incident-', ['to-string', ['get', 'icon_category']]],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 15, 1],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      }, beforeId);
    }
  }

  // Traffic on or off, and whether you're driving (only the slow parts then).
  setTraffic(on, driving = false) {
    this.trafficOn = !!on && !!this.trafficTiles;
    this.trafficDriving = !!driving;
    const m = this.map;
    if (!m?.getLayer?.('pintu-flow')) return;
    const visibility = this.trafficOn ? 'visible' : 'none';
    m.setLayoutProperty('pintu-flow', 'visibility', visibility);
    m.setLayoutProperty('pintu-incidents', 'visibility', visibility);
    m.setFilter?.('pintu-flow', flowFilter(this.trafficDriving));
  }

  // The lane view, all from one source, told apart by each shape's kind.
  _addLaneLayers(beforeId, c) {
    const m = this.map;
    if (!m.getSource('pintu-lanes')) {
      m.addSource('pintu-lanes', { type: 'geojson', data: this.data.lanes, tolerance: 0.05, buffer: 16, maxzoom: 20 });
    }
    const kind = (...names) => ['in', ['get', 'k'], ['literal', names]];
    const fill = (id, names, color, opacity = 1) => {
      if (m.getLayer(id)) return;
      m.addLayer({
        id, type: 'fill', source: 'pintu-lanes', minzoom: 14, filter: kind(...names),
        paint: { 'fill-color': color, 'fill-opacity': opacity, 'fill-antialias': false },
      }, beforeId);
    };
    // Paint on a road stays the same real-world width as the camera moves.
    const metres = (w) => ['interpolate', ['exponential', 2], ['zoom'], 16, w * 0.16, 21, w * 5.12];
    const stroke = (id, names, color, w, dash) => {
      if (m.getLayer(id)) return;
      const paint = { 'line-color': color, 'line-width': metres(w) };
      if (dash) paint['line-dasharray'] = dash;
      m.addLayer({ id, type: 'line', source: 'pintu-lanes', minzoom: 14, filter: kind(...names), layout: { 'line-join': 'round' }, paint }, beforeId);
    };
    fill('pintu-lane-road', ['road'], c.road);
    fill('pintu-lane-tint-ok', ['tint-ok'], c.tintOk, 0.22);
    fill('pintu-lane-tint', ['tint-best'], c.tintBest, 0.38);
    stroke('pintu-lane-divider', ['divider'], c.edge, 0.9, [3, 5]);
    stroke('pintu-lane-edge', ['edge'], c.edge, 1.1);
    fill('pintu-lane-carpet', ['carpet'], c.carpet, 0.9);
    fill('pintu-lane-dim', ['arrow-dim'], c.arrowDim);
    fill('pintu-lane-paint', ['arrow', 'paint'], '#FFFFFF');
    fill('pintu-lane-chevron', ['chevron'], '#FFFFFF', 0.72);
  }

  // The roads around drawn as roads, while driving in 3D.
  _addJunctionRoads(beforeId, c) {
    const m = this.map;
    if (!m.getSource('openmaptiles')) return;
    const visibility = this.junctionRoads ? 'visible' : 'none';
    const base = ['all', ['match', ['get', 'class'], ROAD_CLASSES, true, false], ['!=', ['get', 'brunnel'], 'tunnel']];
    const width = ['+', ['*', lanesGuess, LANE_M], 1.2];
    const add = (layer) => {
      if (m.getLayer(layer.id)) return;
      m.addLayer({ type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 15, ...layer, layout: { 'line-join': 'round', visibility, ...(layer.layout || {}) } }, beforeId);
    };
    // Bridges and flyovers cast a shadow, so they read as above the rest.
    add({ id: 'pintu-jr-shadow', filter: ['all', base, ['==', ['get', 'brunnel'], 'bridge']], paint: { 'line-color': '#000000', 'line-opacity': fadeIn(0.35), 'line-blur': 6, 'line-width': metresWide(['+', width, 3]), 'line-translate': [0, 7], 'line-translate-anchor': 'viewport' } });
    add({ id: 'pintu-jr-surface', filter: base, paint: { 'line-color': c.road, 'line-opacity': fadeIn(), 'line-width': metresWide(width) } });
    add({ id: 'pintu-jr-edge', filter: base, paint: { 'line-color': c.edge, 'line-opacity': fadeIn(0.85), 'line-gap-width': metresWide(['-', width, 0.6]), 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15, 0.4, 18, 1.1, 22, 6] } });
    // A dashed line between each pair of lanes.
    for (const i of [1, 2, 3]) {
      add({
        id: `pintu-jr-lane-${i}`,
        filter: ['all', base, ['>', lanesGuess, i]],
        layout: { 'line-cap': 'butt' },
        paint: {
          'line-color': c.edge,
          'line-opacity': fadeIn(0.8),
          'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15, 0.35, 18, 0.9, 22, 5],
          'line-dasharray': [5, 7],
          'line-offset': metresWide(['*', ['-', i, ['/', lanesGuess, 2]], LANE_M]),
        },
      });
    }
  }

  setJunctionRoads(on) {
    if (this.junctionRoads === on) return;
    this.junctionRoads = on;
    for (const id of JUNCTION_LAYERS) {
      if (this.map?.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }
  }

  // Signs ahead: [{ kind: 'light' | 'bump' | 'rail', lng, lat }].
  setRoadSigns(list) {
    if (!list?.length && !this.data.signs.features.length) return;
    this.data.signs = collection((list || []).map((f) => point(f.lng, f.lat, { k: f.kind })));
    this.map?.getSource('pintu-signs')?.setData(this.data.signs);
  }

  setLanes(featureCollection) {
    this.data.lanes = featureCollection;
    this.map?.getSource('pintu-lanes')?.setData(featureCollection);
    this._syncTurnArrow();
  }

  // With the lanes drawn, the lane to take carries its own painted arrows, and an
  // arrow down the middle of the road would sit on the wrong lane.
  _syncTurnArrow() {
    const show = !this.data.lanes?.features?.length;
    if (this.turnShown === show) return;
    this.turnShown = show;
    for (const id of ['pintu-turn-casing', 'pintu-turn-line', 'pintu-turn-head']) {
      if (this.map?.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
    }
  }

  _syncPuck() {
    const hide = this.carOn && this.carReady;
    if (this.puck) this.puck.getElement().style.visibility = hide ? 'hidden' : 'visible';
  }

  // The car replaces the arrow in 3D.
  setCarOn(on) {
    this.carOn = on;
    this._syncPuck();
    this.map?.triggerRepaint();
  }

  setCar(pose) {
    this.carPose = pose;
    if (this.carOn) this.map?.triggerRepaint();
  }

  setView3D(on) {
    this.view3d = on;
    this._syncBuildings();
  }

  // The photo has its own buildings: drawn ones on top would hide the roads.
  _buildingsShown() { return this.view3d && !this.saving && !this.satellite; }

  _syncBuildings() {
    if (this.map?.getLayer('pintu-3d')) this.map.setLayoutProperty('pintu-3d', 'visibility', this._buildingsShown() ? 'visible' : 'none');
    this.map?.triggerRepaint?.();
    this._syncBaseFills();
  }

  // Any of the map's own areas (buildings, fields) drawn above the photo are
  // hidden while it shows, and put back after.
  _syncBaseFills() {
    const m = this.map;
    if (!m?.getLayer?.('pintu-sat')) return;
    const layers = m.getStyle().layers;
    const from = layers.findIndex((l) => l.id === 'pintu-sat');
    this.hiddenFills ||= new Map();
    for (const l of layers.slice(from + 1)) {
      if (l.id.startsWith('pintu-') || !['fill', 'fill-extrusion'].includes(l.type) || l.id === 'building-3d') continue;
      if (this.satellite) {
        if (!this.hiddenFills.has(l.id)) this.hiddenFills.set(l.id, l.layout?.visibility || 'visible');
        m.setLayoutProperty(l.id, 'visibility', 'none');
      } else if (this.hiddenFills.has(l.id)) {
        m.setLayoutProperty(l.id, 'visibility', this.hiddenFills.get(l.id));
        this.hiddenFills.delete(l.id);
      }
    }
  }

  // Photos from above, under the roads and names: the map's own roads and
  // labels stay on top, its fields, water and buildings go under the photo.
  _addSatellite(layers, beforeId) {
    const m = this.map;
    if (!this.satelliteTiles) return;
    if (!m.getSource('pintu-sat')) {
      m.addSource('pintu-sat', {
        type: 'raster',
        tiles: [`${this.satelliteTiles}/sat/{z}/{x}/{y}.jpg`],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Satellite © TomTom, Maxar',
      });
    }
    if (m.getLayer('pintu-sat')) return;
    const firstRoad = layers.find((l) => l['source-layer'] === 'transportation')?.id;
    m.addLayer({
      id: 'pintu-sat',
      type: 'raster',
      source: 'pintu-sat',
      layout: { visibility: this.satellite ? 'visible' : 'none' },
      // At night, darker, so it doesn't dazzle.
      paint: this.theme === 'night' ? { 'raster-brightness-max': 0.55, 'raster-saturation': -0.25 } : { 'raster-brightness-max': 0.95 },
    }, firstRoad || beforeId);
    this.hiddenFills = new Map();
    this._syncBaseFills();
  }

  setSatellite(on) {
    const want = !!on && !!this.satelliteTiles;
    if (this.satellite === want) return;
    this.satellite = want;
    if (this.map?.getLayer('pintu-sat')) this.map.setLayoutProperty('pintu-sat', 'visibility', want ? 'visible' : 'none');
    this._syncBuildings();
  }

  // The arrow painted on the road at the next turn: { line, head } or null.
  setTurnArrow(arrow) {
    if (!arrow && !this.data.turn.features.length) return;
    this.data.turn = collection(arrow ? [
      { type: 'Feature', properties: { part: 'line' }, geometry: { type: 'LineString', coordinates: arrow.line } },
      point(arrow.end[0], arrow.end[1], { part: 'head', bearing: arrow.bearing }),
    ] : []);
    this.map?.getSource('pintu-turn')?.setData(this.data.turn);
  }

  setSaver(on) {
    if (this.saving === on) return;
    this.saving = on;
    this._syncBuildings();
    try { this.map?.setPixelRatio?.(mapPixelRatio(on)); } catch { /* an older map library: sharpness stays */ }
  }

  _wireLongPress() {
    const cancel = () => { clearTimeout(this.pressTimer); this.pressTimer = null; };
    this.map.on('touchstart', (e) => {
      cancel();
      if (e.points && e.points.length > 1) return;
      const at = e.lngLat;
      this.pressTimer = setTimeout(() => this.onLongPress?.(at), 550);
    });
    for (const ev of ['touchend', 'touchcancel', 'touchmove', 'dragstart', 'zoomstart', 'rotatestart']) this.map.on(ev, cancel);
    this.map.on('contextmenu', (e) => this.onLongPress?.(e.lngLat));
  }

  showRoutes(routes, selected) {
    this._stopReveal();
    this.trim = null;
    this.data.far = EMPTY;
    this.data.active = collection(routes[selected] ? [line(routes[selected].coords)] : []);
    this.data.alts = collection(routes.map((r, index) => (index === selected ? null : line(r.coords, { index }))).filter(Boolean));
    this._push();
  }

  // The chosen route draws itself from you to the destination.
  revealRoute(routes, selected) {
    this.showRoutes(routes, selected);
    const coords = routes[selected]?.coords;
    if (!coords || coords.length < 3 || reducedMotion()) return;
    const started = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - started) / 750);
      const eased = 1 - (1 - t) ** 3;
      const n = Math.max(2, Math.ceil(coords.length * eased));
      this.data.active = collection([line(coords.slice(0, n))]);
      this.map?.getSource('pintu-active')?.setData(this.data.active);
      this.revealRaf = t < 1 ? requestAnimationFrame(tick) : null;
    };
    this.revealRaf = requestAnimationFrame(tick);
  }

  _stopReveal() {
    if (this.revealRaf) cancelAnimationFrame(this.revealRaf);
    this.revealRaf = null;
  }

  // The route still ahead of distance s along it.
  setRemaining(route, s) {
    const t = this.trim;
    const stale = !t || t.route !== route || s < t.end - NEAR_M - 1 || (s > t.end - NEAR_REFRESH_M && t.end < route.length);
    if (stale) {
      const end = Math.min(route.length, s + NEAR_M);
      this.trim = { route, end };
      const rest = end < route.length ? sliceFrom(route.coords, route.cum, end) : [];
      this.data.far = collection(rest.length > 1 ? [line(rest)] : []);
      this.map?.getSource('pintu-far')?.setData(this.data.far);
    }
    const near = sliceBetween(route.coords, route.cum, s, this.trim.end);
    this.data.active = collection(near.length > 1 ? [line(near)] : []);
    this.map?.getSource('pintu-active')?.setData(this.data.active);
  }

  clearRoutes() {
    this._stopReveal();
    this.trim = null;
    this.data.far = EMPTY;
    this.data.active = EMPTY;
    this.data.alts = EMPTY;
    this._push();
  }

  // The way you'd go with (or without) tolls instead, to compare. Null takes it away.
  setOtherWay(coords) {
    const has = coords?.length > 1;
    // Nothing to nothing isn't a change: no need to have the map redraw.
    if (!has && !this.data.other.features.length) return;
    this.data.other = collection(has ? [line(coords)] : []);
    this.map?.getSource('pintu-other')?.setData(this.data.other);
  }

  // Labels beside each route: [{ key, lng, lat, time, note, selected, other }].
  setRouteLabels(labels, onPick) {
    const key = JSON.stringify((labels || []).map((l) => [l.key, l.lng.toFixed(5), l.lat.toFixed(5), l.time, l.note, l.selected, l.other, l.warn]));
    if (key === this.routeLabelKey && this.routeLabels.length === (labels || []).length) return;
    this.routeLabelKey = key;
    for (const m of this.routeLabels) m.remove();
    this.routeLabels = [];
    if (!this.map) return;
    for (const l of labels || []) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `route-label${l.selected ? ' is-selected' : ''}${l.other ? ' is-other' : ''}`;
      el.dataset.key = l.key;
      const time = document.createElement('strong');
      time.textContent = l.time;
      el.append(time);
      if (l.note) {
        const note = document.createElement('span');
        note.textContent = l.note;
        el.append(note);
      }
      el.addEventListener('click', (e) => { e.stopPropagation(); onPick?.(l); });
      // Lifted by the pointer's height, so its tip touches the route.
      const marker = new this.lib.Marker({ element: el, anchor: 'bottom', offset: [0, -8] }).setLngLat([l.lng, l.lat]).addTo(this.map);
      // The chosen route's label sits above the rest.
      if (l.selected) el.style.zIndex = '2';
      this.routeLabels.push(marker);
    }
  }

  // Where a place is on the screen, in pixels, or null before the map is up.
  screenPoint(lng, lat) {
    try {
      const p = this.map?.project?.([lng, lat]);
      return p && Number.isFinite(p.x) ? [p.x, p.y] : null;
    } catch { return null; }
  }

  // Speed cameras: [{ lng, lat }].
  setCameras(list) {
    this.data.cams = collection((list || []).map((c) => point(c.lng, c.lat)));
    this.map?.getSource('pintu-cams')?.setData(this.data.cams);
  }

  // States under an official warning (GeoJSON features), and where the route
  // goes into one ({ lng, lat, label } or null).
  setWarnings(features, storm) {
    this.data.warn = collection(features || []);
    this.map?.getSource('pintu-warn')?.setData(this.data.warn);
    if (this.stormPin) { this.stormPin.remove(); this.stormPin = null; }
    if (!storm || !this.map) return;
    const el = document.createElement('div');
    el.className = 'storm-pin';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', storm.label || '');
    el.innerHTML = UI.storm;
    this.stormPin = new this.lib.Marker({ element: el }).setLngLat([storm.lng, storm.lat]).addTo(this.map);
  }

  _push() {
    this.map?.getSource('pintu-active')?.setData(this.data.active);
    this.map?.getSource('pintu-far')?.setData(this.data.far);
    this.map?.getSource('pintu-alts')?.setData(this.data.alts);
  }

  setPuck(lng, lat, heading) {
    if (!this.map) return;
    if (!this.puck) {
      const el = document.createElement('div');
      el.className = 'puck';
      el.innerHTML = puckSvg;
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onPuckTap?.(); });
      this.puck = new this.lib.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat([lng, lat])
        .addTo(this.map);
      this._syncPuck();
    }
    // Each change redraws the marker, so the direction only when it changed.
    if (heading != null && heading !== this.puckHeading) {
      this.puckHeading = heading;
      this.puck.setRotation(heading);
    }
    this.puck.setLngLat([lng, lat]);
  }

  setDestination(place) {
    if (!this.map) return;
    if (this.dest) { this.dest.remove(); this.dest = null; }
    if (!place) return;
    const el = document.createElement('div');
    el.className = 'dest-pin';
    el.innerHTML = destPinSvg;
    this.dest = new this.lib.Marker({ element: el, anchor: 'bottom' }).setLngLat([place.lng, place.lat]).addTo(this.map);
  }

  // The places on offer while choosing a stop.
  // A starting point other than where you are.
  setStart(place) {
    if (!this.map) return;
    if (this.startPin) { this.startPin.remove(); this.startPin = null; }
    if (!place) return;
    const el = document.createElement('div');
    el.className = 'start-pin';
    this.startPin = new this.lib.Marker({ element: el }).setLngLat([place.lng, place.lat]).addTo(this.map);
  }

  setPins(places, onPick) {
    for (const m of this.pins) m.remove();
    this.pins = [];
    if (!this.map) return;
    for (const place of places) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'map-pin';
      el.setAttribute('aria-label', place.label);
      el.innerHTML = CATEGORY_ICONS[place.category] || '';
      el.addEventListener('click', (e) => { e.stopPropagation(); onPick(place); });
      this.pins.push(new this.lib.Marker({ element: el }).setLngLat([place.lng, place.lat]).addTo(this.map));
    }
  }

  // The stops already on the route.
  setStopPins(stops) {
    for (const m of this.stopPins) m.remove();
    this.stopPins = [];
    if (!this.map) return;
    for (const stop of stops) {
      const el = document.createElement('div');
      el.className = 'map-pin is-stop';
      el.innerHTML = CATEGORY_ICONS[stop.category] || CATEGORY_ICONS.rest;
      this.stopPins.push(new this.lib.Marker({ element: el }).setLngLat([stop.lng, stop.lat]).addTo(this.map));
    }
  }

  // Other people: someone whose trip you're following, or friends in a convoy.
  // A coloured dot with their initial, and their name under it.
  setFriends(list) {
    this.friends ||= new Map();
    if (!this.map) return;
    const keep = new Set();
    for (const f of list) {
      if (!f.pos) continue;
      keep.add(f.id);
      let m = this.friends.get(f.id);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'friend';
        const dot = document.createElement('span');
        dot.className = 'friend-dot';
        const name = document.createElement('span');
        name.className = 'friend-name';
        el.append(dot, name);
        m = { el, dot, name, marker: new this.lib.Marker({ element: el, anchor: 'top' }).setLngLat([f.pos.lng, f.pos.lat]).addTo(this.map) };
        this.friends.set(f.id, m);
      }
      m.dot.textContent = (f.name || '?').trim().charAt(0).toUpperCase() || '?';
      m.name.textContent = f.name || '';
      m.name.hidden = !f.name;
      m.el.style.setProperty('--friend', f.color || '#9C36B5');
      m.el.dataset.id = f.id;
      m.marker.setLngLat([f.pos.lng, f.pos.lat]);
    }
    for (const [id, m] of this.friends) {
      if (keep.has(id)) continue;
      m.marker.remove();
      this.friends.delete(id);
    }
  }

  // What people have reported on the road ahead.
  setReports(list, icons) {
    for (const m of this.reportPins || []) m.remove();
    this.reportPins = [];
    if (!this.map) return;
    for (const r of list) {
      const el = document.createElement('div');
      el.className = `map-pin is-report report-${r.kind}`;
      el.innerHTML = icons[r.kind] || '';
      this.reportPins.push(new this.lib.Marker({ element: el }).setLngLat([r.lng, r.lat]).addTo(this.map));
    }
  }

  // Flown to from wherever the map was, as when you search for a place, and
  // close enough to see it. `offset` puts it in the part the card leaves clear.
  flyToPlace(lng, lat, offset = [0, 0]) {
    this.map?.flyTo({
      center: [lng, lat],
      offset,
      zoom: this.view3d ? 17 : 16.5,
      pitch: this.view3d ? 55 : 0,
      speed: 1.6,
      maxDuration: 6000,
    });
  }

  centerOn(lng, lat, zoom = 15) {
    this.map?.easeTo({ center: [lng, lat], zoom: Math.max(zoom, this.view3d ? 16 : zoom), pitch: this.view3d ? 55 : 0, duration: 900 });
  }

  tilt(on, near) {
    if (!this.map) return;
    const options = { pitch: on ? 55 : 0, duration: 700 };
    if (on && near && this.map.getZoom() < 15.5) { options.center = near; options.zoom = 16; }
    this.map.easeTo(options);
  }

  fit(coordsList, padding) {
    if (!this.map) return;
    const all = coordsList.flat();
    if (!all.length) return;
    this.map.fitBounds(boundsOf(all), { padding, duration: 800, maxZoom: 16, pitch: 0, bearing: 0 });
  }

  // Called every frame while following, so it must not animate on its own.
  metresPerPixel(lat) {
    const z = this.map ? this.map.getZoom() : 16;
    return (40075016.7 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** z);
  }

  pose(lng, lat, bearing, zoom, pitch, padding) {
    this.map?.jumpTo({ center: [lng, lat], bearing: bearing ?? this.map.getBearing(), zoom, pitch, padding });
  }

  camera() {
    return this.map ? { zoom: this.map.getZoom(), pitch: this.map.getPitch() } : { zoom: 16, pitch: 0 };
  }

  // Straight down over a place, for picking a spot on the map.
  lookDownAt(lng, lat, zoom = 16) {
    this.map?.easeTo({ center: [lng, lat], zoom, pitch: 0, bearing: 0, duration: 500 });
  }

  // Straight down and square on, right now, ready to be pointed at something else.
  level() {
    this.map?.jumpTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
  }

  // The place under a point on the screen.
  placeAt(x, y) {
    const ll = this.map?.unproject([x, y]);
    return ll ? { lng: ll.lng, lat: ll.lat } : null;
  }

  flat() {
    this.map?.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 });
  }

  // Where the map itself gets its tiles, so other requests share the same files.
  tileUrl() {
    const tiles = this.map?.getSource('openmaptiles')?.tiles;
    return Array.isArray(tiles) ? tiles[0] : undefined;
  }

  resize() { this.map?.resize(); }
}
