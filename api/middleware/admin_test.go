package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"tempmail/model"

	"github.com/gin-gonic/gin"
)

func TestAdminOnly(t *testing.T) {
	tests := []struct {
		name    string
		account *model.Account
		want    int
	}{
		{"未认证（上下文里没有账号）", nil, http.StatusForbidden},
		{"普通用户", &model.Account{Username: "user"}, http.StatusForbidden},
		{"管理员", &model.Account{Username: "admin", IsAdmin: true}, http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tr := newTestRouter(tt.account, AdminOnly())
			w := tr.get("203.0.113.9:1234", nil)
			if w.Code != tt.want {
				t.Fatalf("status = %d, want %d", w.Code, tt.want)
			}
			wantCalls := 0
			if tt.want == http.StatusOK {
				wantCalls = 1
			}
			if tr.calls != wantCalls {
				t.Fatalf("handler calls = %d, want %d", tr.calls, wantCalls)
			}
		})
	}
}

// 账号被放进上下文但类型不对时（例如被别的中间件写成值而不是指针），必须按未认证处理，不能放行。
func TestAdminOnlyRejectsWrongAccountType(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(AccountKey, model.Account{IsAdmin: true}) // 值类型，不是 *model.Account
		c.Next()
	}, AdminOnly())
	engine.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })

	w := httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
}
