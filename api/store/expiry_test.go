package store

import (
	"strings"
	"testing"
	"time"

	"tempmail/model"
)

func TestParseExpiryPolicyDefaults(t *testing.T) {
	// 没有任何设置（例如全新数据库）时：过期机制关闭、自动清理关闭、有效时长 30 分钟。
	p := ParseExpiryPolicy(nil)
	if p.Enabled || p.AutoCleanup || p.TTLMinutes != DefaultMailboxTTLMinutes {
		t.Fatalf("defaults = %+v, want disabled / no cleanup / 30 min", p)
	}
}

func TestParseExpiryPolicy(t *testing.T) {
	tests := []struct {
		name string
		in   map[string]string
		want ExpiryPolicy
	}{
		{"启用且自定义时长", map[string]string{"mailbox_expiry_enabled": "true", "mailbox_ttl_minutes": "45"}, ExpiryPolicy{Enabled: true, TTLMinutes: 45}},
		{"空白被忽略", map[string]string{"mailbox_expiry_enabled": " true ", "mailbox_ttl_minutes": " 45 ", "mailbox_auto_cleanup": " true "}, ExpiryPolicy{Enabled: true, TTLMinutes: 45, AutoCleanup: true}},
		{"自动清理独立于过期机制：只开清理", map[string]string{"mailbox_auto_cleanup": "true"}, ExpiryPolicy{AutoCleanup: true, TTLMinutes: 30}},
		{"只开过期不开清理", map[string]string{"mailbox_expiry_enabled": "true"}, ExpiryPolicy{Enabled: true, TTLMinutes: 30}},
		{"非 true 的值一律视为关闭", map[string]string{"mailbox_expiry_enabled": "1", "mailbox_auto_cleanup": "yes"}, ExpiryPolicy{TTLMinutes: 30}},
		{"false 即关闭", map[string]string{"mailbox_expiry_enabled": "false", "mailbox_auto_cleanup": "false"}, ExpiryPolicy{TTLMinutes: 30}},
		{"时长为 0 回落默认", map[string]string{"mailbox_ttl_minutes": "0"}, ExpiryPolicy{TTLMinutes: 30}},
		{"时长为负回落默认", map[string]string{"mailbox_ttl_minutes": "-5"}, ExpiryPolicy{TTLMinutes: 30}},
		{"时长不是数字回落默认", map[string]string{"mailbox_ttl_minutes": "abc"}, ExpiryPolicy{TTLMinutes: 30}},
		{"时长为空回落默认", map[string]string{"mailbox_ttl_minutes": ""}, ExpiryPolicy{TTLMinutes: 30}},
		{"时长超过上限回落默认", map[string]string{"mailbox_ttl_minutes": "99999999"}, ExpiryPolicy{TTLMinutes: 30}},
		{"时长恰为上限", map[string]string{"mailbox_ttl_minutes": "5256000"}, ExpiryPolicy{TTLMinutes: MaxMailboxTTLMinutes}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ParseExpiryPolicy(tt.in); got != tt.want {
				t.Fatalf("ParseExpiryPolicy(%v) = %+v, want %+v", tt.in, got, tt.want)
			}
		})
	}
}

func TestExpiryDisabledMeansPermanent(t *testing.T) {
	created := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	now := created.Add(10 * 365 * 24 * time.Hour) // 十年后
	// 无论有效时长、是否开启自动清理，关闭过期机制时邮箱永不到期、永不清理。
	for _, p := range []ExpiryPolicy{
		{TTLMinutes: 30},
		{TTLMinutes: 1},
		{TTLMinutes: 30, AutoCleanup: true},
	} {
		if exp := p.ExpiresAt(created); exp != nil {
			t.Errorf("%+v: ExpiresAt = %v, want nil", p, exp)
		}
		if p.IsExpired(created, now) {
			t.Errorf("%+v: IsExpired = true, want false", p)
		}
		if p.ShouldCleanup() {
			t.Errorf("%+v: ShouldCleanup = true, want false", p)
		}
	}
}

func TestExpiryEnabledComputesFromCreatedAt(t *testing.T) {
	created := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	p := ExpiryPolicy{Enabled: true, TTLMinutes: 30}

	exp := p.ExpiresAt(created)
	if exp == nil || !exp.Equal(created.Add(30*time.Minute)) {
		t.Fatalf("ExpiresAt = %v, want created+30m", exp)
	}
	if p.IsExpired(created, created.Add(29*time.Minute+59*time.Second)) {
		t.Error("到期前一秒不应判定为到期")
	}
	if !p.IsExpired(created, created.Add(30*time.Minute)) {
		t.Error("恰好到达到期时间应判定为到期")
	}
	if !p.IsExpired(created, created.Add(31*time.Minute)) {
		t.Error("超过到期时间应判定为到期")
	}
}

func TestExpiryAndCleanupAreIndependent(t *testing.T) {
	created := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	later := created.Add(2 * time.Hour)

	// 启用过期、关闭自动清理：邮箱照常到期（失效），只是不会被删除。
	noCleanup := ExpiryPolicy{Enabled: true, TTLMinutes: 30, AutoCleanup: false}
	if !noCleanup.IsExpired(created, later) {
		t.Error("关闭自动清理不应影响到期判定")
	}
	if noCleanup.ShouldCleanup() {
		t.Error("关闭自动清理时不应清理")
	}

	// 启用过期、开启自动清理：到期且清理。
	withCleanup := ExpiryPolicy{Enabled: true, TTLMinutes: 30, AutoCleanup: true}
	if !withCleanup.IsExpired(created, later) || !withCleanup.ShouldCleanup() {
		t.Error("两项都开启时应到期并清理")
	}

	// 关闭过期机制、开启自动清理：没有「到期」，自然也不清理。
	onlyCleanup := ExpiryPolicy{Enabled: false, TTLMinutes: 30, AutoCleanup: true}
	if onlyCleanup.IsExpired(created, later) || onlyCleanup.ShouldCleanup() {
		t.Error("过期机制关闭时，自动清理开关不应生效")
	}
}

func TestExpiryApplyFillsMailbox(t *testing.T) {
	created := time.Now().Add(-45 * time.Minute)
	m := model.Mailbox{CreatedAt: created}

	(ExpiryPolicy{TTLMinutes: 30}).Apply(&m, time.Now())
	if m.ExpiresAt != nil || m.Expired {
		t.Fatalf("关闭过期机制: ExpiresAt=%v Expired=%v, want nil/false", m.ExpiresAt, m.Expired)
	}

	(ExpiryPolicy{Enabled: true, TTLMinutes: 30}).Apply(&m, time.Now())
	if m.ExpiresAt == nil || !m.ExpiresAt.Equal(created.Add(30*time.Minute)) || !m.Expired {
		t.Fatalf("启用且已超时: ExpiresAt=%v Expired=%v", m.ExpiresAt, m.Expired)
	}

	(ExpiryPolicy{Enabled: true, TTLMinutes: 120}).Apply(&m, time.Now())
	if m.ExpiresAt == nil || m.Expired {
		t.Fatalf("启用但未超时: ExpiresAt=%v Expired=%v", m.ExpiresAt, m.Expired)
	}
}

func TestValidateSetting(t *testing.T) {
	ok := []struct{ key, value string }{
		{"mailbox_expiry_enabled", "true"}, {"mailbox_expiry_enabled", "false"},
		{"mailbox_auto_cleanup", "true"}, {"mailbox_auto_cleanup", "false"},
		{"mailbox_ttl_minutes", "1"}, {"mailbox_ttl_minutes", "30"}, {"mailbox_ttl_minutes", "5256000"}, {"mailbox_ttl_minutes", " 60 "},
		{"site_title", ""}, {"announcement", "任意内容"}, {"smtp_hostname", "mail.example.com"}, // 其他设置不受影响
	}
	for _, c := range ok {
		if err := ValidateSetting(c.key, c.value); err != nil {
			t.Errorf("ValidateSetting(%q, %q) = %v, want nil", c.key, c.value, err)
		}
	}
	bad := []struct{ key, value string }{
		{"mailbox_expiry_enabled", "yes"}, {"mailbox_expiry_enabled", ""}, {"mailbox_expiry_enabled", "TRUE"},
		{"mailbox_auto_cleanup", "1"}, {"mailbox_auto_cleanup", ""},
		{"mailbox_ttl_minutes", "0"}, {"mailbox_ttl_minutes", "-1"}, {"mailbox_ttl_minutes", "abc"},
		{"mailbox_ttl_minutes", ""}, {"mailbox_ttl_minutes", "5256001"}, {"mailbox_ttl_minutes", "1.5"},
	}
	for _, c := range bad {
		if err := ValidateSetting(c.key, c.value); err == nil {
			t.Errorf("ValidateSetting(%q, %q) = nil, want error", c.key, c.value)
		}
	}
}

// SQL 内的策略读取必须与 Go 侧的 ParseExpiryPolicy 保持同样的默认值与上限，
// 否则「后端计算的到期时间」和「SQL 里的到期判定」会不一致。
func TestExpiryPolicySQLMatchesGoDefaults(t *testing.T) {
	for _, want := range []string{
		"'mailbox_expiry_enabled'", "'mailbox_ttl_minutes'", "'mailbox_auto_cleanup'",
		"ELSE 30", "BETWEEN 1 AND 5256000",
	} {
		if !strings.Contains(expiryPolicyCTE, want) {
			t.Errorf("expiryPolicyCTE 缺少 %s", want)
		}
	}
	if MaxMailboxTTLMinutes != 5256000 || DefaultMailboxTTLMinutes != 30 {
		t.Fatal("Go 常量与 SQL 中的 5256000 / 30 不一致，请同步修改 expiryPolicyCTE")
	}
}
