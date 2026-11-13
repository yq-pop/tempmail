// 可拨动的弹簧弦分割线：阻尼波动方程模拟，鼠标划过即可拨动
import { add } from 'fx/ticker';
import { themeColors } from 'fx/kelvin';
import { $$, clamp, reducedMotion, coarsePointer } from 'core/util';

const strings = new Set();
let loopOn = false;

class StringLine {
  constructor(host) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.colors = themeColors();
    this.visible = true;
    this.lastPy = null;
    this.energy = 0;
    this.pointerIn = false;
    this.resize();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host);
    this.io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (e.isIntersecting) this.draw(); }); this.io.observe(host);
    this.onTheme = () => { this.colors = themeColors(); this.draw(); };
    document.addEventListener('tm:kelvin', this.onTheme);
    if (!coarsePointer) {
      host.addEventListener('pointermove', (e) => this.pluck(e));
      host.addEventListener('pointerleave', () => { this.lastPy = null; this.pointerIn = false; });
    } else {
      host.addEventListener('pointerdown', (e) => this.pluck(e, true));
    }
  }
  resize() {
    const r = this.host.getBoundingClientRect();
    this.w = Math.max(20, r.width); this.h = Math.max(20, r.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.n = Math.max(12, Math.round(this.w / 9));
    this.y = new Float32Array(this.n);
    this.v = new Float32Array(this.n);
    this.draw();
  }
  pluck(e, strong) {
    const r = this.host.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top - this.h / 2;
    const i = clamp(Math.round(px / this.w * (this.n - 1)), 1, this.n - 2);
    const cur = this.y[i];
    // 指针穿越弦 → 施加冲量；靠近弦缓慢移动 → 轻微拖拽
    if (this.lastPy !== null && ((this.lastPy - cur) * (py - cur) < 0 || strong)) {
      const imp = clamp((py - this.lastPy) * 1.1 + (strong ? py * .4 : 0), -40, 40);
      for (let k = -4; k <= 4; k++) {
        const j = i + k; if (j < 1 || j > this.n - 2) continue;
        this.v[j] += imp * Math.exp(-k * k / 6) * .55;
      }
      this.energy = 1;
    } else if (Math.abs(py - cur) < 16) {
      for (let k = -3; k <= 3; k++) {
        const j = i + k; if (j < 1 || j > this.n - 2) continue;
        this.y[j] += (py - this.y[j]) * .06 * Math.exp(-k * k / 4);
      }
      this.energy = 1;
    }
    this.lastPy = py;
    wake();
  }
  step() {
    const { y, v, n } = this;
    let e = 0;
    for (let i = 1; i < n - 1; i++) {
      v[i] += (y[i - 1] + y[i + 1] - 2 * y[i]) * .34 - y[i] * .012;
      v[i] *= .985;
    }
    for (let i = 1; i < n - 1; i++) { y[i] += v[i]; e += Math.abs(v[i]) + Math.abs(y[i]); }
    return e;
  }
  draw() {
    const { ctx, w, h, y, n, colors } = this;
    ctx.clearRect(0, 0, w, h);
    const cy = h / 2;
    ctx.strokeStyle = colors.fg; ctx.lineWidth = 1; ctx.globalAlpha = .85;
    ctx.beginPath();
    ctx.moveTo(0, cy + y[0]);
    for (let i = 1; i < n - 1; i++) {
      const x = i / (n - 1) * w, nx = (i + 1) / (n - 1) * w;
      ctx.quadraticCurveTo(x, cy + y[i], (x + nx) / 2, cy + (y[i] + y[i + 1]) / 2);
    }
    ctx.lineTo(w, cy + y[n - 1]);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 端点锚块与刻度
    ctx.fillStyle = colors.signal; ctx.fillRect(0, cy - 2, 4, 4); ctx.fillRect(w - 4, cy - 2, 4, 4);
    ctx.strokeStyle = colors.hair; ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const x = Math.round(i / 24 * w) + .5; ctx.moveTo(x, cy + 14); ctx.lineTo(x, cy + (i % 4 === 0 ? 20 : 17)); }
    ctx.stroke();
  }
  destroy() {
    this.ro.disconnect(); this.io.disconnect();
    document.removeEventListener('tm:kelvin', this.onTheme);
    strings.delete(this);
  }
}

function wake() {
  if (loopOn) return;
  loopOn = true;
  const stop = add(() => {
    let active = false;
    strings.forEach((s) => {
      if (!s.host.isConnected) { s.destroy(); return; }
      if (!s.visible) return;
      if (s.energy > 0.002) {
        const e = s.step();
        s.energy = e > 0.4 ? 1 : e;
        s.draw();
        active = true;
      }
    });
    if (!active) { stop(); loopOn = false; }
  });
}

export function mountStrings(root = document) {
  $$('.string:not([data-fx])', root).forEach((host) => {
    host.dataset.fx = '1';
    strings.add(new StringLine(host));
  });
}
