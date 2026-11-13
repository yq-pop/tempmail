package middleware

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// windowCounter 是固定窗口计数器。抽成接口是为了让限流逻辑可以脱离 Redis 做单元测试。
type windowCounter interface {
	// hit 把 key 的计数加 1，返回当前计数和窗口剩余时间。
	hit(ctx context.Context, key string, window time.Duration) (count int64, ttl time.Duration, err error)
}

// hitScript 原子地完成“计数 +1”和“仅在窗口首次建立时设置过期时间”。
//
// 旧实现对每个请求都执行 EXPIRE，会不断续期：只要客户端持续有请求（例如收件箱每 8 秒轮询一次），
// 计数就永远不会过期，累计超限后会被永久 429，直到客户端安静满一个窗口。
// PTTL < 0 时兜底补上过期时间，防止残留的无过期 key 永久生效。
var hitScript = redis.NewScript(`
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`)

type redisCounter struct {
	rdb *redis.Client
}

func (r redisCounter) hit(ctx context.Context, key string, window time.Duration) (int64, time.Duration, error) {
	values, err := hitScript.Run(ctx, r.rdb, []string{key}, window.Milliseconds()).Slice()
	if err != nil {
		return 0, 0, err
	}
	if len(values) != 2 {
		return 0, 0, fmt.Errorf("unexpected rate limit script result: %v", values)
	}
	count, countOK := values[0].(int64)
	ttlMillis, ttlOK := values[1].(int64)
	if !countOK || !ttlOK {
		return 0, 0, fmt.Errorf("unexpected rate limit script result types: %v", values)
	}
	return count, time.Duration(ttlMillis) * time.Millisecond, nil
}

// RateLimit 是 /api 的全局限流：按账号计数的固定窗口，并在响应头中暴露配额。
// 必须放在 Auth 之后，这样同一账号无论用哪种方式携带 API Key 都共用同一个计数器。
// limit: 每个窗口允许的请求数；window: 窗口大小（秒）。
func RateLimit(rdb *redis.Client, limit int, window int) gin.HandlerFunc {
	return newLimiter(redisCounter{rdb}, "api", limit, window, true, true)
}

// AccountRateLimit 对单个路由做额外限流，按账号计数。必须放在 Auth 之后。
func AccountRateLimit(rdb *redis.Client, scope string, limit int, window int) gin.HandlerFunc {
	return newLimiter(redisCounter{rdb}, scope, limit, window, true, false)
}

// IPRateLimit 按来源 IP 限流，用于无需登录的公开接口。
func IPRateLimit(rdb *redis.Client, scope string, limit int, window int) gin.HandlerFunc {
	return newLimiter(redisCounter{rdb}, scope, limit, window, false, false)
}

func newLimiter(counter windowCounter, scope string, limit int, windowSeconds int, byAccount bool, exposeQuota bool) gin.HandlerFunc {
	if windowSeconds < 1 {
		windowSeconds = 60
	}
	window := time.Duration(windowSeconds) * time.Second

	return func(c *gin.Context) {
		count, ttl, err := counter.hit(c.Request.Context(), limiterKey(c, scope, byAccount), window)
		if err != nil {
			// Redis 故障时放行（fail-open），保持原有行为。
			c.Next()
			return
		}
		if ttl <= 0 {
			ttl = window
		}

		if exposeQuota {
			remaining := max(int64(limit)-count, 0)
			c.Header("X-RateLimit-Limit", strconv.Itoa(limit))
			c.Header("X-RateLimit-Remaining", strconv.FormatInt(remaining, 10))
			c.Header("X-RateLimit-Reset", strconv.FormatInt(time.Now().Add(ttl).Unix(), 10))
		}

		if count > int64(limit) {
			retryAfter := max(int(math.Ceil(ttl.Seconds())), 1)
			c.Header("Retry-After", strconv.Itoa(retryAfter))
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":       "rate limit exceeded",
				"limit":       limit,
				"retry_after": retryAfter,
			})
			return
		}

		c.Next()
	}
}

// PrivateProxyCIDRs 是可信反向代理的网段。
//
// Gin 默认信任所有来源的 X-Forwarded-For，攻击者可以随意伪造来源 IP 绕过按 IP 的限流。
// 这里只信任回环和内网段（Docker 网络里的 Nginx），公网直连时忽略转发头。
var PrivateProxyCIDRs = []string{
	"127.0.0.0/8",
	"::1/128",
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
	"fc00::/7",
}

// limiterKey 生成计数器 key。按账号限流时使用账号 ID（不再把原始 API Key 写进 Redis）；
// 没有登录态或按 IP 限流时使用来源 IP。
func limiterKey(c *gin.Context, scope string, byAccount bool) string {
	if byAccount {
		if account := GetAccount(c); account != nil {
			return fmt.Sprintf("rl:%s:acct:%s", scope, account.ID)
		}
	}
	return fmt.Sprintf("rl:%s:ip:%s", scope, c.ClientIP())
}
