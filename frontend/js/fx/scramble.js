// 字符破译（Scramble Cipher）：悬停时十六进制/符号乱码逐字解码为原文
import { $$, reducedMotion } from 'core/util';

const GLYPHS = '0123456789ABCDEF<>/\\|_-+*#%&$@=?';
const rnd = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

function run(el) {
  const text = el.dataset.text;
  const chars = Array.from(text);
  if (!chars.length) return;
  clearInterval(el._scr);
  el.style.minWidth = el.offsetWidth + 'px';
  let frame = 0;
  const total = chars.length;
  const perChar = 2.2; // 每个字符占用的帧数
  el._scr = setInterval(() => {
    frame++;
    const done = Math.floor(frame / perChar);
    el.textContent = chars.map((c, i) => (i < done || /\s/.test(c) ? c : rnd())).join('');
    if (done >= total) {
      clearInterval(el._scr);
      el.textContent = text;
      el.style.minWidth = '';
    }
  }, 32);
}

export function bindScramble(root = document) {
  $$('[data-scramble]:not([data-fx])', root).forEach((el) => {
    el.dataset.fx = '1';
    el.dataset.text = el.textContent;
    el.style.display = el.style.display || 'inline-block';
    el.style.whiteSpace = 'nowrap';
    if (reducedMotion) return;
    const host = el.closest('a,button') || el;
    host.addEventListener('pointerenter', () => { el.dataset.text = el.dataset.text || el.textContent; run(el); });
    host.addEventListener('focus', () => run(el));
  });
}

/** 文本被动态更新后，同步“原文” */
export function setScrambleText(el, text) {
  el.textContent = text;
  el.dataset.text = text;
}
