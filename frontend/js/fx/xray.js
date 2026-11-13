// X-Ray 蓝图模式：一键暴露 DOM 线框、12 栏参考线与尺寸标注
import { $, $$ } from 'core/util';

const html = document.documentElement;

function describe(el) {
  if (!el || el === document.body) return 'body';
  const r = el.getBoundingClientRect();
  const id = el.id ? '#' + el.id : '';
  const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => '.' + c).join('');
  return `${el.tagName.toLowerCase()}${id}${cls}  ${Math.round(r.width)}×${Math.round(r.height)}`;
}

export function setXray(on) {
  html.classList.toggle('xray', on);
  $$('[data-xray-toggle]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
}
export const isXray = () => html.classList.contains('xray');

export function initXray() {
  const tip = $('#xray-tip');
  addEventListener('pointermove', (e) => {
    if (!isXray()) { tip.classList.remove('on'); return; }
    tip.textContent = describe(e.target);
    tip.style.transform = `translate3d(${Math.min(e.clientX + 16, innerWidth - 40)}px,${e.clientY + 18}px,0)`;
    tip.classList.add('on');
  }, { passive: true });
  addEventListener('keydown', (e) => {
    if ((e.key === 'x' || e.key === 'X') && e.shiftKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) setXray(!isXray());
  });
}
