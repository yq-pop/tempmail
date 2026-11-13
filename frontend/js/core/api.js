// API 客户端（与后端接口一一对应，行为与旧版保持一致）
import { S } from 'core/state';

export const API_BASE = '/api';
export const PUBLIC_BASE = '/public';

export async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (S.apiKey) headers['Authorization'] = `Bearer ${S.apiKey}`;
  const res = await fetch(path, { ...opts, headers });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    err.details = data.mx_details || data.details || [];
    throw err;
  }
  return data;
}

const json = (body) => JSON.stringify(body);

export const api = {
  // 公共
  publicSettings: () => fetch(PUBLIC_BASE + '/settings').then((r) => r.json()),
  publicStats: () => fetch(PUBLIC_BASE + '/stats').then((r) => r.json()),
  health: () => fetch('/health', { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r; }),
  keyLogin: (body) => apiFetch(PUBLIC_BASE + '/key-login', { method: 'POST', body: json(body) }),
  register: (body) => apiFetch(PUBLIC_BASE + '/register', { method: 'POST', body: json(body) }),

  // 账户
  me: () => apiFetch(API_BASE + '/me'),
  stats: () => apiFetch(API_BASE + '/stats'),

  // 域名
  domains: () => apiFetch(API_BASE + '/domains').then((d) => (Array.isArray(d) ? d : d.domains || [])),
  submitDomain: (body) => apiFetch(API_BASE + '/domains/submit', { method: 'POST', body: json(body) }),
  getDomainStatus: (id) => apiFetch(API_BASE + '/domains/' + id + '/status'),

  // 邮箱 / 邮件
  createMailbox: (body) => apiFetch(API_BASE + '/mailboxes', { method: 'POST', body: json(body || {}) }).then((d) => d.mailbox || d),
  listMailboxes: () => apiFetch(API_BASE + '/mailboxes').then((d) => (Array.isArray(d) ? d : d.data || [])),
  deleteMailbox: (id) => apiFetch(API_BASE + '/mailboxes/' + id, { method: 'DELETE' }),
  listEmails: (mid) => apiFetch(API_BASE + '/mailboxes/' + mid + '/emails').then((d) => (Array.isArray(d) ? d : d.data || [])),
  getEmail: (mid, eid) => apiFetch(API_BASE + '/mailboxes/' + mid + '/emails/' + eid).then((d) => d.email || d),
  deleteEmail: (mid, eid) => apiFetch(API_BASE + '/mailboxes/' + mid + '/emails/' + eid, { method: 'DELETE' }),

  // 管理
  admin: {
    listAccounts: (page = 1, size = 10) => apiFetch(API_BASE + '/admin/accounts?page=' + page + '&size=' + size),
    createAccount: (body) => apiFetch(API_BASE + '/admin/accounts', { method: 'POST', body: json(body) }),
    deleteAccount: (id) => apiFetch(API_BASE + '/admin/accounts/' + id, { method: 'DELETE' }),
    addDomain: (body) => apiFetch(API_BASE + '/admin/domains', { method: 'POST', body: json(body) }),
    deleteDomain: (id) => apiFetch(API_BASE + '/admin/domains/' + id, { method: 'DELETE' }),
    toggleDomain: (id, active) => apiFetch(API_BASE + '/admin/domains/' + id + '/toggle', { method: 'PUT', body: json({ active }) }),
    getSettings: () => apiFetch(API_BASE + '/admin/settings'),
    saveSettings: (body) => apiFetch(API_BASE + '/admin/settings', { method: 'PUT', body: json(body) }),
    mxImport: (body) => apiFetch(API_BASE + '/admin/domains/mx-import', { method: 'POST', body: json(body) }),
    mxRegister: (body) => apiFetch(API_BASE + '/admin/domains/mx-register', { method: 'POST', body: json(body) }),
    refreshDomainMX: () => apiFetch(API_BASE + '/admin/domains/refresh-mx', { method: 'POST' }),
    getDomainStatus: (id) => apiFetch(API_BASE + '/admin/domains/' + id + '/status'),
  },
};

/* ── 域名 / DNS 辅助 ── */
export const normalizeDomain = (d) => String(d || '').trim().toLowerCase().replace(/\.$/, '');
export const domainBase = (d) => { const n = normalizeDomain(d); return n.startsWith('*.') ? n.slice(2) : n; };

export function dnsRecordsFor(domain, serverIP, serverHostname) {
  const base = domainBase(domain) || 'example.com';
  const ip = serverIP || '<服务器IP>';
  const mxTarget = serverHostname || 'mail.' + base;
  const records = [
    { type: 'MX', host: base, value: mxTarget, priority: 10, note: '单域名' },
    { type: 'MX', host: '*.' + base, value: mxTarget, priority: 10, note: '通配子域' },
    { type: 'TXT', host: base, value: `v=spf1 ip4:${ip} ~all`, priority: '—', note: 'SPF' },
  ];
  if (!serverHostname) records.push({ type: 'A', host: mxTarget, value: ip, priority: '—', note: '邮件服务器' });
  return records;
}
