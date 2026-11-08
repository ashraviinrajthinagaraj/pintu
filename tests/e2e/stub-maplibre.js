// A stand-in for MapLibre used only in tests, because the real library and map
// tiles can't be downloaded where these tests run. It implements the handful of
// calls Pintu makes, records them, and paints a plain street grid plus the route
// so screenshots show how the interface sits over a map.
(() => {
  const calls = [];
  window.__mapCalls = calls;
  class LngLat { constructor(lng, lat) { this.lng = lng; this.lat = lat; } }
  const toXY = (c, cam, w, h) => {
    const scale = (256 * 2 ** cam.zoom) / 360;
    const k = Math.cos((cam.center[1] * Math.PI) / 180);
    const pad = cam.padding || {};
    let x = (c[0] - cam.center[0]) * scale * 1;
    let y = -(c[1] - cam.center[1]) * scale * (1 / k) * k;
    const b = (cam.bearing * Math.PI) / 180;
    [x, y] = [x * Math.cos(b) + y * Math.sin(b), -x * Math.sin(b) + y * Math.cos(b)];
    return [w / 2 + x + ((pad.left || 0) - (pad.right || 0)) / 2, h / 2 + y + ((pad.top || 0) - (pad.bottom || 0)) / 2];
  };

  class Map {
    constructor(opts) {
      this.opts = opts;
      this.container = opts.container;
      this.cam = { center: opts.center, zoom: opts.zoom, bearing: 0, pitch: 0, padding: {} };
      this.handlers = {};
      this.jumpCount = 0;
      this.layout = {};
      this.pixelRatio = opts.pixelRatio;
      this.sources = { openmaptiles: {} };
      this.layers = [];
      this.styleUrl = opts.style;
      this.markers = [];
      this.canvas = document.createElement('canvas');
      this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
      this.container.append(this.canvas);
      const attr = document.createElement('div');
      attr.className = 'maplibregl-ctrl-bottom-right';
      attr.style.cssText = 'position:absolute;right:4px;font:11px Arial;background:rgba(255,255,255,.75);color:#222;padding:1px 5px;border-radius:3px;z-index:1';
      attr.textContent = 'ⓘ OpenFreeMap © OpenStreetMap';
      this.container.append(attr);
      window.__map = this;
      this.ready = false;
      setTimeout(() => { this.ready = true; this._fire('style.load', {}); this._fire('load', {}); this.draw(); }, 10);
      addEventListener('resize', () => this.draw());
    }
    on(ev, a, b) { const fn = b || a; (this.handlers[ev] ||= []).push(fn); return this; }
    _fire(ev, e) { for (const fn of this.handlers[ev] || []) fn(e); }
    getStyle() { return { layers: [{ id: 'bg', type: 'background' }, { id: 'early-label', type: 'symbol' }, { id: 'road', type: 'line', 'source-layer': 'transportation' }, { id: 'labels', type: 'symbol' }] }; }
    getLayer(id) { return this.layers.find((l) => l.id === id); }
    setLayoutProperty(id, key, value) { calls.push(['setLayoutProperty', id, key, value]); this.layout[id] = value; }
    jumpTo(o) { this.jumpCount++; this.lastJump = o; Object.assign(this.cam, o); this.draw(); }
    triggerRepaint() {}
    setPixelRatio(r) { calls.push(['setPixelRatio', r]); this.pixelRatio = r; }
    getZoom() { return this.cam.zoom; }
    getPitch() { return this.cam.pitch; }
    setStyle(url, o) { calls.push(['setStyle', url, o]); this.styleUrl = url; this.sources = { openmaptiles: {} }; this.layers = []; setTimeout(() => { this._fire('style.load', {}); this.draw(); }, 5); }
    addSource(id, s) { if (this.sources[id]) throw new Error(`source ${id} exists`); this.sources[id] = { ...s, setData: (d) => { this.sources[id].data = d; this.draw(); } }; }
    getSource(id) { return this.sources[id]; }
    addImage(id, img) { (this.images ||= {})[id] = img; }
    hasImage(id) { return !!this.images?.[id]; }
    setFilter(id, f) { calls.push(['setFilter', id, f]); (this.filters ||= {})[id] = f; }
    addLayer(l, before) {
      if (this.layers.find((x) => x.id === l.id)) throw new Error(`layer ${l.id} exists`);
      if (l.type === 'custom') { this.layers.push(l); l.source.onReady?.(true); return; }
      if (!this.sources[l.source]) throw new Error(`no source ${l.source}`);
      if (before !== 'labels') throw new Error(`layer before ${before}`);
      this.layers.push(l);
    }
    easeTo(o) { calls.push(['easeTo', o]); Object.assign(this.cam, { ...o, center: o.center || this.cam.center }); this.draw(); }
    fitBounds(b, o) {
      calls.push(['fitBounds', b, o]);
      const [[w, s], [e, n]] = b;
      const W = innerWidth - (o.padding.left + o.padding.right), H = innerHeight - (o.padding.top + o.padding.bottom);
      const span = Math.max((e - w) / W, (n - s) / H, 1e-6);
      this.cam = { center: [(w + e) / 2, (s + n) / 2], zoom: Math.log2(360 / (256 * span)), bearing: 0, pitch: 0, padding: o.padding };
      this.draw();
    }
    getBearing() { return this.cam.bearing; }
    getCenter() { return new LngLat(this.cam.center[0], this.cam.center[1]); }
    project(ll) { const c = Array.isArray(ll) ? ll : [ll.lng, ll.lat]; const [x, y] = toXY(c, this.cam, innerWidth, innerHeight); return { x, y }; }
    // What a test says is under the finger.
    queryRenderedFeatures(box) { calls.push(['queryRenderedFeatures', box]); return window.__mapFeatures || []; }
    unproject([x, y]) {
      const scale = (256 * 2 ** this.cam.zoom) / 360;
      const pad = this.cam.padding || {};
      const dx = x - innerWidth / 2 - ((pad.left || 0) - (pad.right || 0)) / 2;
      const dy = y - innerHeight / 2 - ((pad.top || 0) - (pad.bottom || 0)) / 2;
      return new LngLat(this.cam.center[0] + dx / scale, this.cam.center[1] - dy / scale);
    }
    resize() { this.draw(); }
    draw() {
      const c = this.canvas, dpr = devicePixelRatio || 1;
      const w = innerWidth, h = innerHeight;
      c.width = w * dpr; c.height = h * dpr;
      const g = c.getContext('2d');
      g.scale(dpr, dpr);
      const night = /dark/.test(this.styleUrl);
      g.fillStyle = night ? '#1C2326' : '#F1EEE6';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = night ? '#343E43' : '#FFFFFF';
      g.lineWidth = 6;
      const step = 84;
      const ox = ((this.cam.center[0] * 40000) % step + step) % step;
      const oy = ((this.cam.center[1] * 40000) % step + step) % step;
      for (let x = -ox; x < w + step; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = oy; y < h + step; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      for (const l of this.layers) {
        const src = this.sources[l.source];
        if (l.type !== 'line' || l.id.startsWith('pintu-lane') || !src || !src.data || l.paint['line-opacity'] === 0 || l.paint['line-blur']) continue;
        g.strokeStyle = l.paint['line-color'];
        const lw = l.paint['line-width'];
        g.lineWidth = Array.isArray(lw) ? lw[lw.length - 1] : lw;
        g.lineCap = 'round'; g.lineJoin = 'round';
        for (const f of src.data.features) {
          g.beginPath();
          f.geometry.coordinates.forEach((pt, i) => {
            const [x, y] = toXY(pt, this.cam, w, h);
            if (i) g.lineTo(x, y); else g.moveTo(x, y);
          });
          g.stroke();
        }
      }
      for (const m of this.markers) m.place();
    }
  }

  class Marker {
    constructor(o = {}) { this.el = o.element; this.opts = o; this.rot = 0; }
    setLngLat(ll) { this.ll = ll; this.place(); return this; }
    getLngLat() { return Array.isArray(this.ll) ? new LngLat(this.ll[0], this.ll[1]) : this.ll; }
    setRotation(r) { this.rot = r; this.place(); return this; }
    getElement() { return this.el; }
    addTo(map) { this.map = map; map.markers.push(this); this.el.style.position = 'absolute'; map.container.append(this.el); this.place(); return this; }
    remove() { this.el.remove(); if (this.map) this.map.markers = this.map.markers.filter((x) => x !== this); return this; }
    place() {
      if (!this.map || !this.ll) return;
      const [x, y] = toXY(this.ll, this.map.cam, innerWidth, innerHeight);
      const r = this.el.getBoundingClientRect();
      const oy = this.opts.anchor === 'bottom' ? r.height || 48 : (r.height || 44) / 2;
      this.el.style.left = `${x - (r.width || 44) / 2}px`;
      this.el.style.top = `${y - oy}px`;
      if (this.opts.rotationAlignment === 'map') this.el.style.transform = `rotate(${this.rot - this.map.cam.bearing}deg)`;
    }
  }

  window.maplibregl = { Map, Marker, LngLat };
})();
