import { CONFIG } from './config.js';
import { carLayer } from './car-gl.js';
import { boundsOf } from './geo.js';
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
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const placeName = (p = {}) => p.name || p['name:latin'] || p.name_en || p['name:en'] || '';

export class MapView {
  constructor(el, { theme, view3d, onLongPress, onUserMove, onAltTap, onPlaceTap, onPuckTap }) {
    this.el = el;
    this.theme = theme;
    this.view3d = view3d;
    this.onLongPress = onLongPress;
    this.onUserMove = onUserMove;
    this.onAltTap = onAltTap;
    this.onPlaceTap = onPlaceTap;
    this.onPuckTap = onPuckTap;
    this.carPin = null;
    this.carKey = '';
    this.map = null;
    this.data = { active: EMPTY, alts: EMPTY, lanes: EMPTY };
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
      attributionControl: { compact: true },
      fadeDuration: 120,
      maxPitch: 70,
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
    if (hits.some((h) => h.layer?.id === 'pintu-alt-hit')) return;
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
        layout: { visibility: this.view3d ? 'visible' : 'none' },
        paint: {
          'fill-extrusion-color': c.building,
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, ['get', 'render_height']],
          'fill-extrusion-base': ['step', ['zoom'], 0, 15.5, ['get', 'render_min_height']],
          'fill-extrusion-opacity': 0.9,
        },
      }, beforeId);
    }

    if (!m.getSource('pintu-alts')) m.addSource('pintu-alts', { type: 'geojson', data: this.data.alts });
    if (!m.getSource('pintu-active')) m.addSource('pintu-active', { type: 'geojson', data: this.data.active });
    const layout = { 'line-cap': 'round', 'line-join': 'round' };
    // Wider up close, so the line stays easy to see when the map is tilted.
    const width = (a, b) => ['interpolate', ['linear'], ['zoom'], 8, a, 16, b, 18, b * 1.7];
    const add = (id, source, paint) => {
      if (!m.getLayer(id)) m.addLayer({ id, type: 'line', source, layout, paint }, beforeId);
    };
    add('pintu-alt-casing', 'pintu-alts', { 'line-color': c.altCasing, 'line-width': width(6, 13) });
    add('pintu-alt', 'pintu-alts', { 'line-color': c.alt, 'line-width': width(3.5, 9) });
    add('pintu-alt-hit', 'pintu-alts', { 'line-color': '#000', 'line-opacity': 0, 'line-width': 28 });
    add('pintu-glow', 'pintu-active', { 'line-color': c.glow, 'line-opacity': 0.4, 'line-blur': 7, 'line-width': width(12, 28) });
    add('pintu-casing', 'pintu-active', { 'line-color': c.casing, 'line-width': width(8, 16) });
    add('pintu-route', 'pintu-active', { 'line-color': c.route, 'line-width': width(5, 11) });
    this._addLaneLayers(beforeId, c);

    // The car goes on top of everything.
    if (!m.getLayer('pintu-car')) {
      m.addLayer(carLayer(this.lib, {
        pose: () => (this.carOn ? this.carPose : null),
        onReady: (ok) => { this.carReady = ok; this._syncPuck(); },
      }));
    }
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

  setLanes(featureCollection) {
    this.data.lanes = featureCollection;
    this.map?.getSource('pintu-lanes')?.setData(featureCollection);
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
    if (this.map?.getLayer('pintu-3d')) this.map.setLayoutProperty('pintu-3d', 'visibility', on ? 'visible' : 'none');
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

  setRemaining(coords) {
    this.data.active = collection(coords.length > 1 ? [line(coords)] : []);
    this.map?.getSource('pintu-active')?.setData(this.data.active);
  }

  clearRoutes() {
    this._stopReveal();
    this.data.active = EMPTY;
    this.data.alts = EMPTY;
    this._push();
  }

  _push() {
    this.map?.getSource('pintu-active')?.setData(this.data.active);
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
    this.puck.setLngLat([lng, lat]);
    if (heading != null) this.puck.setRotation(heading);
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
