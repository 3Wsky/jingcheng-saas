const { getPool, swTable } = require('../../shared/sw-mysql');
const { toPublicUrl } = require('../../shared/url');

const CONFIG_KEYS = {
  staffEntryRoleOnly: 'miniapp_staff_entry_role_only',
  merchantEntryRoleOnly: 'miniapp_merchant_entry_role_only',
  memberMgmtEntryRoleOnly: 'miniapp_member_mgmt_entry_role_only',
  sharePic: 'miniapp_share_pic',
  shareTitle: 'miniapp_share_title',
  shareDesc: 'miniapp_share_desc',
  shareEnabled: 'miniapp_share_enabled'
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

  async _readKeys(keys) {
    if (!keys.length) return {};
    const placeholders = keys.map(() => '?').join(', ');
    const [rows] = await getPool().query(
      `SELECT config_key, config_value FROM ${swTable('system_config')}
       WHERE config_key IN (${placeholders})`,
      keys
    );
    return Object.fromEntries(rows.map((row) => [row.config_key, row.config_value]));
  }

  async _writeKeys(entries) {
    const now = Math.floor(Date.now() / 1000);
    const pool = getPool();
    for (const [key, value] of entries) {
      await pool.query(
        `INSERT INTO ${swTable('system_config')} (config_key, config_value, updated_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = VALUES(updated_at)`,
        [key, value == null ? '' : String(value), now]
      );
    }
  }

  /** 后台读取：返回原始存储的分享配置（图片为相对/绝对原值，便于回填编辑框）。 */
  async getShareConfigRaw() {
    const map = await this._readKeys([
      CONFIG_KEYS.sharePic,
      CONFIG_KEYS.shareTitle,
      CONFIG_KEYS.shareDesc,
      CONFIG_KEYS.shareEnabled
    ]);
    return {
      pic: map[CONFIG_KEYS.sharePic] || '',
      title: map[CONFIG_KEYS.shareTitle] || '',
      desc: map[CONFIG_KEYS.shareDesc] || '',
      enabled: parseBool(map[CONFIG_KEYS.shareEnabled], false)
    };
  }

  /**
   * 小程序读取：返回 CRMEB 兼容结构 { img, title, synopsis, enabled }，
   * 图片补全为绝对可访问 URL。enabled=false 或未配图时由前端回退 CRMEB 默认分享。
   */
  async getShareForMiniapp(request) {
    const raw = await this.getShareConfigRaw();
    return {
      enabled: raw.enabled && Boolean(raw.pic),
      img: toPublicUrl(raw.pic, request),
      title: raw.title || '',
      synopsis: raw.desc || ''
    };
  }

  async updateShareConfig(input) {
    await this._writeKeys([
      [CONFIG_KEYS.sharePic, input.pic || ''],
      [CONFIG_KEYS.shareTitle, input.title || ''],
      [CONFIG_KEYS.shareDesc, input.desc || ''],
      [CONFIG_KEYS.shareEnabled, input.enabled ? '1' : '0']
    ]);
    return this.getShareConfigRaw();
  }
}

module.exports = { MiniappConfigService };
