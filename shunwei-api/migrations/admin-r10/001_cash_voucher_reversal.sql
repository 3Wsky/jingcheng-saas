-- Admin R10: cash voucher verification reversal

ALTER TABLE `sw_cash_voucher_ledger`
  ADD COLUMN `reversed_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '核销撤回时间，0=未撤回' AFTER `created_at`,
  ADD COLUMN `reversed_by` varchar(64) NOT NULL DEFAULT '' COMMENT '执行撤回的管理员账号' AFTER `reversed_at`,
  ADD COLUMN `reversal_reason` varchar(255) NOT NULL DEFAULT '' COMMENT '核销撤回原因' AFTER `reversed_by`,
  ADD KEY `idx_biz_reversed` (`biz_id`, `reversed_at`);

CREATE TABLE IF NOT EXISTS `sw_cash_voucher_reversal` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `original_biz_id` varchar(64) NOT NULL COMMENT '原核销业务单号',
  `uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '客户uid',
  `merchant_id` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '核销商家',
  `operator_uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '原核销操作人',
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '整笔撤回金额',
  `admin_username` varchar(64) NOT NULL DEFAULT '' COMMENT '执行撤回的管理员账号',
  `reason` varchar(255) NOT NULL DEFAULT '' COMMENT '撤回原因',
  `pending_before` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '撤回前商家待结算',
  `pending_after` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '撤回后商家待结算',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_original_biz_id` (`original_biz_id`),
  KEY `idx_merchant_created` (`merchant_id`, `created_at`),
  KEY `idx_uid_created` (`uid`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='现金券核销撤回记录';
