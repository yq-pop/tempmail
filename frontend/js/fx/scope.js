// 示波器画布：李萨如谐波环（落地页遥测）/ 无信号平直线（空收件箱）
import { add } from 'fx/ticker';
import { themeColors } from 'fx/kelvin';
import { reducedMotion, pad } from 'core/util';

let mouse = { x: .5, y: .5 };
addEventListener('pointermove', (e) => { mouse.x = e.clientX / innerWidth; mouse.y = e.clientY / innerHeight; }, { passive: true });

export function mountScope(canvas) {
  const mode = canvas.dataset.scope || 'lissajous';
  const ctx = canvas.getContext('2d');
  const readEl = canvas.parentElement.querySelector('.scope-read');
  let w = 0, h = 0, dpr = 1, colors = themeColors(), visible = true, alive = true;
  let redraw = null; // 改变画布尺寸会清空内容，resize 后立刻补画一帧，避免空白闪烁

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    w = Math.max(10, r.width); h = Math.max(10, r.height);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (redraw) redraw();
  };
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(canvas);
  const onTheme = () => { colors = themeColors(); };
  document.addEventListener('tm:kelvin', onTheme);

  function graticule() {
    ctx.strokeStyle = colors.hair; ctx.lineWidth = 1; ctx.globalAlpha = .55;
    ctx.beginPath();
    for (let i = 1; i < 10; i++) {
      const x = Math.round(w * i / 10) + .5, y = Math.round(h * i / 10) + .5;
      ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.moveTo(0, y); ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.dim; ctx.beginPath();
    ctx.moveTo(0, h / 2 + .5); ctx.lineTo(w, h / 2 + .5); ctx.moveTo(w / 2 + .5, 0); ctx.lineTo(w / 2 + .5, h);
    ctx.stroke();
    // 刻度
    ctx.beginPath();
    for (let i = 0; i <= 50; i++) {
      const x = Math.round(w * i / 50) + .5, y = Math.round(h * i / 50) + .5, l = i % 5 === 0 ? 7 : 3;
      ctx.moveTo(x, h / 2 - l); ctx.lineTo(x, h / 2 + l); ctx.moveTo(w / 2 - l, y); ctx.lineTo(w / 2 + l, y);
    }
    ctx.stroke();
  }

  let t = 0, readT = 0;
  function lissajous(dt) {
    ctx.clearRect(0, 0, w, h);
    graticule();
    const a = 3, b = 2 + (mouse.x - .5) * .06;
    const phase = t * .35 + (mouse.y - .5) * 1.4;
    const R = Math.min(w, h) * .42, cx = w / 2, cy = h / 2;
    const N = 720;
    const pt = (k) => { const s = k / N * Math.PI * 2; return [cx + Math.sin(a * s + phase) * R * 1.35, cy + Math.sin(b * s) * R]; };

    // 谐波环：主曲线 + 两条细副线
    [[1, 1, .9, colors.fg], [.82, .7, .35, colors.dim], [.6, .5, .22, colors.dim]].forEach(([sc, , al, col]) => {
      ctx.strokeStyle = col; ctx.globalAlpha = al; ctx.lineWidth = 1; ctx.beginPath();
      for (let k = 0; k <= N; k++) {
        const [x, y] = pt(k);
        const X = cx + (x - cx) * sc, Y = cy + (y - cy) * sc;
        k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // 扫描光点与拖尾
    const head = (t * 90) % N;
    for (let i = 0; i < 46; i++) {
      const [x, y] = pt((head - i + N) % N);
      ctx.fillStyle = colors.signal; ctx.globalAlpha = (1 - i / 46) * .9;
      const s = i === 0 ? 3.2 : 2 - i / 46;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    readT += dt;
    if (readEl && readT > .12) {
      readT = 0;
      readEl.innerHTML = `A=<b>3</b> B=<b>${b.toFixed(3)}</b> δ=<b>${((phase % (Math.PI * 2)) / Math.PI).toFixed(3)}π</b> f=<b>${(90 / N * 60).toFixed(1)}Hz</b>`;
    }
  }

  let spike = 0, nextSpike = 2;
  const ys = [];
  function flatline(dt) {
    ctx.clearRect(0, 0, w, h);
    graticule();
    nextSpike -= dt;
    if (nextSpike <= 0) { spike = 1; nextSpike = 3 + Math.random() * 3; }
    spike *= .94;
    const n = Math.ceil(w / 3);
    while (ys.length < n) ys.push(0);
    ys.shift();
    ys.push((Math.random() - .5) * 2.4 + Math.sin(t * 40) * spike * h * .18 * (Math.random() > .5 ? 1 : -1));
    ctx.strokeStyle = colors.fg; ctx.lineWidth = 1; ctx.beginPath();
    ys.forEach((y, i) => { const X = i * 3, Y = h / 2 + y; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.stroke();
    ctx.fillStyle = colors.signal; ctx.fillRect(w - 5, h / 2 + ys[ys.length - 1] - 2, 4, 4);
    readT += dt;
    if (readEl && readT > .3) { readT = 0; readEl.innerHTML = `CH1 <b>NO SIGNAL</b> · 噪底 <b>${(Math.random() * 2 + 1).toFixed(2)} mV</b>`; }
  }

  const draw = mode === 'flatline' ? flatline : lissajous;
  let last = performance.now();
  const stop = add((now) => {
    if (!alive) return;
    if (!canvas.isConnected) { alive = false; cleanup(); return; }
    if (!visible || document.hidden) { last = now; return; }
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (reducedMotion) { draw(0); return; }
    t += dt; draw(dt);
  });
  function cleanup() {
    stop(); ro.disconnect(); io.disconnect(); document.removeEventListener('tm:kelvin', onTheme);
  }
  redraw = () => draw(0);
  draw(0);
  return cleanup;
}
