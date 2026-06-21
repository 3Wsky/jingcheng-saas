-- 测试期：小程序入口全员可见（关闭严格角色限制）
UPDATE sw_system_config SET config_value = '0', updated_at = UNIX_TIMESTAMP()
WHERE config_key IN ('miniapp_staff_entry_role_only', 'miniapp_merchant_entry_role_only');

INSERT INTO sw_system_config (config_key, config_value, updated_at)
SELECT k, '0', UNIX_TIMESTAMP()
FROM (
  SELECT 'miniapp_staff_entry_role_only' AS k
  UNION ALL SELECT 'miniapp_merchant_entry_role_only'
) seeds
WHERE NOT EXISTS (
  SELECT 1 FROM sw_system_config c WHERE c.config_key = seeds.k
);

SELECT config_key, config_value FROM sw_system_config
WHERE config_key IN ('miniapp_staff_entry_role_only', 'miniapp_merchant_entry_role_only');
