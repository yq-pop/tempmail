// 哈希路由：#/  #/mailbox/:id[/:eid]  #/domains  #/api  #/key  #/admin/*
import { $ } from 'core/util';
import { S, isAuthed, isAdmin, emit } from 'core/state';
import { toast, numberFrames, closePanel } from 'core/ui';

const routes = [];
let cleanup = null;
let token = 0;
let hooks = { before() {}, after() {} };

export function defineRoutes(list, h) {
  routes.length = 0;
  list.forEach(([pattern, spec]) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ re, keys, ...spec });
  });
  hooks = { ...hooks, ...h };
}

export const currentPath = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];
export const go = (path) => { if (currentPath() === path) refresh(); else location.hash = '#' + path; };
export const refresh = () => run();

function match(path) {
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { r, params };
    }
  }
  return null;
}

async function run() {
  const my = ++token;
  const path = currentPath();
  let hit = match(path);

  // 访问控制：未登录只能看落地页；非管理员不能进 /admin
  if (!hit || (hit.r.auth && !isAuthed()) || (hit.r.admin && !isAdmin())) {
    if (hit && hit.r.auth && !isAuthed()) { /* 未登录 → 落地页 */ }
    else if (hit && hit.r.admin && !isAdmin()) toast('需要管理员权限', 'warn');
    if (path !== '/') { history.replaceState(null, '', '#/'); }
    hit = match('/');
  }

  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  closePanel(true);

  const root = $('#app');
  hooks.before(path, hit.r);
  root.innerHTML = '';
  const view = isAuthed() && hit.r.authed ? hit.r.authed : hit.r.view;
  try {
    const mod = await view();
    if (my !== token) return;
    const ret = await mod.default.mount(root, hit.params);
    if (my !== token) { if (typeof ret === 'function') ret(); return; }
    cleanup = typeof ret === 'function' ? ret : null;
    numberFrames(root);
  } catch (e) {
    console.error(e);
    if (my !== token) return;
    root.innerHTML = `<div class="wrap view"><div class="page-head"><p class="mono dim">[ERR] 视图加载失败</p><p class="display-s" style="margin-top:12px">${String(e.message || e).replace(/[<>&]/g, '')}</p></div></div>`;
  }
  hooks.after(path, hit.r);
  emit('route', { path });
}

export function startRouter() {
  addEventListener('hashchange', run);
  return run();
}
