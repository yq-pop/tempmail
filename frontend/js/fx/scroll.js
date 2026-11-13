// 滚动：惯性插值 + 速度倾斜 + 游标卡尺 HUD + 跑马灯联动
// 仍使用原生滚动位置（滚动条 / 键盘 / 锚点照常工作），仅对滚轮输入做插值。
import { add } from 'fx/ticker';
import { $, $$, clamp, lerp, pad, reducedMotion, coarsePointer } from 'core/util';

let target = 0, current = 0, lastY = 0, animating = false;
let velSmooth = 0, skew = 0;
let lastRead = '', lastSpeed = '';
let marquees = [];

const root = document.documentElement;
const maxScroll = () => Math.max(0, root.scrollHeight - innerHeight);

function innerScrollable(el, dy) {
  for (let n = el; n && n !== document.body && n !== root; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) {
      if (dy > 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1) return true;
      if (dy < 0 && n.scrollTop > 0) return true;
    }
  }
  return false;
}

function onWheel(e) {
  if (e.ctrlKey || e.defaultPrevented || document.body.classList.contains('is-loading')) return;
  if (e.target.closest && e.target.closest('.panel')) return;
  if (innerScrollable(e.target, e.deltaY)) return;
  e.preventDefault();
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 32; else if (e.deltaMode === 2) dy *= innerHeight;
  if (!animating) { current = target = window.scrollY; }
  target = clamp(target + dy, 0, maxScroll());
  animating = true;
}

export function scrollToY(y) {
  if (reducedMotion || coarsePointer) { window.scrollTo(0, y); return; }
  if (!animating) current = window.scrollY;
  target = clamp(y, 0, maxScroll());
  animating = true;
}
export function scrollToEl(el, offset = 0) {
  if (!el) return;
  scrollToY(el.getBoundingClientRect().top + window.scrollY - offset - 64);
}
export function scrollReset() {
  window.scrollTo(0, 0);
  current = target = lastY = 0; animating = false; velSmooth = 0;
}

export function refreshMarquees() {
  marquees = $$('.marquee-track').map((tr) => ({ tr, off: tr._off || 0, half: 0 }));
  marquees.forEach((m) => { m.half = m.tr.scrollWidth / 2; });
}

export function initScroll() {
  current = target = lastY = window.scrollY;
  if (!reducedMotion && !coarsePointer) {
    addEventListener('wheel', onWheel, { passive: false });
    addEventListener('scroll', () => { if (!animating) current = target = window.scrollY; }, { passive: true });
  }
  const jaw = $('#v-jaw'), read = $('#v-read'), speed = $('#v-speed'), track = $('.v-track');
  const rail = (pos) => track.clientHeight - 2;

  add(() => {
    if (animating) {
      current = lerp(current, target, .1);
      if (Math.abs(target - current) < .3) { current = target; animating = false; }
      window.scrollTo(0, current);
    }
    const y = window.scrollY;
    const v = y - lastY;
    lastY = y;
    velSmooth = lerp(velSmooth, v, .18);
    if (Math.abs(velSmooth) < .01) velSmooth = 0;

    // 倾斜
    const s = clamp(velSmooth * .16, -7, 7);
    skew = lerp(skew, s, .25);
    root.style.setProperty('--skew', Math.abs(skew) < .02 ? '0deg' : skew.toFixed(2) + 'deg');

    // 跑马灯：基础速度 + 滚动速度，方向随滚动方向
    if (marquees.length) {
      const dir = velSmooth === 0 ? 1 : Math.sign(velSmooth);
      marquees.forEach((m) => {
        if (!m.tr.isConnected) return;
        if (!m.half) m.half = m.tr.scrollWidth / 2;
        const sp = (reducedMotion ? 0 : .5) + Math.abs(velSmooth) * .6;
        m.off -= sp * (m.dir || 1);
        if (velSmooth !== 0) m.dir = dir; else m.dir = m.dir || 1;
        if (m.half) { if (m.off <= -m.half) m.off += m.half; if (m.off > 0) m.off -= m.half; }
        m.tr._off = m.off;
        m.tr.style.setProperty('--mx', m.off.toFixed(1) + 'px');
      });
    }

    // HUD
    const max = maxScroll();
    const p = max > 0 ? y / max : 0;
    jaw.style.setProperty('--jy', (p * rail()).toFixed(1) + 'px');
    const r = (p * 1000).toFixed(1).padStart(5, '0') + '‰';
    if (r !== lastRead) { read.textContent = r; lastRead = r; }
    const sp = (velSmooth >= 0 ? '+' : '-') + Math.abs(velSmooth).toFixed(1).padStart(4, '0') + ' px/f';
    if (sp !== lastSpeed) { speed.textContent = sp; lastSpeed = sp; }
  });
}
