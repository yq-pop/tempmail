package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"tempmail/middleware"
	"tempmail/model"

	"github.com/gin-gonic/gin"
)

// stubDomainRoutes 只记录哪些处理器被真正执行到。
type stubDomainRoutes struct{ called []string }

func (s *stubDomainRoutes) List(c *gin.Context)      { s.called = append(s.called, "list"); c.Status(http.StatusOK) }
func (s *stubDomainRoutes) GetStatus(c *gin.Context) { s.called = append(s.called, "status"); c.Status(http.StatusOK) }
func (s *stubDomainRoutes) Submit(c *gin.Context)    { s.called = append(s.called, "submit"); c.Status(http.StatusOK) }

// roleAuth 模拟 Auth 中间件的结果：anonymous 不写入账号，user / admin 写入对应账号。
func roleAuth(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		switch role {
		case "user":
			c.Set(middleware.AccountKey, &model.Account{Username: "u", IsAdmin: false})
		case "admin":
			c.Set(middleware.AccountKey, &model.Account{Username: "a", IsAdmin: true})
		}
		c.Next()
	}
}

func newDomainRouter(role string) (*gin.Engine, *stubDomainRoutes) {
	gin.SetMode(gin.TestMode)
	stub := &stubDomainRoutes{}
	engine := gin.New()
	api := engine.Group("/api", roleAuth(role))
	registerDomainRoutes(api, stub)
	return engine, stub
}

var domainEndpoints = []struct {
	name   string
	method string
	path   string
	want   string // 被放行时应执行到的处理器
}{
	{"列出域名池", http.MethodGet, "/api/domains", "list"},
	{"查询域名状态", http.MethodGet, "/api/domains/7/status", "status"},
	{"提交域名", http.MethodPost, "/api/domains/submit", "submit"},
}

func TestDomainRoutesRejectNonAdmins(t *testing.T) {
	for _, role := range []string{"user", "anonymous"} {
		for _, ep := range domainEndpoints {
			t.Run(role+"/"+ep.name, func(t *testing.T) {
				engine, stub := newDomainRouter(role)
				w := httptest.NewRecorder()
				engine.ServeHTTP(w, httptest.NewRequest(ep.method, ep.path, nil))
				if w.Code != http.StatusForbidden {
					t.Fatalf("%s %s as %s = %d, want 403", ep.method, ep.path, role, w.Code)
				}
				if len(stub.called) != 0 {
					t.Fatalf("handler must not run for %s, but ran: %v", role, stub.called)
				}
			})
		}
	}
}

// ---- 管理后台「全部邮件」：跨用户读取邮件的唯一入口，必须只对管理员开放 ----

type stubAdminEmailRoutes struct{ called []string }

func (s *stubAdminEmailRoutes) List(c *gin.Context) { s.called = append(s.called, "list"); c.Status(http.StatusOK) }
func (s *stubAdminEmailRoutes) Get(c *gin.Context)  { s.called = append(s.called, "get"); c.Status(http.StatusOK) }

func newAdminEmailRouter(role string) (*gin.Engine, *stubAdminEmailRoutes) {
	gin.SetMode(gin.TestMode)
	stub := &stubAdminEmailRoutes{}
	engine := gin.New()
	registerAdminEmailRoutes(engine.Group("/api", roleAuth(role)), stub)
	return engine, stub
}

var adminEmailEndpoints = []struct {
	name   string
	method string
	path   string
	want   string
}{
	{"全部邮件列表", http.MethodGet, "/api/admin/emails", "list"},
	{"带搜索条件的列表", http.MethodGet, "/api/admin/emails?field=user&q=bob&order=asc", "list"},
	{"他人邮件详情", http.MethodGet, "/api/admin/emails/0b8f6f3e-0000-4000-8000-000000000001", "get"},
}

func TestAdminEmailRoutesRejectNonAdmins(t *testing.T) {
	for _, role := range []string{"user", "anonymous"} {
		for _, ep := range adminEmailEndpoints {
			t.Run(role+"/"+ep.name, func(t *testing.T) {
				engine, stub := newAdminEmailRouter(role)
				w := httptest.NewRecorder()
				engine.ServeHTTP(w, httptest.NewRequest(ep.method, ep.path, nil))
				if w.Code != http.StatusForbidden {
					t.Fatalf("%s %s as %s = %d, want 403", ep.method, ep.path, role, w.Code)
				}
				if len(stub.called) != 0 {
					t.Fatalf("handler must not run for %s, but ran: %v", role, stub.called)
				}
			})
		}
	}
}

func TestAdminEmailRoutesAllowAdmins(t *testing.T) {
	for _, ep := range adminEmailEndpoints {
		t.Run(ep.name, func(t *testing.T) {
			engine, stub := newAdminEmailRouter("admin")
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, httptest.NewRequest(ep.method, ep.path, nil))
			if w.Code != http.StatusOK {
				t.Fatalf("%s %s as admin = %d, want 200", ep.method, ep.path, w.Code)
			}
			if len(stub.called) != 1 || stub.called[0] != ep.want {
				t.Fatalf("handlers called = %v, want [%s]", stub.called, ep.want)
			}
		})
	}
}

func TestDomainRoutesAllowAdmins(t *testing.T) {
	for _, ep := range domainEndpoints {
		t.Run(ep.name, func(t *testing.T) {
			engine, stub := newDomainRouter("admin")
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, httptest.NewRequest(ep.method, ep.path, nil))
			if w.Code != http.StatusOK {
				t.Fatalf("%s %s as admin = %d, want 200", ep.method, ep.path, w.Code)
			}
			if len(stub.called) != 1 || stub.called[0] != ep.want {
				t.Fatalf("handlers called = %v, want [%s]", stub.called, ep.want)
			}
		})
	}
}
