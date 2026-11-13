// 邮件阅读窗格：收件箱与管理后台「全部邮件」共用。
// HTML 邮件在沙箱 iframe 中渲染（脚本不会执行），并提供 TEXT / RAW 页签。
import { $, $$, esc, fmtDate } from 'core/util';
import { icon } from 'core/ui';

export function mailDoc(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><base target="_blank">
<style>:root{color-scheme:light}html,body{margin:0}body{padding:26px;font:14px/1.75 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#11110E;background:#F3EFE6;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:#B3280A}table{max-width:100%}pre{white-space:pre-wrap}</style>
</head><body>${html}</body></html>`;
}

/**
 * 在 readerEl 中渲染一封邮件。
 *  e         后端返回的邮件对象（subject / sender / body_html / body_text / raw_message / received_at / size_bytes）
 *  to        「TO」一栏显示的收件邮箱
 *  extraMeta 额外的元信息行，如 [['USER', 'alice']]
 *  deletable 是否显示「删除」按钮（按钮本身带 data-act="del-email"，由调用方绑定事件）
 */
export function renderMailReader(readerEl, e, { to = '', extraMeta = [], deletable = false } = {}) {
  const from = e.sender || e.from_addr || '—';
  const html = e.body_html || e.html_body || '';
  const text = e.body_text || e.text_body || '';
  const raw = e.raw_message || '';
  const tabs = [];
  if (html) tabs.push(['html', 'HTML']);
  tabs.push(['text', 'TEXT']);
  if (raw) tabs.push(['raw', 'RAW']);
  let cur = html ? 'html' : 'text';

  const meta = [['FROM', from], ['TO', to], ...extraMeta, ['DATE', fmtDate(e.received_at)]];
  if (e.size_bytes) meta.push(['SIZE', `${e.size_bytes} B`]);

  readerEl.innerHTML = `
    <header class="reader-head">
      <div class="row between"><span class="mono dim">ID ${esc(String(e.id).slice(0, 8))}</span>
        ${deletable ? `<button type="button" class="btn btn--sm btn--danger" data-act="del-email" data-cursor="删除">${icon('trash', 13)} 删除</button>` : ''}</div>
      <h2 class="reader-subject">${esc(e.subject || '(无主题)')}</h2>
      <div class="reader-meta mono">${meta.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b>`).join('')}</div>
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
