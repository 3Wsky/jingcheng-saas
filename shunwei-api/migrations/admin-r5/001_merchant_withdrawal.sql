-- Admin-R5: 商家提现申请（T+3 线下到账）
-- 生产执行前请先备份数据库。

ALTER TABLE `sw_merchant_settlement`
  ADD COLUMN `applicant_uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '提现申请人uid' AFTER `merchant_id`,
  ADD COLUMN `expected_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '预计到账时间(T+3)' AFTER `settled_at`,
  ADD KEY `idx_merchant_status_created` (`merchant_id`, `status`, `created_at`);
