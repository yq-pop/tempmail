// 背景着色器：等高线流场 + 光谱色散（Chromatic Dispersion）
// 响应鼠标位置与速度、页面滚动深度；不支持 WebGL 时回退到静态 CSS 背景。
import { add } from 'fx/ticker';
import { themeColors } from 'fx/kelvin';
import { reducedMotion } from 'core/util';

const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

const FRAG_BODY = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform float uVel; uniform float uScroll;
uniform vec3 uBg; uniform vec3 uInk; uniform vec3 uSig; uniform float uLight;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
}
float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++){ s += a * noise(p); p = p * 2.03 + vec2(17., 9.); a *= .5; } return s; }
float line(float x, float w){
  float fw = max(fwidth(x), 1e-4);
  float d = abs(fract(x - .5) - .5);
  return 1. - smoothstep(fw * w * .5, fw * w * 1.5, d);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = (uv - .5) * vec2(asp, 1.);
  float t = uTime;

  vec2 q = vec2(fbm(p * 1.6 + vec2(0., t * .04)), fbm(p * 1.6 + vec2(5.2, 1.3) - t * .03));
  float f = fbm(p * 1.6 + 2. * q + vec2(t * .02, -t * .015));

  vec2 m = (uMouse - uv) * vec2(asp, 1.);
  f += (.20 + .38 * uVel) * exp(-dot(m, m) * 10.);
  f += uScroll * .35;

  float x = f * 14.;
  vec2 g = vec2(dFdx(x), dFdy(x));
  vec2 dir = normalize(p - (uMouse - .5) * vec2(asp, 1.) + vec2(1e-4));
  float disp = 1.1 + uVel * 5.5;
  float shift = dot(g, dir) * disp;
  vec3 xs = vec3(x - shift, x, x + shift);

  vec3 L = vec3(line(xs.x, .95), line(xs.y, .95), line(xs.z, .95));
  vec3 M = vec3(line(xs.x / 5., 1.4), line(xs.y / 5., 1.4), line(xs.z / 5., 1.4));

  vec3 col = uBg;
  col = mix(col, uInk, L * (.06 + .035 * uLight));
  col = mix(col, uInk, M * (.125 + .05 * uLight));

  float level = 7. + uScroll * 9. + sin(t * .17) * 1.6;
  float datum = 1. - smoothstep(0., max(fwidth(x), 1e-4) * 1.2, abs(x - level));
  col = mix(col, uSig, datum * (.3 - .1 * uLight));

  float v = smoothstep(1.2, .2, length(uv - .5) * 1.25);
  col = mix(uBg, col, .12 + .88 * v);
  fragColor = vec4(col, 1.);
}`;

function hexToVec(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(log || 'shader compile failed');
  }
  return s;
}

export function initShader(canvas) {
  const html = document.documentElement;
  let gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
  const gl2 = !!gl;
  if (!gl) gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) { html.classList.add('no-gl'); return { ok: false, reason: 'no-webgl' }; }

  let prog;
  try {
    let fsrc;
    if (gl2) {
      fsrc = '#version 300 es\n' + FRAG_BODY.replace('uniform vec2 uRes;', 'out vec4 fragColor;\nuniform vec2 uRes;');
    } else {
      if (!gl.getExtension('OES_standard_derivatives')) throw new Error('no derivatives');
      fsrc = '#extension GL_OES_standard_derivatives : enable\n' + FRAG_BODY.replace('uniform vec2 uRes;', '#define fragColor gl_FragColor\nuniform vec2 uRes;');
    }
    // WebGL2 需要 ESSL 3.00 的顶点着色器写法
    const vsrc = gl2 ? '#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}' : VERT;
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vsrc));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fsrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) {
    console.warn('[shader]', e.message);
    html.classList.add('no-gl');
    return { ok: false, reason: String(e.message) };
  }

  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  ['uRes', 'uTime', 'uMouse', 'uVel', 'uScroll', 'uBg', 'uInk', 'uSig', 'uLight'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });

  let w = 1, h = 1;
  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.7;
    w = Math.max(2, Math.floor(innerWidth * scale));
    h = Math.max(2, Math.floor(innerHeight * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(U.uRes, w, h);
  }
  function theme() {
    const c = themeColors();
    const light = document.documentElement.getAttribute('data-kelvin') === '5600';
    gl.uniform3fv(U.uBg, hexToVec(c.bg));
    gl.uniform3fv(U.uInk, hexToVec(c.fg));
    gl.uniform3fv(U.uSig, hexToVec(c.signal));
    gl.uniform1f(U.uLight, light ? 1 : 0);
  }
  resize();
  theme();

  // 输入：鼠标位置与速度（平滑）
  let tx = .5, ty = .5, mx = .5, my = .5, vel = 0, scroll = 0, lastX = .5, lastY = .5;
  addEventListener('pointermove', (e) => {
    tx = e.clientX / innerWidth; ty = 1 - e.clientY / innerHeight;
  }, { passive: true });
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { resize(); draw(performance.now()); }, 120); });
  document.addEventListener('tm:kelvin', () => { theme(); draw(performance.now()); });

  let last = 0;
  const start = performance.now();
  function draw(now) {
    const dx = tx - lastX, dy = ty - lastY;
    lastX = tx; lastY = ty;
    mx += (tx - mx) * .07; my += (ty - my) * .07;
    vel += (Math.min(1, Math.hypot(dx, dy) * 22) - vel) * .08;
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    scroll += ((window.scrollY / max) - scroll) * .05;
    gl.uniform1f(U.uTime, reducedMotion ? 12 : (now - start) / 1000 + 12);
    gl.uniform2f(U.uMouse, mx, my);
    gl.uniform1f(U.uVel, vel);
    gl.uniform1f(U.uScroll, scroll);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  draw(performance.now()); // 立即绘制首帧（后台标签页里 rAF 可能被节流）
  if (!reducedMotion) {
    add((now) => {
      if (document.hidden) return;
      if (now - last < 32) return; // ~30fps，背景无需更高帧率
      last = now;
      draw(now);
    });
  }
  return { ok: true, gl2 };
}
