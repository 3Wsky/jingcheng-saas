-- MVP1-001: 顺为系统配置表（免审开关、现金券核销模式等）
-- 执行库: so1988_shunwei

CREATE TABLE IF NOT EXISTS `sw_system_config` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `config_key` varchar(64) NOT NULL DEFAULT '' COMMENT '配置键',
  `config_value` text COMMENT '配置值(JSON或标量)',
  `remark` varchar(255) NOT NULL DEFAULT '' COMMENT '说明',
  `updated_by` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '最后修改人uid(超管)',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '创建时间',
  `updated_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='顺为系统配置';

INSERT INTO `sw_system_config` (`config_key`, `config_value`, `remark`, `created_at`, `updated_at`)
VALUES
  ('integral_mall_skip_approval', '1', '积分商城免审开关:1=店员直接核销,0=走三级审批(MVP2)', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
  ('cash_voucher_redeem_mode', '"any"', '现金券核销模式:any=任意金额,hundred=整百(MVP3)', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
  ('membership_gift_integral_sw199', '199000', '199会员开卡赠送积分', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
  ('membership_gift_integral_sw299', '299000', '299会员开卡赠送积分', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
  ('gift_integral_expire_days', '365', '赠送积分有效期(天)', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
  ('cash_voucher_expire_days', '365', '现金券批次有效期(天)', UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
  ('consumption_tier_min_amount', '2000', '线下消费权益最低门槛(元)', UNIX_TIMESTAMP(), UNIX_TIMESTAMP())
ON DUPLICATE KEY UPDATE `updated_at` = UNIX_TIMESTAMP();
