// 进入视口时的揭示动画（遮罩上滑 / 淡入）
import { $$ } from 'core/util';

let io;
function ensure() {
  if (io) return io;
  io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: .12, rootMargin: '0px 0px -6% 0px' });
  return io;
}

export function observeReveals(root = document) {
  const obs = ensure();
  $$('[data-reveal]:not([data-fx]), .line-group:not([data-fx])', root).forEach((el) => {
    el.dataset.fx = '1';
    // 同一父级内按顺序错峰
    if (!el.style.getPropertyValue('--i')) {
      const sibs = Array.from(el.parentElement.children).filter((c) => c.hasAttribute('data-reveal'));
      el.style.setProperty('--i', Math.max(0, sibs.indexOf(el)));
    }
    obs.observe(el);
  });
}
