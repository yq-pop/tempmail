// 双环光标：精确朱砂圆点 + 弹簧阻尼外环；悬停可交互区域时外环膨胀为朱砂透镜并显示动作指令
import { add } from 'fx/ticker';
import { $, coarsePointer } from 'core/util';

const INTERACTIVE = 'a[href],button,[data-cursor],input:not([type=hidden]),select,textarea,label[for],summary,[role=button],[role=tab]';
const DEFAULT_LABEL = { A: '前往', BUTTON: '执行', INPUT: '输入', TEXTAREA: '输入', SELECT: '选择', LABEL: '切换', SUMMARY: '展开' };

export function initCursor() {
  if (coarsePointer || !window.matchMedia('(pointer: fine)').matches) return;
  const html = document.documentElement;
  const dot = $('#cur-dot'), ring = $('#cur-ring'), label = $('#cur-ring span');
  html.classList.add('has-cursor');

  let mx = -100, my = -100, rx = -100, ry = -100, vx = 0, vy = 0, first = true;
  let current = null;

  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    mx = e.clientX; my = e.clientY;
    if (first) { rx = mx; ry = my; first = false; html.classList.add('cursor-on'); }
    dot.style.transform = `translate3d(${mx}px,${my}px,0)`;
  }, { passive: true });

  document.addEventListener('pointerover', (e) => {
    const native = e.target.closest('[data-native-cursor]');
    html.classList.toggle('native-cursor', !!native);
    const t = e.target.closest(INTERACTIVE);
    if (t === current) return;
    current = t;
    ring.classList.remove('is-lens', 'is-btn', 'is-text');
    html.classList.remove('cur-text');
    if (!t || t.dataset.cursor === 'none' || t.disabled) return;
    const tag = t.tagName;
    if ((tag === 'INPUT' && !/^(checkbox|radio|button|submit)$/.test(t.type)) || tag === 'TEXTAREA') {
      ring.classList.add('is-text'); html.classList.add('cur-text'); return;
    }
    if (t.classList.contains('btn') || t.classList.contains('icon-btn') || t.classList.contains('tool')) {
      ring.classList.add('is-btn'); return;
    }
    label.textContent = t.dataset.cursor || DEFAULT_LABEL[tag] || '打开';
    ring.classList.add('is-lens');
  });
  document.addEventListener('pointerdown', () => ring.classList.add('is-down'));
  document.addEventListener('pointerup', () => ring.classList.remove('is-down'));
  document.documentElement.addEventListener('mouseleave', () => html.classList.remove('cursor-on'));
  document.documentElement.addEventListener('mouseenter', () => { if (!first) html.classList.add('cursor-on'); });

  // 外环：弹簧阻尼
  add(() => {
    if (first) return;
    vx += (mx - rx) * .16; vy += (my - ry) * .16;
    vx *= .72; vy *= .72;
    rx += vx; ry += vy;
    ring.style.transform = `translate3d(${rx}px,${ry}px,0)`;
  });
}
