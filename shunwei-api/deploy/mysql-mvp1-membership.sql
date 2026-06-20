-- =============================================================================
-- ⚠️ 本文件为 PM 快速草案，正式迁移请使用：
--    CMB/shunwei-api/migrations/mvp1/001~005（架构师交付，含 sw_user_membership 等）
--    详见 migrations/README.md
-- =============================================================================
-- 目标库: so1988_shunwei
-- 版本: MVP1 (2026-06-19)
-- 说明: 仅新增表 + 配置数据，不修改/删除 CRMEB 现有表数据
-- 执行前: mysqldump 备份生产库
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. 系统配置（免审开关、会员档位映射、赠送积分数量）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sw_system_config` (
  `config_key` VARCHAR(64) NOT NULL COMMENT '配置键',
  `config_value` TEXT NOT NULL COMMENT '配置值(JSON或标量)',
  `remark` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '说明',
  `updated_at` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '更新时间',
  PRIMARY KEY (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='顺为旁路系统配置';

INSERT INTO `sw_system_config` (`config_key`, `config_value`, `remark`, `updated_at`) VALUES
('integral_mall_skip_approval', '1', '积分商城免审开关：1=店员直接核销 0=走审批(MVP2)', UNIX_TIMESTAMP()),
('member_tier_199_ship_id', '6', '199会员对应 eb_member_ship.id', UNIX_TIMESTAMP()),
('member_tier_299_ship_id', '7', '299会员对应 eb_member_ship.id', UNIX_TIMESTAMP()),
('gift_integral_199', '199000', '199会员开卡赠送积分', UNIX_TIMESTAMP()),
('gift_integral_299', '299000', '299会员开卡赠送积分', UNIX_TIMESTAMP()),
('gift_integral_expire_days', '365', '赠送积分有效期(天)', UNIX_TIMESTAMP()),
('member_vip_days', '365', '会员有效期(天)', UNIX_TIMESTAMP()),
('integral_exchange_rate', '1000', '积分汇率：1元=1000积分', UNIX_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `config_value` = VALUES(`config_value`),
  `remark` = VALUES(`remark`),
  `updated_at` = VALUES(`updated_at`);

-- -----------------------------------------------------------------------------
-- 2. 积分批次（FIFO 消耗，与 eb_user.integral 双写同步）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sw_integral_batch` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '批次ID',
  `uid` INT UNSIGNED NOT NULL COMMENT '用户ID',
  `batch_type` ENUM('gift','recharge','adjust') NOT NULL DEFAULT 'gift' COMMENT 'gift=赠送 recharge=充值 adjust=调整',
  `initial_amount` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '初始积分',
  `remaining_amount` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '剩余积分',
  `expires_at` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '过期时间戳，0=永久有效',
  `source_type` VARCHAR(32) NOT NULL DEFAULT '' COMMENT '来源类型 member_grant/wechat_pay/admin',
  `source_id` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '来源业务ID',
  `remark` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '备注',
  `created_at` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '创建时间',
  `updated_at` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_uid_expires` (`uid`, `expires_at`),
  KEY `idx_uid_remaining` (`uid`, `remaining_amount`),
  KEY `idx_source` (`source_type`, `source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分批次(FIFO)';

-- -----------------------------------------------------------------------------
-- 3. 积分流水（审计 + 对账）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sw_integral_ledger` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '流水ID',
  `uid` INT UNSIGNED NOT NULL COMMENT '用户ID',
  `direction` ENUM('in','out') NOT NULL COMMENT 'in=增加 out=扣减',
  `amount` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '变动积分',
  `balance_after` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '变动后CRMEB总积分',
  `batch_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联批次ID',
  `biz_type` VARCHAR(32) NOT NULL DEFAULT '' COMMENT '业务类型 member_gift/exchange/recharge',
  `biz_id` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '业务单号',
  `remark` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '备注',
  `operator_uid` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '操作人UID，0=系统',
  `created_at` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_uid_created` (`uid`, `created_at`),
  KEY `idx_biz` (`biz_type`, `biz_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分流水';

-- -----------------------------------------------------------------------------
-- 4. 会员开通事件日志（双通道：线下审批 / 微信自购）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sw_membership_event_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '事件ID',
  `uid` INT UNSIGNED NOT NULL COMMENT '用户ID',
  `event_type` ENUM('grant','purchase','upgrade','renew','expire','revoke') NOT NULL COMMENT '事件类型',
  `tier_code` VARCHAR(16) NOT NULL DEFAULT '' COMMENT 'tier_199 / tier_299',
  `member_ship_id` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'eb_member_ship.id',
  `gift_integral` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '本次赠送积分',
  `vip_days` INT NOT NULL DEFAULT 365 COMMENT '会员天数',
  `channel` ENUM('offline_approval','wechat_pay','admin') NOT NULL COMMENT '开通渠道',
  `ref_id` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '关联单号(OtherOrder.id等)',
  `operator_uid` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '操作人',
  `before_overdue` BIGINT NOT NULL DEFAULT 0 COMMENT '变更前到期时间',
  `after_overdue` BIGINT NOT NULL DEFAULT 0 COMMENT '变更后到期时间',
  `before_tier_code` VARCHAR(16) NOT NULL DEFAULT '' COMMENT '变更前档位',
  `after_tier_code` VARCHAR(16) NOT NULL DEFAULT '' COMMENT '变更后档位',
  `created_at` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_uid` (`uid`),
  KEY `idx_ref` (`channel`, `ref_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会员开通事件日志';

-- -----------------------------------------------------------------------------
-- 5. CRMEB 付费会员档位：新增 199 / 299 年卡（不删除原有档位）
--    生产库若 id 6/7 已占用，请改 sw_system_config 中 ship_id 映射
-- -----------------------------------------------------------------------------
INSERT INTO `eb_member_ship` (`id`, `type`, `title`, `vip_day`, `price`, `pre_price`, `sort`, `is_del`, `add_time`)
SELECT 6, 'year', '199会员', 365, 199.00, 199.00, 20, 0, UNIX_TIMESTAMP()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `eb_member_ship` WHERE `id` = 6);

INSERT INTO `eb_member_ship` (`id`, `type`, `title`, `vip_day`, `price`, `pre_price`, `sort`, `is_del`, `add_time`)
SELECT 7, 'year', '299会员', 365, 299.00, 299.00, 21, 0, UNIX_TIMESTAMP()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `eb_member_ship` WHERE `id` = 7);

-- 若生产 AUTO_INCREMENT 冲突，改用:
-- INSERT INTO eb_member_ship (type, title, vip_day, price, pre_price, sort, is_del, add_time) VALUES (...);
-- 然后 UPDATE sw_system_config SET config_value = <新id> WHERE config_key IN ('member_tier_199_ship_id','member_tier_299_ship_id');

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- 执行后验证
-- =============================================================================
-- SELECT * FROM sw_system_config;
-- SELECT id, type, title, vip_day, price, pre_price FROM eb_member_ship WHERE is_del = 0 ORDER BY sort DESC;
-- SHOW TABLES LIKE 'sw_%';
