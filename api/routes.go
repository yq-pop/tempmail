package main

import (
	"tempmail/middleware"

	"github.com/gin-gonic/gin"
)

// domainRoutes 是 /api/domains 下各接口的处理器。真实实现是 handler.DomainHandler，
// 抽成接口是为了让权限规则可以脱离数据库做单元测试。
type domainRoutes interface {
	List(*gin.Context)
	GetStatus(*gin.Context)
	Submit(*gin.Context)
}

// adminEmailRoutes 是管理后台「全部邮件」的处理器。真实实现是 handler.AdminEmailHandler。
type adminEmailRoutes interface {
	List(*gin.Context)
	Get(*gin.Context)
}

// registerAdminEmailRoutes 注册管理员专用的跨用户邮件查询接口。
//
// 这是整个系统里唯一能读取「别的用户」邮件的入口，因此用 AdminOnly 在后端强制限制：
// 普通用户调用返回 403，未携带密钥返回 401。普通用户自己的 /api/mailboxes/:id/emails 仍然
// 只能读取归属于自己账号的邮箱，互不影响。
func registerAdminEmailRoutes(api *gin.RouterGroup, h adminEmailRoutes) {
	emails := api.Group("/admin/emails", middleware.AdminOnly())
	{
		emails.GET("", h.List)
		emails.GET("/:id", h.Get)
	}
}

// registerDomainRoutes 注册 /api/domains 下的接口。
//
// 域名池由管理员维护：普通用户既不能查看域名池，也不能添加或提交域名。
// 这里在后端用 AdminOnly 强制限制，不依赖前端隐藏入口，直接调用接口同样会被拒绝（403）。
// 保留这几个旧路径只是为了兼容管理员已有的脚本和管理页；
// 管理员专用的 /api/admin/domains/* 在 main.go 的 admin 分组里，同样受 AdminOnly 保护。
func registerDomainRoutes(api *gin.RouterGroup, h domainRoutes) {
	domains := api.Group("/domains", middleware.AdminOnly())
	{
		domains.GET("", h.List)
		domains.GET("/:id/status", h.GetStatus)
		domains.POST("/submit", h.Submit)
	}
}
