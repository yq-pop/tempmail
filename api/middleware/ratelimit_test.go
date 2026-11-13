package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"tempmail/model"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// fakeCounter 是内存版固定窗口计数器，只用于验证中间件自身的逻辑。
type fakeCounter struct {
	mu     sync.Mutex
	counts map[string]int64
	keys   []string
	ttl    time.Duration // 0 表示返回完整窗口
	err    error
}

func newFakeCounter() *fakeCounter {
	return &fakeCounter{counts: make(map[string]int64)}
}

func (f *fakeCounter) hit(_ context.Context, key string, window time.Duration) (int64, time.Duration, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return 0, 0, f.err
	}
	f.counts[key]++
	f.keys = append(f.keys, key)
	ttl := f.ttl
	if ttl == 0 {
		ttl = window
	}
	return f.counts[key], ttl, nil
}

func (f *fakeCounter) lastKey() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.keys[len(f.keys)-1]
}

type testRouter struct {
	engine *gin.Engine
	calls  int
}

func newTestRouter(account *model.Account, mws ...gin.HandlerFunc) *testRouter {
	gin.SetMode(gin.TestMode)
	tr := &testRouter{engine: gin.New()}
	if account != nil {
		tr.engine.Use(func(c *gin.Context) {
			c.Set(AccountKey, account)
			c.Next()
		})
	}
	tr.engine.Use(mws...)
	tr.engine.GET("/x", func(c *gin.Context) {
		tr.calls++
		c.String(http.StatusOK, "ok")
	})
	return tr
}

func (tr *testRouter) get(remoteAddr string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.RemoteAddr = remoteAddr
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	tr.engine.ServeHTTP(w, req)
	return w
}

func TestRateLimitExposesQuotaAndBlocksOverLimit(t *testing.T) {
	counter := newFakeCounter()
	counter.ttl = 1500 * time.Millisecond
	account := &model.Account{ID: uuid.New()}
	tr := newTestRouter(account, newLimiter(counter, "api", 2, 60, true, true))

	first := tr.get("203.0.113.7:1000", nil)
	if first.Code != http.StatusOK {
		t.Fatalf("first request status = %d", first.Code)
	}
	if got := first.Header().Get("X-RateLimit-Limit"); got != "2" {
		t.Fatalf("X-RateLimit-Limit = %q, want 2", got)
	}
	if got := first.Header().Get("X-RateLimit-Remaining"); got != "1" {
		t.Fatalf("X-RateLimit-Remaining = %q, want 1", got)
	}
	reset, err := strconv.ParseInt(first.Header().Get("X-RateLimit-Reset"), 10, 64)
	if err != nil || reset < time.Now().Unix() {
		t.Fatalf("X-RateLimit-Reset = %q, want a future unix timestamp", first.Header().Get("X-RateLimit-Reset"))
	}

	second := tr.get("203.0.113.7:1000", nil)
	if second.Code != http.StatusOK || second.Header().Get("X-RateLimit-Remaining") != "0" {
		t.Fatalf("second request = %d remaining=%q", second.Code, second.Header().Get("X-RateLimit-Remaining"))
	}

	third := tr.get("203.0.113.7:1000", nil)
	if third.Code != http.StatusTooManyRequests {
		t.Fatalf("third request status = %d, want 429", third.Code)
	}
	// 剩余 1.5 秒，向上取整为 2 秒。
	if got := third.Header().Get("Retry-After"); got != "2" {
		t.Fatalf("Retry-After = %q, want 2", got)
	}
	if !strings.Contains(third.Body.String(), `"retry_after":2`) {
		t.Fatalf("body = %s, want retry_after 2", third.Body.String())
	}
	if tr.calls != 2 {
		t.Fatalf("handler calls = %d, want 2 (blocked request must not reach handler)", tr.calls)
	}
}

func TestRateLimitKeysByAccountIDNotAPIKey(t *testing.T) {
	counter := newFakeCounter()
	account := &model.Account{ID: uuid.New()}
	tr := newTestRouter(account, newLimiter(counter, "api", 2, 60, true, true))

	// 同一账号用三种写法携带 API Key，必须共用同一个计数器。
	secret := "tm_supersecretkey"
	tr.get("203.0.113.7:1", map[string]string{"Authorization": "Bearer " + secret})
	tr.get("203.0.113.7:1", map[string]string{"Authorization": secret})
	third := tr.get("203.0.113.7:1", map[string]string{"X-API-Key": secret})
	if third.Code != http.StatusTooManyRequests {
		t.Fatalf("third request status = %d, want 429: all key spellings must share one counter", third.Code)
	}

	wantKey := "rl:api:acct:" + account.ID.String()
	for _, key := range counter.keys {
		if key != wantKey {
			t.Fatalf("counter key = %q, want %q", key, wantKey)
		}
		if strings.Contains(key, secret) {
			t.Fatalf("API key leaked into redis key %q", key)
		}
	}
}

func TestIPRateLimitIsolatesClientsAndScopes(t *testing.T) {
	counter := newFakeCounter()
	register := newTestRouter(nil, newLimiter(counter, "register", 1, 3600, false, false))

	if w := register.get("198.51.100.1:5000", nil); w.Code != http.StatusOK {
		t.Fatalf("first request from A = %d", w.Code)
	}
	blocked := register.get("198.51.100.1:5001", nil)
	if blocked.Code != http.StatusTooManyRequests {
		t.Fatalf("second request from A = %d, want 429 (port must not matter)", blocked.Code)
	}
	if blocked.Header().Get("X-RateLimit-Limit") != "" {
		t.Fatalf("route-level limiter must not override global quota headers")
	}
	if w := register.get("198.51.100.2:5000", nil); w.Code != http.StatusOK {
		t.Fatalf("first request from B = %d, want 200 (other IPs unaffected)", w.Code)
	}

	// 同一个 IP 在不同 scope 下互不影响。
	keyLogin := newTestRouter(nil, newLimiter(counter, "key-login", 1, 600, false, false))
	if w := keyLogin.get("198.51.100.1:5000", nil); w.Code != http.StatusOK {
		t.Fatalf("A under another scope = %d, want 200", w.Code)
	}
	if got, want := counter.lastKey(), "rl:key-login:ip:198.51.100.1"; got != want {
		t.Fatalf("key = %q, want %q", got, want)
	}
}

func TestAccountLimiterFallsBackToIPWithoutAccount(t *testing.T) {
	counter := newFakeCounter()
	tr := newTestRouter(nil, newLimiter(counter, "domain-submit", 5, 3600, true, false))
	tr.get("203.0.113.9:1", nil)
	if got, want := counter.lastKey(), "rl:domain-submit:ip:203.0.113.9"; got != want {
		t.Fatalf("key = %q, want %q", got, want)
	}
}

func TestRateLimitFailsOpenWhenCounterFails(t *testing.T) {
	counter := newFakeCounter()
	counter.err = errors.New("redis down")
	tr := newTestRouter(nil, newLimiter(counter, "api", 1, 60, false, true))

	for i := 0; i < 3; i++ {
		if w := tr.get("203.0.113.7:1", nil); w.Code != http.StatusOK {
			t.Fatalf("request %d status = %d, want 200 (fail-open)", i, w.Code)
		}
	}
}

func TestPrivateProxyCIDRsPreventForwardedForSpoofing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	if err := engine.SetTrustedProxies(PrivateProxyCIDRs); err != nil {
		t.Fatalf("SetTrustedProxies: %v", err)
	}
	var seen string
	engine.GET("/ip", func(c *gin.Context) {
		seen = c.ClientIP()
		c.Status(http.StatusOK)
	})

	tests := []struct {
		name       string
		remoteAddr string
		xff        string
		want       string
	}{
		// 公网地址直连：不可信，忽略伪造的 X-Forwarded-For。
		{name: "direct public client spoofing", remoteAddr: "203.0.113.50:1", xff: "1.2.3.4", want: "203.0.113.50"},
		// 经由内网 Nginx：取 Nginx 追加的真实来源，而不是客户端自带的最左侧值。
		{name: "behind private proxy", remoteAddr: "172.18.0.5:1", xff: "1.2.3.4, 203.0.113.9", want: "203.0.113.9"},
		{name: "behind private proxy single value", remoteAddr: "172.18.0.5:1", xff: "203.0.113.9", want: "203.0.113.9"},
		{name: "no header", remoteAddr: "172.18.0.5:1", xff: "", want: "172.18.0.5"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/ip", nil)
			req.RemoteAddr = tt.remoteAddr
			if tt.xff != "" {
				req.Header.Set("X-Forwarded-For", tt.xff)
			}
			engine.ServeHTTP(httptest.NewRecorder(), req)
			if seen != tt.want {
				t.Fatalf("ClientIP = %q, want %q", seen, tt.want)
			}
		})
	}
}
