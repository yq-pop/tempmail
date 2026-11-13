// 管理 · 账户：分页列表 + 内嵌「创建账户」控制台
import { $, esc, on, fmtDate } from 'core/util';
import { api } from 'core/api';
import { toast, frame, col, copyText, confirmPanel, icon, tag, numberFrames } from 'core/ui';

const SIZE = 10;

export default {
  async mount(root) {
    root.innerHTML = `
    <div class="wrap view">
      <section class="page-head g12">
        <div class="col" style="${col(1, 9)}">
          <p class="kicker mono"><b>[ROUTE A1]</b><span>/ ADMIN / ACCOUNTS</span><span>账户管理</span></p>
          <h1 class="display" data-skew data-reveal="mask"><span class="line"><span class="outline">Admin</span></span><span class="line" style="--i:1"><span>Accounts</span></span></h1>
        </div>
        <div class="col side" style="${col(10, 3)}"><p>创建和管理用户账户。<em>Key 默认模糊。</em></p></div>
      </section>
      <div class="g12" style="row-gap:var(--gut)">
        <div class="col" style="${col(1, 8)}" data-xray="TABLE">${frame({ sub: '账户列表', code: 'ADM-ACC', cls: 'frame--flush' }, '<div id="acc-body"><div class="scanline"></div></div>')}</div>
        <div class="col sticky" style="${col(9, 4)}" data-xray="CONSOLE">${frame({ sub: '创建账户', code: 'ADM-NEW' }, `
          <form id="acc-form" novalidate>
            <div class="field"><label for="acc-name"><b>FIELD 01</b><span>用户名</span></label><input class="input" id="acc-name" placeholder="username" autocomplete="off" spellcheck="false" /><p class="hint">2–64 个字符；创建后将生成专属 API Key。</p></div>
            <button type="submit" class="btn btn--solid btn--block" data-cursor="创建">创建账户 ▸</button>
          </form>
          <div id="acc-created" class="mt-s"></div>`)}</div>
      </div>
    </div>`;

    let page = 1, alive = true;
    const body = $('#acc-body', root);

    async function load(p = page) {
      page = p;
      let res;
      try { res = await api.admin.listAccounts(page, SIZE); }
      catch (e) { body.innerHTML = `<div class="notice notice--err" style="margin:20px"><span class="mono">[ERR]</span><span>${esc(e.message)}</span></div>`; return; }
      if (!alive) return;
      const accounts = res.data || [];
      const total = res.total || 0;
      const pages = Math.max(1, Math.ceil(total / SIZE));
      body.innerHTML = `
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>用户名 / KEY</th><th>角色</th><th>收件统计</th><th>创建时间</th><th>操作</th></tr></thead><tbody>
          ${accounts.map((a) => `<tr>
            <td><div style="font-weight:700">${esc(a.username || '—')}</div>
              <div class="row" style="gap:8px;margin-top:6px;flex-wrap:nowrap"><span class="keyfield mono-cell" data-key tabindex="0" role="button" aria-label="点击显示 Key" style="font-size:11px">${esc(a.api_key || '—')}</span><button type="button" class="icon-btn" data-copy="${esc(a.api_key || '')}" aria-label="复制 Key" data-cursor="复制">${icon('copy', 14)}</button></div></td>
            <td>${a.is_admin ? tag('warn', '管理员') : tag('off', '普通用户')}</td>
            <td class="mono" style="line-height:1.9"><div>累计收件 <b>${esc(a.received_email_count || 0)}</b></div><div class="dim">当前邮件 ${esc(a.current_email_count || 0)}</div><div class="dim">邮箱 ${esc(a.active_mailbox_count || 0)}/${esc(a.mailbox_count || 0)}</div></td>
            <td class="mono dim">${esc(fmtDate(a.created_at))}</td>
            <td>${a.is_admin ? '' : `<button type="button" class="btn btn--sm btn--danger" data-del="${esc(a.id)}" data-name="${esc(a.username || '')}" data-cursor="删除">删除</button>`}</td>
          </tr>`).join('') || '<tr class="empty"><td colspan="5">暂无账户</td></tr>'}
        </tbody></table></div>
        <div class="row between mono" style="padding:16px 18px;border-top:1px solid var(--hair)">
          <span class="dim">共 ${total} 个账户 · 第 ${page}/${pages} 页</span>
          <span class="row"><button type="button" class="btn btn--sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>◂ 上一页</button><button type="button" class="btn btn--sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>下一页 ▸</button></span>
        </div>`;
    }

    const offs = [
      on(root, 'click', '[data-page]', (e, t) => load(Number(t.dataset.page))),
      on(root, 'click', '[data-copy]', (e, t) => copyText(t.dataset.copy)),
      on(root, 'click', '[data-key]', (e, t) => t.classList.toggle('is-open')),
      on(root, 'click', '[data-del]', async (e, t) => {
        const ok = await confirmPanel({ code: 'DELETE ACCOUNT', title: '删除账户', danger: true, confirmText: '确认删除', message: `<p>确定删除账户 <strong>${esc(t.dataset.name)}</strong>？</p><p class="hint">该账户下的邮箱与邮件也会被清除。</p>` });
        if (!ok) return;
        try { await api.admin.deleteAccount(t.dataset.del); toast('账户已删除', 'success'); load(); }
        catch (err) { toast('删除失败：' + err.message, 'error'); }
      }),
    ];

    $('#acc-form', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('#acc-name', root);
      const username = input.value.trim();
      if (!username) { toast('请输入用户名', 'warn'); return; }
      const btn = $('button[type=submit]', e.target);
      btn.disabled = true;
      try {
        const r = await api.admin.createAccount({ username });
        toast('账户已创建', 'success');
        input.value = '';
        $('#acc-created', root).innerHTML = `<div class="notice notice--ok"><span class="mono">[OK]</span><span>已创建 <b>${esc(r.username || username)}</b>。API Key：<code style="word-break:break-all">${esc(r.api_key || '')}</code></span></div>`;
        load(1);
      } catch (err) { toast('创建失败：' + err.message, 'error'); }
      finally { btn.disabled = false; }
    });

    await load(1);
    numberFrames(root);
    return () => { alive = false; offs.forEach((f) => f()); };
  },
};
