// Draws a vehicle with WebGL: on the map through a custom MapLibre layer, and on
// its own in the vehicle panel's turning preview.
import { FLOATS_PER_VERTEX, buildVehicle } from './car-mesh.js';

const VS = `#version 300 es
in vec3 a_pos;
in vec3 a_nor;
in vec3 a_col;
in vec2 a_mat;
uniform mat4 u_mvp;
uniform mat3 u_rot;
out vec3 v_nor;
out vec3 v_col;
out vec2 v_mat;
void main() {
  v_nor = u_rot * a_nor;
  v_col = a_col;
  v_mat = a_mat;
  gl_Position = u_mvp * vec4(a_pos, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
in vec3 v_nor;
in vec3 v_col;
in vec2 v_mat;
uniform vec3 u_sun;
uniform vec3 u_view;
uniform vec3 u_sky;
uniform vec3 u_ground;
uniform vec3 u_sunColor;
out vec4 color;
void main() {
  vec3 n = normalize(v_nor);
  float diffuse = max(dot(n, u_sun), 0.0);
  vec3 ambient = mix(u_ground, u_sky, n.z * 0.5 + 0.5);
  vec3 c = v_col * (ambient + u_sunColor * diffuse);
  vec3 h = normalize(u_sun + u_view);
  float gloss = v_mat.y;
  float spec = pow(max(dot(n, h), 0.0), 60.0) * gloss;
  float rim = pow(1.0 - max(dot(n, u_view), 0.0), 3.5) * gloss;
  c += u_sunColor * spec * 0.8 + u_sky * rim * 0.3;
  c = mix(c, v_col * 1.5, v_mat.x);
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  color = vec4(c, 1.0);
}`;

const SHADOW_VS = `#version 300 es
in vec2 a_uv;
uniform mat4 u_mvp;
uniform vec2 u_size;
uniform vec2 u_mid;
uniform float u_lift;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = u_mvp * vec4(u_mid + a_uv * u_size, u_lift, 1.0);
}`;

const SHADOW_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform vec4 u_color;
uniform float u_beam;
out vec4 color;
void main() {
  if (u_beam > 0.5) {
    // Headlights on the road ahead: strongest near the car, fading with distance.
    float y = v_uv.y * 0.5 + 0.5;
    float spread = abs(v_uv.x) / (0.25 + y * 0.75);
    float a = (1.0 - y) * (1.0 - y) * smoothstep(1.0, 0.25, spread);
    color = vec4(u_color.rgb * a * u_color.a, a * u_color.a * 0.2);
    return;
  }
  float r = length(v_uv);
  float a = smoothstep(1.0, 0.45, r) * u_color.a;
  color = vec4(u_color.rgb * a, a);
}`;

function compile(gl, vs, fs) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

export function multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[r + 4] * b[c * 4 + 1] + a[r + 8] * b[c * 4 + 2] + a[r + 12] * b[c * 4 + 3];
    }
  }
  return o;
}

const LOOKS = {
  day: { sun: [0.45, -0.35, 0.82], sky: [0.46, 0.5, 0.56], ground: [0.2, 0.2, 0.2], sunColor: [0.85, 0.82, 0.76], shadow: 0.38 },
  night: { sun: [0.3, -0.45, 0.84], sky: [0.2, 0.25, 0.34], ground: [0.09, 0.1, 0.12], sunColor: [0.5, 0.55, 0.68], shadow: 0.55 },
};

export class CarRenderer {
  constructor(gl) {
    this.gl = gl;
    this.program = compile(gl, VS, FS);
    this.shadowProgram = compile(gl, SHADOW_VS, SHADOW_FS);
    this.u = {};
    for (const n of ['u_mvp', 'u_rot', 'u_sun', 'u_view', 'u_sky', 'u_ground', 'u_sunColor']) this.u[n] = gl.getUniformLocation(this.program, n);
    this.su = {};
    for (const n of ['u_mvp', 'u_size', 'u_mid', 'u_lift', 'u_color', 'u_beam']) this.su[n] = gl.getUniformLocation(this.shadowProgram, n);

    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const stride = FLOATS_PER_VERTEX * 4;
    const attr = (name, size, offset) => {
      const loc = gl.getAttribLocation(this.program, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
    };
    attr('a_pos', 3, 0);
    attr('a_nor', 3, 3);
    attr('a_col', 3, 6);
    attr('a_mat', 2, 9);

    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    const uv = gl.getAttribLocation(this.shadowProgram, 'a_uv');
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.count = 0;
    this.look = null;
    this.size = null;
  }

  setLook(body, color) {
    const key = `${body}:${color}`;
    if (key === this.look) return;
    this.look = key;
    const { data, length, width } = buildVehicle(body, color);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.count = data.length / FLOATS_PER_VERTEX;
    this.size = { length, width };
  }

  // mvp takes model metres to the screen. rot takes model directions to
  // east/north/up, and view points from the car towards the camera in that space.
  draw(mvp, rot, view, theme, { headlights = false } = {}) {
    if (!this.count) return;
    const gl = this.gl;
    const look = LOOKS[theme] || LOOKS.day;
    const { length, width } = this.size;

    gl.disable(gl.CULL_FACE);
    gl.disable(gl.STENCIL_TEST);

    // A soft shadow under the car, and its lamps on the road at night.
    gl.useProgram(this.shadowProgram);
    gl.bindVertexArray(this.quadVao);
    gl.uniformMatrix4fv(this.su.u_mvp, false, mvp);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.uniform1f(this.su.u_lift, 0.02);
    gl.uniform1f(this.su.u_beam, 0);
    gl.uniform2f(this.su.u_mid, 0, length / 2);
    gl.uniform2f(this.su.u_size, width * 0.82, length * 0.62);
    gl.uniform4f(this.su.u_color, 0, 0, 0, look.shadow);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (headlights) {
      const reach = length * 2.6;
      gl.uniform1f(this.su.u_beam, 1);
      gl.uniform2f(this.su.u_mid, 0, length + reach * 0.5);
      gl.uniform2f(this.su.u_size, width * 1.5, reach * 0.5);
      gl.uniform4f(this.su.u_color, 1, 0.94, 0.75, 0.75);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // The car, sorted against itself but never hidden behind a building.
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.u.u_mvp, false, mvp);
    gl.uniformMatrix3fv(this.u.u_rot, false, rot);
    gl.uniform3fv(this.u.u_sun, normalize3(look.sun));
    gl.uniform3fv(this.u.u_view, normalize3(view));
    gl.uniform3fv(this.u.u_sky, look.sky);
    gl.uniform3fv(this.u.u_ground, look.ground);
    gl.uniform3fv(this.u.u_sunColor, look.sunColor);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.buffer);
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.quadVao);
    gl.deleteProgram(this.program);
    gl.deleteProgram(this.shadowProgram);
  }
}

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Heading is degrees clockwise from north. Local x is the car's right, y its front.
export function headingMatrix(heading) {
  const r = (heading * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return new Float32Array([c, -s, 0, s, c, 0, 0, 0, 1]);
}

export function carLayer(lib, source) {
  return {
    id: 'pintu-car',
    type: 'custom',
    renderingMode: '3d',
    source,
    onAdd(map, gl) {
      this.map = map;
      try {
        this.renderer = new CarRenderer(gl);
        source.onReady?.(true);
      } catch (err) {
        console.warn('3D car unavailable', err);
        this.renderer = null;
        source.onReady?.(false);
      }
    },
    onRemove() {
      this.renderer?.dispose();
      this.renderer = null;
    },
    render(gl, args) {
      const pose = source.pose();
      if (!pose || !this.renderer) return;
      this.renderer.setLook(pose.body, pose.color);
      const map = this.map;
      const zoom = map.getZoom();
      const worldSize = 512 * 2 ** zoom;
      const { length } = this.renderer.size;
      const unit = (pose.lengthPx / worldSize) / length;
      const at = lib.MercatorCoordinate.fromLngLat([pose.lng, pose.lat], 0);
      const rot = headingMatrix(pose.heading ?? 0);
      // The car's middle sits on the spot. Mercator's y runs south, so the
      // north-facing parts of each direction change sign here.
      const shift = length / 2;
      const rightE = rot[0], rightN = rot[1], frontE = rot[3], frontN = rot[4];
      const model = new Float32Array([
        unit * rightE, -unit * rightN, 0, 0,
        unit * frontE, -unit * frontN, 0, 0,
        0, 0, unit, 0,
        at.x - unit * frontE * shift, at.y + unit * frontN * shift, 0, 1,
      ]);
      const mvp = multiply(args.defaultProjectionData.mainMatrix, model);
      const b = (map.getBearing() * Math.PI) / 180;
      const p = (map.getPitch() * Math.PI) / 180;
      const view = [-Math.sin(b) * Math.sin(p), -Math.cos(b) * Math.sin(p), Math.cos(p)];
      this.renderer.draw(mvp, rot, view, pose.theme, { headlights: pose.theme === 'night' });
    },
  };
}

// A vehicle turning slowly on its own, for choosing one.
export class CarPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
    this.renderer = this.gl ? new CarRenderer(this.gl) : null;
    this.raf = null;
    this.angle = 215;
  }

  get ok() { return !!this.renderer; }

  setLook(body, color) { this.renderer?.setLook(body, color); this.draw(); }

  start() {
    if (!this.renderer || this.raf) return;
    let last = performance.now();
    const tick = (now) => {
      this.angle = (this.angle + ((now - last) / 1000) * 22) % 360;
      last = now;
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  draw() {
    const { gl, canvas, renderer } = this;
    if (!renderer || !renderer.size) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const { length } = renderer.size;
    const a = (this.angle * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    // Spin about the car's middle, seen from a little above.
    const model = new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, (s * length) / 2, (-c * length) / 2, 0, 1]);
    // Stand back far enough for the whole thing, a motorcycle's height included.
    const fit = Math.max(length / 4.4, 0.72);
    const pitch = (66 * Math.PI) / 180;
    const eye = [0, -Math.sin(pitch) * 10 * fit, Math.cos(pitch) * 10 * fit + 0.6];
    const view = lookAt(eye, [0, 0, 0.6]);
    const proj = perspective((28 * Math.PI) / 180, w / h, 0.5, 60);
    const mvp = multiply(proj, multiply(view, model));
    const rot = new Float32Array([c, s, 0, -s, c, 0, 0, 0, 1]);
    const toCamera = [eye[0], eye[1], eye[2]];
    renderer.draw(mvp, rot, toCamera, 'day', {});
  }
}

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
}

function lookAt(eye, at) {
  const z = normalize3([eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]]);
  const up = [0, 0, 1];
  const xx = normalize3([up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]);
  const y = [z[1] * xx[2] - z[2] * xx[1], z[2] * xx[0] - z[0] * xx[2], z[0] * xx[1] - z[1] * xx[0]];
  return new Float32Array([
    xx[0], y[0], z[0], 0,
    xx[1], y[1], z[1], 0,
    xx[2], y[2], z[2], 0,
    -(xx[0] * eye[0] + xx[1] * eye[1] + xx[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ]);
}
