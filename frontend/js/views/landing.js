// 落地页（未登录）：英雄区 + 接入终端 + 原理 + 遥测 + 规格
import { $, esc, on, splitTitle, countUp, pad } from 'core/util';
import { S, saveSession, emit } from 'core/state';
import { api, PUBLIC_BASE } from 'core/api';
import { toast, frame, col, copyText, icon } from 'core/ui';

const bool = (v) => v === true || v === 'true';

export default {
  async mount(root) {
    const s = S.settings || {};
    const title = s.site_title || 'TempMail';
    const parts = splitTitle(title);
    const cap = '<span class="line hero-cap-line" style="--i:2"><span class="hero-cap serif">ephemeral — by design</span></span>';
    const titleHTML = parts.length === 2
      ? `<span class="line"><span><span class="outline">${esc(parts[0])}</span></span></span><span class="line" style="--i:1"><span>${esc(parts[1])}</span></span>${cap}`
      : `<span class="line"><span><span class="outline">${esc(parts[0])}</span></span></span>${cap}`;

    root.innerHTML = `
    <div class="wrap view view-landing">
      <section class="hero" id="top">
        <div class="g12 hero-grid">
          <div class="col" style="${col(1, 8)}" data-xray="HERO">
            <p class="hero-kicker mono dim" data-reveal><span>[SIGNAL RECEIVER]</span><span>收信仪器</span><span>REV 2611</span></p>
            <h1 class="display hero-title" data-skew data-reveal="mask" aria-label="${esc(title)}">${titleHTML}</h1>
            <p class="lead" data-reveal>${esc(title)}，一台只负责<em>接收</em>的精密仪器。地址按需分配，邮件用完即焚；每个账户彼此隔离。</p>
          </div>
          <div class="col" style="${col(9, 4)}" id="access" data-xray="ACCESS">
            ${frame({ sub: '接入终端', code: 'TM-ACCESS' }, '<div id="access-body"></div>')}
          </div>
        </div>
        <div class="hero-foot mono">
          <span>SMTP :25 → LMTP → API</span>
          <span id="utc">UTC --:--:--</span>
          <span data-scrollto="#principle" style="cursor:pointer" data-cursor="下滑">SCROLL ▾</span>
        </div>
      </section>

      <div class="marquee" data-reveal="mask"><div class="marquee-track">
        <span>只收不发</span><span class="x">✕</span><span class="o">Receive only</span><span class="x">✕</span><span>用完即焚</span><span class="x">✕</span><span class="o">Wildcard MX</span><span class="x">✕</span><span>账户隔离</span><span class="x">✕</span><span class="o">TTL 30 min</span><span class="x">✕</span>
      </div></div>

      <section id="principle">
        <div class="sec-title"><span class="mono dim">[02]</span><h2 class="display-m" data-skew data-reveal="mask"><span class="line"><span>Principle <em class="serif">原理</em></span></span></h2></div>
        <div class="principle g12">
          <article class="col step-card" data-reveal style="${col(1, 5)}"><div class="big">01</div><h3>分配</h3><p>一键生成随机地址，或指定本地部分与域名。支持单级域名，也支持通配 MX 下的随机多级子域。</p></article>
          <article class="col step-card off-1" data-reveal style="${col(7, 5)}"><div class="big">02</div><h3>接收</h3><p>Postfix 只收不发，经 LMTP 直接入库。收件箱每 8 秒自动校准，新邮件即时标记。</p></article>
          <article class="col step-card" data-reveal style="${col(3, 6)}"><div class="big">03</div><h3>销毁</h3><p>邮箱到期自动清除，邮件随之销毁；也可以随时手动删除。HTML 邮件在沙箱中渲染，脚本不会执行。</p></article>
        </div>
      </section>

      <div class="string" data-l="A" data-r="B" aria-hidden="true"></div>

      <section id="telemetry">
        <div class="sec-title"><span class="mono dim">[03]</span><h2 class="display-m" data-skew data-reveal="mask"><span class="line"><span>Telemetry <em class="serif">遥测</em></span></span></h2></div>
        <div class="g12" style="row-gap:var(--gut)">
          <div class="col" style="${col(1, 5)}" data-reveal data-xray="SCOPE">
            ${frame({ sub: '李萨如谐波', code: 'SCOPE-01', cls: 'frame--dash' }, '<div class="scope-wrap"><canvas data-scope="lissajous"></canvas><div class="scope-read mono"></div></div>')}
          </div>
          <div class="col" style="${col(6, 7)}" data-reveal data-xray="READOUT">
            ${frame({ sub: '平台读数', code: 'TM-STAT', cls: 'frame--dash' }, `
              <div class="readout" id="landing-stats">
                <div class="cell"><span class="mono dim">已收邮件</span><span class="cell-v" data-k="total_emails">—</span><span class="mono dim">累计</span></div>
                <div class="cell"><span class="mono dim">邮箱总量</span><span class="cell-v" data-k="total_mailboxes">—</span><span class="mono dim">历史创建</span></div>
                <div class="cell"><span class="mono dim">活跃邮箱</span><span class="cell-v" data-k="active_mailboxes">—</span><span class="mono dim">当前有效</span></div>
              </div>
              <p class="hint mt-s">读数来自公开统计接口 <code>/public/stats</code>，每次进入页面刷新一次。</p>`)}
          </div>
        </div>
      </section>

      <section id="spec">
        <div class="sec-title"><span class="mono dim">[04]</span><h2 class="display-m" data-skew data-reveal="mask"><span class="line"><span>Spec <em class="serif">规格</em></span></span></h2></div>
        <div class="g12">
          <div class="col" style="${col(3, 8)}" data-reveal data-xray="SPEC">
            ${frame({ sub: '技术规格表', code: 'TM-SPEC' }, `
              <dl class="kv">
                <dt>收信路径</dt><dd>SMTP :25 → Postfix → LMTP → API → PostgreSQL</dd>
                <dt>中继策略</dt><dd>RECEIVE-ONLY · 不做任何外发中继</dd>
                <dt>邮箱寿命</dt><dd>默认 30 分钟，管理员可调；0 = 永不过期</dd>
                <dt>域名能力</dt><dd>单域名 MX / 通配 MX（随机多级子域）</dd>
                <dt>隔离模型</dt><dd>按账户隔离 · API Key 鉴权</dd>
                <dt>邮件渲染</dt><dd>iframe sandbox，禁用脚本</dd>
                <dt>接口</dt><dd>REST · <code>/api/*</code>（登录后可见完整文档）</dd>
              </dl>`)}
          </div>
        </div>
      </section>

      <footer class="foot mono">
        <span>${esc(title)} // TM-REV-2611</span>
        <a href="https://github.com/123nhh/tempmail" target="_blank" rel="noopener noreferrer" data-cursor="GitHub">GitHub ↗</a>
      </footer>
    </div>`;

    /* ── 接入终端 ── */
    const body = $('#access-body', root);
    let tab = 'login';
    const keyLogin = s.key_login_enabled !== false;
    const linuxDO = s.linuxdo_login_enabled === true;
    const gitHub = s.github_login_enabled === true;
    const regOpen = bool(s.registration_open);

    function paint() {
      body.innerHTML = `
        <div class="tabs" role="tablist">
          <button type="button" class="tab" role="tab" data-tab="login" aria-selected="${tab === 'login'}">接入 / ACCESS</button>
          <button type="button" class="tab" role="tab" data-tab="reg" aria-selected="${tab === 'reg'}" ${regOpen ? '' : 'disabled title="管理员已关闭注册"'}>注册 / ENROLL</button>
        </div>
        <div id="access-form">${tab === 'login' ? loginHTML() : regHTML()}</div>`;
      const inp = $('#login-key', body) || $('#reg-username', body);
      if (inp && matchMedia('(pointer:fine)').matches && document.activeElement === document.body) { /* 不抢焦点，避免打断预加载 */ }
    }

    function loginHTML() {
      const oauth = linuxDO || gitHub;
      const showKey = keyLogin || oauth;
      return `
        ${showKey ? `
        <div class="field"><label for="login-key"><b>FIELD 01</b><span>API KEY</span></label>
          <input class="input" id="login-key" type="password" placeholder="tm_xxxxxxxxxxxx" autocomplete="current-password" spellcheck="false" />
          <p class="hint">${keyLogin ? '在管理后台或注册成功后获得的 API Key' : 'API Key 登录已关闭，仅管理员 API Key 可用于后台维护'}</p>
        </div>
        <button type="button" class="btn btn--solid btn--block" data-act="login" data-cursor="接入">接入系统 ▸</button>` : ''}
        ${showKey && oauth ? '<div class="rule rule--dash"></div>' : ''}
        ${oauth ? `<div class="stack" style="--gap:10px">
          ${linuxDO ? '<button type="button" class="btn btn--block" data-oauth="linuxdo">Linux DO Connect</button>' : ''}
          ${gitHub ? '<button type="button" class="btn btn--block" data-oauth="github">GitHub</button>' : ''}
        </div>` : ''}
        ${!showKey && !oauth ? '<p class="hint">当前没有启用任何登录方式，请联系管理员。</p>' : ''}
        <p class="hint mt-s">没有账户？切换到「注册」自行创建，或联系管理员。</p>`;
    }

    function regHTML() {
      return `
        <div class="field"><label for="reg-username"><b>FIELD 01</b><span>用户名</span></label><input class="input" id="reg-username" placeholder="your_name" autocomplete="username" /></div>
        <div class="field"><label for="reg-email"><b>FIELD 02</b><span>邮箱（可选）</span></label><input class="input" id="reg-email" type="email" placeholder="contact@example.com" autocomplete="email" /></div>
        <button type="button" class="btn btn--solid btn--block" data-act="register" data-cursor="注册">创建账户 ▸</button>`;
    }

    async function tryLogin(key) {
      S.apiKey = key;
      try {
        const acct = await api.keyLogin({ api_key: key });
        saveSession(acct, key);
        toast(`欢迎回来，${acct.username || '用户'}`, 'success');
        emit('auth');
      } catch (e) {
        S.apiKey = '';
        toast('API Key 无效：' + e.message, 'error');
      }
    }

    const offs = [];
    offs.push(on(body, 'click', '[data-tab]', (e, t) => { if (t.disabled) return; tab = t.dataset.tab; paint(); }));
    offs.push(on(body, 'click', '[data-oauth]', (e, t) => { location.href = `${PUBLIC_BASE}/auth/${t.dataset.oauth}`; }));
    offs.push(on(body, 'click', '[data-act="login"]', async (e, b) => {
      const key = ($('#login-key', body)?.value || '').trim();
      if (!key) { toast('请输入 API Key', 'warn'); return; }
      b.disabled = true; try { await tryLogin(key); } finally { b.disabled = false; }
    }));
    offs.push(on(body, 'click', '[data-act="register"]', async (e, b) => {
      const username = ($('#reg-username', body)?.value || '').trim();
      const email = ($('#reg-email', body)?.value || '').trim();
      if (!username) { toast('请输入用户名', 'warn'); return; }
      b.disabled = true;
      try {
        const r = await api.register({ username, email: email || undefined });
        $('#access-form', body).innerHTML = `
          <div class="notice notice--ok"><span class="mono">[OK]</span><span>注册成功。请保存您的 API Key，它不会再次显示。</span></div>
          <div class="big-key"><span id="new-key">${esc(r.api_key)}</span><button type="button" class="icon-btn" data-copy="${esc(r.api_key)}" aria-label="复制" data-cursor="复制">${icon('copy')}</button></div>
          <button type="button" class="btn btn--solid btn--block" data-enter="${esc(r.api_key)}" data-cursor="接入">立即接入 ▸</button>`;
      } catch (err) { toast('注册失败：' + err.message, 'error'); b.disabled = false; }
    }));
    offs.push(on(body, 'click', '[data-copy]', (e, t) => copyText(t.dataset.copy)));
    offs.push(on(body, 'click', '[data-enter]', (e, t) => tryLogin(t.dataset.enter)));
    offs.push(on(body, 'keydown', '#login-key', (e) => { if (e.key === 'Enter') $('[data-act="login"]', body)?.click(); }));
    offs.push(on(body, 'keydown', '#reg-username, #reg-email', (e) => { if (e.key === 'Enter') $('[data-act="register"]', body)?.click(); }));
    paint();

    /* ── 读数 ── */
    api.publicStats().then((st) => {
      $('#landing-stats', root)?.querySelectorAll('[data-k]').forEach((el) => {
        const v = st?.[el.dataset.k];
        if (v === undefined || v === null) return;
        const io = new IntersectionObserver(([en]) => { if (en.isIntersecting) { countUp(el, v); io.disconnect(); } });
        io.observe(el);
      });
    }).catch(() => {});

    /* ── UTC 时钟 ── */
    const utc = $('#utc', root);
    const tick = () => { const d = new Date(); utc.textContent = `UTC ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
    tick();
    const timer = setInterval(tick, 1000);

    return () => { clearInterval(timer); offs.forEach((f) => f()); };
  },
};
