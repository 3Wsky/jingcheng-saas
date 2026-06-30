-- Admin-R9-001: SN 产品库改造为「IMEI1 为主键身份」，支持手机按 IMEI1、非手机按 SN 核对
-- 执行库: so1988_shunwei
--
-- 背景: 申请会员权益时，手机用 IMEI1、智能穿戴/电脑等用 SN。识别后对照产品库
--       （IMEI1 优先、SN 兜底）自动回填型号；终审按码命中可自动通过。
--       管家婆「序列号库存状况」导出里：序列号=IMEI1(手机)/SN(非手机)，序列号备注=附加 SN，
--       且手机普遍没有 SN —— 因此唯一键不能再用 sn_norm（会令大量空 SN 的手机互相覆盖），
--       改用 match_key（= IMEI1 优先，缺失则 SN）作为单台设备的唯一身份。
--
-- 注: 代码层 SnCatalogService.ensureSchemaUpgrade() 在首次访问表时会幂等执行等价变更，
--     本脚本用于显式/预先执行，二者效果一致、可重复执行。

-- 1) 补列：imei1 / imei1_norm / match_key
ALTER TABLE `sw_sn_catalog`
  ADD COLUMN IF NOT EXISTS `imei1` varchar(32) NOT NULL DEFAULT '' COMMENT 'IMEI1（手机主标识，纯数字）' AFTER `sn_norm`,
  ADD COLUMN IF NOT EXISTS `imei1_norm` varchar(32) NOT NULL DEFAULT '' COMMENT 'IMEI1 归一化（仅数字）' AFTER `imei1`,
  ADD COLUMN IF NOT EXISTS `match_key` varchar(64) NOT NULL DEFAULT '' COMMENT '设备唯一身份：IMEI1 优先，缺失用 SN' AFTER `imei1_norm`;

-- 2) 回填 match_key（IMEI1 优先，否则 SN）
UPDATE `sw_sn_catalog`
  SET `match_key` = IF(`imei1_norm` <> '', `imei1_norm`, `sn_norm`)
  WHERE `match_key` = '';

-- 3) 普通索引（低版本 MySQL 不支持 IF NOT EXISTS 时，已存在报 1061，可忽略）
ALTER TABLE `sw_sn_catalog` ADD KEY `idx_imei1_norm` (`imei1_norm`);
ALTER TABLE `sw_sn_catalog` ADD KEY `idx_sn_norm` (`sn_norm`);

-- 4) 唯一键从 sn_norm 切换到 match_key
--    先去掉旧唯一键 uk_sn_norm（不存在报 1091，可忽略），再建 match_key 唯一键
ALTER TABLE `sw_sn_catalog` DROP INDEX `uk_sn_norm`;
ALTER TABLE `sw_sn_catalog` ADD UNIQUE KEY `uk_match_key` (`match_key`);
