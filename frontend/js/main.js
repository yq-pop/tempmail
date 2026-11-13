// 入口：自检 → 品牌 / 会话恢复 → 顶栏 → 路由
import { $, $$, esc, h, on } from 'core/util';
import { S, isAuthed, isAdmin, saveSession, clearSession, listen } from 'core/state';
import { api } from 'core/api';
import { toast, icon } from 'core/ui';
import { defineRoutes, startRouter, currentPath, go, refresh } from 'core/router';
import { initFX } from 'fx/index';
import { initShader } from 'fx/shader';
import { runPreloader } from 'fx/preloader';
import { scrollReset } from 'fx/scroll';

/* ───────── 顶栏 ───────── */
function brandMark() {
  const url = (S.settings.site_logo_url || '').trim();
  if (url) return `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="6" width="18" height="12"/><path d="M3 7l9 6.5L21 7"/></svg>';
}

function navItems() {
  if (!isAuthed()) {
    return [
      { href: '#/', scrollto: '#access', no: '01', label: '接入' },
      { href: '#/', scrollto: '#principle', no: '02', label: '原理' },
      { href: '#/', scrollto: '#telemetry', no: '03', label: '遥测' },
      { href: '#/', scrollto: '#spec', no: '04', label: '规格' },
    ];
  }
  const list = [
    { href: '#/', no: '01', label: '邮箱', match: (p) => p === '/' || p.startsWith('/mailbox') },
    { href: '#/domains', no: '02', label: '域名', match: (p) => p === '/domains' },
    { href: '#/api', no: '03', label: '接口', match: (p) => p === '/api' },
    { href: '#/key', no: '04', label: '密钥', match: (p) => p === '/key' },
  ];
  if (isAdmin()) {
    list.push({ sep: true });
    list.push({ href: '#/admin/accounts', no: 'A1', label: '账户', match: (p) => p === '/admin/accounts' });
    list.push({ href: '#/admin/domains', no: 'A2', label: '域名管理', match: (p) => p === '/admin/domains' });
    list.push({ href: '#/admin/settings', no: 'A3', label: '设置', match: (p) => p === '/admin/settings' });
  }
  return list;
}

function renderHeader() {
  const title = S.settings.site_title || 'TempMail';
  const items = navItems();
  const authed = isAuthed();
  $('#hdr').innerHTML = `
    <a class="brand" href="#/" aria-label="${esc(title)}" data-cursor="首页">
      <span class="brand-mark">${brandMark()}</span>
      <span class="brand-name" data-scramble>${esc(title)}</span>
      <span class="brand-rev mono">TM-01</span>
    </a>
    <nav class="nav mono" id="nav" aria-label="主导航">
      ${items.map((it, i) => it.sep ? '<span class="sep"></span>' : `<a href="${it.href}" ${it.scrollto ? `data-scrollto="${it.scrollto}"` : ''} data-i="${i}"><i>${it.no}</i><span data-scramble>${esc(it.label)}</span></a>`).join('')}
    </nav>
    <div class="hdr-tools">
      <button type="button" class="kelvin mono" data-kelvin-toggle aria-label="切换色温：2800K 碳黑 / 5600K 羊皮纸" data-cursor="色温"><b>2800K</b><span class="kelvin-track"><i class="kelvin-knob"></i></span><b>5600K</b></button>
      <button type="button" class="tool tool-xray mono" data-xray-toggle aria-pressed="false" aria-label="X-Ray 蓝图模式 (Shift+X)" data-cursor="透视">X-RAY</button>
      ${authed ? `<span class="who mono"><b>${esc(S.account?.username || '用户')}</b><span>${isAdmin() ? 'ADMIN' : 'USER'}</span></span><button type="button" class="tool mono" data-act="logout" data-cursor="退出">退出</button>` : ''}
      <button type="button" class="tool menu-btn mono" data-act="menu" aria-label="菜单" aria-expanded="false">${icon('menu')}</button>
    </div>`;
  setActiveNav(currentPath());
}

function setActiveNav(path) {
  if (!isAuthed()) return;
  const items = navItems();
  $$('#nav a').forEach((a) => {
    const it = items[Number(a.dataset.i)];
    a.classList.toggle('is-active', !!(it && it.match && it.match(path)));
  });
  $('#nav')?.classList.remove('is-open');
  $('[data-act="menu"]')?.setAttribute('aria-expanded', 'false');
}

on(document.body, 'click', '[data-act="logout"]', () => {
  clearSession();
  renderHeader();
  toast('已退出登录', 'info');
  go('/');
});
on(document.body, 'click', '[data-act="menu"]', (e, btn) => {
  const nav = $('#nav');
  const open = nav.classList.toggle('is-open');
  btn.setAttribute('aria-expanded', String(open));
});
on(document.body, 'click', '#nav a', () => { $('#nav')?.classList.remove('is-open'); });

// 登录/注册后由视图触发
listen('auth', () => { renderHeader(); refresh(); });
// 管理员修改站点名称 / Logo 后，仅刷新品牌区
listen('branding', () => { applyBranding(); renderHeader(); });

/* ───────── 路由表 ───────── */
defineRoutes([
  ['/', { view: () => import('views/landing'), authed: () => import('views/dashboard') }],
  ['/mailbox/:id', { auth: true, view: () => import('views/inbox') }],
  ['/mailbox/:id/:eid', { auth: true, view: () => import('views/inbox') }],
  ['/domains', { auth: true, view: () => import('views/domains') }],
  ['/api', { auth: true, view: () => import('views/apidocs') }],
  ['/key', { auth: true, view: () => import('views/key') }],
  ['/admin/accounts', { auth: true, admin: true, view: () => import('views/admin-accounts') }],
  ['/admin/domains', { auth: true, admin: true, view: () => import('views/admin-domains') }],
  ['/admin/settings', { auth: true, admin: true, view: () => import('views/admin-settings') }],
], {
  before: () => { scrollReset(); },
  after: (path) => { setActiveNav(path); $('#app')?.focus({ preventScroll: true }); },
});

/* ───────── 启动 ───────── */
function applyBranding() {
  const t = S.settings.site_title || 'TempMail';
  document.title = `${t} — 临时邮箱平台`;
}

async function restoreSession() {
  if (!S.apiKey) return 'ok';
  try {
    const acct = await api.me();
    saveSession(acct, S.apiKey);
    return 'ok';
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      clearSession();
      setTimeout(() => toast('登录状态已失效，请重新登录', 'warn'), 600);
      return 'warn';
    }
    return S.account ? 'warn' : 'fail';
  }
}

async function boot() {
  initFX();
  let shaderOk = false;
  const timeout = (p, ms, fallback = 'warn') => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);

  const checks = [
    { label: '光学着色器 / GLSL CONTEXT', run: async () => { shaderOk = initShader($('#gl')).ok; return shaderOk ? 'ok' : 'warn'; } },
    { label: '字形载入 / TYPEFACES', run: () => timeout(document.fonts.ready.then(() => 'ok'), 2800) },
    { label: '公共配置 / PUBLIC SETTINGS', run: async () => { S.settings = (await api.publicSettings()) || {}; applyBranding(); return 'ok'; } },
    { label: '服务脉冲 / API HEALTH', run: () => timeout(api.health().then(() => 'ok'), 4000, 'fail') },
    { label: '会话校准 / SESSION', run: restoreSession },
    { label: '栅格锁定 / 12-COL GRID', run: async () => 'ok' },
  ];

  await runPreloader(checks, async () => {
    renderHeader();
    await startRouter();
  });
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('pre')?.remove();
  document.body.classList.remove('is-loading');
  $('#app').innerHTML = `<div class="wrap view"><div class="page-head"><p class="mono dim">[ERR] 启动失败</p><p class="display-s" style="margin-top:12px">${esc(e.message || e)}</p></div></div>`;
});
