// 全局色温切换：2800K Carbon ⇄ 5600K Paper
const KEY = 'tm_kelvin';
const root = document.documentElement;

export const getKelvin = () => root.getAttribute('data-kelvin') || '2800';

export function setKelvin(k, persist = true) {
  if (k !== '2800' && k !== '5600') return;
  root.classList.add('kelvin-anim');
  root.setAttribute('data-kelvin', k);
  if (persist) localStorage.setItem(KEY, k);
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', k === '5600' ? '#F3EFE6' : '#0A0A08');
  document.dispatchEvent(new CustomEvent('tm:kelvin', { detail: k }));
  clearTimeout(setKelvin._t);
  setKelvin._t = setTimeout(() => root.classList.remove('kelvin-anim'), 700);
}

export const toggleKelvin = () => setKelvin(getKelvin() === '2800' ? '5600' : '2800');

/** 读取当前主题的 CSS 变量（供 Canvas / WebGL 使用） */
export function themeColors() {
  const cs = getComputedStyle(root);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { bg: v('--bg'), raised: v('--raised'), fg: v('--fg'), dim: v('--dim'), signal: v('--signal'), amber: v('--amber'), ok: v('--ok'), hair: v('--hair-3') };
}

export function initKelvin() {
  // 没有手动选择过时，跟随系统
  if (!localStorage.getItem(KEY) && window.matchMedia) {
    const mq = matchMedia('(prefers-color-scheme: light)');
    const fn = (e) => { if (!localStorage.getItem(KEY)) setKelvin(e.matches ? '5600' : '2800', false); };
    mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn);
  }
}
