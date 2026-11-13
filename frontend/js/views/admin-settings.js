// 管理 · 系统设置：访问控制 / 品牌 / 邮件服务 / OAuth / 服务信息
import { $, esc, on } from 'core/util';
import { S } from 'core/state';
import { api } from 'core/api';
import { toast, frame, col, copyText, icon, numberFrames } from 'core/ui';
import { emit } from 'core/state';

const bool = (v) => v === true || v === 'true';
const SECRETS = new Set(['linuxdo_client_secret', 'github_client_secret']);
const BRANDING = new Set(['site_title', 'site_logo_url', 'announcement']);

function field({ key, label, value = '', hint = '', placeholder = '', type = 'text', area = false, secret = false }) {
  const input = area
    ? `<textarea class="textarea" id="s-${key}" data-key="${key}" rows="3" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input class="input" id="s-${key}" data-key="${key}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${secret ? 'autocomplete="new-password"' : 'autocomplete="off"'} spellcheck="false" />`;
  return `<div class="field"><label for="s-${key}"><b>${esc(label)}</b><span>${esc(key)}</span></label>
    <div class="inline-save">${input}<button type="button" class="btn btn--sm" data-save="${key}" data-cursor="保存">保存</button></div>
    ${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
}

function toggle({ key, label, desc, on: checked }) {
  return `<label class="sw"><input type="checkbox" data-toggle="${key}" data-label="${esc(label)}" ${checked ? 'checked' : ''} /><span class="sw-track"></span><span><b>${esc(label)}</b><small>${desc}</small></span></label>`;
}

export default {
  async mount(root) {
    root.innerHTML = `
    <div class="wrap view">
      <section class="page-head g12">
        <div class="col" style="${col(1, 9)}">
          <p class="kicker mono"><b>[ROUTE A3]</b><span>/ ADMIN / SETTINGS</span><span>系统设置</span></p>
          <h1 class="display" data-skew data-reveal="mask"><span class="line"><span class="outline">Sys</span></span><span class="line" style="--i:1"><span>Settings</span></span></h1>
        </div>
        <div class="col side" style="${col(10, 3)}"><p>每一项独立保存，<em>即时生效。</em></p></div>
      </section>
      <div id="set-body"><div class="scanline"></div></div>
    </div>`;

    let s = {};
    try { s = await api.admin.getSettings(); }
    catch (e) { $('#set-body', root).innerHTML = `<div class="notice notice--err"><span class="mono">[ERR]</span><span>${esc(e.message)}</span></div>`; return; }

    const smtpIp = s.smtp_server_ip || '', smtpHost = s.smtp_hostname || '';
    const origin = location.origin;

    $('#set-body', root).innerHTML = `
    <div class="g12" style="row-gap:var(--gut)">
      <div class="col stack" style="${col(1, 6)};--gap:var(--gut)">
        ${frame({ sub: '访问控制', code: 'SET-ACL', xray: 'ACL' }, `
          ${toggle({ key: 'registration_open', label: '开放自行注册', desc: '开启后未登录用户可在登录页自行注册账户', on: bool(s.registration_open) })}
          ${toggle({ key: 'key_login_enabled', label: '启用 API Key 登录', desc: '开启后用户可使用 API Key 在登录页登录', on: s.key_login_enabled !== 'false' && s.key_login_enabled !== false })}
          ${toggle({ key: 'linuxdo_login_enabled', label: '启用 Linux DO Connect 登录', desc: '需同时配置下方 Client ID / Secret / 回调地址', on: bool(s.linuxdo_login_enabled) })}
          ${toggle({ key: 'github_login_enabled', label: '启用 GitHub 登录', desc: '需同时配置 GitHub OAuth App 的 Client ID、Secret 与回调地址', on: bool(s.github_login_enabled) })}`)}
        ${frame({ sub: '品牌与公告', code: 'SET-BRAND', xray: 'BRAND' }, `
          ${field({ key: 'site_title', label: '站点名称', value: s.site_title || 'TempMail', hint: '显示在标题栏、顶栏与首页大标题', placeholder: 'TempMail' })}
          ${field({ key: 'site_logo_url', label: '站点 Logo URL', value: s.site_logo_url || '', hint: '填写图片 URL 后，顶栏会显示自定义 Logo；留空使用默认图标', placeholder: 'https://example.com/logo.png' })}
          ${field({ key: 'announcement', label: '公告内容', value: s.announcement || '', hint: '以滚动字幕显示在已登录用户的总览页顶部；留空则不显示', placeholder: '留空则不显示公告', area: true })}`)}
        ${frame({ sub: '服务信息', code: 'SET-INFO', cls: 'frame--dash', xray: 'INFO' }, `
          <dl class="kv">
            <dt>SMTP IP</dt><dd>${esc(smtpIp || '<未设置>')}</dd>
            <dt>邮件主机名</dt><dd>${esc(smtpHost || '<未设置>')}</dd>
            <dt>API</dt><dd>${esc(origin)}/api</dd>
            <dt>前端</dt><dd>${esc(origin)}</dd>
          </dl>
          <div class="lbl" style="margin:22px 0 8px"><span>管理员 API Key</span></div>
          <div class="code-line"><span class="keyfield" id="adm-key" tabindex="0" role="button" aria-label="点击显示">${esc(S.apiKey)}</span><button type="button" class="icon-btn" data-copy-key aria-label="复制" data-cursor="复制">${icon('copy')}</button></div>
          <p class="hint mt-s">Key 文件位置：<code>/data/admin.key</code>（API 服务容器内）</p>`)}
      </div>
      <div class="col stack" style="${col(8, 5)};--gap:var(--gut);margin-top:clamp(0px,5vw,72px)">
        ${frame({ sub: '邮件服务', code: 'SET-MAIL', xray: 'MAIL' }, `
          ${field({ key: 'smtp_server_ip', label: 'SMTP 服务器公网 IP', value: smtpIp, hint: '用于生成 SPF DNS 配置提示', placeholder: '0.0.0.0' })}
          ${field({ key: 'smtp_hostname', label: '邮件服务器主机名', value: smtpHost, hint: '用作 MX 记录目标（如 mail.yourdomain.com）。设置后添加域名只需一条 MX 记录，无需额外 A 记录。', placeholder: 'mail.yourdomain.com' })}
          ${field({ key: 'default_domain', label: '默认邮箱域名', value: s.default_domain || '', hint: '创建邮箱时下拉框优先选中的域名', placeholder: 'mail.example.com' })}
          ${field({ key: 'mailbox_ttl_minutes', label: '邮箱有效期（分钟）', value: s.mailbox_ttl_minutes || '30', hint: '新建邮箱的默认存活时间，0 = 永不过期', placeholder: '30' })}
          ${field({ key: 'max_mailboxes_per_user', label: '每账户邮箱上限', value: s.max_mailboxes_per_user || '5', hint: '每个账户同时存在的邮箱数量上限', placeholder: '5' })}`)}
        ${frame({ sub: 'Linux DO Connect', code: 'SET-LDO', xray: 'LINUXDO' }, `
          ${field({ key: 'linuxdo_client_id', label: 'Client ID', value: s.linuxdo_client_id || '', placeholder: 'Client ID' })}
          ${field({ key: 'linuxdo_client_secret', label: 'Client Secret', value: '', type: 'password', secret: true, placeholder: bool(s.linuxdo_client_secret_set) ? '已配置，留空不修改' : 'Client Secret', hint: bool(s.linuxdo_client_secret_set) ? 'Client Secret 已配置。出于安全原因不会回显，留空保存不会覆盖。' : 'Client Secret 只保存在后端数据库，不会通过公开配置下发。' })}
          ${field({ key: 'linuxdo_redirect_url', label: '回调地址', value: s.linuxdo_redirect_url || `${origin}/public/auth/linuxdo/callback`, hint: '需要与 Connect.Linux.Do 应用后台配置的回调地址完全一致。', placeholder: 'https://your-domain.com/public/auth/linuxdo/callback' })}`)}
        ${frame({ sub: 'GitHub OAuth', code: 'SET-GH', xray: 'GITHUB' }, `
          ${field({ key: 'github_client_id', label: 'Client ID', value: s.github_client_id || '', placeholder: 'Client ID' })}
          ${field({ key: 'github_client_secret', label: 'Client Secret', value: '', type: 'password', secret: true, placeholder: bool(s.github_client_secret_set) ? '已配置，留空不修改' : 'Client Secret', hint: bool(s.github_client_secret_set) ? 'Client Secret 已配置。出于安全原因不会回显，留空保存不会覆盖。' : 'Client Secret 只保存在后端数据库，不会通过公开配置下发。' })}
          ${field({ key: 'github_redirect_url', label: '回调地址', value: s.github_redirect_url || `${origin}/public/auth/github/callback`, hint: '需要与 GitHub OAuth App 后台的 Authorization callback URL 完全一致。', placeholder: 'https://your-domain.com/public/auth/github/callback' })}`)}
      </div>
    </div>`;
    numberFrames(root);

    const offs = [
      on(root, 'click', '[data-save]', async (e, btn) => {
        const key = btn.dataset.save;
        const el = $('#s-' + key, root);
        const val = el.tagName === 'TEXTAREA' ? el.value : el.value.trim();
        if (SECRETS.has(key) && !val) { toast('Client Secret 留空，未修改', 'info'); return; }
        btn.disabled = true;
        try {
          await api.admin.saveSettings({ [key]: val });
          toast('已保存', 'success');
          if (BRANDING.has(key)) { S.settings = { ...S.settings, [key]: val }; emit('branding'); }
          if (key === 'smtp_server_ip' || key === 'smtp_hostname') S.settings = { ...S.settings, [key]: val };
          if (SECRETS.has(key)) el.value = '';
        } catch (err) { toast('保存失败：' + err.message, 'error'); }
        finally { btn.disabled = false; }
      }),
      on(root, 'change', '[data-toggle]', async (e, cb) => {
        const key = cb.dataset.toggle, enabled = cb.checked;
        try {
          await api.admin.saveSettings({ [key]: enabled ? 'true' : 'false' });
          toast(`${cb.dataset.label}已${enabled ? '开启' : '关闭'}`, 'success');
          S.settings = { ...S.settings, [key]: enabled };
        } catch (err) { toast('保存失败：' + err.message, 'error'); cb.checked = !enabled; }
      }),
      on(root, 'click', '#adm-key', (e, t) => t.classList.toggle('is-open')),
      on(root, 'click', '[data-copy-key]', () => copyText(S.apiKey)),
    ];
    return () => offs.forEach((f) => f());
  },
};
