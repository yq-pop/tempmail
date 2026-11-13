// 我的 API Key：默认模糊，点击显影
import { $, esc, on } from 'core/util';
import { S } from 'core/state';
import { frame, col, copyText, icon } from 'core/ui';

export default {
  mount(root) {
    const key = S.apiKey || '—';
    root.innerHTML = `
    <div class="wrap view">
      <section class="page-head g12">
        <div class="col" style="${col(1, 9)}">
          <p class="kicker mono"><b>[ROUTE 04]</b><span>/ KEY</span><span>我的 API Key</span></p>
          <h1 class="display" data-skew data-reveal="mask"><span class="line"><span class="outline">API</span></span><span class="line" style="--i:1"><span>Key</span></span></h1>
        </div>
        <div class="col side" style="${col(10, 3)}"><p>Key 即身份。<em>请勿泄露。</em></p></div>
      </section>
      <div class="g12">
        <div class="col" style="${col(1, 7)}" data-xray="KEY">
          ${frame({ sub: '凭证', code: 'TM-KEY' }, `
            <p class="hint" style="margin-bottom:18px">API Key 用于认证所有 API 请求。点击下方 Key 显影；保存后请妥善保管，丢失需联系管理员重置。</p>
            <div class="lbl" style="margin-bottom:8px"><span>当前 API Key</span></div>
            <div class="code-line" data-cursor="显影" id="key-line">
              <span class="keyfield" id="key-val" tabindex="0" role="button" aria-label="点击显示 API Key">${esc(key)}</span>
              <button type="button" class="icon-btn" data-act="copy" aria-label="复制" data-cursor="复制">${icon('copy')}</button>
            </div>`)}
        </div>
        <div class="col" style="${col(8, 5)}" data-xray="CURL">
          ${frame({ sub: 'HTTP 请求示例', code: 'TM-CURL', cls: 'frame--dash' }, `
            <div class="codeblock"><pre>curl -H "Authorization: Bearer &lt;api_key&gt;" \\
  ${esc(location.origin)}/api/mailboxes</pre></div>
            <p class="hint mt-s">更多接口见「接口」页。</p>`)}
        </div>
      </div>
    </div>`;

    const val = $('#key-val', root);
    const reveal = () => val.classList.toggle('is-open');
    const offs = [
      on(root, 'click', '#key-val', reveal),
      on(root, 'keydown', '#key-val', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); } }),
      on(root, 'click', '[data-act="copy"]', () => copyText(S.apiKey)),
    ];
    return () => offs.forEach((f) => f());
  },
};
