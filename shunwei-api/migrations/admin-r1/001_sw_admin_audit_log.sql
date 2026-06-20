-- Admin-R1-001: 超管操作审计日志
-- 执行库: so1988_shunwei
-- 依赖: mvp1~mvp3 已执行

CREATE TABLE IF NOT EXISTS `sw_admin_audit_log` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '日志ID',
  `admin_username` varchar(64) NOT NULL DEFAULT '' COMMENT '超管登录名(来自admin cookie)',
  `action` varchar(64) NOT NULL DEFAULT '' COMMENT '操作类型:integral_grant,membership_grant,staff_role,approval_config,...',
  `target_type` varchar(32) NOT NULL DEFAULT '' COMMENT '目标类型:user,approval,config,merchant',
  `target_id` varchar(64) NOT NULL DEFAULT '' COMMENT '目标ID(uid/requestId/configKey等)',
  `payload_json` text COMMENT '请求快照(JSON)',
  `result_status` varchar(16) NOT NULL DEFAULT 'success' COMMENT 'success,failed',
  `result_message` varchar(255) NOT NULL DEFAULT '' COMMENT '结果摘要',
  `ip_address` varchar(45) NOT NULL DEFAULT '' COMMENT '操作IP',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '操作时间',
  PRIMARY KEY (`id`),
  KEY `idx_action_created` (`action`, `created_at`),
  KEY `idx_target` (`target_type`, `target_id`),
  KEY `idx_admin_created` (`admin_username`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='超管操作审计日志';
