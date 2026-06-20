-- MVP3-003: 积分微信充值订单
-- 执行库: so1988_shunwei

CREATE TABLE IF NOT EXISTS `sw_integral_recharge_order` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '订单ID',
  `order_no` varchar(32) NOT NULL DEFAULT '' COMMENT '顺为充值单号',
  `uid` int(10) unsigned NOT NULL DEFAULT '0',
  `pay_amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '支付金额(元)',
  `integral_amount` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '获得积分',
  `exchange_rate` int(10) unsigned NOT NULL DEFAULT '1000' COMMENT '汇率:1元=1000积分',
  `pay_status` tinyint(1) NOT NULL DEFAULT '0' COMMENT '0=待支付,1=已支付,-1=已取消',
  `pay_type` varchar(32) NOT NULL DEFAULT 'weixin' COMMENT '支付方式',
  `crmeb_pay_ref` varchar(64) NOT NULL DEFAULT '' COMMENT 'CRMEB支付关联单号',
  `paid_at` int(10) unsigned NOT NULL DEFAULT '0',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0',
  `updated_at` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_uid_status` (`uid`, `pay_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分充值订单';
