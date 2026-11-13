package store

import (
	"strings"
	"testing"
)

func TestEscapeLike(t *testing.T) {
	tests := map[string]string{
		"plain":    "plain",
		"100%":     `100\%`,
		"a_b":      `a\_b`,
		`back\sl`:  `back\\sl`,
		`%_\`:      `\%\_\\`,
		"中文 关键词": "中文 关键词",
		"":         "",
	}
	for in, want := range tests {
		if got := escapeLike(in); got != want {
			t.Errorf("escapeLike(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormalizeAdminEmailFilter(t *testing.T) {
	got := normalizeAdminEmailFilter(AdminEmailFilter{Query: "  hello  ", Order: "weird", Page: -3, Size: 5000})
	if got.Query != "hello" || got.Order != AdminEmailOrderDesc || got.Page != 1 || got.Size != 20 {
		t.Fatalf("normalize = %+v", got)
	}
	if got := normalizeAdminEmailFilter(AdminEmailFilter{Order: "asc", Page: 3, Size: 50}); got.Order != AdminEmailOrderAsc || got.Page != 3 || got.Size != 50 {
		t.Fatalf("normalize keeps valid values: %+v", got)
	}
	long := strings.Repeat("字", 500)
	if n := len([]rune(normalizeAdminEmailFilter(AdminEmailFilter{Query: long}).Query)); n != adminEmailMaxQueryLen {
		t.Fatalf("query length = %d, want %d", n, adminEmailMaxQueryLen)
	}
}

func TestBuildAdminEmailWhere(t *testing.T) {
	wantColumn := map[string]string{
		AdminEmailFieldSender:  "e.sender",
		AdminEmailFieldSubject: "e.subject",
		AdminEmailFieldUser:    "a.username",
		AdminEmailFieldMailbox: "m.full_address",
	}
	for field, column := range wantColumn {
		where, args := buildAdminEmailWhere(AdminEmailFilter{Field: field, Query: "kw"})
		if !strings.Contains(where, column+" ILIKE $1") || !strings.Contains(where, `ESCAPE '\'`) {
			t.Errorf("%s: where = %q", field, where)
		}
		if len(args) != 1 || args[0] != "%kw%" {
			t.Errorf("%s: args = %v", field, args)
		}
	}

	// 通配符按字面匹配
	if _, args := buildAdminEmailWhere(AdminEmailFilter{Field: AdminEmailFieldSubject, Query: "50%_off"}); args[0] != `%50\%\_off%` {
		t.Errorf("args = %v", args)
	}

	// 没有关键词：不过滤，也不带参数
	if where, args := buildAdminEmailWhere(AdminEmailFilter{Field: AdminEmailFieldSender}); where != "" || args != nil {
		t.Errorf("empty query: where=%q args=%v", where, args)
	}
}

// 关键词和列名都不能让用户输入进入 SQL 文本：即使 handler 的校验被绕过，也只会落到白名单列上。
func TestBuildAdminEmailWhereNeverInterpolatesInput(t *testing.T) {
	evil := "x'; DROP TABLE emails; --"
	where, args := buildAdminEmailWhere(AdminEmailFilter{Field: "e.id; DROP TABLE emails", Query: evil})
	if strings.Contains(where, "DROP") || strings.Contains(where, evil) {
		t.Fatalf("where 含有用户输入: %q", where)
	}
	if !strings.Contains(where, "e.sender") {
		t.Fatalf("未知字段应回落到发件人: %q", where)
	}
	if len(args) != 1 || !strings.Contains(args[0].(string), "DROP TABLE") {
		t.Fatalf("关键词应只出现在参数里: %v", args)
	}
}

func TestAdminEmailFieldWhitelist(t *testing.T) {
	for _, f := range []string{"sender", "subject", "user", "mailbox"} {
		if !ValidAdminEmailField(f) {
			t.Errorf("%q 应该合法", f)
		}
	}
	for _, f := range []string{"", "body", "SENDER", "e.sender", "username", "address"} {
		if ValidAdminEmailField(f) {
			t.Errorf("%q 不应合法", f)
		}
	}
}

func TestAdminEmailOrderSQL(t *testing.T) {
	if adminEmailOrderSQL(AdminEmailOrderAsc) != "ASC" || adminEmailOrderSQL(AdminEmailOrderDesc) != "DESC" || adminEmailOrderSQL("; DROP") != "DESC" {
		t.Fatal("排序只能是 ASC / DESC，未知值回落到 DESC")
	}
}
