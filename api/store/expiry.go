package store

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"tempmail/model"
)

// 邮箱有效期相关的后台设置（存放在 app_settings 表）。
//
// 三个设置相互独立：
//   - mailbox_expiry_enabled：是否启用过期机制。默认 false，邮箱永久有效。
//   - mailbox_ttl_minutes：有效时长（分钟），从邮箱创建时间起算。仅在启用过期机制时参与判断。
//   - mailbox_auto_cleanup：邮箱到期后是否自动清理。默认 false。
//     它只决定「到期的邮箱要不要被删除」，不影响「是否到期」：关闭它，到期的邮箱依旧失效，只是不被删除。
const (
	SettingMailboxExpiryEnabled = "mailbox_expiry_enabled"
	SettingMailboxTTLMinutes    = "mailbox_ttl_minutes"
	SettingMailboxAutoCleanup   = "mailbox_auto_cleanup"

	DefaultMailboxTTLMinutes = 30
	// MaxMailboxTTLMinutes 限制有效时长上限（10 年），避免 interval 运算溢出。
	MaxMailboxTTLMinutes = 5256000
)

// ExpiryPolicy 是后台配置解析后的邮箱有效期策略。
type ExpiryPolicy struct {
	Enabled     bool // 是否启用过期机制
	TTLMinutes  int  // 有效时长（分钟）
	AutoCleanup bool // 到期后是否自动清理
}

// TTL 返回有效时长。
func (p ExpiryPolicy) TTL() time.Duration { return time.Duration(p.TTLMinutes) * time.Minute }

// ExpiresAt 返回邮箱的到期时间；未启用过期机制时返回 nil（永久有效）。
// 到期时间不落库，始终由「创建时间 + 当前有效时长」动态计算，因此后台改配置会立即对所有邮箱生效。
func (p ExpiryPolicy) ExpiresAt(createdAt time.Time) *time.Time {
	if !p.Enabled {
		return nil
	}
	t := createdAt.Add(p.TTL())
	return &t
}

// IsExpired 判断邮箱在 now 这个时刻是否已到期。未启用过期机制时永远返回 false。
func (p ExpiryPolicy) IsExpired(createdAt, now time.Time) bool {
	exp := p.ExpiresAt(createdAt)
	return exp != nil && !now.Before(*exp)
}

// ShouldCleanup 表示后台清理器是否应该删除已到期的邮箱：必须同时启用过期机制和自动清理。
func (p ExpiryPolicy) ShouldCleanup() bool { return p.Enabled && p.AutoCleanup }

// Apply 把到期信息写入邮箱，供接口返回。
func (p ExpiryPolicy) Apply(m *model.Mailbox, now time.Time) {
	m.ExpiresAt = p.ExpiresAt(m.CreatedAt)
	m.Expired = p.IsExpired(m.CreatedAt, now)
}

// ParseExpiryPolicy 从设置键值解析策略。缺失或非法的值回落到默认：
// 过期机制关闭、自动清理关闭、有效时长 30 分钟。
func ParseExpiryPolicy(settings map[string]string) ExpiryPolicy {
	p := ExpiryPolicy{TTLMinutes: DefaultMailboxTTLMinutes}
	p.Enabled = strings.TrimSpace(settings[SettingMailboxExpiryEnabled]) == "true"
	p.AutoCleanup = strings.TrimSpace(settings[SettingMailboxAutoCleanup]) == "true"
	if n, err := strconv.Atoi(strings.TrimSpace(settings[SettingMailboxTTLMinutes])); err == nil && n > 0 && n <= MaxMailboxTTLMinutes {
		p.TTLMinutes = n
	}
	return p
}

// ValidateSetting 校验后台提交的设置值。目前只有邮箱有效期相关的设置需要校验，其余设置原样接受。
func ValidateSetting(key, value string) error {
	switch key {
	case SettingMailboxExpiryEnabled, SettingMailboxAutoCleanup:
		if value != "true" && value != "false" {
			return fmt.Errorf("%s 只能是 true 或 false", key)
		}
	case SettingMailboxTTLMinutes:
		n, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil || n < 1 || n > MaxMailboxTTLMinutes {
			return fmt.Errorf("邮箱有效时长必须是 1 到 %d 之间的整数（分钟）", MaxMailboxTTLMinutes)
		}
	}
	return nil
}

// GetExpiryPolicy 读取当前生效的邮箱有效期策略。
func (s *Store) GetExpiryPolicy(ctx context.Context) (ExpiryPolicy, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT key, value FROM app_settings WHERE key IN ($1, $2, $3)`,
		SettingMailboxExpiryEnabled, SettingMailboxTTLMinutes, SettingMailboxAutoCleanup)
	if err != nil {
		return ExpiryPolicy{}, err
	}
	defer rows.Close()
	settings := make(map[string]string, 3)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return ExpiryPolicy{}, err
		}
		settings[k] = v
	}
	if err := rows.Err(); err != nil {
		return ExpiryPolicy{}, err
	}
	return ParseExpiryPolicy(settings), nil
}

// CleanupExpiredMailboxes 删除已到期的邮箱（连同其邮件）。
// 只有「启用过期机制」且「开启自动清理」时才会删除任何东西；否则直接返回 0。
// 策略读取与删除在同一条 SQL 里完成，不会出现「刚读完配置，管理员就改了配置」的竞态。
func (s *Store) CleanupExpiredMailboxes(ctx context.Context) (int64, error) {
	tag, err := s.pool.Exec(ctx, `
		WITH `+expiryPolicyCTE+`
		DELETE FROM mailboxes AS m
		USING policy AS p
		WHERE p.enabled AND p.auto_cleanup
		  AND m.created_at + make_interval(mins => p.ttl_minutes) <= NOW()`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// expiryPolicyCTE 在 SQL 内读取过期策略，输出单行 policy(enabled, ttl_minutes, auto_cleanup)。
// 与 ParseExpiryPolicy 保持相同的默认值和容错：设置缺失或非法时，过期机制关闭、有效时长 30 分钟。
// 放进同一条语句里，投递这类热路径就不需要额外多一次数据库往返。
const expiryPolicyCTE = `raw AS (
		SELECT
			(SELECT value FROM app_settings WHERE key = 'mailbox_expiry_enabled') AS enabled_v,
			(SELECT value FROM app_settings WHERE key = 'mailbox_ttl_minutes')    AS ttl_v,
			(SELECT value FROM app_settings WHERE key = 'mailbox_auto_cleanup')   AS cleanup_v
	),
	policy AS (
		SELECT
			COALESCE(btrim(enabled_v), '') = 'true' AS enabled,
			COALESCE(btrim(cleanup_v), '') = 'true' AS auto_cleanup,
			CASE
				WHEN btrim(ttl_v) ~ '^[0-9]{1,7}$' THEN
					CASE WHEN btrim(ttl_v)::INT BETWEEN 1 AND 5256000 THEN btrim(ttl_v)::INT ELSE 30 END
				ELSE 30
			END AS ttl_minutes
		FROM raw
	)`

// mailboxAliveSQL 是「邮箱当前有效」的判定条件，m 为 mailboxes 别名，p 为 policy。
// 未启用过期机制时恒为真。
const mailboxAliveSQL = `(NOT p.enabled OR m.created_at + make_interval(mins => p.ttl_minutes) > NOW())`
