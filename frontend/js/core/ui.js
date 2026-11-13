// UI 原语：提示、侧滑控制台、取景器模块、图标、DNS 表格
import { $, $$, esc, h, pad } from 'core/util';

/* ── 图标：1.5px 描边、直角端点，与精密仪器线稿统一 ── */
const PATHS = {
  copy: '<rect x="9" y="9" width="11" height="11"/><path d="M5 15V5h10"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  open: '<path d="M7 17 17 7M8 7h9v9"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  menu: '<path d="M4 8h16M4 16h16"/>',
  bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
};
export const icon = (name, size = 16) =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true">${PATHS[name] || ''}</svg>`;

/* ── 提示：控制台式日志行 ── */
const TOAST_LABEL = { success: 'OK', error: 'ERR', warn: 'WARN', info: 'INFO' };
export function toast(msg, type = 'info') {
  const box = $('#toasts');
  if (!box) return;
  const t = h(`<div class="toast toast--${type}" role="status"><i></i><span class="mono">${TOAST_LABEL[type] || 'INFO'}</span><p>${esc(msg)}</p></div>`);
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 450); }, 3800);
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) throw new Error('copy failed');
    }
    toast('已复制到剪贴板', 'success');
  } catch {
    toast('复制失败，请手动选择', 'warn');
  }
}

/* ── 取景器模块 ── */
export function frame({ sub = '', code = '', cls = '', style = '', xray = '', attrs = '' }, inner) {
  return `<section class="frame ${cls}" style="${style}" data-xray="${esc(xray || code)}" ${attrs}>
    <header class="frame-head mono"><span class="frame-idx">[00 // 00]</span><span class="frame-sub">${sub}</span><span class="frame-code">${esc(code)}</span></header>
    <div class="frame-body">${inner}</div>
    <i class="cm tl"></i><i class="cm tr"></i><i class="cm bl"></i><i class="cm br"></i>
  </section>`;
}

/** 为一个视图内的模块自动编号 [01 // 05] */
export function numberFrames(root) {
  const list = $$('.frame', root).filter((f) => !f.closest('.panel'));
  list.forEach((f, i) => {
    const idx = f.querySelector(':scope > .frame-head .frame-idx');
    if (idx) idx.textContent = `[${pad(i + 1)} // ${pad(list.length)}]`;
  });
}

/** 12 栏定位：col(1, 8) → style="--cs:1;--cn:8" */
export const col = (start, span) => `--cs:${start};--cn:${span}`;

export const tag = (kind, text, extra = '') => `<span class="tag tag--${kind} ${extra}">${esc(text)}</span>`;

/* ── 侧滑控制台（替代旧版居中弹窗） ── */
let activePanel = null;

export function openPanel({ code = 'CONSOLE', title = '', sub = '', body = '', actions = [], wide = false } = {}) {
  closePanel(true);
  const root = $('#panel-root');
  const back = h('<div class="panel-back"></div>');
  const el = h(`<aside class="panel ${wide ? 'panel--wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header class="panel-head mono"><span>${esc(code)}</span><button type="button" class="icon-btn" data-close aria-label="关闭" data-cursor="关闭">${icon('x')}</button></header>
    <h2 class="panel-title display-s">${esc(title)}</h2>
    ${sub ? `<p class="hint">${sub}</p>` : ''}
    <div class="panel-body">${body}</div>
    <footer class="panel-foot"></footer>
  </aside>`);
  root.append(back, el);

  const prevFocus = document.activeElement;
  const foot = $('.panel-foot', el);
  const ctx = { el, body: $('.panel-body', el), foot, close };
  actions.forEach((a) => {
    const b = h(`<button type="button" class="btn ${a.kind ? 'btn--' + a.kind : ''}">${esc(a.label)}</button>`);
    b.addEventListener('click', async () => {
      if (!a.onClick) { close(); return; }
      b.disabled = true;
      try {
        const r = await a.onClick(ctx);
        if (r !== false) close();
      } finally { b.disabled = false; }
    });
    foot.appendChild(b);
  });
  if (!actions.length) foot.remove();

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', () => close());
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });

  function close(immediate = false) {
    if (activePanel !== ctx) return;
    activePanel = null;
    document.removeEventListener('keydown', onKey);
    back.classList.remove('in');
    el.classList.remove('in');
    const done = () => { back.remove(); el.remove(); if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); };
    if (immediate) done(); else setTimeout(done, 520);
    if (ctx.onClose) ctx.onClose();
  }

  activePanel = ctx;
  requestAnimationFrame(() => { back.classList.add('in'); el.classList.add('in'); });
  setTimeout(() => { const f = $('input, select, textarea, .panel-foot .btn', el); if (f) f.focus({ preventScroll: true }); }, 380);
  return ctx;
}

export function closePanel(immediate = false) {
  if (activePanel) activePanel.close(immediate);
}

export function confirmPanel({ title, message, confirmText = '确认', danger = false, code = 'CONFIRM' }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const ctx = openPanel({
      code, title, body: `<div class="stack" style="--gap:14px">${message}</div>`,
      actions: [
        { label: '取消', kind: 'ghost', onClick: () => { done(false); } },
        { label: confirmText, kind: danger ? 'danger' : 'solid', onClick: () => { done(true); } },
      ],
    });
    ctx.onClose = () => done(false);
  });
}

/* ── DNS 记录表 / MX 明细 ── */
export function dnsRows(records) {
  return (records || []).map((r) => `<tr><td>${esc(r.type)}</td><td>${esc(r.host || '@')}</td><td>${esc(r.value)}</td><td>${esc(r.priority ?? '—')}</td></tr>`).join('');
}
export function dnsTable(records) {
  return `<div class="tbl-wrap"><table class="dns"><thead><tr><th>类型</th><th>主机名</th><th>内容</th><th>优先级</th></tr></thead><tbody>${dnsRows(records)}</tbody></table></div>`;
}
export function mxDetails(details) {
  if (!Array.isArray(details) || !details.length) return '';
  const kind = (d) => (d.kind === 'wildcard' ? '通配子域' : d.kind === 'single' || d.kind === 'base' ? '单域名' : '域名');
  return `<div class="mx-detail">${details.map((d) => `<div><i class="${d.matched ? 'ok' : 'no'}">${d.matched ? '✓' : '✕'}</i><span>${esc(d.name || '')}<br><span class="dim">${kind(d)}：${esc(d.status || '')}</span></span></div>`).join('')}</div>`;
}
