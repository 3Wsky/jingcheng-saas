-- Admin-R2-001: 店员名片配置表
-- 执行库: so1988_shunwei

CREATE TABLE IF NOT EXISTS `sw_staff_card` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `staff_uid` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '店员uid(eb_user.uid,is_staff=1)',
  `display_name` varchar(64) NOT NULL DEFAULT '' COMMENT '展示姓名(默认同eb_user.nickname)',
  `avatar` varchar(512) NOT NULL DEFAULT '' COMMENT '头像URL',
  `job_title` varchar(64) NOT NULL DEFAULT '' COMMENT '职位',
  `bio` varchar(500) NOT NULL DEFAULT '' COMMENT '个人简介',
  `store_name` varchar(128) NOT NULL DEFAULT '' COMMENT '门店名称',
  `store_address` varchar(255) NOT NULL DEFAULT '' COMMENT '门店详细地址',
  `store_phone` varchar(20) NOT NULL DEFAULT '' COMMENT '门店电话',
  `business_hours` varchar(128) NOT NULL DEFAULT '' COMMENT '营业时间文案',
  `latitude` decimal(10,6) NOT NULL DEFAULT '0.000000' COMMENT '纬度',
  `longitude` decimal(10,6) NOT NULL DEFAULT '0.000000' COMMENT '经度',
  `wechat_qrcode` varchar(512) NOT NULL DEFAULT '' COMMENT '微信二维码图片URL',
  `is_published` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否对外展示',
  `created_at` int(10) unsigned NOT NULL DEFAULT '0',
  `updated_at` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_staff_uid` (`staff_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='店员名片配置';

-- Admin-R2-002: 商家门店资料扩展（ALTER 幂等需手工检查列是否存在）
ALTER TABLE `sw_merchant`
  ADD COLUMN `store_address` varchar(255) NOT NULL DEFAULT '' COMMENT '门店地址' AFTER `contact_phone`,
  ADD COLUMN `province` varchar(32) NOT NULL DEFAULT '' COMMENT '省' AFTER `store_address`,
  ADD COLUMN `city` varchar(32) NOT NULL DEFAULT '' COMMENT '市' AFTER `province`,
  ADD COLUMN `district` varchar(32) NOT NULL DEFAULT '' COMMENT '区' AFTER `city`,
  ADD COLUMN `latitude` decimal(10,6) NOT NULL DEFAULT '0.000000' COMMENT '纬度' AFTER `district`,
  ADD COLUMN `longitude` decimal(10,6) NOT NULL DEFAULT '0.000000' COMMENT '经度' AFTER `latitude`,
  ADD COLUMN `store_images` text COMMENT '门头图JSON数组' AFTER `longitude`,
  ADD COLUMN `business_hours` varchar(128) NOT NULL DEFAULT '' COMMENT '营业时间' AFTER `store_images`,
  ADD COLUMN `settlement_note` varchar(255) NOT NULL DEFAULT '' COMMENT '结算周期备注' AFTER `business_hours`;
