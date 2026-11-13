-- ============================================================
-- TempMail v12 migration - 邮箱有效期可配置（默认永久有效）+ 管理后台「全部邮件」
-- ============================================================
-- 可重复执行。
--
-- 1. 邮箱到期时间改为按后台配置动态计算（created_at + 有效时长），不再依赖 mailboxes.expires_at：
--    - mailbox_expiry_enabled 默认 false：邮箱永久有效，不会到期，也不会被清理；
--    - mailbox_auto_cleanup  默认 false：到期后是否自动清理，独立于到期判定；
--    - mailbox_ttl_minutes   沿用原有设置（默认 30），仅在启用过期机制时生效。
--    升级后所有已有邮箱立即变为永久有效（此前按 30 分钟到期并被清理）。
-- 2. expires_at 列已弃用：保留是为了兼容旧版本，不再参与任何判断。
-- 3. 新增索引：清理 / 到期判定按 created_at 进行；「全部邮件」按 received_at 跨用户排序。

INSERT INTO app_settings (key, value) VALUES ('mailbox_expiry_enabled', 'false') ON CONFLICT DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('mailbox_ttl_minutes', '30') ON CONFLICT DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('mailbox_auto_cleanup', 'false') ON CONFLICT DO NOTHING;

COMMENT ON COLUMN mailboxes.expires_at IS '已弃用：邮箱有效期现在按后台配置动态计算（created_at + 有效时长），此列不再参与任何判断';

CREATE INDEX IF NOT EXISTS idx_mailboxes_created_at ON mailboxes (created_at);
DROP INDEX IF EXISTS idx_mailboxes_expires_at;

CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails (received_at DESC);
