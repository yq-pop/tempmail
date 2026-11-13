// 特效总装：初始化全局特效，并在 DOM 变化后自动升级新元素
import { $, $$ } from 'core/util';
import { initKelvin, toggleKelvin } from 'fx/kelvin';
import { initCursor } from 'fx/cursor';
import { initScroll, refreshMarquees, scrollToEl } from 'fx/scroll';
import { initMagnetic, upgradeButtons } from 'fx/magnetic';
import { bindScramble } from 'fx/scramble';
import { mountStrings } from 'fx/strings';
import { initXray, setXray, isXray } from 'fx/xray';
import { observeReveals } from 'fx/reveal';
import { mountScope } from 'fx/scope';

export function scan(root = document) {
  upgradeButtons(root);
  bindScramble(root);
  mountStrings(root);
  observeReveals(root);
  $$('canvas[data-scope]:not([data-fx])', root).forEach((c) => { c.dataset.fx = '1'; mountScope(c); });
  if ($$('.marquee-track:not([data-fx])', root).length) {
    $$('.marquee-track:not([data-fx])', root).forEach((m) => {
      m.dataset.fx = '1';
      // 复制一份内容以实现无缝循环
      m.innerHTML += m.innerHTML;
      m.setAttribute('aria-hidden', 'true');
    });
    refreshMarquees();
  }
}

export function initFX() {
  initKelvin();
  initScroll();
  initCursor();
  initMagnetic();
  initXray();

  // 全局点击：色温 / X-Ray / 锚点滚动
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-kelvin-toggle]')) toggleKelvin();
    const x = t.closest('[data-xray-toggle]');
    if (x) setXray(!isXray());
    const a = t.closest('[data-scrollto]');
    if (a) { e.preventDefault(); scrollToEl($(a.dataset.scrollto)); }
  });

  // 动态内容自动升级
  let pending = false;
  const mo = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; scan(document.body); });
  });
  mo.observe(document.body, { childList: true, subtree: true });
  scan(document.body);

  if (document.fonts?.ready) document.fonts.ready.then(refreshMarquees);
  addEventListener('resize', () => refreshMarquees());
}
