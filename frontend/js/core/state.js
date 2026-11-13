// 全局状态与会话持久化
// 注意：OAuth 回调页会直接写入 localStorage 的 tm_apikey / tm_account，键名不可更改。

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') || fallback;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}

export const S = {
  apiKey: localStorage.getItem('tm_apikey') || '',
  account: loadJSON('tm_account', null),
  settings: {},
  mailboxes: [],
};

export const isAdmin = () => !!S.account?.is_admin;
export const isAuthed = () => !!(S.apiKey && S.account);

export function saveSession(account, key) {
  S.apiKey = account?.api_key || key;
  S.account = account;
  localStorage.setItem('tm_apikey', S.apiKey);
  localStorage.setItem('tm_account', JSON.stringify(account));
}

export function clearSession() {
  S.apiKey = '';
  S.account = null;
  S.mailboxes = [];
  localStorage.removeItem('tm_apikey');
  localStorage.removeItem('tm_account');
}

/** 极简事件总线 */
const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const listen = (name, fn) => { bus.addEventListener(name, fn); return () => bus.removeEventListener(name, fn); };
