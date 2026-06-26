-- SN 码绑定记录表（拍照识别 SN/IMEI 并关联订单）
CREATE TABLE IF NOT EXISTS `sw_sn_binding` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `sn_code`    VARCHAR(64) NOT NULL COMMENT 'SN 序列号',
  `imei`       VARCHAR(32) NOT NULL DEFAULT '' COMMENT 'IMEI 号（如有）',
  `brand`      VARCHAR(32) NOT NULL DEFAULT '' COMMENT '品牌',
  `model`      VARCHAR(64) NOT NULL DEFAULT '' COMMENT '型号',
  `order_id`   VARCHAR(64) NOT NULL DEFAULT '' COMMENT '关联订单号',
  `uid`        INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '操作人 UID',
  `source`     ENUM('scan','manual') NOT NULL DEFAULT 'scan' COMMENT '来源：扫码识别/手动输入',
  `created_at` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '创建时间戳',
  UNIQUE KEY `uk_sn` (`sn_code`),
  KEY `idx_order` (`order_id`),
  KEY `idx_uid` (`uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SN 码绑定记录';
