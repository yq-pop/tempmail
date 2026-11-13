// API 接口文档：左侧目录（滚动联动）+ 右侧示例代码
import { $, $$, esc, on, pad } from 'core/util';
import { S } from 'core/state';
import { frame, col, copyText, icon } from 'core/ui';
import { scrollToEl } from 'fx/scroll';

function sections(base, key) {
  return [
    {
      id: 'auth', title: '认证方式',
      desc: '所有 /api/* 接口需要在 HTTP Header 中携带 API Key：',
      code: `# Bearer Token 方式
curl -H "Authorization: Bearer ${key}" ${base}/api/me

# Query 参数方式
curl "${base}/api/me?api_key=${key}"`,
    },
    {
      id: 'create', title: '创建临时邮箱',
      desc: 'POST /api/mailboxes — address、domain、mode 均为可选字段；未传 mode 时 API 随机生成单域名或 10-14 级多级域名邮箱',
      code: `# API 默认：随机地址 + 随机单域名或 10-14 级多级域名邮箱
curl -s -X POST ${base}/api/mailboxes \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{}'

# 前端默认行为：普通单级域名邮箱
curl -s -X POST ${base}/api/mailboxes \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"mode": "single"}'

# 指定本地部分（@ 之前），域名随机
curl -s -X POST ${base}/api/mailboxes \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"address": "mytestbox"}'

# 指定域名，地址随机（domain 须是已激活域名）
curl -s -X POST ${base}/api/mailboxes \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"mode": "single", "domain": "mail.example.com"}'

# 指定通配基础域名，生成多级邮箱
curl -s -X POST ${base}/api/mailboxes \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"mode": "multi", "domain": "example.com"}'

# 同时指定地址和域名
curl -s -X POST ${base}/api/mailboxes \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"mode": "single", "address": "mytestbox", "domain": "mail.example.com"}'

# 错误码：
#   400 → domain 不存在或未激活
#   409 → 地址已被占用（换一个 address 或留空让系统随机生成）
#   503 → 系统内无可用域名`,
    },
    {
      id: 'list', title: '获取邮箱列表',
      desc: 'GET /api/mailboxes — 获取当前账号下所有邮箱',
      code: `curl -s ${base}/api/mailboxes \\
  -H "Authorization: Bearer ${key}"

# 分页
curl -s "${base}/api/mailboxes?page=1&size=20" \\
  -H "Authorization: Bearer ${key}"`,
    },
    {
      id: 'inbox', title: '获取收件箱（邮件列表）',
      desc: 'GET /api/mailboxes/:id/emails — 按收件时间倒序列出邮件摘要',
      code: `MAILBOX_ID="你的邮箱UUID"
curl -s ${base}/api/mailboxes/$MAILBOX_ID/emails \\
  -H "Authorization: Bearer ${key}"

# 分页
curl -s "${base}/api/mailboxes/$MAILBOX_ID/emails?page=1&size=20" \\
  -H "Authorization: Bearer ${key}"`,
    },
    {
      id: 'read', title: '读取单封邮件',
      desc: 'GET /api/mailboxes/:id/emails/:email_id — 获取邮件完整内容（含 HTML/纯文本和原始数据）',
      code: `MAILBOX_ID="你的邮箱UUID"
EMAIL_ID="你的邮件UUID"
curl -s ${base}/api/mailboxes/$MAILBOX_ID/emails/$EMAIL_ID \\
  -H "Authorization: Bearer ${key}"`,
    },
    {
      id: 'del-box', title: '删除邮箱',
      desc: 'DELETE /api/mailboxes/:id — 立即删除邮箱及其所有邮件',
      code: `MAILBOX_ID="你的邮箱UUID"
curl -s -X DELETE ${base}/api/mailboxes/$MAILBOX_ID \\
  -H "Authorization: Bearer ${key}"`,
    },
    {
      id: 'del-mail', title: '删除单封邮件',
      desc: 'DELETE /api/mailboxes/:id/emails/:email_id',
      code: `curl -s -X DELETE ${base}/api/mailboxes/$MAILBOX_ID/emails/$EMAIL_ID \\
  -H "Authorization: Bearer ${key}"`,
    },
    {
      id: 'script', title: '完整自动化示例（Shell）',
      desc: '创建邮箱 → 等待 5 秒 → 读取邮件 → 清理',
      code: `#!/bin/bash
BASE="${base}"
KEY="${key}"

# 1. 创建临时邮箱
MB=$(curl -s -X POST $BASE/api/mailboxes \\
  -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" \\
  -d '{}')
MB_ID=$(echo $MB | python3 -c "import sys,json; print(json.load(sys.stdin)['mailbox']['id'])")
MB_ADDR=$(echo $MB | python3 -c "import sys,json; print(json.load(sys.stdin)['mailbox']['full_address'])")
echo "邮箱: $MB_ADDR (主键: $MB_ID)"

# 2. 向邮箱发送邮件...
echo "将测试邮件发到: $MB_ADDR"
sleep 5

# 3. 查看收件箱
EMAILS=$(curl -s $BASE/api/mailboxes/$MB_ID/emails \\
  -H "Authorization: Bearer $KEY")
echo "取到邮件: $EMAILS" | python3 -m json.tool

# 4. 读取第一封邮件
EMAIL_ID=$(echo $EMAILS | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['data'][0]['id']) if d.get('data') else print('')" 2>/dev/null)
if [ -n "$EMAIL_ID" ]; then
  curl -s $BASE/api/mailboxes/$MB_ID/emails/$EMAIL_ID \\
    -H "Authorization: Bearer $KEY" | python3 -m json.tool
fi

# 5. 删除邮箱
curl -s -X DELETE $BASE/api/mailboxes/$MB_ID \\
  -H "Authorization: Bearer $KEY"
echo "邮箱已删除"`,
    },
    {
      id: 'bench', title: '并发压测示例（wrk / k6）',
      desc: '对注册接口进行高并发压测，500 并发，持续 30 秒',
      code: `# 安装 wrk: apt install wrk

# 导出注册脚本
cat > /tmp/register.lua << 'EOF'
wrk.method = "POST"
wrk.body   = '{"username": "user_' .. math.random(100000,999999) .. '"}'
wrk.headers["Content-Type"] = "application/json"
EOF

# 运行压测
wrk -t 10 -c 500 -d 30s --script /tmp/register.lua \\
  ${base}/public/register

# 或使用 k6
cat > /tmp/test.js << 'EOF'
import http from 'k6/http';
import { check } from 'k6';
export const options = { vus: 500, duration: '30s' };
const KEY = '${key}';
export default function() {
  const r = http.post(
    '${base}/api/mailboxes',
    '{}',
    { headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' }}
  );
  check(r, { '创建成功': r => r.status === 201 });
}
EOF
k6 run /tmp/test.js`,
    },
  ];
}

export default {
  mount(root) {
    const key = S.apiKey || 'YOUR_API_KEY';
    const list = sections(location.origin, key);
    root.innerHTML = `
    <div class="wrap view">
      <section class="page-head g12">
        <div class="col" style="${col(1, 9)}">
          <p class="kicker mono"><b>[ROUTE 03]</b><span>/ API</span><span>接口文档</span></p>
          <h1 class="display" data-skew data-reveal="mask"><span class="line"><span class="outline">API</span></span><span class="line" style="--i:1"><span>Docs</span></span></h1>
        </div>
        <div class="col side" style="${col(10, 3)}"><p>所有可用接口，<em>附调用示例。</em></p></div>
      </section>
      <div class="g12" style="row-gap:20px">
        <aside class="col" style="${col(1, 3)}"><nav class="toc" aria-label="目录">${list.map((s, i) => `<a href="#/api" data-to="d-${s.id}"><span>${pad(i + 1)}</span><span>${esc(s.title)}</span></a>`).join('')}</nav></aside>
        <div class="col stack" style="${col(4, 9)};--gap:var(--gut)">
          ${frame({ sub: '当前 API Key', code: 'TM-KEY', cls: 'frame--dash' }, `
            <div class="code-line"><span class="keyfield" id="doc-key" tabindex="0" role="button" aria-label="点击显示">${esc(key)}</span><button type="button" class="icon-btn" data-copy-key aria-label="复制" data-cursor="复制">${icon('copy')}</button></div>`)}
          ${list.map((s, i) => `<div id="d-${s.id}" data-xray="${esc(s.id.toUpperCase())}">${frame({ sub: esc(s.title), code: 'EP-' + pad(i + 1) }, `
            <p class="mono dim" style="margin-bottom:14px;text-transform:none;letter-spacing:.04em">${esc(s.desc)}</p>
            <div class="codeblock"><button type="button" class="icon-btn" data-copy-code="${i}" aria-label="复制代码" data-cursor="复制">${icon('copy')}</button><pre>${esc(s.code)}</pre></div>`)}</div>`).join('')}
        </div>
      </div>
    </div>`;

    const offs = [
      on(root, 'click', '[data-copy-key]', () => copyText(S.apiKey)),
      on(root, 'click', '[data-copy-code]', (e, t) => copyText(list[Number(t.dataset.copyCode)].code)),
      on(root, 'click', '#doc-key', (e, t) => t.classList.toggle('is-open')),
      on(root, 'click', '.toc a', (e, a) => { e.preventDefault(); scrollToEl(document.getElementById(a.dataset.to), 0); }),
    ];

    // 目录联动
    const links = $$('.toc a', root);
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) links.forEach((a) => a.classList.toggle('is-active', a.dataset.to === en.target.id));
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    list.forEach((s) => io.observe($('#d-' + s.id, root)));
    links[0]?.classList.add('is-active');

    return () => { io.disconnect(); offs.forEach((f) => f()); };
  },
};
