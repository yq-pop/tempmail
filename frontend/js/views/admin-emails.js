// 管理 · 全部邮件：跨用户查询邮件列表并查看详情（仅管理员；后端接口同样限制为管理员）
import { $, $$, esc, on, fmtDate } from 'core/util';
import { api } from 'core/api';
import { toast, frame, col, icon, numberFrames } from 'core/ui';
import { scrollToEl } from 'fx/scroll';
import { renderMailReader } from 'views/mail-reader';

const SIZE = 20;
const FIELDS = [['sender', '发件人'], ['subject', '主题'], ['user', '用户'], ['mailbox', '邮箱']];
const wide = () => matchMedia('(min-width: 961px)').matches;
const detailUrl = (id) => `#/admin/emails/${encodeURIComponent(id)}`;

export default {
  async mount(root, params = {}) {
    // 搜索条件：field 只在有关键词时才会发送给后端；order 按邮件接收时间排序。
    const state = { field: 'sender', q: '', order: 'desc', page: 1, total: 0, items: [], selected: params.id || null };
    let alive = true, loadSeq = 0, readSeq = 0;
    const offs = [];

    root.innerHTML = `
    <div class="wrap view">
      <section class="page-head g12">
        <div class="col" style="${col(1, 9)}">
          <p class="kicker mono"><b>[ROUTE A2]</b><span>/ ADMIN / EMAILS</span><span>全部邮件</span></p>
          <h1 class="display" data-skew data-reveal="mask"><span class="line"><span class="outline">All</span></span><span class="line" style="--i:1"><span>Mails</span></span></h1>
        </div>
        <div class="col side" style="${col(10, 3)}"><p>跨用户查看全部邮件。<em>仅管理员可见。</em></p></div>
      </section>

      <div data-xray="SEARCH" style="margin-bottom:var(--gut)">
        ${frame({ sub: '搜索与排序', code: 'ADM-FIND' }, `
          <form id="ae-form" class="ae-bar" novalidate>
            <div class="ae-cell"><label class="lbl" for="ae-field"><span>搜索字段</span></label>
              <select class="select" id="ae-field">${FIELDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
            <div class="ae-cell ae-q"><label class="lbl" for="ae-q"><span>关键词</span></label>
              <input class="input" id="ae-q" type="search" placeholder="输入关键词，回车搜索" autocomplete="off" spellcheck="false" maxlength="200" /></div>
            <div class="ae-cell"><span class="lbl" id="ae-order-l"><span>按接收时间</span></span>
              <div class="seg" role="radiogroup" aria-labelledby="ae-order-l">
                <label><input type="radio" name="ae-order" value="desc" checked /><span>↓ 降序</span></label>
                <label><input type="radio" name="ae-order" value="asc" /><span>↑ 升序</span></label>
              </div></div>
            <div class="ae-cell ae-act">
              <button type="submit" class="btn btn--solid btn--sm" data-cursor="搜索">搜索 ▸</button>
              <button type="button" class="btn btn--sm btn--ghost" data-act="clear" data-cursor="清除" hidden>清除</button>
              <button type="button" class="btn btn--sm" data-act="refresh" data-cursor="刷新">${icon('refresh', 13)} 刷新</button>
            </div>
          </form>`)}
      </div>

      <div class="g12 inbox-grid" style="row-gap:var(--gut)">
        <div class="col" style="${col(1, 7)}" data-xray="LIST">
          ${frame({ sub: '邮件列表', code: 'ADM-MAILS', cls: 'frame--flush' }, '<div id="ae-body"><div class="scanline" role="progressbar" aria-label="加载中"></div></div>')}
        </div>
        <div class="col sticky" style="${col(8, 5)}" data-xray="READER">
          ${frame({ sub: '阅读窗格', code: 'ADM-READ' }, '<div class="reader" id="ae-reader"></div>')}
        </div>
      </div>
    </div>`;

    const bodyEl = $('#ae-body', root), readerEl = $('#ae-reader', root);
    const fieldSel = $('#ae-field', root), qInput = $('#ae-q', root), clearBtn = $('[data-act="clear"]', root);
    const fieldLabel = (v) => (FIELDS.find(([k]) => k === v) || FIELDS[0])[1];

    /* ── 列表 ── */
    function render() {
      const pages = Math.max(1, Math.ceil(state.total / SIZE));
      const rows = state.items.map((m) => `
        <tr class="${String(m.id) === String(state.selected) ? 'is-active' : ''}" data-id="${esc(m.id)}" tabindex="0" role="button" data-cursor="阅读">
          <td class="ae-from">${esc(m.sender || '(无发件人)')}</td>
          <td class="ae-subj">${esc(m.subject || '(无主题)')}</td>
          <td class="ae-who"><b>${esc(m.username || '—')}</b><span class="mono dim">${esc(m.mailbox || '—')}</span></td>
          <td class="mono dim ae-time">${esc(fmtDate(m.received_at))}</td>
        </tr>`).join('');
      const emptyText = state.q ? `没有「${fieldLabel(state.field)}」包含「${esc(state.q)}」的邮件` : '暂无邮件';
      bodyEl.innerHTML = `
        <div class="tbl-wrap"><table class="tbl ae-tbl"><thead><tr><th>发件人</th><th>主题</th><th>用户 / 邮箱</th><th>接收时间</th></tr></thead><tbody>
          ${rows || `<tr class="empty"><td colspan="4">${emptyText}</td></tr>`}
        </tbody></table></div>
        <div class="row between mono" style="padding:16px 18px;border-top:1px solid var(--hair)">
          <span class="dim">共 ${state.total} 封${state.q ? ' · 已筛选' : ''} · 第 ${state.page}/${pages} 页 · ${state.order === 'asc' ? '最早在前' : '最新在前'}</span>
          <span class="row"><button type="button" class="btn btn--sm" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>◂ 上一页</button><button type="button" class="btn btn--sm" data-page="${state.page + 1}" ${state.page >= pages ? 'disabled' : ''}>下一页 ▸</button></span>
        </div>`;
    }

    async function load({ page = state.page, manual = false } = {}) {
      const my = ++loadSeq;
      let res;
      try {
        res = await api.admin.listEmails({
          field: state.q ? state.field : '', q: state.q, order: state.order, page, size: SIZE,
        });
      } catch (e) {
        if (!alive || my !== loadSeq) return;
        bodyEl.innerHTML = `<div class="notice notice--err" style="margin:20px"><span class="mono">[ERR]</span><span>加载失败：${esc(e.message)}</span></div>`;
        if (manual) toast('刷新失败：' + e.message, 'error');
        return;
      }
      if (!alive || my !== loadSeq) return;
      state.total = res.total || 0;
      const pages = Math.max(1, Math.ceil(state.total / SIZE));
      if (page > pages) { load({ page: pages }); return; } // 当前页已无数据（例如邮件被清理），回到最后一页
      state.page = page;
      state.items = res.data || [];
      render();
      if (manual) toast('已刷新', 'success');
    }

    /* ── 阅读窗格 ── */
    function renderEmptyReader() {
      readerEl.innerHTML = '<div class="empty"><p class="serif">选择左侧一封邮件</p><p class="hint">点击列表中的邮件，在此处阅读详情。</p></div>';
    }
    async function openEmail(eid, { scroll = false } = {}) {
      state.selected = eid;
      history.replaceState(null, '', detailUrl(eid));
      $$('tr[data-id]', bodyEl).forEach((tr) => tr.classList.toggle('is-active', tr.dataset.id === String(eid)));
      const my = ++readSeq;
      readerEl.innerHTML = '<div class="scanline" role="progressbar" aria-label="读取中"></div>';
      if (scroll && !wide()) scrollToEl(readerEl, 12);
      let e;
      try { e = await api.admin.getEmail(eid); }
      catch (err) {
        if (!alive || my !== readSeq) return;
        readerEl.innerHTML = `<div class="notice notice--err"><span class="mono">[ERR]</span><span>${err.status === 404 ? '邮件不存在（可能已被删除或随邮箱清理）' : '读取失败：' + esc(err.message)}</span></div>`;
        return;
      }
      if (!alive || my !== readSeq) return;
      renderMailReader(readerEl, e, { to: e.mailbox, extraMeta: [['USER', e.username || '—']] });
    }

    /* ── 搜索栏 ── */
    function applyFilters() {
      state.field = fieldSel.value;
      state.q = qInput.value.trim();
      clearBtn.hidden = !state.q;
      load({ page: 1 });
    }

    offs.push(
      on(root, 'submit', '#ae-form', (e) => { e.preventDefault(); applyFilters(); }),
      on(root, 'change', '#ae-field', () => { if (qInput.value.trim() || state.q) applyFilters(); else state.field = fieldSel.value; }),
      on(root, 'change', 'input[name="ae-order"]', (e, el) => { state.order = el.value; load({ page: 1 }); }),
      on(root, 'click', '[data-act="refresh"]', () => load({ manual: true })),
      on(root, 'click', '[data-act="clear"]', () => { qInput.value = ''; applyFilters(); qInput.focus(); }),
      on(bodyEl, 'click', '[data-page]', (e, t) => load({ page: Number(t.dataset.page) })),
      on(bodyEl, 'click', 'tr[data-id]', (e, t) => openEmail(t.dataset.id, { scroll: true })),
      on(bodyEl, 'keydown', 'tr[data-id]', (e, t) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEmail(t.dataset.id, { scroll: true }); } }),
    );

    numberFrames(root);
    renderEmptyReader();
    if (state.selected) openEmail(state.selected);
    await load({ page: 1 });

    return () => { alive = false; offs.forEach((f) => f()); };
  },
};
