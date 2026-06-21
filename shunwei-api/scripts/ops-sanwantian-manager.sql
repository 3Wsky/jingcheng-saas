-- 运维脚本：三万天 → 店长，并清除对马玉涛的归属
-- 在服务器 MySQL 执行：mysql -u so1988_shunwei -p so1988_shunwei < scripts/ops-sanwantian-manager.sql

START TRANSACTION;

SELECT uid, nickname, spread_uid, is_staff, division_id
FROM eb_user
WHERE (nickname LIKE '%三万天%' OR nickname LIKE '%马玉涛%') AND COALESCE(is_del, 0) = 0;

UPDATE eb_user
SET spread_uid = 0
WHERE nickname LIKE '%三万天%' AND COALESCE(is_del, 0) = 0;

UPDATE eb_user u
INNER JOIN (
  SELECT
    san.uid,
    COALESCE(
      NULLIF(san.division_id, 0),
      (SELECT ma.division_id FROM eb_user ma WHERE ma.nickname LIKE '%马玉涛%' AND COALESCE(ma.is_del, 0) = 0 LIMIT 1)
    ) AS target_division
  FROM eb_user san
  WHERE san.nickname LIKE '%三万天%' AND COALESCE(san.is_del, 0) = 0
  LIMIT 1
) src ON u.uid = src.uid
SET u.is_staff = 1, u.division_id = src.target_division
WHERE src.target_division > 0;

INSERT INTO sw_store_manager (division_id, manager_uid, is_active, appointed_by, created_at, updated_at)
SELECT u.division_id, u.uid, 1, 0, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()
FROM eb_user u
WHERE u.nickname LIKE '%三万天%' AND u.division_id > 0 AND COALESCE(u.is_del, 0) = 0
ON DUPLICATE KEY UPDATE is_active = 1, updated_at = UNIX_TIMESTAMP();

SELECT u.uid, u.nickname, u.spread_uid, u.is_staff, u.division_id,
       EXISTS(SELECT 1 FROM sw_store_manager sm WHERE sm.manager_uid = u.uid AND sm.is_active = 1) AS is_manager
FROM eb_user u
WHERE u.nickname LIKE '%三万天%' AND COALESCE(u.is_del, 0) = 0;

COMMIT;
