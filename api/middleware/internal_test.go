package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func newInternalRouter(token string) (*gin.Engine, *int) {
	gin.SetMode(gin.TestMode)
	calls := 0
	r := gin.New()
	r.Use(InternalAuth(token))
	r.POST("/internal/deliver", func(c *gin.Context) {
		calls++
		c.String(http.StatusOK, "ok")
	})
	return r, &calls
}

func TestInternalAuth(t *testing.T) {
	const secret = "0123456789abcdef0123456789abcdef"

	tests := []struct {
		name       string
		serverTok  string
		header     *string
		wantStatus int
		wantCalls  int
	}{
		{name: "correct token", serverTok: secret, header: ptr(secret), wantStatus: http.StatusOK, wantCalls: 1},
		{name: "missing header", serverTok: secret, header: nil, wantStatus: http.StatusUnauthorized},
		{name: "empty header", serverTok: secret, header: ptr(""), wantStatus: http.StatusUnauthorized},
		{name: "wrong token", serverTok: secret, header: ptr("wrong"), wantStatus: http.StatusUnauthorized},
		{name: "prefix of token", serverTok: secret, header: ptr(secret[:8]), wantStatus: http.StatusUnauthorized},
		{name: "token with suffix", serverTok: secret, header: ptr(secret + "x"), wantStatus: http.StatusUnauthorized},
		// 未配置密钥时必须拒绝所有请求，即使调用方也不带头（空串 == 空串不能放行）。
		{name: "unconfigured rejects empty header", serverTok: "", header: nil, wantStatus: http.StatusServiceUnavailable},
		{name: "unconfigured rejects empty value", serverTok: "", header: ptr(""), wantStatus: http.StatusServiceUnavailable},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r, calls := newInternalRouter(tt.serverTok)
			req := httptest.NewRequest(http.MethodPost, "/internal/deliver", nil)
			if tt.header != nil {
				req.Header.Set(InternalTokenHeader, *tt.header)
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", w.Code, tt.wantStatus, w.Body.String())
			}
			if *calls != tt.wantCalls {
				t.Fatalf("handler calls = %d, want %d", *calls, tt.wantCalls)
			}
		})
	}
}

func ptr(s string) *string { return &s }
