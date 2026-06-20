-- =============================================================================
-- 历史会员 & 积分回填（幂等，可重复执行）
-- 目标库: so1988_shunwei
-- 前置: mvp1/001~005 已执行，sw_membership_ship_map 已有 SW199/SW299
-- 详见: docs/MEMBER_HISTORY_MIGRATION_PLAN.md
-- =============================================================================

SET NAMES utf8mb4;
SET @now = UNIX_TIMESTAMP();

-- -----------------------------------------------------------------------------
-- 1. 历史积分 → sw_integral_batch（每用户一条 legacy 批次）
-- -----------------------------------------------------------------------------
INSERT INTO `sw_integral_batch`
  (`uid`, `batch_type`, `source_type`, `source_id`, `total_amount`, `remain_amount`,
   `expire_at`, `status`, `remark`, `created_at`, `updated_at`)
SELECT
  u.uid,
  'adjust',
  'legacy_import',
  CONCAT('legacy-uid-', u.uid),
  u.integral,
  u.integral,
  0,
  1,
  '历史积分迁移（CRMEB eb_user.integral）',
  @now,
  @now
FROM `eb_user` u
WHERE COALESCE(u.is_del, 0) = 0
  AND u.integral > 0
  AND NOT EXISTS (
    SELECT 1 FROM `sw_integral_batch` b
    WHERE b.uid = u.uid AND b.source_type = 'legacy_import'
  );

-- -----------------------------------------------------------------------------
-- 2. 历史有效会员 → sw_user_membership
--    仅当 eb_other_order 有明确 199/299 付费订单时才写入
--    仅有 is_money_level 标志、无订单 → 跳过（由超管后期统一发放）
-- -----------------------------------------------------------------------------
INSERT INTO `sw_user_membership`
  (`uid`, `tier_code`, `eb_member_ship_id`, `source_channel`, `source_ref`,
   `granted_integral`, `start_at`, `expire_at`, `status`, `created_at`, `updated_at`)
SELECT
  u.uid,
  CASE
    WHEN latest.pay_price >= 299 THEN 'SW299'
    WHEN latest.pay_price >= 199 THEN 'SW199'
  END AS tier_code,
  CASE
    WHEN latest.pay_price >= 299 THEN COALESCE(m299.eb_member_ship_id, 0)
    ELSE COALESCE(m199.eb_member_ship_id, 0)
  END AS eb_member_ship_id,
  'legacy_import',
  latest.order_id,
  0,
  GREATEST(u.overdue_time - 365 * 86400, u.add_time, @now - 365 * 86400),
  u.overdue_time,
  IF(u.overdue_time > @now, 1, 0),
  @now,
  @now
FROM `eb_user` u
INNER JOIN (
  SELECT o1.uid, o1.pay_price, o1.order_id
  FROM `eb_other_order` o1
  INNER JOIN (
    SELECT uid, MAX(id) AS max_id
    FROM `eb_other_order`
    WHERE type = 1 AND COALESCE(paid, 0) = 1 AND COALESCE(is_del, 0) = 0
      AND pay_price >= 199
    GROUP BY uid
  ) o2 ON o1.uid = o2.uid AND o1.id = o2.max_id
) latest ON latest.uid = u.uid
LEFT JOIN `sw_membership_ship_map` m199 ON m199.tier_code = 'SW199' AND m199.is_active = 1
LEFT JOIN `sw_membership_ship_map` m299 ON m299.tier_code = 'SW299' AND m299.is_active = 1
WHERE COALESCE(u.is_del, 0) = 0
  AND u.overdue_time > @now
  AND NOT EXISTS (
    SELECT 1 FROM `sw_user_membership` m
    WHERE m.uid = u.uid AND m.source_channel = 'legacy_import'
  );

-- -----------------------------------------------------------------------------
-- 3. 统计输出（执行后人工查看）
-- -----------------------------------------------------------------------------
SELECT 'legacy_integral_batches' AS metric, COUNT(*) AS cnt
FROM `sw_integral_batch` WHERE source_type = 'legacy_import'
UNION ALL
SELECT 'legacy_memberships', COUNT(*)
FROM `sw_user_membership` WHERE source_channel = 'legacy_import'
UNION ALL
SELECT 'legacy_active_memberships', COUNT(*)
FROM `sw_user_membership` WHERE source_channel = 'legacy_import' AND status = 1 AND expire_at > @now;
