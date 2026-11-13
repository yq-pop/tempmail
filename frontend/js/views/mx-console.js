// 域名提交控制台（用户页与管理页共用）
//  · mountSubmitConsole：任意登录用户提交域名 → 即时 MX 检测 → 激活或进入 30s 轮询队列
//  · mountManualConsole：管理员手动添加 → MX 检测 → 失败时可「强制添加」
import { $, esc, on, timeAgo } from 'core/util';
import { S } from 'core/state';
import { api, dnsRecordsFor } from 'core/api';
import { toast, dnsTable, mxDetails, icon } from 'core/ui';

const smtp = () => ({ ip: S.settings?.smtp_server_ip || '', host: S.settings?.smtp_hostname || '' });
const dnsHint = (domain) => dnsTable(dnsRecordsFor(domain || 'example.com', smtp().ip, smtp().host));
const lower = (v) => String(v || '').trim().toLowerCase();
const lab = (b, t) => { (b.querySelector('.btn-label') || b).textContent = t; };

function shell(p, { submitLabel, hint }) {
  return `
    <div class="field"><label for="${p}-domain"><b>FIELD 01</b><span>域名</span></label>
      <input class="input" id="${p}-domain" placeholder="example.com" autocomplete="off" spellcheck="false" />
      <p class="hint">${hint}</p></div>
    <div class="dashed" style="padding:14px 14px 8px">
      <p class="mono dim" style="margin-bottom:8px">需配置的 DNS 记录</p>
      <div data-role="dns">${dnsHint('')}</div>
    </div>
    <div data-role="status" class="mt-s"></div>
    <div class="row mt-s" data-role="actions"><button type="button" class="btn btn--solid" data-role="submit" data-cursor="提交">${submitLabel} ▸</button></div>`;
}

const okBox = (msg) => `<div class="notice notice--ok"><span class="mono">[OK]</span><span>${msg}</span></div>`;
const warnBox = (msg) => `<div class="notice"><span class="mono">[SCAN]</span><span>${msg}</span></div>`;
const errBox = (msg) => `<div class="notice notice--err"><span class="mono">[ERR]</span><span>${msg}</span></div>`;

/* ───────── 提交（自动验证） ───────── */
export function mountSubmitConsole(host, { onActivated } = {}) {
  host.innerHTML = shell('mx', {
    submitLabel: '提交检测',
    hint: '提交后立即检测 MX。已生效则直接激活；否则进入待验证队列，后台每 <b>30 秒</b>自动重试。',
  });
  const input = $('#mx-domain', host), status = $('[data-role="status"]', host), dns = $('[data-role="dns"]', host);
  const btn = $('[data-role="submit"]', host);
  let timer = null, alive = true;

  const offs = [
    on(host, 'input', '#mx-domain', () => { dns.innerHTML = dnsHint(input.value.trim()); }),
    on(host, 'keydown', '#mx-domain', (e) => { if (e.key === 'Enter') submit(); }),
    on(host, 'click', '[data-role="submit"]', submit),
  ];

  async function submit() {
    const domain = lower(input.value);
    if (!domain) { toast('请输入域名', 'warn'); return; }
    btn.disabled = true; lab(btn, '检测中…');
    status.innerHTML = '<div class="scanline"></div>';
    try {
      const r = await api.submitDomain({ domain });
      if (!alive) return;
      if (r.status === 'active') {
        status.innerHTML = okBox(`MX 验证通过，域名 <b>${esc(domain)}</b> 已加入域名池。`);
        toast(`${domain} 已激活`, 'success');
        input.value = '';
        reset();
        onActivated?.();
      } else {
        dns.innerHTML = dnsTable(r.dns_required || []);
        status.innerHTML = warnBox(`域名已加入验证队列（ID ${esc(r.domain?.id)}）。MX 生效后（通常 5–30 分钟）系统将自动激活。${mxDetails(r.mx_details)}<span class="dim" id="mx-wait"></span>`);
        reset();
        poll(r.domain.id, domain);
        onActivated?.({ pending: true });
      }
    } catch (e) {
      if (!alive) return;
      status.innerHTML = errBox(`${esc(e.message)}${mxDetails(e.details)}`);
      btn.disabled = false; lab(btn, '重新提交 ▸');
    }
  }

  function reset() { btn.disabled = false; lab(btn, '提交检测 ▸'); }

  function poll(id, domain) {
    clearInterval(timer);
    let attempts = 0;
    timer = setInterval(async () => {
      if (!alive || !host.isConnected) { clearInterval(timer); return; }
      attempts++;
      try {
        const d = await api.getDomainStatus(id);
        if (d.status === 'active') {
          clearInterval(timer);
          status.innerHTML = okBox(`MX 验证通过！域名 <b>${esc(domain)}</b> 已自动激活。`);
          toast(`${domain} 已自动激活`, 'success');
          onActivated?.();
        } else {
          const w = $('#mx-wait', status);
          if (w) w.innerHTML = `<br/>等待中 · 第 ${attempts} 次检测 · 上次 ${esc(d.mx_checked_at ? timeAgo(d.mx_checked_at) : '从未')}`;
        }
      } catch { /* 静默重试 */ }
    }, 5000);
  }

  return () => { alive = false; clearInterval(timer); offs.forEach((f) => f()); };
}

/* ───────── 手动添加（管理员） ───────── */
export function mountManualConsole(host, { onAdded } = {}) {
  host.innerHTML = shell('mn', {
    submitLabel: '检测 MX',
    hint: '输入将用于接收邮件的域名。检测通过则立即加入域名池；未通过时可选择「强制添加」。',
  });
  const input = $('#mn-domain', host), status = $('[data-role="status"]', host), dns = $('[data-role="dns"]', host);
  const actions = $('[data-role="actions"]', host);
  const btn = $('[data-role="submit"]', host);
  let alive = true;

  const forceBtn = document.createElement('button');
  forceBtn.type = 'button'; forceBtn.className = 'btn btn--danger'; forceBtn.hidden = true;
  forceBtn.innerHTML = `${icon('bolt', 13)} 强制添加`;
  actions.appendChild(forceBtn);

  const offs = [
    on(host, 'input', '#mn-domain', () => { dns.innerHTML = dnsHint(input.value.trim()); forceBtn.hidden = true; }),
    on(host, 'keydown', '#mn-domain', (e) => { if (e.key === 'Enter') check(); }),
    on(host, 'click', '[data-role="submit"]', check),
  ];
  forceBtn.addEventListener('click', force);

  async function check() {
    const domain = lower(input.value);
    if (!domain) { toast('请输入域名', 'warn'); return; }
    btn.disabled = true; lab(btn, '检测中…');
    status.innerHTML = '<div class="scanline"></div>';
    try {
      await api.admin.mxImport({ domain, force: false });
      if (!alive) return;
      status.innerHTML = okBox(`MX 验证通过，域名 <b>${esc(domain)}</b> 已立即加入域名池。`);
      toast(`${domain} MX 验证通过，已加入域名池`, 'success');
      input.value = ''; forceBtn.hidden = true;
      onAdded?.();
    } catch (e) {
      if (!alive) return;
      status.innerHTML = `<div class="notice notice--err"><span class="mono">[MX]</span><span><b>MX 记录未检测到</b>：${esc(e.message)}${mxDetails(e.details)}<br/><span class="dim">请先配置上方 DNS 记录后重新检测，或点击「强制添加」跳过检测直接加入域名池。</span></span></div>`;
      forceBtn.hidden = false;
    } finally { btn.disabled = false; lab(btn, '检测 MX ▸'); }
  }

  async function force() {
    const domain = lower(input.value);
    if (!domain) return;
    forceBtn.disabled = true;
    try {
      const r = await api.admin.addDomain({ domain });
      if (!alive) return;
      dns.innerHTML = dnsTable(r.dns_records || []);
      status.innerHTML = okBox(`域名 <b>${esc(domain)}</b> 已添加。请在 DNS 管理面板配置上方记录，一般 5–30 分钟生效。${r.instructions ? `<br/><span class="dim">${esc(r.instructions)}</span>` : ''}`);
      toast(`${domain} 已添加`, 'success');
      input.value = ''; forceBtn.hidden = true;
      onAdded?.();
    } catch (e) { status.innerHTML = errBox(esc(e.message)); toast('操作失败：' + e.message, 'error'); }
    finally { forceBtn.disabled = false; }
  }

  return () => { alive = false; offs.forEach((f) => f()); };
}
