-- Admin-R6: 商家店员/店长绑定表
CREATE TABLE IF NOT EXISTS `sw_merchant_staff` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `merchant_id` int(10) unsigned NOT NULL DEFAULT '0',
  `staff_uid` int(10) unsigned NOT NULL DEFAULT '0',
  `role` varchar(16) NOT NULL DEFAULT 'staff' COMMENT 'staff=店员, manager=店长',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0',
  `updated_at` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_merchant_staff` (`merchant_id`, `staff_uid`),
  KEY `idx_staff_uid` (`staff_uid`, `is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商家核销人员';
