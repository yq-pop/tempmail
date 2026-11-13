// 双层磁吸按钮：外框与内部文字以不同阻尼跟随指针
import { add } from 'fx/ticker';
import { $$, coarsePointer, reducedMotion } from 'core/util';

const items = new Set();
let px = -9999, py = -9999;

/** 把 <button class="btn">文字</button> 升级为 frame + label 双层结构 */
export function upgradeButtons(root = document) {
  $$('.btn:not([data-fx])', root).forEach((b) => {
    b.dataset.fx = '1';
    if (!b.querySelector('.btn-frame')) {
      b.innerHTML = `<span class="btn-frame"></span><span class="btn-label">${b.innerHTML}</span>`;
    }
    if (coarsePointer || reducedMotion || b.hasAttribute('data-no-magnet')) return;
    items.add({ b, frame: b.querySelector('.btn-frame'), label: b.querySelector('.btn-label'), fx: 0, fy: 0, lx: 0, ly: 0 });
  });
}

export function initMagnetic() {
  if (coarsePointer || reducedMotion) return;
  addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; }, { passive: true });
  addEventListener('pointerleave', () => { px = py = -9999; });
  let tick = 0;
  add(() => {
    tick++;
    items.forEach((it) => {
      if (!it.b.isConnected) { items.delete(it); return; }
      let tx = 0, ty = 0;
      const needs = Math.abs(it.fx) > .05 || Math.abs(it.fy) > .05 || Math.abs(it.lx) > .05 || Math.abs(it.ly) > .05;
      if (px > -9000 && !it.b.disabled) {
        const r = it.b.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const dx = px - cx, dy = py - cy;
        const reach = 54;
        if (Math.abs(dx) < r.width / 2 + reach && Math.abs(dy) < r.height / 2 + reach) {
          tx = dx; ty = dy;
          // 外框移动 22%，内部文字移动 42%，阻尼不同 → 产生层次错位
          it.fx += (tx * .22 - it.fx) * .16; it.fy += (ty * .22 - it.fy) * .16;
          it.lx += (tx * .42 - it.lx) * .1; it.ly += (ty * .42 - it.ly) * .1;
          apply(it);
          return;
        }
      }
      if (needs) {
        it.fx *= .82; it.fy *= .82; it.lx *= .86; it.ly *= .86;
        if (Math.abs(it.fx) < .05 && Math.abs(it.lx) < .05) { it.fx = it.fy = it.lx = it.ly = 0; }
        apply(it);
      }
    });
  });
}

function apply(it) {
  it.frame.style.transform = `translate3d(${it.fx.toFixed(2)}px,${it.fy.toFixed(2)}px,0)`;
  it.label.style.transform = `translate3d(${it.lx.toFixed(2)}px,${it.ly.toFixed(2)}px,0)`;
}
