import { CONFIG } from './config.js';
import { boundsOf } from './geo.js';
import { destPinSvg, puckSvg } from './icons.js';

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
  day: { route: '#0B4DA2', casing: '#FFFFFF', alt: '#7E8F99', altCasing: '#FFFFFF' },
  night: { route: '#6FAEFF', casing: '#0B2140', alt: '#7C8A91', altCasing: '#1A2124' },
};

const EMPTY = { type: 'FeatureCollection', features: [] };
const line = (coords, properties = {}) => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: coords } });

export class MapView {
  constructor(el, { theme, onLongPress, onUserMove, onAltTap }) {
    this.el = el;
    this.theme = theme;
    this.onLongPress = onLongPress;
    this.onUserMove = onUserMove;
    this.onAltTap = onAltTap;
    this.map = null;
    this.data = { active: EMPTY, alts: EMPTY };
    this.puck = null;
    this.dest = null;
    this.pressTimer = null;
    this.pendingFit = null;
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
      maxPitch: 65,
    });
    this.map.on('style.load', () => { this._addLayers(); });
    this.map.on('dragstart', () => this.onUserMove?.());
    this.map.on('rotatestart', (e) => { if (e.originalEvent) this.onUserMove?.(); });
    this.map.on('pitchstart', (e) => { if (e.originalEvent) this.onUserMove?.(); });
    this.map.on('zoomstart', (e) => { if (e.originalEvent) this.onUserMove?.(); });
    this._wireLongPress();
    this.map.on('click', 'pintu-alt-hit', (e) => {
      const f = e.features && e.features[0];
      if (f) this.onAltTap?.(f.properties.index);
    });
  }

  setTheme(theme) {
    if (theme === this.theme) return;
    this.theme = theme;
    // diff: false forces a full reload, which is what fires 'style.load' and
    // lets the route layers go back on top of the new style.
    this.map?.setStyle(CONFIG.mapStyles[theme], { diff: false });
  }

  _addLayers() {
    const m = this.map;
    const c = COLORS[this.theme];
    const beforeId = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    if (!m.getSource('pintu-alts')) m.addSource('pintu-alts', { type: 'geojson', data: this.data.alts });
    if (!m.getSource('pintu-active')) m.addSource('pintu-active', { type: 'geojson', data: this.data.active });
    const lineLayout = { 'line-cap': 'round', 'line-join': 'round' };
    const width = (a, b, d) => ({ 'line-color': a, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, b, 16, d] });
    const add = (id, source, paint) => {
      if (!m.getLayer(id)) m.addLayer({ id, type: 'line', source, layout: lineLayout, paint }, beforeId);
    };
    add('pintu-alt-casing', 'pintu-alts', width(c.altCasing, 6, 13));
    add('pintu-alt', 'pintu-alts', width(c.alt, 3.5, 9));
    add('pintu-alt-hit', 'pintu-alts', { 'line-color': '#000', 'line-opacity': 0, 'line-width': 28 });
    add('pintu-casing', 'pintu-active', width(c.casing, 8, 16));
    add('pintu-route', 'pintu-active', width(c.route, 5, 11));
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
    this.data.active = { type: 'FeatureCollection', features: routes[selected] ? [line(routes[selected].coords)] : [] };
    this.data.alts = {
      type: 'FeatureCollection',
      features: routes.map((r, index) => (index === selected ? null : line(r.coords, { index }))).filter(Boolean),
    };
    this._push();
  }

  setRemaining(coords) {
    this.data.active = { type: 'FeatureCollection', features: coords.length > 1 ? [line(coords)] : [] };
    this.map?.getSource('pintu-active')?.setData(this.data.active);
  }

  clearRoutes() {
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
      this.puck = new this.lib.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat([lng, lat])
        .addTo(this.map);
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

  centerOn(lng, lat, zoom = 15) {
    this.map?.easeTo({ center: [lng, lat], zoom, duration: 800 });
  }

  fit(coordsList, padding) {
    if (!this.map) return;
    const all = coordsList.flat();
    if (!all.length) return;
    this.map.fitBounds(boundsOf(all), { padding, duration: 700, maxZoom: 16, pitch: 0, bearing: 0 });
  }

  follow(lng, lat, bearing, zoom, padding) {
    this.map?.easeTo({
      center: [lng, lat],
      bearing: bearing ?? this.map.getBearing(),
      pitch: 52,
      zoom,
      padding,
      duration: 900,
      easing: (t) => t,
      essential: true,
    });
  }

  flat() {
    this.map?.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 });
  }

  resize() { this.map?.resize(); }
}
