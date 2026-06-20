-- MVP3-002: 异业商家与结算台账
-- 执行库: so1988_shunwei

CREATE TABLE IF NOT EXISTS `sw_merchant` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT COMMENT '商家ID',
  `merchant_name` varchar(128) NOT NULL DEFAULT '' COMMENT '店名',
  `category` varchar(64) NOT NULL DEFAULT '' COMMENT '类目:火锅/服装/电影/超市等',
  `contact_name` varchar(64) NOT NULL DEFAULT '',
  `contact_phone` varchar(20) NOT NULL DEFAULT '',
  `login_uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '绑定小程序用户uid',
  `can_verify` tinyint(1) NOT NULL DEFAULT '1' COMMENT '核销权限',
  `pending_settlement` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '待结算金额',
  `settled_total` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '累计已结算',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` int(10) unsigned NOT NULL DEFAULT '0',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0',
  `updated_at` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_login_uid` (`login_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='异业商家';

CREATE TABLE IF NOT EXISTS `sw_merchant_settlement` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '结算记录ID',
  `merchant_id` int(10) unsigned NOT NULL DEFAULT '0',
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '结算金额',
  `status` varchar(16) NOT NULL DEFAULT 'pending' COMMENT 'pending=待结算,settled=已结算',
  `settled_by` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '标记已结算的超管',
  `settled_at` int(10) unsigned NOT NULL DEFAULT '0',
  `remark` varchar(255) NOT NULL DEFAULT '',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_merchant_status` (`merchant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商家结算台账';
