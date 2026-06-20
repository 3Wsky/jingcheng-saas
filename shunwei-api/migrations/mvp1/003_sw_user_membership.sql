-- MVP1-003: 顺为会员等级扩展（199/299 档位，独立于 CRMEB is_money_level）
-- 执行库: so1988_shunwei

CREATE TABLE IF NOT EXISTS `sw_user_membership` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '用户uid',
  `tier_code` varchar(16) NOT NULL DEFAULT '' COMMENT '档位:SW199,SW299',
  `eb_member_ship_id` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '关联eb_member_ship.id',
  `source_channel` varchar(32) NOT NULL DEFAULT '' COMMENT 'offline_approval,wechat_purchase,admin_grant',
  `source_ref` varchar(64) NOT NULL DEFAULT '' COMMENT '来源单号',
  `granted_integral` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '本次赠送积分',
  `start_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '生效时间',
  `expire_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '到期时间',
  `status` tinyint(1) NOT NULL DEFAULT '1' COMMENT '1=有效,0=已过期,-1=已撤销',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '创建时间',
  `updated_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_uid_status` (`uid`, `status`),
  KEY `idx_uid_tier` (`uid`, `tier_code`),
  KEY `idx_source` (`source_channel`, `source_ref`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='顺为会员开通记录';

CREATE TABLE IF NOT EXISTS `sw_membership_ship_map` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tier_code` varchar(16) NOT NULL DEFAULT '' COMMENT 'SW199,SW299',
  `eb_member_ship_id` int(10) unsigned NOT NULL DEFAULT '0' COMMENT 'eb_member_ship.id',
  `gift_integral` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '开卡赠送积分',
  `tier_rank` tinyint(3) unsigned NOT NULL DEFAULT '0' COMMENT '档位等级:1=199,2=299',
  `is_active` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '创建时间',
  `updated_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tier_code` (`tier_code`),
  UNIQUE KEY `uk_ship_id` (`eb_member_ship_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会员卡档位映射';
