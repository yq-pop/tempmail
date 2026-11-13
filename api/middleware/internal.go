package middleware

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"

	"github.com/gin-gonic/gin"
)

// InternalTokenHeader 是 Postfix 侧调用 /internal/* 时携带共享密钥的请求头。
const InternalTokenHeader = "X-Internal-Token"

// InternalAuth 保护 /internal/* 内部接口。
//
// 内部接口可以向任意邮箱写入邮件并列出全部域名，因此不能只依赖“仅内部网络可达”。
// 调用方必须在 X-Internal-Token 头中携带与服务端一致的共享密钥。
// token 为空时拒绝所有请求（fail-closed），避免因为漏配而变成无鉴权接口。
func InternalAuth(token string) gin.HandlerFunc {
	// 对摘要做常量时间比较，避免通过响应耗时或长度推断密钥。
	want := sha256.Sum256([]byte(token))
	return func(c *gin.Context) {
		if token == "" {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error": "internal api disabled: INTERNAL_TOKEN is not configured",
			})
			return
		}
		got := sha256.Sum256([]byte(c.GetHeader(InternalTokenHeader)))
		if subtle.ConstantTimeCompare(got[:], want[:]) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "invalid internal token",
			})
			return
		}
		c.Next()
	}
}
