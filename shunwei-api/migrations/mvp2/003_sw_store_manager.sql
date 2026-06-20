-- MVP2-003: 店长配置（按 division_id，每店 1-2 人）
-- 执行库: so1988_shunwei

CREATE TABLE IF NOT EXISTS `sw_store_manager` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `division_id` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '门店division_id',
  `manager_uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '店长用户uid',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `appointed_by` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '任命超管uid',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0',
  `updated_at` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_division_manager` (`division_id`, `manager_uid`),
  KEY `idx_manager` (`manager_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='门店店长配置';
