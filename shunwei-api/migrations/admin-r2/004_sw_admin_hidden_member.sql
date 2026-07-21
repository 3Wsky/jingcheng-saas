CREATE TABLE IF NOT EXISTS `sw_admin_hidden_member` (
  `uid` BIGINT UNSIGNED NOT NULL,
  `reason` VARCHAR(255) NOT NULL DEFAULT '',
  `created_by` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`uid`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='FZLSaas会员列表隐藏名单';
