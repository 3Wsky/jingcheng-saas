-- MVP1-005: CRMEB 会员卡档位种子数据（199/299 年费卡）
-- 执行库: so1988_shunwei
-- 说明: type='owner' 为 CRMEB 自定义会员卡类型，已在 OtherOrderServices::checkPayMemberType 支持

-- 隐藏 CRMEB 默认演示卡（生产环境如仍需保留可注释本段）
UPDATE `eb_member_ship` SET `is_del` = 1 WHERE `type` IN ('month', 'quarter', 'year', 'ever', 'free') AND `is_del` = 0;

-- 插入顺为 199/299 会员卡（幂等：按 title 判断）
INSERT INTO `eb_member_ship` (`type`, `title`, `vip_day`, `price`, `pre_price`, `sort`, `is_del`, `add_time`)
SELECT 'owner', '顺为199会员', 365, 199.00, 199.00, 100, 0, UNIX_TIMESTAMP()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `eb_member_ship` WHERE `title` = '顺为199会员' AND `is_del` = 0);

INSERT INTO `eb_member_ship` (`type`, `title`, `vip_day`, `price`, `pre_price`, `sort`, `is_del`, `add_time`)
SELECT 'owner', '顺为299会员', 365, 299.00, 299.00, 99, 0, UNIX_TIMESTAMP()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `eb_member_ship` WHERE `title` = '顺为299会员' AND `is_del` = 0);

-- 同步档位映射表（依赖上一步插入后的 id）
INSERT INTO `sw_membership_ship_map` (`tier_code`, `eb_member_ship_id`, `gift_integral`, `tier_rank`, `is_active`, `created_at`, `updated_at`)
SELECT 'SW199', s.id, 199000, 1, 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()
FROM `eb_member_ship` s
WHERE s.title = '顺为199会员' AND s.is_del = 0
  AND NOT EXISTS (SELECT 1 FROM `sw_membership_ship_map` m WHERE m.tier_code = 'SW199');

INSERT INTO `sw_membership_ship_map` (`tier_code`, `eb_member_ship_id`, `gift_integral`, `tier_rank`, `is_active`, `created_at`, `updated_at`)
SELECT 'SW299', s.id, 299000, 2, 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()
FROM `eb_member_ship` s
WHERE s.title = '顺为299会员' AND s.is_del = 0
  AND NOT EXISTS (SELECT 1 FROM `sw_membership_ship_map` m WHERE m.tier_code = 'SW299');
