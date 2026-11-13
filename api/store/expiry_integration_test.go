package store

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"tempmail/model"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// 这些测试需要真实的 PostgreSQL（设置 TEST_DATABASE_DSN 才会运行），
// 覆盖邮箱有效期与「全部邮件」里所有写在 SQL 里的行为。

type expiryFixture struct {
	accountID uuid.UUID
	username  string
	domainID  int
	domain    string
}

func newExpiryFixture(t *testing.T, s *Store, label string) expiryFixture {
	t.Helper()
	ctx := context.Background()
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:10]
	f := expiryFixture{
		username: "exp" + label + "_" + suffix,
		domain:   "exp" + strings.ToLower(label) + "-" + suffix + ".example.test",
	}
	if err := s.pool.QueryRow(ctx,
		`INSERT INTO accounts (username, api_key) VALUES ($1, $2) RETURNING id`,
		f.username, "tm_test_"+suffix+label).Scan(&f.accountID); err != nil {
		t.Fatalf("insert account: %v", err)
	}
	if err := s.pool.QueryRow(ctx,
		`INSERT INTO domains (domain, domain_type, base_domain, supports_single, is_active, status)
		 VALUES ($1, 'exact', $1, TRUE, TRUE, 'active') RETURNING id`,
		f.domain).Scan(&f.domainID); err != nil {
		t.Fatalf("insert domain: %v", err)
	}
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM accounts WHERE id = $1`, f.accountID)
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM domains WHERE id = $1`, f.domainID)
	})
	return f
}

// addMailbox 插入一个「创建于 age 之前」的邮箱。
func (f expiryFixture) addMailbox(t *testing.T, s *Store, local string, age time.Duration) (uuid.UUID, string) {
	t.Helper()
	address := local + "@" + f.domain
	var id uuid.UUID
	if err := s.pool.QueryRow(context.Background(),
		`INSERT INTO mailboxes (account_id, address, domain_id, full_address, created_at)
		 VALUES ($1, $2, $3, $4, NOW() - make_interval(secs => $5::double precision))
		 RETURNING id`,
		f.accountID, local, f.domainID, address, age.Seconds()).Scan(&id); err != nil {
		t.Fatalf("insert mailbox: %v", err)
	}
	return id, address
}

func setExpiryPolicy(t *testing.T, s *Store, enabled bool, ttlMinutes int, autoCleanup bool) {
	t.Helper()
	ctx := context.Background()
	set := func(k, v string) {
		if err := s.SetSetting(ctx, k, v); err != nil {
			t.Fatalf("SetSetting(%s): %v", k, err)
		}
	}
	b := func(v bool) string {
		if v {
			return "true"
		}
		return "false"
	}
	set(SettingMailboxExpiryEnabled, b(enabled))
	set(SettingMailboxTTLMinutes, strconv.Itoa(ttlMinutes))
	set(SettingMailboxAutoCleanup, b(autoCleanup))
	// 还原为默认值，避免影响其他集成测试
	t.Cleanup(func() {
		_ = s.SetSetting(context.Background(), SettingMailboxExpiryEnabled, "false")
		_ = s.SetSetting(context.Background(), SettingMailboxTTLMinutes, "30")
		_ = s.SetSetting(context.Background(), SettingMailboxAutoCleanup, "false")
	})
}

func mailboxExists(t *testing.T, s *Store, id uuid.UUID) bool {
	t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM mailboxes WHERE id = $1`, id).Scan(&n); err != nil {
		t.Fatalf("count mailbox: %v", err)
	}
	return n == 1
}

// listByAddress 按邮箱本地部分索引某账号的邮箱。
func listByAddress(t *testing.T, s *Store, accountID uuid.UUID) map[string]model.Mailbox {
	t.Helper()
	boxes, _, err := s.ListMailboxes(context.Background(), accountID, 1, 100)
	if err != nil {
		t.Fatalf("ListMailboxes: %v", err)
	}
	out := make(map[string]model.Mailbox, len(boxes))
	for _, m := range boxes {
		out[m.Address] = m
	}
	return out
}

// ---------------------------------------------------------------- 默认：永久有效

func TestExpiryDisabledByDefaultKeepsEverything(t *testing.T) {
	s := openIntegrationStore(t)
	ctx := context.Background()
	setExpiryPolicy(t, s, false, 30, false)
	f := newExpiryFixture(t, s, "A")

	before, err := s.GetStats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	id, addr := f.addMailbox(t, s, "ancient", 3*time.Hour) // 远超 30 分钟的老邮箱

	got := listByAddress(t, s, f.accountID)["ancient"]
	if got.ExpiresAt != nil || got.Expired {
		t.Fatalf("关闭过期机制时邮箱应永久有效，got ExpiresAt=%v Expired=%v", got.ExpiresAt, got.Expired)
	}
	if _, err := s.CleanupExpiredMailboxes(ctx); err != nil {
		t.Fatalf("CleanupExpiredMailboxes: %v", err)
	}
	if !mailboxExists(t, s, id) {
		t.Fatal("关闭过期机制时邮箱不应被清理")
	}
	res, err := s.DeliverEmails(ctx, []string{addr}, "a@x.test", "s", "t", "", "raw")
	if err != nil || len(res) != 1 || !res[0].Delivered {
		t.Fatalf("永久有效的邮箱应正常收信: res=%+v err=%v", res, err)
	}
	after, err := s.GetStats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if after.ActiveMailboxes-before.ActiveMailboxes != 1 || after.TotalMailboxes-before.TotalMailboxes != 1 {
		t.Fatalf("永久邮箱应计入活跃邮箱: active %d→%d total %d→%d",
			before.ActiveMailboxes, after.ActiveMailboxes, before.TotalMailboxes, after.TotalMailboxes)
	}
}

// 自动清理开关打开，但过期机制关闭：没有「到期」，所以什么都不会被清理。
func TestAutoCleanupAloneDoesNothing(t *testing.T) {
	s := openIntegrationStore(t)
	setExpiryPolicy(t, s, false, 30, true)
	f := newExpiryFixture(t, s, "B")
	id, _ := f.addMailbox(t, s, "ancient", 5*time.Hour)

	if _, err := s.CleanupExpiredMailboxes(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !mailboxExists(t, s, id) {
		t.Fatal("过期机制关闭时，自动清理开关不应删除邮箱")
	}
}

// ------------------------------------------------ 启用过期、关闭自动清理：到期但不删除

func TestExpiryEnabledWithoutAutoCleanupExpiresButKeeps(t *testing.T) {
	s := openIntegrationStore(t)
	ctx := context.Background()
	setExpiryPolicy(t, s, true, 30, false)
	f := newExpiryFixture(t, s, "C")

	before, err := s.GetStats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	oldID, oldAddr := f.addMailbox(t, s, "old", 3*time.Hour)
	freshID, freshAddr := f.addMailbox(t, s, "fresh", time.Minute)

	// 1. 到期判定与到期时间由后端计算
	boxes := listByAddress(t, s, f.accountID)
	if !boxes["old"].Expired || boxes["old"].ExpiresAt == nil {
		t.Fatalf("过了有效时长的邮箱应为已到期: %+v", boxes["old"])
	}
	if boxes["fresh"].Expired || boxes["fresh"].ExpiresAt == nil {
		t.Fatalf("未到期的邮箱应带有到期时间且未到期: %+v", boxes["fresh"])
	}

	// 2. 到期的邮箱失效：不再收信；未到期的正常收信（两条投递 SQL 路径都要验证）
	res, err := s.DeliverEmails(ctx, []string{oldAddr, freshAddr}, "a@x.test", "s", "t", "", "raw")
	if err != nil || len(res) != 2 || res[0].Delivered || !res[1].Delivered {
		t.Fatalf("DeliverEmails: 到期邮箱应被丢弃、未到期邮箱应送达: res=%+v err=%v", res, err)
	}
	batch, err := s.DeliverMessageBatch(ctx, []MessageDelivery{
		{Recipient: oldAddr, Sender: "a@x.test", Subject: "s", BodyText: "t", Raw: "raw"},
		{Recipient: freshAddr, Sender: "a@x.test", Subject: "s", BodyText: "t", Raw: "raw"},
	})
	if err != nil || len(batch) != 2 || batch[0].Delivered || !batch[1].Delivered {
		t.Fatalf("DeliverMessageBatch: 到期邮箱应被丢弃、未到期邮箱应送达: res=%+v err=%v", batch, err)
	}

	// 3. 畸形邮件发往到期邮箱：与未知收件人一致地丢弃，不能返回错误（否则 Postfix 会反复重试）
	poison := MessageDelivery{Recipient: oldAddr, Sender: "a@x.test", Subject: "s", BodyText: "bad\x00nul", Raw: "raw"}
	if r, err := s.DeliverMessage(ctx, poison); err != nil || r.Delivered {
		t.Fatalf("发往到期邮箱的畸形邮件应被丢弃而不是报错: r=%+v err=%v", r, err)
	}
	poison.Recipient = freshAddr
	if _, err := s.DeliverMessage(ctx, poison); err == nil {
		t.Fatal("发往有效邮箱的畸形邮件仍应报错（保持原有行为）")
	}

	// 4. 关闭自动清理：到期的邮箱不会被删除
	if _, err := s.CleanupExpiredMailboxes(ctx); err != nil {
		t.Fatal(err)
	}
	if !mailboxExists(t, s, oldID) || !mailboxExists(t, s, freshID) {
		t.Fatal("关闭自动清理时，到期邮箱不应被删除")
	}

	// 5. 统计：到期邮箱不算活跃
	after, err := s.GetStats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if after.TotalMailboxes-before.TotalMailboxes != 2 || after.ActiveMailboxes-before.ActiveMailboxes != 1 {
		t.Fatalf("到期邮箱不应计入活跃: total %d→%d active %d→%d",
			before.TotalMailboxes, after.TotalMailboxes, before.ActiveMailboxes, after.ActiveMailboxes)
	}
	accounts, _, err := s.ListAccounts(ctx, 1, 100)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, a := range accounts {
		if a.ID == f.accountID {
			found = true
			if a.MailboxCount != 2 || a.ActiveMailboxCount != 1 {
				t.Fatalf("账户统计: mailboxes=%d active=%d, want 2/1", a.MailboxCount, a.ActiveMailboxCount)
			}
		}
	}
	if !found {
		t.Fatal("ListAccounts 第一页应包含刚创建的账户")
	}
}

// ------------------------------------------------------------ 启用过期且开启自动清理

func TestExpiryEnabledWithAutoCleanupDeletesOnlyExpired(t *testing.T) {
	s := openIntegrationStore(t)
	ctx := context.Background()
	setExpiryPolicy(t, s, true, 30, true)
	f := newExpiryFixture(t, s, "D")

	oldID, _ := f.addMailbox(t, s, "old", 3*time.Hour)
	freshID, _ := f.addMailbox(t, s, "fresh", time.Minute)
	var emailID uuid.UUID
	if err := s.pool.QueryRow(ctx,
		`INSERT INTO emails (mailbox_id, sender, subject) VALUES ($1, 's', 'x') RETURNING id`, oldID).Scan(&emailID); err != nil {
		t.Fatal(err)
	}

	deleted, err := s.CleanupExpiredMailboxes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if deleted < 1 {
		t.Fatalf("deleted = %d, want >= 1", deleted)
	}
	if mailboxExists(t, s, oldID) {
		t.Fatal("到期且开启自动清理时，应删除到期邮箱")
	}
	if !mailboxExists(t, s, freshID) {
		t.Fatal("未到期的邮箱不应被删除")
	}
	var n int
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM emails WHERE id = $1`, emailID).Scan(&n)
	if n != 0 {
		t.Fatal("邮箱被清理时，其邮件应一并删除")
	}
}

// ------------------------------------------- 配置即时生效：有效时长 / 总开关

func TestExpirySettingsApplyImmediately(t *testing.T) {
	s := openIntegrationStore(t)
	ctx := context.Background()
	f := newExpiryFixture(t, s, "E")
	id, _ := f.addMailbox(t, s, "mid", 20*time.Minute) // 已存在 20 分钟

	check := func(label string, wantExpired bool, wantHasExp bool) {
		t.Helper()
		m, err := s.GetMailbox(ctx, id, f.accountID)
		if err != nil {
			t.Fatalf("%s: GetMailbox: %v", label, err)
		}
		if m.Expired != wantExpired || (m.ExpiresAt != nil) != wantHasExp {
			t.Fatalf("%s: Expired=%v ExpiresAt=%v, want expired=%v hasExp=%v", label, m.Expired, m.ExpiresAt, wantExpired, wantHasExp)
		}
	}

	setExpiryPolicy(t, s, false, 30, false)
	check("关闭过期机制", false, false)

	setExpiryPolicy(t, s, true, 30, false)
	check("启用，有效时长 30 分钟", false, true)

	setExpiryPolicy(t, s, true, 10, false)
	check("有效时长缩短到 10 分钟，已存在的邮箱立即到期", true, true)

	setExpiryPolicy(t, s, true, 60, false)
	check("有效时长延长到 60 分钟，又恢复有效", false, true)

	setExpiryPolicy(t, s, false, 10, false)
	check("再次关闭过期机制，回到永久有效", false, false)

	// 到期时间 = 创建时间 + 当前有效时长
	setExpiryPolicy(t, s, true, 45, false)
	m, err := s.GetMailbox(ctx, id, f.accountID)
	if err != nil {
		t.Fatal(err)
	}
	if want := m.CreatedAt.Add(45 * time.Minute); m.ExpiresAt == nil || !m.ExpiresAt.Equal(want) {
		t.Fatalf("ExpiresAt = %v, want %v", m.ExpiresAt, want)
	}
}

func TestCreateMailboxReflectsPolicy(t *testing.T) {
	s := openIntegrationStore(t)
	ctx := context.Background()
	f := newExpiryFixture(t, s, "F")

	setExpiryPolicy(t, s, false, 30, false)
	m1, err := s.CreateMailbox(ctx, f.accountID, "perm", f.domainID, "perm@"+f.domain)
	if err != nil {
		t.Fatal(err)
	}
	if m1.ExpiresAt != nil || m1.Expired {
		t.Fatalf("默认永久有效，新邮箱不应有到期时间: %+v", m1)
	}

	setExpiryPolicy(t, s, true, 45, false)
	m2, err := s.CreateMailbox(ctx, f.accountID, "temp", f.domainID, "temp@"+f.domain)
	if err != nil {
		t.Fatal(err)
	}
	if m2.ExpiresAt == nil || m2.Expired {
		t.Fatalf("启用过期后新邮箱应带到期时间且未到期: %+v", m2)
	}
	if d := m2.ExpiresAt.Sub(m2.CreatedAt); d != 45*time.Minute {
		t.Fatalf("到期时间应为创建时间 + 45 分钟，实际 %v", d)
	}
}

// 用户侧的邮箱读取必须带账号归属校验：别人的邮箱对你就是「不存在」。
func TestGetMailboxEnforcesOwnership(t *testing.T) {
	s := openIntegrationStore(t)
	ctx := context.Background()
	alice := newExpiryFixture(t, s, "G1")
	bob := newExpiryFixture(t, s, "G2")
	id, _ := alice.addMailbox(t, s, "private", time.Minute)

	if _, err := s.GetMailbox(ctx, id, alice.accountID); err != nil {
		t.Fatalf("本人应能读取: %v", err)
	}
	if _, err := s.GetMailbox(ctx, id, bob.accountID); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("他人读取应返回 ErrNoRows，got %v", err)
	}
	if err := s.DeleteMailbox(ctx, id, bob.accountID); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("他人删除应返回 ErrNoRows，got %v", err)
	}
	if !mailboxExists(t, s, id) {
		t.Fatal("他人的删除请求不应删除邮箱")
	}
}

// ------------------------------------------------------- 管理后台「全部邮件」

func (f expiryFixture) addEmail(t *testing.T, s *Store, mailboxID uuid.UUID, sender, subject string, receivedAt time.Time) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := s.pool.QueryRow(context.Background(),
		`INSERT INTO emails (mailbox_id, sender, subject, body_text, body_html, raw_message, size_bytes, received_at)
		 VALUES ($1, $2, $3, $4, $5, $6, 10, $7) RETURNING id`,
		mailboxID, sender, subject, "正文 "+subject, "<p>"+subject+"</p>", "RAW "+subject, receivedAt).Scan(&id); err != nil {
		t.Fatalf("insert email: %v", err)
	}
	return id
}

func TestListAllEmailsSearchSortAndPaging(t *testing.T) {
	s := openIntegrationStore(t)
	ctx := context.Background()
	alice := newExpiryFixture(t, s, "H1")
	bob := newExpiryFixture(t, s, "H2")
	token := strings.TrimPrefix(alice.username, "expH1_") // 本次测试独有的标记，避免与库里其他数据混淆
	_, aliceAddr := alice.addMailbox(t, s, "inbox", time.Hour)
	aliceBox := mustMailboxID(t, s, aliceAddr)
	bobBoxID, bobAddr := bob.addMailbox(t, s, "inbox", time.Hour)

	base := time.Now().Add(-10 * time.Hour).Truncate(time.Second)
	e1 := alice.addEmail(t, s, aliceBox, "Alice Notify <notify-"+token+"@alpha.test>", "Welcome "+token, base.Add(1*time.Hour))
	e2 := alice.addEmail(t, s, aliceBox, "bob@beta.test", "pct 100% "+token, base.Add(2*time.Hour))
	e3 := alice.addEmail(t, s, aliceBox, "dan@delta.test", "pct 1000 "+token, base.Add(3*time.Hour))
	e4 := alice.addEmail(t, s, aliceBox, "eve@eps.test", "a_b "+token, base.Add(4*time.Hour))
	e5 := alice.addEmail(t, s, aliceBox, "fay@zeta.test", "axb "+token, base.Add(5*time.Hour))
	e6 := alice.addEmail(t, s, bobBoxID, "carol@gamma.test", "Hello "+token, base.Add(6*time.Hour))

	ids := func(items []AdminEmailSummary) []uuid.UUID {
		out := make([]uuid.UUID, len(items))
		for i, it := range items {
			out[i] = it.ID
		}
		return out
	}
	list := func(f AdminEmailFilter) ([]AdminEmailSummary, int) {
		t.Helper()
		items, total, err := s.ListAllEmails(ctx, f)
		if err != nil {
			t.Fatalf("ListAllEmails(%+v): %v", f, err)
		}
		return items, total
	}
	same := func(label string, got []uuid.UUID, want ...uuid.UUID) {
		t.Helper()
		if len(got) != len(want) {
			t.Fatalf("%s: got %d items %v, want %d %v", label, len(got), got, len(want), want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("%s: item %d = %v, want %v", label, i, got[i], want[i])
			}
		}
	}

	// 按「用户」搜索：只有该用户邮箱里的邮件；默认按接收时间降序
	items, total := list(AdminEmailFilter{Field: AdminEmailFieldUser, Query: alice.username})
	if total != 5 {
		t.Fatalf("user 搜索 total = %d, want 5", total)
	}
	same("用户 alice 降序", ids(items), e5, e4, e3, e2, e1)
	if items[0].Username != alice.username || items[0].Mailbox != aliceAddr {
		t.Fatalf("列表项应带所属用户与邮箱: %+v", items[0])
	}

	// 升序
	items, _ = list(AdminEmailFilter{Field: AdminEmailFieldUser, Query: alice.username, Order: AdminEmailOrderAsc})
	same("用户 alice 升序", ids(items), e1, e2, e3, e4, e5)

	// 按「邮箱」搜索（地址子串、大小写不敏感）
	items, total = list(AdminEmailFilter{Field: AdminEmailFieldMailbox, Query: strings.ToUpper(bobAddr)})
	same("邮箱 bob", ids(items), e6)
	if total != 1 || items[0].Username != bob.username {
		t.Fatalf("邮箱搜索: total=%d item=%+v", total, items[0])
	}

	// 按「发件人」搜索：大小写不敏感的子串，能匹配显示名里的内容
	items, _ = list(AdminEmailFilter{Field: AdminEmailFieldSender, Query: "NOTIFY-" + strings.ToUpper(token)})
	same("发件人子串", ids(items), e1)

	// 按「主题」搜索
	items, _ = list(AdminEmailFilter{Field: AdminEmailFieldSubject, Query: "hello " + token})
	same("主题子串", ids(items), e6)

	// 通配符按字面匹配：未转义时 "100% <token>" 会同时匹配 "1000 <token>"
	items, _ = list(AdminEmailFilter{Field: AdminEmailFieldSubject, Query: "100% " + token})
	same("字面量 %", ids(items), e2)
	// 同理 "a_b" 不应匹配 "axb"
	items, _ = list(AdminEmailFilter{Field: AdminEmailFieldSubject, Query: "a_b " + token})
	same("字面量 _", ids(items), e4)

	// 分页：5 封邮件，每页 2 封
	items, total = list(AdminEmailFilter{Field: AdminEmailFieldUser, Query: alice.username, Page: 2, Size: 2})
	if total != 5 {
		t.Fatalf("分页 total = %d, want 5", total)
	}
	same("第 2 页", ids(items), e3, e2)
	items, _ = list(AdminEmailFilter{Field: AdminEmailFieldUser, Query: alice.username, Page: 3, Size: 2})
	same("第 3 页", ids(items), e1)

	// 没有任何命中
	items, total = list(AdminEmailFilter{Field: AdminEmailFieldSender, Query: "no-such-sender-" + token})
	if len(items) != 0 || total != 0 {
		t.Fatalf("无命中: %d items, total %d", len(items), total)
	}

	// 详情：任意用户的邮件，含完整内容与所属邮箱 / 用户
	d, err := s.GetEmailAdmin(ctx, e6)
	if err != nil {
		t.Fatalf("GetEmailAdmin: %v", err)
	}
	if d.Username != bob.username || d.Mailbox != bobAddr || d.AccountID != bob.accountID ||
		!strings.Contains(d.BodyText, "Hello "+token) || !strings.Contains(d.BodyHTML, "<p>") || !strings.HasPrefix(d.RawMessage, "RAW ") {
		t.Fatalf("详情不完整: %+v", d)
	}
	if _, err := s.GetEmailAdmin(ctx, uuid.New()); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("不存在的邮件应返回 ErrNoRows，got %v", err)
	}
}

func mustMailboxID(t *testing.T, s *Store, address string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := s.pool.QueryRow(context.Background(), `SELECT id FROM mailboxes WHERE full_address = $1`, address).Scan(&id); err != nil {
		t.Fatalf("lookup mailbox %s: %v", address, err)
	}
	return id
}
