// 开场标定序列：仪器自检清单 + 实时几何波形 + 等宽 000→100 计数，随后多联百叶帘错位拉开
import { $, esc, pad, reducedMotion, sleep } from 'core/util';

const SESSION_KEY = 'tm_calibrated';

/**
 * checks: [{ code, label, run: () => Promise<'ok'|'warn'|'fail'|void> }]
 * 返回：动画结束（百叶帘完全拉开）的 Promise。onReady 在自检完成、百叶帘开始拉开前调用。
 */
export async function runPreloader(checks, onReady) {
  const pre = $('#pre');
  const results = checks.map((c) => c.run().then((r) => r || 'ok').catch(() => 'fail'));

  const skipAnim = reducedMotion || sessionStorage.getItem(SESSION_KEY) === '1';
  if (skipAnim) {
    await Promise.race([Promise.all(results), sleep(2500)]);
    await onReady?.();
    pre.remove();
    document.body.classList.remove('is-loading');
    return;
  }

  const blinds = $('.pre-blinds', pre);
  blinds.innerHTML = Array.from({ length: 8 }, (_, i) => `<span style="--i:${i}"></span>`).join('');
  const list = $('#pre-list');
  list.innerHTML = checks.map((c, i) => `<li data-i="${i}"><b>${pad(i + 1)}</b><span>${esc(c.label)}</span><em>···</em></li>`).join('');
  const lis = Array.from(list.children);
  const nEl = $('#pre-n'), barEl = $('#pre-bar'), clock = $('#pre-clock');
  const MIN_MS = 2100, MAX_MS = 6500;
  const t0 = performance.now();
  let done = 0, finished = false, skipped = false, shown = 0;
  const statuses = new Array(checks.length).fill(null);

  // 逐行点亮 + 状态回填
  checks.forEach((c, i) => {
    setTimeout(() => lis[i].classList.add('on'), 180 + i * 230);
    results[i].then(async (r) => {
      await sleep(Math.max(0, 180 + i * 230 + 380 - (performance.now() - t0)));
      statuses[i] = r; done++;
      lis[i].classList.add(r);
      lis[i].querySelector('em').textContent = { ok: 'OK', warn: 'WARN', fail: 'FAIL' }[r];
    });
  });
  $('#pre-skip').addEventListener('click', () => { skipped = true; });

  // 波形
  const cv = $('#pre-wave'), ctx = cv.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const fit = () => { const r = cv.getBoundingClientRect(); cv.width = r.width * dpr; cv.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  fit();
  let raf;
  const draw = (now) => {
    const w = cv.width / dpr, h = cv.height / dpr, t = (now - t0) / 1000;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(244,241,234,.1)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 1; i < 10; i++) { const x = Math.round(w * i / 10) + .5, y = Math.round(h * i / 10) + .5; ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    const k = shown / 100;
    ctx.strokeStyle = '#F4F1EA'; ctx.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const u = x / w;
      // 方波/三角/正弦叠加；随进度逐渐收敛为稳定正弦（"锁相"）
      const noise = (1 - k) * (Math.sin(u * 38 + t * 9) * .22 + Math.sin(u * 91 - t * 15) * .12);
      const base = Math.sin(u * 14 + t * 3.2) * (.5 - .12 * k) + Math.sin(u * 5 - t * 1.4) * .22 * (1 - k * .6);
      const y = h / 2 + (base + noise) * h * .38;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    // 扫描线
    const sx = ((t * .45) % 1) * w;
    ctx.strokeStyle = '#FF3B14'; ctx.beginPath(); ctx.moveTo(sx + .5, 0); ctx.lineTo(sx + .5, h); ctx.stroke();
    clock.textContent = new Date(now - t0 + 0).toISOString().slice(11, 23);
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  // 计数：以真实自检进度为上限，并保证最短展示时间。
  // 用定时器驱动并按时间步长平滑（与帧率无关），后台标签页里也能按时结束。
  await new Promise((resolve) => {
    let prev = performance.now();
    const iv = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.25, (now - prev) / 1000);
      prev = now;
      const el = now - t0;
      const real = done / checks.length;
      const byTime = Math.min(1, el / MIN_MS);
      let target = Math.min(real, byTime) * 100;
      if (el > MAX_MS || skipped) target = 100;
      shown += (target - shown) * (1 - Math.exp(-dt * (skipped ? 14 : 7)));
      if (target >= 100 && shown > 99.4) shown = 100;
      nEl.textContent = pad(Math.round(shown), 3);
      barEl.style.transform = `scaleX(${shown / 100})`;
      if (shown >= 100) { clearInterval(iv); finished = true; resolve(); }
    }, 16);
  });

  sessionStorage.setItem(SESSION_KEY, '1');
  await sleep(skipped ? 60 : 380);
  await onReady?.();
  pre.classList.add('is-out');
  await sleep(380);
  pre.classList.add('is-open');
  document.body.classList.remove('is-loading');
  await sleep(1500);
  cancelAnimationFrame(raf);
  pre.remove();
}
