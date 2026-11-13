// 收信仪：左侧邮件索引 + 右侧阅读窗格（旧版「列表页 / 详情页」合并为双栏）
import { $, $$, esc, on, pad, fmtDate, fmtClock, timeAgo } from 'core/util';
import { S } from 'core/state';
import { api } from 'core/api';
import { toast, frame, col, copyText, confirmPanel, icon, tag } from 'core/ui';
import { go } from 'core/router';
import { scrollToEl } from 'fx/scroll';

const POLL_SECONDS = 8;
const sameIds = (a, b) => a.length === b.length && a.every((e, i) => e.id === b[i].id);
const wide = () => matchMedia('(min-width: 961px)').matches;

function mailDoc(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><base target="_blank">
<style>:root{color-scheme:light}html,body{margin:0}body{padding:26px;font:14px/1.75 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#11110E;background:#F3EFE6;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:#B3280A}table{max-width:100%}pre{white-space:pre-wrap}</style>
</head><body>${html}</body></html>`;
}

export default {
  async mount(root, { id, eid }) {
    let mb = S.mailboxes.find((m) => String(m.id) === String(id));
    if (!mb) {
      try { S.mailboxes = await api.listMailboxes(); mb = S.mailboxes.find((m) => String(m.id) === String(id)); } catch { /* 下面统一处理 */ }
    }
    if (!mb) { toast('邮箱不存在或已过期', 'warn'); go('/'); return; }

    const addr = mb.full_address;
    const at = addr.lastIndexOf('@');
    let emails = [];
    let selected = eid || null;
    let alive = true, nextIn = POLL_SECONDS, timer = null;
    const offs = [];
    const exp = mb.expires_at ? Date.parse(mb.expires_at) : null;

    root.innerHTML = `
    <div class="wrap view">
      <section class="page-head g12">
        <div class="col" style="${col(1, 9)}">
          <p class="kicker mono"><b>[ROUTE 01.1]</b><span>/ INBOX</span><span id="ib-count">0 MSG</span></p>
          <h1 class="addr-big" data-reveal>${esc(addr.slice(0, at))}<em class="serif">@</em>${esc(addr.slice(at + 1))}</h1>
        </div>
        <div class="col side" style="${col(10, 3)}">
          <div class="row end">
            <button type="button" class="btn btn--sm" data-act="copy" data-cursor="复制">复制地址</button>
            <button type="button" class="btn btn--sm" data-act="refresh" data-cursor="刷新">${icon('refresh', 13)} 刷新</button>
            <a class="btn btn--sm btn--ghost" href="#/" data-cursor="返回">${icon('back', 13)} 返回</a>
          </div>
        </div>
      </section>
      <div class="row between mono" style="margin-bottom:18px">
        <span class="tag tag--ok tag--live" id="ib-live">LIVE · 下次校准 ${pad(nextIn)}s</span>
        <span class="dim" id="ib-ttl"></span>
      </div>
      <div class="g12 inbox-grid" style="row-gap:var(--gut)">
        <div class="col" style="${col(1, 5)}" data-xray="LIST">
          ${frame({ sub: '邮件索引', code: 'TM-MSG', cls: 'frame--flush' }, '<div class="mail-list" id="mail-list" style="border-top:0"></div>')}
        </div>
        <div class="col" style="${col(6, 7)}" data-xray="READER">
          ${frame({ sub: '阅读窗格', code: 'TM-READ' }, '<div class="reader" id="reader"></div>')}
        </div>
      </div>
    </div>`;

    const listEl = $('#mail-list', root), readerEl = $('#reader', root);
    const liveEl = $('#ib-live', root), ttlEl = $('#ib-ttl', root), countEl = $('#ib-count', root);

    /* ── 列表 ── */
    function renderList(newIds = new Set()) {
      countEl.textContent = `${emails.length} MSG`;
      if (!emails.length) {
        listEl.innerHTML = `<div class="empty"><p class="serif">暂无邮件</p><p class="hint">向 <code style="word-break:break-all">${esc(addr)}</code> 发送邮件后，<br/>邮件将显示在此处。</p></div>`;
        return;
      }
      listEl.innerHTML = emails.map((e, i) => {
        const from = e.sender || e.from_addr || '(无发件人)';
        const prev = (e.body_text || e.text_body || '').slice(0, 90).replace(/\s+/g, ' ');
        return `<div class="mail-item ${String(e.id) === String(selected) ? 'is-active' : ''} ${newIds.has(e.id) ? 'is-new' : ''}" role="button" tabindex="0" data-eid="${esc(e.id)}" data-cursor="阅读">
          <span class="mi-no mono">${pad(emails.length - i)}</span>
          <span class="mi-time mono">${esc(timeAgo(e.received_at))}</span>
          <span class="mi-from">${esc(from)}</span>
          <span class="mi-subj">${esc(e.subject || '(无主题)')}</span>
          <span class="mi-prev">${esc(prev)}</span>
        </div>`;
      }).join('');
    }

    function renderEmpty() {
      readerEl.innerHTML = `<div class="empty">
        <div class="scope-wrap" style="width:min(100%,520px)"><canvas data-scope="flatline"></canvas><div class="scope-read mono"></div></div>
        <p class="serif">${emails.length ? '选择左侧一封邮件' : '等待信号'}</p>
        <p class="hint">${emails.length ? '点击索引中的条目，在此处阅读。' : '收件箱每 ' + POLL_SECONDS + ' 秒自动校准，无需手动刷新。'}</p>
      </div>`;
    }

    /* ── 阅读窗格 ── */
    let reading = 0;
    async function openEmail(eid2, { scroll = false } = {}) {
      selected = eid2;
      history.replaceState(null, '', `#/mailbox/${encodeURIComponent(id)}/${encodeURIComponent(eid2)}`);
      $$('.mail-item', listEl).forEach((n) => n.classList.toggle('is-active', n.dataset.eid === String(eid2)));
      const my = ++reading;
      readerEl.innerHTML = '<div class="scanline" role="progressbar" aria-label="读取中"></div>';
      if (scroll && !wide()) scrollToEl($('#reader', root), 12);
      let e;
      try { e = await api.getEmail(id, eid2); }
      catch (err) {
        if (my !== reading || !alive) return;
        readerEl.innerHTML = `<div class="notice notice--err"><span class="mono">[ERR]</span><span>读取失败：${esc(err.message)}</span></div>`;
        return;
      }
      if (my !== reading || !alive) return;
      const from = e.sender || e.from_addr || '—';
      const html = e.body_html || e.html_body || '';
      const text = e.body_text || e.text_body || '';
      const raw = e.raw_message || '';
      const tabs = [];
      if (html) tabs.push(['html', 'HTML']);
      tabs.push(['text', 'TEXT']);
      if (raw) tabs.push(['raw', 'RAW']);
      let cur = html ? 'html' : 'text';

      readerEl.innerHTML = `
        <header class="reader-head">
          <div class="row between"><span class="mono dim">ID ${esc(String(e.id).slice(0, 8))}</span>
            <button type="button" class="btn btn--sm btn--danger" data-act="del-email" data-cursor="删除">${icon('trash', 13)} 删除</button></div>
          <h2 class="reader-subject">${esc(e.subject || '(无主题)')}</h2>
          <div class="reader-meta mono"><span>FROM</span><b>${esc(from)}</b><span>TO</span><b>${esc(addr)}</b><span>DATE</span><b>${esc(fmtDate(e.received_at))}</b>${e.size_bytes ? `<span>SIZE</span><b>${esc(e.size_bytes)} B</b>` : ''}</div>
        </header>
        <div class="tabs" role="tablist" style="margin:18px 0 0;border-bottom:0">${tabs.map(([k, l]) => `<button type="button" class="tab" role="tab" data-view="${k}" aria-selected="${k === cur}">${l}</button>`).join('')}</div>
        <div class="paper" id="paper" data-native-cursor></div>`;

      const paper = $('#paper', readerEl);
      let ro = null;
      function paint() {
        if (ro) { ro.disconnect(); ro = null; }
        if (cur === 'html') {
          paper.innerHTML = '<iframe sandbox="allow-same-origin allow-popups" referrerpolicy="no-referrer" title="邮件正文"></iframe>';
          const f = $('iframe', paper);
          const fit = () => {
            try {
              const next = Math.max(200, f.contentDocument.documentElement.scrollHeight) + 'px';
              if (f.style.height !== next) f.style.height = next;
            } catch { /* 跨域保护 */ }
          };
          f.addEventListener('load', () => {
            fit();
            // 必须用 iframe 自身窗口的 ResizeObserver 观察其内部元素；
            // 用父窗口的构造函数跨文档观察会导致每帧都触发 "loop completed with undelivered notifications"
            try {
              const RO = f.contentWindow.ResizeObserver || ResizeObserver;
              ro = new RO(fit);
              ro.observe(f.contentDocument.documentElement);
            } catch { /* ignore */ }
          });
          f.srcdoc = mailDoc(html);
          setTimeout(fit, 400);
        } else {
          paper.innerHTML = `<pre>${esc(cur === 'raw' ? raw : (text || '(邮件内容为空)'))}</pre>`;
        }
      }
      paint();
      // 绑定在本次渲染生成的标签上，随阅读窗格重绘自动释放
      $$('[data-view]', readerEl).forEach((t) => t.addEventListener('click', () => {
        cur = t.dataset.view;
        $$('[data-view]', readerEl).forEach((b) => b.setAttribute('aria-selected', String(b === t)));
        paint();
      }));
    }

    /* ── 轮询 ── */
    async function poll({ manual = false } = {}) {
      try {
        const fresh = await api.listEmails(id);
        if (!alive) return;
        if (!sameIds(fresh, emails)) {
          const known = new Set(emails.map((e) => e.id));
          const added = fresh.filter((e) => !known.has(e.id));
          const first = emails.length === 0 && !listEl.dataset.init;
          emails = fresh;
          const newIds = new Set(first ? [] : added.map((e) => e.id));
          renderList(newIds);
          if (added.length && !first) toast(`收到 ${added.length} 封新邮件`, 'success');
          if (selected && !emails.some((e) => String(e.id) === String(selected))) { selected = null; renderEmpty(); }
          if (!selected && emails.length && wide()) openEmail(emails[0].id);
          else if (!selected && !readerEl.firstElementChild) renderEmpty();
        } else if (manual) toast('已是最新', 'info');
        listEl.dataset.init = '1';
      } catch (e) { if (manual) toast('刷新失败：' + e.message, 'error'); }
    }

    function tick() {
      nextIn -= 1;
      if (nextIn <= 0) { nextIn = POLL_SECONDS; poll(); }
      liveEl.textContent = `LIVE · 下次校准 ${pad(nextIn)}s`;
      if (exp) {
        const left = exp - Date.now();
        ttlEl.textContent = left > 0 ? `邮箱剩余 ${fmtClock(left)}` : '邮箱已过期';
        ttlEl.style.color = left <= 0 ? 'var(--signal-t)' : left < 5 * 60000 ? 'var(--signal-t)' : left < 15 * 60000 ? 'var(--amber-t)' : '';
        if (left <= 0) { liveEl.className = 'tag tag--err'; liveEl.textContent = 'EXPIRED'; }
      } else ttlEl.textContent = '邮箱永不过期';
      // 列表中的相对时间随时间刷新
      $$('.mail-item', listEl).forEach((n, i) => { const e = emails[i]; const t = $('.mi-time', n); if (e && t) t.textContent = timeAgo(e.received_at); });
    }
    timer = setInterval(tick, 1000);

    /* ── 事件 ── */
    offs.push(on(root, 'click', '[data-act="copy"]', () => copyText(addr)));
    offs.push(on(root, 'click', '[data-act="refresh"]', () => { nextIn = POLL_SECONDS; poll({ manual: true }); }));
    offs.push(on(listEl, 'click', '.mail-item', (e, t) => { if (!e.target.closest('[data-act]')) openEmail(t.dataset.eid, { scroll: true }); }));
    offs.push(on(listEl, 'keydown', '.mail-item', (e, t) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEmail(t.dataset.eid, { scroll: true }); } }));
    offs.push(on(readerEl, 'click', '[data-act="del-email"]', async () => {
      const cur = selected;
      const ok = await confirmPanel({ code: 'DELETE MESSAGE', title: '删除邮件', danger: true, confirmText: '确认删除', message: '<p>该邮件将被永久删除，无法恢复。</p>' });
      if (!ok || !alive) return;
      try {
        await api.deleteEmail(id, cur);
        toast('邮件已删除', 'success');
        const i = emails.findIndex((e) => String(e.id) === String(cur));
        emails = emails.filter((e) => String(e.id) !== String(cur));
        selected = null;
        history.replaceState(null, '', `#/mailbox/${encodeURIComponent(id)}`);
        renderList();
        const next = emails[Math.min(i, emails.length - 1)];
        if (next && wide()) openEmail(next.id); else renderEmpty();
      } catch (err) { toast('删除失败：' + err.message, 'error'); }
    }));

    /* ── 首次加载 ── */
    try { emails = await api.listEmails(id); } catch (e) { toast('加载邮件失败：' + e.message, 'error'); }
    if (!alive) return;
    listEl.dataset.init = '1';
    renderList();
    tick();
    if (selected && emails.some((e) => String(e.id) === String(selected))) openEmail(selected);
    else {
      selected = null;
      if (eid) history.replaceState(null, '', `#/mailbox/${encodeURIComponent(id)}`);
      if (emails.length && wide()) openEmail(emails[0].id); else renderEmpty();
    }

    return () => { alive = false; clearInterval(timer); offs.forEach((f) => f()); };
  },
};
