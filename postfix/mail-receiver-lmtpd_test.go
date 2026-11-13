package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
)

func TestDeliverDrainsResponseAndReusesConnection(t *testing.T) {
	var newConnections atomic.Int64
	ts := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"delivered","email_id":"00000000-0000-0000-0000-000000000001"}`))
	}))
	ts.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			newConnections.Add(1)
		}
	}
	ts.Start()
	defer ts.Close()

	client := newAPIHTTPClient()
	defer client.CloseIdleConnections()
	srv := &server{apiURL: ts.URL, httpClient: client}
	payload := deliverPayload{Recipient: "test@example.com", Raw: "hello"}
	for i := 0; i < 25; i++ {
		if err := srv.deliver(context.Background(), payload); err != nil {
			t.Fatalf("deliver %d: %v", i, err)
		}
	}

	if got := newConnections.Load(); got != 1 {
		t.Fatalf("expected one reused HTTP connection, got %d", got)
	}
}

// 单封与批量投递都必须携带共享密钥，否则 API 会以 401 拒绝，邮件将堆在 Postfix 队列里。
func TestInternalRequestsCarryToken(t *testing.T) {
	const token = "0123456789abcdef0123456789abcdef"
	var mu sync.Mutex
	seen := map[string]string{}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen[r.URL.Path] = r.Header.Get(internalTokenHeader)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/internal/deliver-batch" {
			_, _ = w.Write([]byte(`{"results":[{"recipient":"a@example.com","status":"delivered"}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"status":"delivered"}`))
	}))
	defer ts.Close()

	srv := &server{apiURL: ts.URL, internalToken: token, httpClient: newAPIHTTPClient()}
	if err := srv.deliver(context.Background(), deliverPayload{Recipient: "a@example.com", Raw: "x"}); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if _, err := srv.deliverBatch(context.Background(), deliverBatchPayload{Recipients: []string{"a@example.com"}, Raw: "x"}); err != nil {
		t.Fatalf("deliverBatch: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	for _, path := range []string{"/internal/deliver", "/internal/deliver-batch"} {
		if got := seen[path]; got != token {
			t.Fatalf("%s sent %s = %q, want the shared token", path, internalTokenHeader, got)
		}
	}
}

func TestValidateBatchResults(t *testing.T) {
	recipients := []string{"a@example.com", "b@example.com"}
	tests := []struct {
		name    string
		results []batchResult
		wantErr bool
	}{
		{
			name: "valid",
			results: []batchResult{
				{Recipient: "a@example.com", Status: "delivered"},
				{Recipient: "b@example.com", Status: "discarded"},
			},
		},
		{
			name:    "missing result",
			results: []batchResult{{Recipient: "a@example.com", Status: "delivered"}},
			wantErr: true,
		},
		{
			name: "wrong order",
			results: []batchResult{
				{Recipient: "b@example.com", Status: "delivered"},
				{Recipient: "a@example.com", Status: "delivered"},
			},
			wantErr: true,
		},
		{
			name: "invalid status",
			results: []batchResult{
				{Recipient: "a@example.com", Status: "maybe"},
				{Recipient: "b@example.com", Status: "delivered"},
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateBatchResults(recipients, tt.results)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateBatchResults() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestDecodeHeader(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"纯 ASCII 原样返回", "hello world", "hello world"},
		{"UTF-8 Base64 中文主题", "=?utf-8?b?5q2j5paH6Kej5p6Q5rWL6K+VIOS4reaWh+S4u+mimA==?=", "正文解析测试 中文主题"},
		{"UTF-8 Quoted-Printable", "=?UTF-8?Q?caf=C3=A9_menu?=", "café menu"},
		{"带地址的显示名", "=?UTF-8?B?5byg5LiJ?= <zhang@example.com>", "张三 <zhang@example.com>"},
		{"相邻编码字之间的空白被忽略", "=?utf-8?q?a?= =?utf-8?q?b?=", "ab"},
		{"ISO-8859-1", "=?ISO-8859-1?Q?Andr=E9?=", "André"},
		{"不支持的字符集保留原文", "=?x-unknown-charset?B?5byg5LiJ?=", "=?x-unknown-charset?B?5byg5LiJ?="},
		{"非法编码字保留原文", "=?utf-8?b?!!!?=", "=?utf-8?b?!!!?="},
		{"空字符串", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := decodeHeader(tt.in); got != tt.want {
				t.Fatalf("decodeHeader(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
