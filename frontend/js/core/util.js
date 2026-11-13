// 通用工具：DOM 选择、转义、格式化、事件委托

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const pad = (n, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const coarsePointer = matchMedia('(pointer: coarse)').matches;

/** 由 HTML 字符串创建单个元素 */
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** 事件委托：on(root, 'click', '[data-act]', (e, target) => {}) */
export function on(root, type, selector, handler) {
  const fn = (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) handler(e, t);
  };
  root.addEventListener(type, fn);
  return () => root.removeEventListener(type, fn);
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** 剩余时间倒计时：不足 1 小时 mm:ss，不足 1 天 h:mm:ss，更长则 "N 天 HH 时"。 */
export function fmtRemaining(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return `${d} 天 ${pad(hr)} 时`;
  if (hr) return `${hr}:${pad(m)}:${pad(sec)}`;
  return `${pad(m)}:${pad(sec)}`;
}

/** 把分钟数写成易读的时长：30 → "30 分钟"，90 → "1 小时 30 分钟"，1440 → "1 天" */
export function fmtDuration(minutes) {
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m) || m <= 0) return '—';
  const d = Math.floor(m / 1440), hr = Math.floor((m % 1440) / 60), mn = m % 60;
  const parts = [];
  if (d) parts.push(`${d} 天`);
  if (hr) parts.push(`${hr} 小时`);
  if (mn || !parts.length) parts.push(`${mn} 分钟`);
  return parts.join(' ');
}

export function timeAgo(s) {
  if (!s) return '—';
  const mins = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  return `${Math.floor(hrs / 24)} 天前`;
}

/** 数字滚动：0 → to */
export function countUp(el, to, ms = 900) {
  const n = Number(to);
  if (!Number.isFinite(n) || reducedMotion) { el.textContent = Number.isFinite(n) ? n.toLocaleString() : String(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(n * (1 - Math.pow(1 - p, 4))).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** 站点标题拆行：用于大标题。TempMail → ['Temp','Mail'] */
export function splitTitle(title) {
  const words = String(title || 'TempMail').replace(/([a-z])([A-Z])/g, '$1 $2').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return [words[0], words.slice(1).join(' ')];
  return [words[0] || 'TempMail'];
}
