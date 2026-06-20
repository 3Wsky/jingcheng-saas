-- MVP1-004: 积分商城核销扩展（自提核销日志，复用 CRMEB eb_store_integral*）
-- 执行库: so1988_shunwei

CREATE TABLE IF NOT EXISTS `sw_integral_mall_verify_log` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `integral_order_id` int(10) unsigned NOT NULL DEFAULT '0' COMMENT 'eb_store_integral_order.id',
  `order_id` varchar(32) NOT NULL DEFAULT '' COMMENT 'CRMEB积分订单号',
  `uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '兑换用户uid',
  `product_id` int(10) unsigned NOT NULL DEFAULT '0' COMMENT 'eb_store_integral.id',
  `verify_code` varchar(64) NOT NULL DEFAULT '' COMMENT '核销码',
  `staff_uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '核销店员uid',
  `division_id` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '门店division_id',
  `verify_status` tinyint(1) NOT NULL DEFAULT '1' COMMENT '1=已核销,0=待核销,-1=已撤销',
  `skip_approval` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否免审路径',
  `remark` varchar(255) NOT NULL DEFAULT '' COMMENT '备注',
  `verified_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '核销时间',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_id` (`order_id`),
  KEY `idx_staff` (`staff_uid`, `verified_at`),
  KEY `idx_uid` (`uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分商城核销日志';
