// 域名池：待验证队列（实时轮询）+ 可用域名 + 提交控制台 + 添加指南
import { $, $$, esc, timeAgo } from 'core/util';
import { S, isAdmin } from 'core/state';
import { api, dnsRecordsFor } from 'core/api';
import { toast, frame, col, tag, dnsTable, mxDetails, numberFrames } from 'core/ui';
import { mountSubmitConsole } from 'views/mx-console';

export default {
  async mount(root) {
    root.innerHTML = `
    <div class="wrap view">
      <section class="page-head g12">
        <div class="col" style="${col(1, 9)}">
          <p class="kicker mono"><b>[ROUTE 02]</b><span>/ DOMAINS</span><span>域名列表 &amp; 添加指南</span></p>
          <h1 class="display" data-skew data-reveal="mask"><span class="line"><span class="outline">Domain</span></span><span class="line" style="--i:1"><span>Pool</span></span></h1>
        </div>
        <div class="col side" style="${col(10, 3)}"><p>查看可用域名，<em>并了解如何添加新域名。</em></p></div>
      </section>
      <div class="g12" style="row-gap:var(--gut)">
        <div class="col stack" style="${col(1, 7)};--gap:var(--gut)" id="dom-left"><div class="scanline"></div></div>
        <div class="col sticky" style="${col(8, 5)}" data-xray="CONSOLE">
          ${frame({ sub: '提交域名自动验证', code: 'TM-MX' }, '<div id="submit-host"></div>')}
        </div>
      </div>
      <div class="string" data-l="PROC" data-r="1→4" aria-hidden="true"></div>
      <div class="g12">
        <div class="col" style="${col(4, 9)}" data-xray="GUIDE">
          ${frame({ sub: '添加域名指南', code: 'TM-GUIDE' }, '<div id="guide"></div>')}
        </div>
      </div>
    </div>`;

    let alive = true, poller = null;
    const left = $('#dom-left', root);

    const capTags = (d) => `${d.supports_single ? tag('ok', '单域名') : tag('off', '单域名未通过', 'tag--plain')} ${d.supports_wildcard ? tag('ok', '通配子域') : tag('off', '通配未通过', 'tag--plain')}`;

    async function load() {
      let domains = [];
      try { domains = await api.domains(); } catch (e) { left.innerHTML = `<div class="notice notice--err"><span class="mono">[ERR]</span><span>${esc(e.message)}</span></div>`; return; }
      if (!alive) return;
      const pending = domains.filter((d) => d.status === 'pending');
      const active = domains.filter((d) => d.status !== 'pending');

      left.innerHTML = `
        ${pending.length ? frame({ sub: `待 MX 验证 (${pending.length})`, code: 'QUEUE', cls: 'frame--dash', xray: 'QUEUE' }, `
          <p class="hint" style="margin-bottom:14px">后台每 30 秒自动检测，验证通过后自动激活。</p>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>域名</th><th>上次检测</th><th>状态</th></tr></thead><tbody>
            ${pending.map((d) => `<tr id="pr-${esc(d.id)}"><td class="mono-cell">${esc(d.domain)}</td><td class="mono dim">${esc(d.mx_checked_at ? timeAgo(d.mx_checked_at) : '待首次检测')}</td><td id="ps-${esc(d.id)}">${tag('warn', '检测中', 'tag--live')}</td></tr>`).join('')}
          </tbody></table></div>`) : ''}
        ${frame({ sub: '可用域名池', code: 'POOL', cls: 'frame--flush', xray: 'POOL' }, `
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>域名</th><th>能力</th><th>状态</th></tr></thead><tbody>
            ${active.length ? active.map((d) => `<tr><td class="mono-cell">${esc(d.base_domain || d.domain)}</td><td><div class="row" style="gap:6px">${capTags(d)}</div></td><td>${d.is_active ? tag('ok', '启用') : tag('off', '停用')}</td></tr>`).join('') : '<tr class="empty"><td colspan="3">暂无域名</td></tr>'}
          </tbody></table></div>`)}
        ${isAdmin() ? '<p class="hint">管理员可在「域名管理」中启停、删除域名并刷新 MX 能力。</p>' : ''}`;
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
              st.innerHTML = `${tag('warn', '检测中', 'tag--live')}<span class="mono dim" style="margin-left:8px">上次 ${esc(d.mx_checked_at ? timeAgo(d.mx_checked_at) : '从未')}</span>${mxDetails(d.mx_details)}`;
            }
          } catch { /* 静默 */ }
        }
        if (!remaining.size) clearInterval(poller);
      }, 5000);
    }

    /* ── 指南 ── */
    const ex = dnsRecordsFor('mail.example.com', S.settings?.smtp_server_ip || '', S.settings?.smtp_hostname || '');
    $('#guide', root).innerHTML = `<div class="steps">
      <div class="step"><span class="step-n">1</span><div><h4>准备域名</h4><p>在域名注册商处购买一个域名，例如 <code>example.com</code>，并获取 DNS 管理权限。</p></div></div>
      <div class="step"><span class="step-n">2</span><div><h4>配置 MX 记录</h4><p>提交基础域名（如 <code>mail.example.com</code>），系统会分别检测单域名 MX 和通配子域 MX，并按可用能力开放生成模式。</p><div style="margin-top:12px">${dnsTable(ex)}</div></div></div>
      <div class="step"><span class="step-n">3</span><div><h4>提交域名自动验证</h4><p>DNS 广播后（通常 5–30 分钟），在右侧控制台提交域名：</p><ul><li>MX 已生效 → 立即激活并加入域名池</li><li>MX 未生效 → 进入待验证队列，后台每 30 秒自动重试</li></ul></div></div>
      <div class="step"><span class="step-n">4</span><div><h4>验证收信</h4><p>域名激活后，创建该域名下的邮箱，用其他邮件客户端发送测试邮件，30 秒内应能收到。</p></div></div>
    </div>`;

    const stopConsole = mountSubmitConsole($('#submit-host', root), { onActivated: () => load() });
    await load();
    return () => { alive = false; clearInterval(poller); stopConsole(); };
  },
};
