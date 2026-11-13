// 管理 · 域名：待验证队列 + 域名池（启停 / 删除 / 刷新 MX）+ 提交 / 手动添加控制台
import { $, esc, on, timeAgo } from 'core/util';
import { api } from 'core/api';
import { toast, frame, col, confirmPanel, icon, tag, mxDetails, numberFrames } from 'core/ui';
import { mountSubmitConsole, mountManualConsole } from 'views/mx-console';

export default {
  async mount(root) {
    root.innerHTML = `
    <div class="wrap view">
      <section class="page-head g12">
        <div class="col" style="${col(1, 9)}">
          <p class="kicker mono"><b>[ROUTE A2]</b><span>/ ADMIN / DOMAINS</span><span>域名管理</span></p>
          <h1 class="display" data-skew data-reveal="mask"><span class="line"><span class="outline">Domain</span></span><span class="line" style="--i:1"><span>Admin</span></span></h1>
        </div>
        <div class="col side" style="${col(10, 3)}">
          <div class="row end"><button type="button" class="btn btn--sm" data-act="refresh-mx" data-cursor="刷新">${icon('refresh', 13)} 刷新 MX</button></div>
        </div>
      </section>
      <div class="g12" style="row-gap:var(--gut)">
        <div class="col stack" style="${col(1, 7)};--gap:var(--gut)" id="ad-left"><div class="scanline"></div></div>
        <div class="col sticky" style="${col(8, 5)}" data-xray="CONSOLE">
          ${frame({ sub: '域名接入控制台', code: 'ADM-DOM' }, `
            <div class="tabs" role="tablist"><button type="button" class="tab" role="tab" data-tab="auto" aria-selected="true">MX 自动注册</button><button type="button" class="tab" role="tab" data-tab="manual" aria-selected="false">手动添加</button></div>
            <div id="con-auto"></div><div id="con-manual" hidden></div>`)}
        </div>
      </div>
    </div>`;

    let alive = true, poller = null;
    const left = $('#ad-left', root);

    async function load() {
      let domains = [];
      try { domains = await api.domains(); } catch (e) { left.innerHTML = `<div class="notice notice--err"><span class="mono">[ERR]</span><span>${esc(e.message)}</span></div>`; return; }
      if (!alive) return;
      const pending = domains.filter((d) => d.status === 'pending');
      const active = domains.filter((d) => d.status !== 'pending');
      left.innerHTML = `
        ${pending.length ? frame({ sub: `待 MX 验证 (${pending.length})`, code: 'QUEUE', cls: 'frame--dash', xray: 'QUEUE' }, `
          <p class="hint" style="margin-bottom:14px">后台每 30 秒自动检测，验证通过后自动加入域名池。</p>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>域名</th><th>上次检测</th><th>操作</th></tr></thead><tbody>
            ${pending.map((d) => `<tr id="pr-${esc(d.id)}"><td class="mono-cell">${esc(d.domain)}</td><td class="mono dim">${esc(d.mx_checked_at ? timeAgo(d.mx_checked_at) : '从未')}</td><td><div class="ops"><span id="ps-${esc(d.id)}">${tag('warn', '检测中', 'tag--live')}</span><button type="button" class="icon-btn danger" data-del="${esc(d.id)}" data-name="${esc(d.domain)}" aria-label="删除" data-cursor="删除">${icon('trash', 14)}</button></div></td></tr>`).join('')}
          </tbody></table></div>`) : ''}
        ${frame({ sub: '域名列表', code: 'POOL', cls: 'frame--flush', xray: 'POOL' }, `
          <p class="hint" style="padding:14px 18px 0">后台会定期刷新单域名和通配子域能力，共 ${active.length} 个。</p>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>域名</th><th>能力</th><th>状态</th><th>操作</th></tr></thead><tbody>
            ${active.length ? active.map((d) => `<tr>
              <td class="mono-cell">${esc(d.base_domain || d.domain)}</td>
              <td><div class="row" style="gap:6px">${d.supports_single ? tag('ok', '单域名') : tag('off', '单域名未通过', 'tag--plain')}${d.supports_wildcard ? tag('ok', '通配子域') : tag('off', '通配未通过', 'tag--plain')}</div></td>
              <td>${d.is_active ? tag('ok', '启用') : tag('off', '停用')}</td>
              <td><div class="ops"><button type="button" class="btn btn--sm" data-toggle="${esc(d.id)}" data-to="${!d.is_active}" data-cursor="${d.is_active ? '停用' : '启用'}">${d.is_active ? '停用' : '启用'}</button><button type="button" class="btn btn--sm btn--danger" data-del="${esc(d.id)}" data-name="${esc(d.domain)}" data-cursor="删除">删除</button></div></td>
            </tr>`).join('') : '<tr class="empty"><td colspan="4">暂无域名</td></tr>'}
          </tbody></table></div>`)}`;
      numberFrames(root);
      startPoller(pending.map((d) => d.id));
    }

    function startPoller(ids) {
      clearInterval(poller);
      if (!ids.length) return;
      const remaining = new Set(ids);
      poller = setInterval(async () => {
        for (const id of [...remaining]) {
          try {
            const d = await api.getDomainStatus(id);
            if (!alive) return;
            const st = $('#ps-' + id, root);
            if (d.status === 'active') {
              remaining.delete(id);
              if (st) st.innerHTML = tag('ok', '已激活');
              toast(`域名 ${d.domain} MX 验证通过，已加入域名池`, 'success');
              setTimeout(() => { if (alive) load(); }, 1800);
            } else if (st) {
              st.innerHTML = `${tag('warn', '检测中', 'tag--live')}${mxDetails(d.mx_details)}`;
            }
          } catch { /* 静默 */ }
        }
        if (!remaining.size) clearInterval(poller);
      }, 5000);
    }

    const offs = [
      on(root, 'click', '[data-act="refresh-mx"]', async () => {
        try { await api.admin.refreshDomainMX(); toast('MX 能力已刷新', 'success'); load(); }
        catch (e) { toast('刷新失败：' + e.message, 'error'); }
      }),
      on(root, 'click', '[data-toggle]', async (e, t) => {
        try { await api.admin.toggleDomain(t.dataset.toggle, t.dataset.to === 'true'); toast('状态已切换', 'success'); load(); }
        catch (err) { toast('操作失败：' + err.message, 'error'); }
      }),
      on(root, 'click', '[data-del]', async (e, t) => {
        const ok = await confirmPanel({ code: 'DELETE DOMAIN', title: '删除域名', danger: true, confirmText: '确认删除', message: `<p>确定删除域名 <strong style="font-family:var(--mono)">${esc(t.dataset.name)}</strong>？</p><p class="hint">如果该域名下还有邮箱，系统会拒绝删除。你可以先停用域名，避免继续生成新邮箱。</p>` });
        if (!ok) return;
        try { await api.admin.deleteDomain(t.dataset.del); toast('域名已删除', 'success'); load(); }
        catch (err) { toast('删除失败：' + err.message, 'error'); }
      }),
      on(root, 'click', '.tabs [data-tab]', (e, t) => {
        const manual = t.dataset.tab === 'manual';
        $$tabs(root).forEach((b) => b.setAttribute('aria-selected', String(b === t)));
        $('#con-auto', root).hidden = manual;
        $('#con-manual', root).hidden = !manual;
      }),
    ];
    const $$tabs = (r) => Array.from(r.querySelectorAll('.tabs [data-tab]'));

    const stopA = mountSubmitConsole($('#con-auto', root), { onActivated: () => load() });
    const stopM = mountManualConsole($('#con-manual', root), { onAdded: () => load() });
    await load();
    return () => { alive = false; clearInterval(poller); stopA(); stopM(); offs.forEach((f) => f()); };
  },
};
