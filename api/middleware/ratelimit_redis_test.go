package middleware

import (
	"context"
	"net/http"
	"testing"
	"time"

	"tempmail/model"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func newMiniRedis(t *testing.T) (*miniredis.Miniredis, *redis.Client) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return mr, rdb
}

// 窗口只能在第一次计数时建立，后续请求不得续期。
func TestRedisCounterDoesNotExtendWindow(t *testing.T) {
	mr, rdb := newMiniRedis(t)
	counter := redisCounter{rdb}
	ctx := context.Background()
	window := 60 * time.Second

	count, ttl, err := counter.hit(ctx, "k", window)
	if err != nil || count != 1 || ttl != window {
		t.Fatalf("first hit = (%d, %s, %v), want (1, %s, nil)", count, ttl, err, window)
	}

	mr.FastForward(40 * time.Second)
	count, ttl, err = counter.hit(ctx, "k", window)
	if err != nil || count != 2 {
		t.Fatalf("second hit = (%d, %s, %v), want count 2", count, ttl, err)
	}
	if ttl <= 0 || ttl > 20*time.Second {
		t.Fatalf("ttl after second hit = %s, want <= 20s (window must not be renewed)", ttl)
	}

	// 原窗口到期后重新计数。
	mr.FastForward(21 * time.Second)
	count, ttl, err = counter.hit(ctx, "k", window)
	if err != nil || count != 1 || ttl != window {
		t.Fatalf("hit after expiry = (%d, %s, %v), want a fresh window", count, ttl, err)
	}
}

// 历史遗留的、没有过期时间的 key 会被自动补上过期时间，不会永久生效。
func TestRedisCounterRepairsKeyWithoutTTL(t *testing.T) {
	mr, rdb := newMiniRedis(t)
	if err := mr.Set("legacy", "499"); err != nil {
		t.Fatal(err)
	}
	window := 60 * time.Second

	count, ttl, err := redisCounter{rdb}.hit(context.Background(), "legacy", window)
	if err != nil || count != 500 || ttl != window {
		t.Fatalf("hit = (%d, %s, %v), want (500, %s, nil)", count, ttl, err, window)
	}
	if got := mr.TTL("legacy"); got != window {
		t.Fatalf("stored TTL = %s, want %s", got, window)
	}
}

// 回归测试：收件箱页每 8 秒轮询一次，持续使用不应该被累计封禁。
// 旧实现每次请求都会续期 TTL，计数永不过期，第 11 次请求起永久 429。
func TestRateLimitContinuousPollingIsNotPermanentlyBlocked(t *testing.T) {
	mr, rdb := newMiniRedis(t)
	account := &model.Account{ID: uuid.New()}
	// 60 秒窗口内最多 10 次；每 8 秒一次轮询，窗口内约 8 次，始终低于上限。
	tr := newTestRouter(account, RateLimit(rdb, 10, 60))

	for i := 0; i < 60; i++ {
		w := tr.get("203.0.113.7:1", nil)
		if w.Code != http.StatusOK {
			t.Fatalf("poll %d (t=%ds) status = %d, want 200", i, i*8, w.Code)
		}
		mr.FastForward(8 * time.Second)
	}
}

// 超限后必须在窗口结束时自动恢复，不能因为客户端持续重试而一直被封。
func TestRateLimitRecoversAfterWindowEvenWithRetries(t *testing.T) {
	mr, rdb := newMiniRedis(t)
	account := &model.Account{ID: uuid.New()}
	tr := newTestRouter(account, RateLimit(rdb, 3, 60))

	for i := 0; i < 3; i++ {
		if w := tr.get("203.0.113.7:1", nil); w.Code != http.StatusOK {
			t.Fatalf("request %d status = %d, want 200", i, w.Code)
		}
	}
	// 被拦截后每 10 秒重试一次（旧实现下每次重试都会续期，永远出不来）。
	for elapsed := 10; elapsed < 60; elapsed += 10 {
		mr.FastForward(10 * time.Second)
		if w := tr.get("203.0.113.7:1", nil); w.Code != http.StatusTooManyRequests {
			t.Fatalf("t=%ds status = %d, want 429 while still inside the window", elapsed, w.Code)
		}
	}
	mr.FastForward(10 * time.Second) // 总计 60 秒，窗口结束
	if w := tr.get("203.0.113.7:1", nil); w.Code != http.StatusOK {
		t.Fatalf("after window status = %d, want 200", w.Code)
	}
}
