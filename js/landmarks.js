// Famous statues standing in the 3D map where the map's own data stops at the
// pedestal. Each is drawn in place, life size, facing the way the real one does,
// and rises with the buildings as you zoom in.
import { MESH_VS, MESH_FS, LOOKS, compile, multiply, headingMatrix, normalize3 } from './car-gl.js';
import { FLOATS_PER_VERTEX } from './car-mesh.js';
import { buildLandmark } from './landmark-mesh.js';

// `at` is the middle of where it stands; `base` how high that is above the
// ground, in metres (the top of the pedestal in the map's buildings); `facing`
// degrees from north, clockwise, square to the pedestal's sides.
export const LANDMARKS = [
  // On the top of the pedestal, 47 m up; the pedestal's sides run 57° and 147°,
  // and she faces out over the harbour to the south-east.
  { id: 'liberty', name: 'Statue of Liberty', at: [-74.04456, 40.689257], base: 47, facing: 147, model: 'liberty' },
  // Beside the foot of the 272 steps, which climb towards 31°; he faces away
  // from the caves, over the square.
  { id: 'murugan', name: 'Lord Murugan Statue', at: [101.683981, 3.237478], base: 0, facing: 211, model: 'murugan' },
];

// By night they're lit from below, as the real ones are, so they still stand out.
const FLOODLIT = { sun: [0.25, -0.5, 0.6], sky: [0.2, 0.23, 0.3], ground: [0.42, 0.36, 0.27], sunColor: [0.62, 0.58, 0.5] };

// The map's buildings grow from flat at zoom 14 to full height at 15.5; these do too.
export const RISE_FROM = 14;
export const RISE_TO = 15.5;
export const riseAt = (zoom) => Math.min(1, Math.max(0, (zoom - RISE_FROM) / (RISE_TO - RISE_FROM)));

// On the map as shown, or close enough to its edge to stand into view.
// `box` is [west, south, east, north].
export function inView(landmark, [w, s, e, n], margin = 0.006) {
  const [lng, lat] = landmark.at;
  return lng >= w - margin && lng <= e + margin && lat >= s - margin && lat <= n + margin;
}

// From the model's metres to the map's own units. Mercator's y runs south, so
// the north part of each direction changes sign. Heights are squashed by `rise`
// with the buildings, the base included.
export function modelMatrix(at, metre, facing, base, rise = 1) {
  const r = headingMatrix(facing);
  const z = metre * rise;
  return new Float32Array([
    metre * r[0], -metre * r[1], 0, 0,
    metre * r[3], -metre * r[4], 0, 0,
    0, 0, z, 0,
    at.x, at.y, base * z, 1,
  ]);
}

// The layer that draws them. `source.shown()` says whether 3D buildings are on;
// `source.theme()` is 'day' or 'night'. Models are made the first time they're needed.
export function landmarkLayer(lib, source) {
  return {
    id: 'pintu-landmarks',
    type: 'custom',
    renderingMode: '3d',
    source,
    onAdd(map, gl) {
      this.map = map;
      this.meshes = new Map();
      try {
        this.program = compile(gl, MESH_VS, MESH_FS);
        this.u = {};
        for (const n of ['u_mvp', 'u_rot', 'u_sun', 'u_view', 'u_sky', 'u_ground', 'u_sunColor']) this.u[n] = gl.getUniformLocation(this.program, n);
      } catch (err) {
        console.warn('3D landmarks unavailable', err);
        this.program = null;
      }
    },
    onRemove(map, gl) {
      if (!gl) return;
      for (const m of this.meshes?.values() || []) {
        if (!m) continue;
        gl.deleteBuffer(m.buffer);
        gl.deleteVertexArray(m.vao);
      }
      if (this.program) gl.deleteProgram(this.program);
      this.meshes = new Map();
      this.program = null;
    },
    mesh(gl, kind) {
      if (this.meshes.has(kind)) return this.meshes.get(kind);
      const built = buildLandmark(kind);
      let m = null;
      if (built) {
        const vao = gl.createVertexArray();
        const buffer = gl.createBuffer();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, built.data, gl.STATIC_DRAW);
        const stride = FLOATS_PER_VERTEX * 4;
        for (const [name, size, offset] of [['a_pos', 3, 0], ['a_nor', 3, 3], ['a_col', 3, 6], ['a_mat', 2, 9]]) {
          const loc = gl.getAttribLocation(this.program, name);
          if (loc < 0) continue;
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
        }
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        m = { vao, buffer, count: built.data.length / FLOATS_PER_VERTEX };
      }
      this.meshes.set(kind, m);
      return m;
    },
    render(gl, args) {
      if (!this.program || !source.shown()) return;
      const map = this.map;
      const rise = riseAt(map.getZoom());
      if (!(rise > 0)) return;
      const b = map.getBounds();
      const box = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      const here = LANDMARKS.filter((lm) => inView(lm, box));
      if (!here.length) return;

      const look = source.theme?.() === 'night' ? FLOODLIT : LOOKS.day;
      const bearing = (map.getBearing() * Math.PI) / 180;
      const pitch = (map.getPitch() * Math.PI) / 180;
      const view = [-Math.sin(bearing) * Math.sin(pitch), -Math.cos(bearing) * Math.sin(pitch), Math.cos(pitch)];
      // In among the buildings: hidden behind what's in front, standing on its pedestal.
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.disable(gl.STENCIL_TEST);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.useProgram(this.program);
      gl.uniform3fv(this.u.u_sun, normalize3(look.sun));
      gl.uniform3fv(this.u.u_view, normalize3(view));
      gl.uniform3fv(this.u.u_sky, look.sky);
      gl.uniform3fv(this.u.u_ground, look.ground);
      gl.uniform3fv(this.u.u_sunColor, look.sunColor);
      for (const lm of here) {
        const m = this.mesh(gl, lm.model);
        if (!m) continue;
        const at = lib.MercatorCoordinate.fromLngLat(lm.at, 0);
        const model = modelMatrix(at, at.meterInMercatorCoordinateUnits(), lm.facing, lm.base, rise);
        gl.uniformMatrix4fv(this.u.u_mvp, false, multiply(args.defaultProjectionData.mainMatrix, model));
        gl.uniformMatrix3fv(this.u.u_rot, false, headingMatrix(lm.facing));
        gl.bindVertexArray(m.vao);
        gl.drawArrays(gl.TRIANGLES, 0, m.count);
      }
      gl.bindVertexArray(null);
    },
  };
}
