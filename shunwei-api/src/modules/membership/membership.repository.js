const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

/**
 * 会员旁路仓储（对齐 migrations/mvp1/ 表结构）
 */
class MembershipRepository {
  constructor() {
    this.tablesReady = false;
  }

  /**
   * 确保 MVP1 旁路表存在（与 migrations/mvp1/*.sql 一致）
   */
  async ensureTables() {
    if (this.tablesReady) return;

    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${swTable('system_config')} (
        id int(10) unsigned NOT NULL AUTO_INCREMENT,
        config_key varchar(64) NOT NULL DEFAULT '',
        config_value text,
        remark varchar(255) NOT NULL DEFAULT '',
        updated_by int(10) unsigned NOT NULL DEFAULT 0,
        created_at int(10) unsigned NOT NULL DEFAULT 0,
        updated_at int(10) unsigned NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY uk_config_key (config_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${swTable('integral_batch')} (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        uid int(10) unsigned NOT NULL DEFAULT 0,
        batch_type varchar(32) NOT NULL DEFAULT 'gift',
        source_type varchar(32) NOT NULL DEFAULT '',
        source_id varchar(64) NOT NULL DEFAULT '',
        total_amount int(10) unsigned NOT NULL DEFAULT 0,
        remain_amount int(10) unsigned NOT NULL DEFAULT 0,
        expire_at int(10) unsigned NOT NULL DEFAULT 0,
        status tinyint(1) NOT NULL DEFAULT 1,
        remark varchar(255) NOT NULL DEFAULT '',
        created_at int(10) unsigned NOT NULL DEFAULT 0,
        updated_at int(10) unsigned NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        KEY idx_uid_status_expire (uid, status, expire_at),
        KEY idx_source (source_type, source_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${swTable('integral_ledger')} (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        uid int(10) unsigned NOT NULL DEFAULT 0,
        direction tinyint(1) NOT NULL DEFAULT 1,
        amount int(10) unsigned NOT NULL DEFAULT 0,
        balance_after int(10) unsigned NOT NULL DEFAULT 0,
        batch_id bigint(20) unsigned NOT NULL DEFAULT 0,
        biz_type varchar(32) NOT NULL DEFAULT '',
        biz_id varchar(64) NOT NULL DEFAULT '',
        operator_uid int(10) unsigned NOT NULL DEFAULT 0,
        remark varchar(255) NOT NULL DEFAULT '',
        created_at int(10) unsigned NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        KEY idx_uid_created (uid, created_at),
        KEY idx_biz (biz_type, biz_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${swTable('user_membership')} (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        uid int(10) unsigned NOT NULL DEFAULT 0,
        tier_code varchar(16) NOT NULL DEFAULT '',
        eb_member_ship_id int(10) unsigned NOT NULL DEFAULT 0,
        source_channel varchar(32) NOT NULL DEFAULT '',
        source_ref varchar(64) NOT NULL DEFAULT '',
        granted_integral int(10) unsigned NOT NULL DEFAULT 0,
        start_at int(10) unsigned NOT NULL DEFAULT 0,
        expire_at int(10) unsigned NOT NULL DEFAULT 0,
        status tinyint(1) NOT NULL DEFAULT 1,
        created_at int(10) unsigned NOT NULL DEFAULT 0,
        updated_at int(10) unsigned NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        KEY idx_uid_status (uid, status),
        KEY idx_source (source_channel, source_ref)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${swTable('membership_ship_map')} (
        id int(10) unsigned NOT NULL AUTO_INCREMENT,
        tier_code varchar(16) NOT NULL DEFAULT '',
        eb_member_ship_id int(10) unsigned NOT NULL DEFAULT 0,
        gift_integral int(10) unsigned NOT NULL DEFAULT 0,
        tier_rank tinyint(3) unsigned NOT NULL DEFAULT 0,
        is_active tinyint(1) NOT NULL DEFAULT 1,
        created_at int(10) unsigned NOT NULL DEFAULT 0,
        updated_at int(10) unsigned NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY uk_tier_code (tier_code),
        UNIQUE KEY uk_ship_id (eb_member_ship_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await this.ensureShipMapColumns(pool);

    const now = Math.floor(Date.now() / 1000);
    const defaults = [
      ['integral_mall_skip_approval', '1', '积分商城免审开关'],
      ['membership_gift_integral_sw199', '199000', '199会员开卡赠送积分'],
      ['membership_gift_integral_sw299', '299000', '299会员开卡赠送积分'],
      ['gift_integral_expire_days', '365', '赠送积分有效期(天)'],
      ['member_vip_days', '365', '会员有效期(天)'],
      ['integral_exchange_rate', '1000', '积分汇率 1元=1000积分']
    ];

    for (const [key, value, remark] of defaults) {
      await pool.query(
        `
        INSERT INTO ${swTable('system_config')} (config_key, config_value, remark, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE config_key = config_key
        `,
        [key, value, remark, now, now]
      );
    }

    this.tablesReady = true;
  }

  /** 为 ship_map 增补方案管理列（title/price/vip_days/sort），幂等 */
  async ensureShipMapColumns(pool) {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sw_membership_ship_map'`
    );
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    const adds = [];
    if (!have.has('title')) adds.push("ADD COLUMN title varchar(64) NOT NULL DEFAULT ''");
    if (!have.has('price')) adds.push('ADD COLUMN price decimal(10,2) NOT NULL DEFAULT 0');
    if (!have.has('vip_days')) adds.push('ADD COLUMN vip_days int(10) unsigned NOT NULL DEFAULT 0');
    if (!have.has('sort')) adds.push('ADD COLUMN sort int(11) NOT NULL DEFAULT 0');
    if (adds.length) {
      await pool.query(`ALTER TABLE ${swTable('membership_ship_map')} ${adds.join(', ')}`);
    }
  }

  async getAllConfig() {
    await this.ensureTables();
    const [rows] = await getPool().query(
      `SELECT config_key, config_value, remark, updated_at FROM ${swTable('system_config')}`
    );
    return rows;
  }

  async getConfigMap() {
    const rows = await this.getAllConfig();
    return Object.fromEntries(rows.map((row) => [row.config_key, row.config_value]));
  }

  async updateConfig(updates) {
    await this.ensureTables();
    const now = Math.floor(Date.now() / 1000);
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      for (const [key, value] of Object.entries(updates)) {
        await connection.query(
          `
          INSERT INTO ${swTable('system_config')} (config_key, config_value, remark, created_at, updated_at)
          VALUES (?, ?, '', ?, ?)
          ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = VALUES(updated_at)
          `,
          [key, String(value), now, now]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.getConfigMap();
  }

  async listShipMaps() {
    await this.ensureTables();
    const [rows] = await getPool().query(
      `
      SELECT m.tier_code, m.eb_member_ship_id, m.gift_integral, m.tier_rank,
             m.title AS plan_title, m.price AS plan_price, m.vip_days AS plan_vip_days, m.sort AS plan_sort,
             s.title AS ship_title, s.vip_day AS ship_vip_day, s.pre_price AS ship_price
      FROM ${swTable('membership_ship_map')} m
      LEFT JOIN ${legacyTable('member_ship')} s ON s.id = m.eb_member_ship_id AND s.is_del = 0
      WHERE m.is_active = 1
      ORDER BY m.sort DESC, m.tier_rank ASC, m.id ASC
      `
    );
    return rows;
  }

  async listPlansAdmin() {
    await this.ensureTables();
    const [rows] = await getPool().query(
      `
      SELECT m.id, m.tier_code, m.eb_member_ship_id, m.gift_integral, m.tier_rank, m.is_active,
             m.title AS plan_title, m.price AS plan_price, m.vip_days AS plan_vip_days, m.sort AS plan_sort,
             s.title AS ship_title, s.vip_day AS ship_vip_day, s.pre_price AS ship_price
      FROM ${swTable('membership_ship_map')} m
      LEFT JOIN ${legacyTable('member_ship')} s ON s.id = m.eb_member_ship_id AND s.is_del = 0
      ORDER BY m.sort DESC, m.tier_rank ASC, m.id ASC
      `
    );
    return rows;
  }

  async createPlan(data) {
    await this.ensureTables();
    const now = Math.floor(Date.now() / 1000);
    const [res] = await getPool().query(
      `
      INSERT INTO ${swTable('membership_ship_map')}
        (tier_code, eb_member_ship_id, gift_integral, tier_rank, is_active, title, price, vip_days, sort, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [data.tierCode, data.memberShipId, data.giftIntegral, data.tierRank, data.isActive ? 1 : 0, data.title, data.price, data.vipDays, data.sort, now, now]
    );
    return res.insertId;
  }

  async updatePlan(id, data) {
    await this.ensureTables();
    const now = Math.floor(Date.now() / 1000);
    const fields = [];
    const vals = [];
    const set = (col, val) => { fields.push(`${col} = ?`); vals.push(val); };
    if (data.tierCode !== undefined) set('tier_code', data.tierCode);
    if (data.memberShipId !== undefined) set('eb_member_ship_id', data.memberShipId);
    if (data.giftIntegral !== undefined) set('gift_integral', data.giftIntegral);
    if (data.tierRank !== undefined) set('tier_rank', data.tierRank);
    if (data.isActive !== undefined) set('is_active', data.isActive ? 1 : 0);
    if (data.title !== undefined) set('title', data.title);
    if (data.price !== undefined) set('price', data.price);
    if (data.vipDays !== undefined) set('vip_days', data.vipDays);
    if (data.sort !== undefined) set('sort', data.sort);
    if (!fields.length) return 0;
    set('updated_at', now);
    vals.push(id);
    const [res] = await getPool().query(
      `UPDATE ${swTable('membership_ship_map')} SET ${fields.join(', ')} WHERE id = ?`,
      vals
    );
    return res.affectedRows;
  }

  async deletePlan(id) {
    await this.ensureTables();
    const [res] = await getPool().query(
      `DELETE FROM ${swTable('membership_ship_map')} WHERE id = ?`,
      [id]
    );
    return res.affectedRows;
  }

  async getShipMapByTier(tierCode) {
    await this.ensureTables();
    const [rows] = await getPool().query(
      `
      SELECT m.*, s.title, s.vip_day, s.pre_price
      FROM ${swTable('membership_ship_map')} m
      LEFT JOIN ${legacyTable('member_ship')} s ON s.id = m.eb_member_ship_id
      WHERE m.tier_code = ? AND m.is_active = 1
      LIMIT 1
      `,
      [tierCode]
    );
    return rows[0] || null;
  }

  async getShipMapByShipId(shipId) {
    await this.ensureTables();
    const [rows] = await getPool().query(
      `
      SELECT m.*, s.title, s.vip_day, s.pre_price
      FROM ${swTable('membership_ship_map')} m
      LEFT JOIN ${legacyTable('member_ship')} s ON s.id = m.eb_member_ship_id
      WHERE m.eb_member_ship_id = ? AND m.is_active = 1
      LIMIT 1
      `,
      [shipId]
    );
    return rows[0] || null;
  }

  async getUserMembership(uid) {
    const [rows] = await getPool().query(
      `
      SELECT uid, nickname, integral, is_money_level, is_ever_level, overdue_time
      FROM ${legacyTable('user')}
      WHERE uid = ? AND COALESCE(is_del, 0) = 0
      LIMIT 1
      `,
      [uid]
    );
    return rows[0] || null;
  }

  async getMemberShipById(id) {
    const [rows] = await getPool().query(
      `
      SELECT id, type, title, vip_day, price, pre_price
      FROM ${legacyTable('member_ship')}
      WHERE id = ? AND is_del = 0
      LIMIT 1
      `,
      [id]
    );
    return rows[0] || null;
  }

  async findMembershipBySource(sourceChannel, sourceRef) {
    await this.ensureTables();
    const [rows] = await getPool().query(
      `
      SELECT * FROM ${swTable('user_membership')}
      WHERE source_channel = ? AND source_ref = ?
      LIMIT 1
      `,
      [sourceChannel, sourceRef]
    );
    return rows[0] || null;
  }

  async getActiveTierForUser(uid) {
    await this.ensureTables();
    const now = Math.floor(Date.now() / 1000);
    const [rows] = await getPool().query(
      `
      SELECT um.*, sm.tier_rank
      FROM ${swTable('user_membership')} um
      LEFT JOIN ${swTable('membership_ship_map')} sm ON sm.tier_code = um.tier_code
      WHERE um.uid = ? AND um.status = 1 AND um.expire_at > ?
      ORDER BY sm.tier_rank DESC, um.expire_at DESC
      LIMIT 1
      `,
      [uid, now]
    );
    return rows[0] || null;
  }

  async listMembershipHistory(uid, limit = 20) {
    await this.ensureTables();
    const [rows] = await getPool().query(
      `
      SELECT * FROM ${swTable('user_membership')}
      WHERE uid = ?
      ORDER BY id DESC
      LIMIT ?
      `,
      [uid, Math.min(limit, 100)]
    );
    return rows;
  }

  async listIntegralLedger(uid, limit = 50) {
    await this.ensureTables();
    const [rows] = await getPool().query(
      `
      SELECT * FROM ${swTable('integral_ledger')}
      WHERE uid = ?
      ORDER BY id DESC
      LIMIT ?
      `,
      [uid, Math.min(limit, 200)]
    );
    return rows;
  }

  async listIntegralBatches(uid) {
    await this.ensureTables();
    const now = Math.floor(Date.now() / 1000);
    const [rows] = await getPool().query(
      `
      SELECT id, batch_type, total_amount, remain_amount, expire_at, source_type, created_at
      FROM ${swTable('integral_batch')}
      WHERE uid = ? AND status = 1 AND remain_amount > 0 AND (expire_at = 0 OR expire_at > ?)
      ORDER BY CASE WHEN expire_at = 0 THEN 1 ELSE 0 END, expire_at ASC, id ASC
      `,
      [uid, now]
    );
    return rows;
  }
}

module.exports = { MembershipRepository };
