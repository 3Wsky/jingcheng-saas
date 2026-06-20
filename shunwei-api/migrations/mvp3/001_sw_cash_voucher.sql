-- MVP3-001: 储值型现金券钱包
-- 执行库: so1988_shunwei

CREATE TABLE IF NOT EXISTS `sw_cash_voucher_batch` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '批次ID',
  `uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '用户uid',
  `source_type` varchar(32) NOT NULL DEFAULT '' COMMENT 'approval_grant,manual',
  `source_id` varchar(64) NOT NULL DEFAULT '' COMMENT '来源单号',
  `total_amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '批次总额',
  `remain_amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '批次余额',
  `expire_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '过期时间',
  `status` tinyint(1) NOT NULL DEFAULT '1' COMMENT '1=有效,0=耗尽,-1=过期',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0',
  `updated_at` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_uid_status_expire` (`uid`, `status`, `expire_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='现金券批次';

CREATE TABLE IF NOT EXISTS `sw_cash_voucher_ledger` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '流水ID',
  `uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '券持有人',
  `direction` tinyint(1) NOT NULL DEFAULT '0' COMMENT '1=发放,0=核销',
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `batch_id` bigint(20) unsigned NOT NULL DEFAULT '0',
  `merchant_id` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '核销商户,0=本店',
  `operator_uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '核销操作人',
  `biz_id` varchar(64) NOT NULL DEFAULT '' COMMENT '业务单号',
  `remark` varchar(255) NOT NULL DEFAULT '',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_uid` (`uid`),
  KEY `idx_merchant` (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='现金券流水';
