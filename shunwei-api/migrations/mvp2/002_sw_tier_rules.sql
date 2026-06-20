-- MVP2-002: 消费档位规则引擎
-- 执行库: so1988_shunwei

CREATE TABLE IF NOT EXISTS `sw_tier_rule` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT COMMENT '规则ID',
  `min_amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '下限(含)',
  `max_amount` decimal(12,2) DEFAULT NULL COMMENT '上限(不含),NULL=无上限',
  `tier_code` varchar(16) NOT NULL DEFAULT '' COMMENT 'SW199,SW299',
  `voucher_amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '现金券金额',
  `gift_integral` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '赠送积分',
  `sort` int(10) NOT NULL DEFAULT '0' COMMENT '排序',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0',
  `updated_at` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_amount_range` (`min_amount`, `max_amount`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='线下消费档位规则';

-- 注意：派生表列必须显式命名，否则 MySQL 8 报 "Duplicate column name '1'"
INSERT INTO `sw_tier_rule` (`min_amount`, `max_amount`, `tier_code`, `voucher_amount`, `gift_integral`, `sort`, `is_active`, `created_at`, `updated_at`)
SELECT * FROM (
  SELECT 2000.00 AS a, 3000.00 AS b, 'SW199' AS c, 100.00 AS d, 199000 AS e, 1 AS f, 1 AS g, UNIX_TIMESTAMP() AS h, UNIX_TIMESTAMP() AS i
  UNION ALL SELECT 3000.00, 6000.00, 'SW199', 300.00, 199000, 2, 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()
  UNION ALL SELECT 6000.00, 10000.00, 'SW299', 500.00, 299000, 3, 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()
  UNION ALL SELECT 10000.00, NULL, 'SW299', 800.00, 299000, 4, 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()
) t
WHERE NOT EXISTS (SELECT 1 FROM `sw_tier_rule` LIMIT 1);
