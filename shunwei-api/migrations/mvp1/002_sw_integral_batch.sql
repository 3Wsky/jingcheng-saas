-- MVP1-002: 积分批次表 + 流水账本（FIFO 消耗，与 eb_user.integral 双写）
-- 执行库: so1988_shunwei

CREATE TABLE IF NOT EXISTS `sw_integral_batch` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '批次ID',
  `uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '用户uid',
  `batch_type` varchar(32) NOT NULL DEFAULT 'gift' COMMENT '批次类型:gift=赠送,recharge=充值,adjust=人工调整',
  `source_type` varchar(32) NOT NULL DEFAULT '' COMMENT '来源:membership_grant,membership_purchase,approval_grant,recharge,manual',
  `source_id` varchar(64) NOT NULL DEFAULT '' COMMENT '来源单据号(审批单/订单号等)',
  `total_amount` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '批次初始积分',
  `remain_amount` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '批次剩余积分',
  `expire_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '过期时间戳,0=永久(充值积分)',
  `status` tinyint(1) NOT NULL DEFAULT '1' COMMENT '1=有效,0=已耗尽,-1=已过期冻结',
  `remark` varchar(255) NOT NULL DEFAULT '' COMMENT '备注',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '创建时间',
  `updated_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_uid_status_expire` (`uid`, `status`, `expire_at`),
  KEY `idx_source` (`source_type`, `source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分批次表';

CREATE TABLE IF NOT EXISTS `sw_integral_ledger` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '流水ID',
  `uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '用户uid',
  `direction` tinyint(1) NOT NULL DEFAULT '1' COMMENT '1=增加,0=减少',
  `amount` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '变动积分',
  `balance_after` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '变动后CRMEB总积分快照',
  `batch_id` bigint(20) unsigned NOT NULL DEFAULT '0' COMMENT '关联批次ID,0=汇总扣减',
  `biz_type` varchar(32) NOT NULL DEFAULT '' COMMENT '业务类型:grant,consume,recharge,expire,revoke',
  `biz_id` varchar(64) NOT NULL DEFAULT '' COMMENT '业务单号',
  `operator_uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '操作人uid,0=系统',
  `remark` varchar(255) NOT NULL DEFAULT '' COMMENT '备注',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_uid_created` (`uid`, `created_at`),
  KEY `idx_biz` (`biz_type`, `biz_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分流水账本';
