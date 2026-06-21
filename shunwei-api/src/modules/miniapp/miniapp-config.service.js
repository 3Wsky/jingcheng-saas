const { getPool, swTable } = require('../../shared/sw-mysql');

const CONFIG_KEYS = {
  staffEntryRoleOnly: 'miniapp_staff_entry_role_only',
  merchantEntryRoleOnly: 'miniapp_merchant_entry_role_only',
  memberMgmtEntryRoleOnly: 'miniapp_member_mgmt_entry_role_only'
};

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return value === '1' || value === 'true' || value === true;
}

class MiniappConfigService {
  async getEntryConfig() {
    const [rows] = await getPool().query(
      `SELECT config_key, config_value FROM ${swTable('system_config')}
       WHERE config_key IN (?, ?)`,
      [CONFIG_KEYS.staffEntryRoleOnly, CONFIG_KEYS.merchantEntryRoleOnly]
    );
    const map = Object.fromEntries(rows.map((row) => [row.config_key, row.config_value]));
    return {
      staffEntryRoleOnly: parseBool(map[CONFIG_KEYS.staffEntryRoleOnly], false),
      merchantEntryRoleOnly: parseBool(map[CONFIG_KEYS.merchantEntryRoleOnly], false)
    };
  }

  async updateEntryConfig(input) {
    const now = Math.floor(Date.now() / 1000);
    const pool = getPool();
    const entries = [
      [CONFIG_KEYS.staffEntryRoleOnly, input.staffEntryRoleOnly ? '1' : '0'],
      [CONFIG_KEYS.merchantEntryRoleOnly, input.merchantEntryRoleOnly ? '1' : '0']
    ];

    for (const [key, value] of entries) {
      await pool.query(
        `INSERT INTO ${swTable('system_config')} (config_key, config_value, updated_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = VALUES(updated_at)`,
        [key, value, now]
      );
    }

    return this.getEntryConfig();
  }
}

module.exports = { MiniappConfigService };
