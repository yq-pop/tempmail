package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"tempmail/store"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

// AdminEmailHandler 提供管理后台「全部邮件」：跨用户查询邮件列表与详情。
// 路由在 routes.go 里由 AdminOnly 保护，这里不再重复校验身份。
type AdminEmailHandler struct {
	store *store.Store
}

func NewAdminEmailHandler(s *store.Store) *AdminEmailHandler {
	return &AdminEmailHandler{store: s}
}

// GET /api/admin/emails?field=sender|subject|user|mailbox&q=关键词&order=asc|desc&page=1&size=20
//
//	field — 搜索字段：发件人 / 主题 / 用户 / 邮箱；有关键词但未指定时默认按发件人
//	q     — 关键词，大小写不敏感的子串匹配；为空则不过滤
//	order — 按邮件接收时间排序：desc（默认，最新在前）或 asc
func (h *AdminEmailHandler) List(c *gin.Context) {
	field := strings.TrimSpace(c.Query("field"))
	q := strings.TrimSpace(c.Query("q"))
	if field != "" && !store.ValidAdminEmailField(field) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid field, expected sender, subject, user or mailbox"})
		return
	}
	if q != "" && field == "" {
		field = store.AdminEmailFieldSender
	}

	order := strings.ToLower(strings.TrimSpace(c.DefaultQuery("order", store.AdminEmailOrderDesc)))
	if order != store.AdminEmailOrderAsc && order != store.AdminEmailOrderDesc {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid order, expected asc or desc"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 20
	}

	items, total, err := h.store.ListAllEmails(c.Request.Context(), store.AdminEmailFilter{
		Field: field, Query: q, Order: order, Page: page, Size: size,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"data":  items,
		"total": total,
		"page":  page,
		"size":  size,
	})
}

// GET /api/admin/emails/:id - 读取任意用户的邮件详情（含所属邮箱与用户）
func (h *AdminEmailHandler) Get(c *gin.Context) {
	id, err := parseUUID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid email id"})
		return
	}
	email, err := h.store.GetEmailAdmin(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "email not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"email": email})
}
