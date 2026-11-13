package store

import (
	"context"
	"strconv"
	"strings"
	"time"

	"tempmail/model"

	"github.com/google/uuid"
)

// 管理后台「全部邮件」：跨用户查询邮件。
//
// 这里的方法没有任何账号归属限制，所以只能由 handler.AdminEmailHandler 调用，
// 而该 handler 的路由在 routes.go 里由 AdminOnly 保护。普通用户读取邮件仍然走
// ListEmails / GetEmail，它们必须先通过 GetMailbox(mailboxID, accountID) 的归属校验。

const (
	AdminEmailFieldSender  = "sender"
	AdminEmailFieldSubject = "subject"
	AdminEmailFieldUser    = "user"
	AdminEmailFieldMailbox = "mailbox"

	AdminEmailOrderAsc  = "asc"
	AdminEmailOrderDesc = "desc"

	adminEmailMaxQueryLen = 200
)

// adminEmailSearchColumns 是允许搜索的字段到 SQL 列的白名单映射。
// 列名只来自这里，绝不会拼接用户输入。
var adminEmailSearchColumns = map[string]string{
	AdminEmailFieldSender:  "e.sender",
	AdminEmailFieldSubject: "e.subject",
	AdminEmailFieldUser:    "a.username",
	AdminEmailFieldMailbox: "m.full_address",
}

// ValidAdminEmailField 判断搜索字段是否合法。
func ValidAdminEmailField(field string) bool {
	_, ok := adminEmailSearchColumns[field]
	return ok
}

// AdminEmailFilter 是「全部邮件」的查询条件。Query 为空表示不过滤。
type AdminEmailFilter struct {
	Field string // sender | subject | user | mailbox，仅在 Query 非空时使用
	Query string // 关键词，大小写不敏感的子串匹配
	Order string // asc | desc：按邮件接收时间排序，默认 desc（最新在前）
	Page  int
	Size  int
}

// AdminEmailSummary 是列表中的一行：除邮件摘要外，还带上所属邮箱与用户。
type AdminEmailSummary struct {
	ID         uuid.UUID `json:"id"`
	MailboxID  uuid.UUID `json:"mailbox_id"`
	Mailbox    string    `json:"mailbox"`
	AccountID  uuid.UUID `json:"account_id"`
	Username   string    `json:"username"`
	Sender     string    `json:"sender"`
	Subject    string    `json:"subject"`
	SizeBytes  int       `json:"size_bytes"`
	ReceivedAt time.Time `json:"received_at"`
}

// AdminEmailDetail 是邮件详情：完整邮件内容 + 所属邮箱与用户。
type AdminEmailDetail struct {
	model.Email
	Mailbox   string    `json:"mailbox"`
	AccountID uuid.UUID `json:"account_id"`
	Username  string    `json:"username"`
}

// escapeLike 转义 LIKE 通配符，让用户输入的 % _ \ 按字面匹配。
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// normalizeAdminEmailFilter 规整查询条件：去空白、限制长度、补默认值、限制分页范围。
func normalizeAdminEmailFilter(f AdminEmailFilter) AdminEmailFilter {
	f.Query = strings.TrimSpace(f.Query)
	if runes := []rune(f.Query); len(runes) > adminEmailMaxQueryLen {
		f.Query = string(runes[:adminEmailMaxQueryLen])
	}
	if f.Order != AdminEmailOrderAsc {
		f.Order = AdminEmailOrderDesc
	}
	if f.Page < 1 {
		f.Page = 1
	}
	if f.Size < 1 || f.Size > 100 {
		f.Size = 20
	}
	return f
}

// buildAdminEmailWhere 生成 WHERE 子句及参数。没有关键词时返回空子句。
func buildAdminEmailWhere(f AdminEmailFilter) (where string, args []any) {
	if f.Query == "" {
		return "", nil
	}
	column, ok := adminEmailSearchColumns[f.Field]
	if !ok {
		// handler 已校验过字段；这里再兜底一次，避免任何情况下出现拼接未知列名。
		column = adminEmailSearchColumns[AdminEmailFieldSender]
	}
	return ` WHERE ` + column + ` ILIKE $1 ESCAPE '\'`, []any{"%" + escapeLike(f.Query) + "%"}
}

func adminEmailOrderSQL(order string) string {
	if order == AdminEmailOrderAsc {
		return "ASC"
	}
	return "DESC"
}

const adminEmailJoins = `
	FROM emails e
	JOIN mailboxes m ON m.id = e.mailbox_id
	JOIN accounts a ON a.id = m.account_id`

// ListAllEmails 跨用户查询邮件列表，支持按字段搜索与按接收时间排序，返回当前页与总数。
func (s *Store) ListAllEmails(ctx context.Context, filter AdminEmailFilter) ([]AdminEmailSummary, int, error) {
	f := normalizeAdminEmailFilter(filter)
	where, args := buildAdminEmailWhere(f)

	var total int
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*)`+adminEmailJoins+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	dir := adminEmailOrderSQL(f.Order)
	limitIdx, offsetIdx := len(args)+1, len(args)+2
	query := `SELECT e.id, e.mailbox_id, m.full_address, m.account_id, a.username,
		e.sender, e.subject, e.size_bytes, e.received_at` + adminEmailJoins + where +
		` ORDER BY e.received_at ` + dir + `, e.id ` + dir +
		` LIMIT $` + strconv.Itoa(limitIdx) + ` OFFSET $` + strconv.Itoa(offsetIdx)
	args = append(args, f.Size, (f.Page-1)*f.Size)

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]AdminEmailSummary, 0, f.Size)
	for rows.Next() {
		var it AdminEmailSummary
		if err := rows.Scan(&it.ID, &it.MailboxID, &it.Mailbox, &it.AccountID, &it.Username,
			&it.Sender, &it.Subject, &it.SizeBytes, &it.ReceivedAt); err != nil {
			return nil, 0, err
		}
		items = append(items, it)
	}
	return items, total, rows.Err()
}

// GetEmailAdmin 按邮件 ID 读取任意用户的邮件详情（含所属邮箱与用户）。
func (s *Store) GetEmailAdmin(ctx context.Context, emailID uuid.UUID) (*AdminEmailDetail, error) {
	var d AdminEmailDetail
	err := s.pool.QueryRow(ctx,
		`SELECT e.id, e.mailbox_id, e.sender, e.subject, e.body_text, e.body_html, e.raw_message,
			e.size_bytes, e.received_at, m.full_address, m.account_id, a.username`+adminEmailJoins+`
		 WHERE e.id = $1`, emailID,
	).Scan(&d.ID, &d.MailboxID, &d.Sender, &d.Subject, &d.BodyText, &d.BodyHTML, &d.RawMessage,
		&d.SizeBytes, &d.ReceivedAt, &d.Mailbox, &d.AccountID, &d.Username)
	if err != nil {
		return nil, err
	}
	return &d, nil
}
