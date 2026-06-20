-- MVP2-001: 三级审批流
-- 执行库: so1988_shunwei

CREATE TABLE IF NOT EXISTS `sw_approval_request` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '审批单ID',
  `request_no` varchar(32) NOT NULL DEFAULT '' COMMENT '审批单号',
  `biz_type` varchar(32) NOT NULL DEFAULT '' COMMENT 'consumption_grant,integral_mall_verify',
  `customer_uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '客户uid',
  `staff_uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '发起店员uid',
  `division_id` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '门店ID',
  `consumption_amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '消费金额(元)',
  `matched_tier_code` varchar(16) NOT NULL DEFAULT '' COMMENT '匹配档位SW199/SW299',
  `matched_voucher_amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '匹配现金券金额',
  `matched_integral` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '匹配赠送积分',
  `receipt_no` varchar(64) NOT NULL DEFAULT '' COMMENT '小票号,空=人工审核',
  `receipt_images` text COMMENT '凭证图片JSON数组',
  `status` varchar(16) NOT NULL DEFAULT 'pending' COMMENT 'pending,manager_review,admin_review,approved,rejected,revoked',
  `reject_reason` varchar(512) NOT NULL DEFAULT '' COMMENT '驳回原因',
  `parent_request_id` bigint(20) unsigned NOT NULL DEFAULT '0' COMMENT '重提时关联原单',
  `approved_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '终批时间',
  `revoke_deadline` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '可撤销截止时间(终批+24h)',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0',
  `updated_at` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_request_no` (`request_no`),
  KEY `idx_receipt_no` (`receipt_no`),
  KEY `idx_status_division` (`status`, `division_id`),
  KEY `idx_customer` (`customer_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='审批申请单';

CREATE TABLE IF NOT EXISTS `sw_approval_step` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '步骤ID',
  `request_id` bigint(20) unsigned NOT NULL DEFAULT '0' COMMENT '审批单ID',
  `step_role` varchar(16) NOT NULL DEFAULT '' COMMENT 'staff,manager,admin',
  `operator_uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '操作人uid',
  `action` varchar(16) NOT NULL DEFAULT '' COMMENT 'submit,approve,reject,revoke,resubmit',
  `comment` varchar(512) NOT NULL DEFAULT '' COMMENT '意见',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_request` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='审批步骤流水';

CREATE TABLE IF NOT EXISTS `sw_approval_todo` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '待办ID',
  `request_id` bigint(20) unsigned NOT NULL DEFAULT '0',
  `assignee_uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '待办人',
  `todo_type` varchar(32) NOT NULL DEFAULT '' COMMENT 'manager_review,admin_review',
  `is_done` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0',
  `done_at` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_assignee_done` (`assignee_uid`, `is_done`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='审批站内待办';
