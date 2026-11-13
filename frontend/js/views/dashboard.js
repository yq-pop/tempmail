// 邮箱总览：读数条 + 邮箱索引 + 内嵌「新建邮箱」控制台
import { $, $$, esc, on, pad, fmtDate, fmtClock, countUp } from 'core/util';
import { S, isAdmin } from 'core/state';
import { api } from 'core/api';
import { toast, frame, col, copyText, confirmPanel, icon, tag, numberFrames } from 'core/ui';
import { go } from 'core/router';

function splitAddr(full) {
  const i = String(full).lastIndexOf('@');
  return i < 0 ? [String(full), ''] : [full.slice(0, i), full.slice(i + 1)];
}

export default {
  async mount(root) {
    const admin = isAdmin();
    root.innerHTML = `
    <div class="wrap view">
      <section class="page-head g12">
        <div class="col" style="${col(1, 9)}">
          <p class="kicker mono"><b>[ROUTE 01]</b><span>/ MAILBOXES</span><span>邮箱总览</span></p>
          <h1 class="display" data-skew data-reveal="mask"><span class="line"><span class="outline">Mail</span></span><span class="line" style="--i:1"><span>Boxes</span></span></h1>
        </div>
        <div class="col side" style="${col(10, 3)}"><p>管理您的临时邮箱。<em>每一个地址都有保质期。</em></p></div>
      </section>
      <div id="dash-body"><div class="scanline" role="progressbar" aria-label="加载中"></div></div>
    </div>`;

    let alive = true;
    const offs = [];
    let timer = null;
    const bodyEl = $('#dash-body', root);

    let [mailboxes, domains, st, pub] = [[], [], {}, {}];
    try {
      [mailboxes, domains, st, pub] = await Promise.all([
        api.listMailboxes(),
        api.domains(),
        api.stats().catch(() => ({})),
        api.publicSettings().catch(() => ({})),
      ]);
    } catch (e) {
      bodyEl.innerHTML = `<div class="notice notice--err"><span class="mono">[ERR]</span><span>加载失败：${esc(e.message)}</span></div>`;
      return;
    }
    if (!alive) return;
    S.mailboxes = mailboxes || [];
    if (pub && Object.keys(pub).length) S.settings = { ...S.settings, ...pub };

    const activeDomains = (domains || []).filter((d) => d.is_active);
    const pending = (domains || []).filter((d) => d.status === 'pending').length;
    const cells = [
      { l: '我的邮箱', v: S.mailboxes.length, n: '当前有效' },
      { l: '可用域名', v: activeDomains.length, n: `共 ${(domains || []).length} 个` },
      { l: '收到邮件', v: st.total_emails ?? '—', n: '全平台累计' },
      { l: '邮箱总量', v: st.total_mailboxes ?? '—', n: `活跃 ${st.active_mailboxes ?? '—'} 个` },
      ...(admin ? [
        { l: '账户总数', v: st.total_accounts ?? '—', n: '注册用户' },
        { l: '待验证域名', v: st.pending_domains ?? pending, n: pending > 0 ? '验证中' : '无' },
      ] : []),
    ];
    const announcement = (pub.announcement || '').trim();
    const annUnit = `<span class="x">✕</span><span>公告 / NOTICE</span><span class="x">✕</span><span>${esc(announcement)}</span>`;

    bodyEl.innerHTML = `
      ${announcement ? `<div class="marquee marquee--sm" role="note" aria-label="公告: ${esc(announcement)}"><div class="marquee-track">${annUnit.repeat(3)}</div></div>` : ''}
      <div class="readout" data-reveal data-xray="READOUT">
        ${cells.map((c) => `<div class="cell"><span class="mono dim">${esc(c.l)}</span><span class="cell-v" ${typeof c.v === 'number' ? `data-n="${c.v}"` : ''}>${typeof c.v === 'number' ? 0 : esc(c.v)}</span><span class="mono dim">${esc(c.n)}</span></div>`).join('')}
      </div>
      ${pending > 0 ? `<div class="notice mt-s"><span class="mono">[SCAN]</span><span>有 ${pending} 个域名正在 MX 验证中，通过后将自动加入域名池。<a href="#/domains" class="sig" data-cursor="查看">查看进度 ▸</a></span></div>` : ''}
      <div class="string" data-l="IDX" data-r="NEW" aria-hidden="true"></div>
      <div class="g12" style="row-gap:var(--gut)">
        <div class="col" style="${col(1, 8)}" data-xray="INDEX">
          ${frame({ sub: '邮箱索引', code: 'TM-IDX', cls: 'frame--flush' }, '<div id="mb-index"></div>')}
        </div>
        <div class="col sticky" style="${col(9, 4)}" data-xray="CONSOLE">
          ${frame({ sub: '新建邮箱', code: 'TM-NEW' }, '<form id="mb-form" novalidate></form>')}
        </div>
      </div>`;
    $$('[data-n]', bodyEl).forEach((el) => countUp(el, el.dataset.n));
    numberFrames(root);

    /* ── 邮箱索引 ── */
    const idx = $('#mb-index', bodyEl);
    function renderList(highlightId) {
      const boxes = S.mailboxes;
      if (!boxes.length) {
        idx.innerHTML = `<div class="empty"><p class="serif">尚无邮箱</p><p class="hint">在右侧控制台创建第一个邮箱，<br/>地址将在到期后自动销毁。</p></div>`;
        return;
      }
      idx.innerHTML = `<ul class="mb-list" style="border-top:0">${boxes.map((mb, i) => {
        const [local, dom] = splitAddr(mb.full_address);
        return `<li class="mb-row ${String(mb.id) === String(highlightId) ? 'is-new' : ''}" data-id="${esc(mb.id)}" data-addr="${esc(mb.full_address)}" data-exp="${esc(mb.expires_at || '')}" data-cr="${esc(mb.created_at || '')}">
          <span class="mb-no mono">[${pad(i + 1)}]</span>
          <button type="button" class="mb-addr" data-act="open" data-cursor="打开" aria-label="打开 ${esc(mb.full_address)}">${esc(local)}<em>@</em>${esc(dom)}</button>
          <span class="mb-acts">
            <button type="button" class="icon-btn" data-act="copy" aria-label="复制地址" data-cursor="复制">${icon('copy')}</button>
            <button type="button" class="icon-btn" data-act="open" aria-label="查看邮件" data-cursor="收信">${icon('open')}</button>
            <button type="button" class="icon-btn danger" data-act="del" aria-label="删除邮箱" data-cursor="删除">${icon('trash')}</button>
          </span>
          <span class="mb-meta mono"><span>创建 ${fmtDate(mb.created_at)}</span><span class="ttl">—</span><span class="gauge" aria-hidden="true"><i></i></span></span>
        </li>`;
      }).join('')}</ul>`;
      tickTTL();
    }

    function tickTTL() {
      const now = Date.now();
      $$('.mb-row', idx).forEach((row) => {
        const ttl = $('.ttl', row), g = $('.gauge', row);
        if (!row.dataset.exp) { ttl.textContent = '永不过期'; g.style.display = 'none'; return; }
        const exp = Date.parse(row.dataset.exp), cr = Date.parse(row.dataset.cr) || exp - 30 * 60000;
        const left = exp - now;
        const total = Math.max(1, exp - cr);
        if (left <= 0) { ttl.textContent = '已过期'; ttl.className = 'ttl crit'; g.className = 'gauge crit'; g.firstElementChild.style.setProperty('--p', 0); return; }
        const mins = left / 60000;
        const level = mins <= 5 ? 'crit' : mins <= 15 ? 'warn' : '';
        ttl.textContent = `剩余 ${fmtClock(left)}`;
        ttl.className = 'ttl ' + level;
        g.className = 'gauge ' + level;
        g.firstElementChild.style.setProperty('--p', Math.max(0, Math.min(1, left / total)).toFixed(4));
      });
    }
    timer = setInterval(tickTTL, 1000);

    async function reload(highlightId) {
      try { S.mailboxes = await api.listMailboxes(); } catch (e) { toast('刷新失败：' + e.message, 'error'); }
      if (!alive) return;
      renderList(highlightId);
      const first = $('[data-n]', bodyEl); // 首个读数是「我的邮箱」
      if (first) first.textContent = S.mailboxes.length.toLocaleString();
    }

    offs.push(on(idx, 'click', '[data-act]', async (e, t) => {
      const row = t.closest('.mb-row');
      const id = row.dataset.id, addr = row.dataset.addr;
      if (t.dataset.act === 'open') go('/mailbox/' + id);
      else if (t.dataset.act === 'copy') copyText(addr);
      else if (t.dataset.act === 'del') {
        const ok = await confirmPanel({
          code: 'DELETE MAILBOX', title: '删除邮箱', danger: true, confirmText: '确认删除',
          message: `<p>确定删除 <strong style="font-family:var(--mono);word-break:break-all">${esc(addr)}</strong>？</p><p class="notice notice--err"><span class="mono">[!]</span><span>所有邮件将被永久删除，无法恢复。</span></p>`,
        });
        if (!ok) return;
        try { await api.deleteMailbox(id); toast('邮箱已删除', 'success'); reload(); }
        catch (err) { toast('删除失败：' + err.message, 'error'); }
      }
    }));
    renderList();

    /* ── 新建邮箱控制台 ── */
    const form = $('#mb-form', bodyEl);
    const opts = activeDomains.map((d) => {
      const label = d.base_domain || String(d.domain || '').replace(/^\*\./, '');
      const single = !!d.supports_single, wild = !!d.supports_wildcard;
      const suffix = single && wild ? '（单域名/通配）' : wild ? '（通配）' : '（单域名）';
      return `<option value="${esc(d.id)}" data-single="${single ? 1 : 0}" data-wild="${wild ? 1 : 0}" data-base="${esc(label)}">${esc(label)}${suffix}</option>`;
    }).join('');
    form.innerHTML = `
      <div class="field"><label for="mb-address"><b>FIELD 01</b><span>本地部分 · @ 之前</span></label>
        <input class="input" id="mb-address" placeholder="留空则随机生成" autocomplete="off" spellcheck="false" />
        <p class="hint">只允许字母、数字、连字符、下划线</p></div>
      <div class="field"><label for="mb-domain"><b>FIELD 02</b><span>域名</span></label>
        <select class="select" id="mb-domain"><option value="">随机选取</option>${opts}</select>
        <p class="hint">系统会按该域名当前可用的 MX 能力创建邮箱。</p></div>
      <div class="field" id="mb-mode-group" hidden><label><b>FIELD 03</b><span>生成模式</span></label>
        <div class="seg" role="radiogroup">
          <label id="mb-single-wrap"><input type="radio" name="mb-mode" value="single" checked /><span>单域名</span></label>
          <label id="mb-multi-wrap"><input type="radio" name="mb-mode" value="multi" /><span>随机多级</span></label>
        </div>
        <p class="hint" id="mb-mode-hint"></p></div>
      <div class="field" id="mb-sub-group" hidden><label for="mb-subdomain"><b>FIELD 04</b><span>自定义多级子域</span></label>
        <div class="affix"><input class="input" id="mb-subdomain" placeholder="留空则随机，如 gmail.outlook" autocomplete="off" spellcheck="false" /><span id="mb-sub-suffix"></span></div>
        <p class="hint">只允许字母、数字、连字符和点，每段不能以连字符开头或结尾。</p></div>
      <button type="submit" class="btn btn--solid btn--block" id="mb-submit" data-cursor="创建">创建邮箱 ▸</button>
      ${activeDomains.length === 0 ? '<p class="notice notice--err mt-s"><span class="mono">[!]</span><span>域名池为空，暂时无法创建。请先到「域名」页提交域名。</span></p>' : ''}`;

    const sel = $('#mb-domain', form), modeGroup = $('#mb-mode-group', form), subGroup = $('#mb-sub-group', form);
    const modeOf = () => form.querySelector('input[name="mb-mode"]:checked')?.value || 'single';
    function syncMode() {
      const opt = sel.options[sel.selectedIndex];
      const base = opt?.dataset?.base || '';
      const canSingle = !opt || !opt.value || opt.dataset.single === '1';
      const canWild = !opt || !opt.value || opt.dataset.wild === '1';
      const single = form.querySelector('input[name="mb-mode"][value="single"]');
      const multi = form.querySelector('input[name="mb-mode"][value="multi"]');
      $('#mb-single-wrap', form).style.display = canSingle ? '' : 'none';
      $('#mb-multi-wrap', form).style.display = canWild ? '' : 'none';
      if (!canSingle && canWild) multi.checked = true;
      if (canSingle && !canWild) single.checked = true;
      const mode = modeOf();
      modeGroup.hidden = !((canSingle && canWild) || (!canSingle && canWild));
      subGroup.hidden = !(canWild && mode === 'multi');
      $('#mb-sub-suffix', form).textContent = base ? '.' + base : '';
      $('#mb-mode-hint', form).textContent = mode === 'multi' ? '多级域名会生成 @a.b.c.mail.example.com。' : '单域名会生成 @mail.example.com。';
    }
    offs.push(on(form, 'change', '#mb-domain, input[name="mb-mode"]', syncMode));
    syncMode();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#mb-submit', form);
      const opt = sel.options[sel.selectedIndex];
      const canWild = !opt || !opt.value || opt.dataset.wild === '1';
      const mode = modeOf();
      const address = $('#mb-address', form).value.trim();
      const subdomain = $('#mb-subdomain', form).value.trim();
      const domainID = Number(sel.value || 0);
      const body = { mode };
      if (address) body.address = address;
      if (domainID) body.domain_id = domainID;
      if (canWild && mode === 'multi' && subdomain) body.subdomain = subdomain;
      btn.disabled = true;
      try {
        const mb = await api.createMailbox(body);
        toast(`已创建：${mb.full_address}`, 'success');
        $('#mb-address', form).value = '';
        await reload(mb.id);
      } catch (err) { toast('创建失败：' + err.message, 'error'); }
      finally { btn.disabled = false; }
    });

    return () => { alive = false; clearInterval(timer); offs.forEach((f) => f()); };
  },
};
