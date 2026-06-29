-- Admin-R8-001: 加宽审批单 receipt_no 字段
-- 执行库: so1988_shunwei
--
-- 背景: 小程序「申请会员权益」会把多个产品的 型号/价格/SN 拼成一段文本(最长240字符)写入 receipt_no，
--       但原字段仅 varchar(64)，导致多产品时被 MySQL 截断、价格丢失。
--       加宽到 varchar(255) 以保留完整产品信息（含价格），同时支持历史/未来按价格回填消费金额。

ALTER TABLE `sw_approval_request`
  MODIFY COLUMN `receipt_no` varchar(255) NOT NULL DEFAULT '' COMMENT '小票号/产品信息(型号/价格/SN), 空=人工审核';
