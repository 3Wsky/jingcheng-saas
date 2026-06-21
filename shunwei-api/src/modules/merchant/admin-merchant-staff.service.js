const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

class AdminMerchantStaffService {
  async ensureTable() {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS ${swTable('merchant_staff')} (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        merchant_id int(10) unsigned NOT NULL DEFAULT '0',
        staff_uid int(10) unsigned NOT NULL DEFAULT '0',
        role varchar(16) NOT NULL DEFAULT 'staff',
        is_active tinyint(1) NOT NULL DEFAULT '1',
        created_at int(10) unsigned NOT NULL DEFAULT '0',
        updated_at int(10) unsigned NOT NULL DEFAULT '0',
        PRIMARY KEY (id),
        UNIQUE KEY uk_merchant_staff (merchant_id, staff_uid),
        KEY idx_staff_uid (staff_uid, is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  async listMerchantOptions() {
    const [rows] = await getPool().query(
      `SELECT id, merchant_name FROM ${swTable('merchant')}
       WHERE is_active = 1 ORDER BY id DESC LIMIT 200`
    );
    return (rows || []).map((row) => ({
      id: Number(row.id),
      merchantName: String(row.merchant_name || '').trim()
    })).filter((row) => row.merchantName);
  }

  async getUserMerchantRoles(uid) {
    await this.ensureTable();
    const [rows] = await getPool().query(
      `SELECT ms.id, ms.merchant_id, ms.role, ms.is_active, m.merchant_name, m.login_uid
       FROM ${swTable('merchant_staff')} ms
       JOIN ${swTable('merchant')} m ON m.id = ms.merchant_id
       WHERE ms.staff_uid = ? AND ms.is_active = 1 AND m.is_active = 1
       ORDER BY ms.id DESC`,
      [uid]
    );
    const [ownerRows] = await getPool().query(
      `SELECT id, merchant_name, login_uid FROM ${swTable('merchant')}
       WHERE login_uid = ? AND is_active = 1`,
      [uid]
    );
    const assigned = (rows || []).map((row) => ({
      id: Number(row.id),
      merchantId: Number(row.merchant_id),
      merchantName: row.merchant_name || '',
      role: row.role === 'manager' ? 'manager' : 'staff',
      source: Number(row.login_uid) === uid ? 'owner' : 'assigned'
    }));
    const owned = (ownerRows || []).map((row) => ({
      merchantId: Number(row.id),
      merchantName: row.merchant_name || '',
      role: 'manager',
      source: 'owner'
    }));
    const merged = [...assigned];
    owned.forEach((item) => {
      if (!merged.some((x) => x.merchantId === item.merchantId)) merged.push(item);
    });
    return { list: merged, owned, assigned };
  }

  async updateUserMerchantRole(uid, action, merchantId, role) {
    await this.ensureTable();
    const pool = getPool();
    const [[user]] = await pool.query(
      `SELECT uid, nickname FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
      [uid]
    );
    if (!user) {
      const error = new Error('用户不存在');
      error.statusCode = 404;
      throw error;
    }

    if (action === 'revoke') {
      if (!merchantId) {
        const error = new Error('请指定商家');
        error.statusCode = 400;
        throw error;
      }
      const now = Math.floor(Date.now() / 1000);
      await pool.query(
        `UPDATE ${swTable('merchant_staff')} SET is_active = 0, updated_at = ? WHERE merchant_id = ? AND staff_uid = ?`,
        [now, merchantId, uid]
      );
      const [[merchant]] = await pool.query(
        `SELECT id, login_uid FROM ${swTable('merchant')} WHERE id = ? LIMIT 1`,
        [merchantId]
      );
      if (merchant && Number(merchant.login_uid) === uid) {
        await pool.query(
          `UPDATE ${swTable('merchant')} SET login_uid = 0, updated_at = ? WHERE id = ?`,
          [now, merchantId]
        );
      }
      return { uid, merchantId, revoked: true };
    }

    const normalizedRole = role === 'manager' ? 'manager' : 'staff';
    if (!merchantId) {
      const error = new Error('请选择商家');
      error.statusCode = 400;
      throw error;
    }
    const [[merchant]] = await pool.query(
      `SELECT id, merchant_name, login_uid FROM ${swTable('merchant')} WHERE id = ? AND is_active = 1 LIMIT 1`,
      [merchantId]
    );
    if (!merchant) {
      const error = new Error('商家不存在或已停用');
      error.statusCode = 404;
      throw error;
    }

    const now = Math.floor(Date.now() / 1000);
    await pool.query(
      `INSERT INTO ${swTable('merchant_staff')}
       (merchant_id, staff_uid, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE role = VALUES(role), is_active = 1, updated_at = VALUES(updated_at)`,
      [merchantId, uid, normalizedRole, now, now]
    );

    if (normalizedRole === 'manager') {
      const [[conflict]] = await pool.query(
        `SELECT id, merchant_name FROM ${swTable('merchant')}
         WHERE login_uid = ? AND id <> ? AND is_active = 1 LIMIT 1`,
        [uid, merchantId]
      );
      if (conflict) {
        const error = new Error(`该用户已是商家「${conflict.merchant_name}」的绑定账号`);
        error.statusCode = 400;
        throw error;
      }
      await pool.query(
        `UPDATE ${swTable('merchant')} SET login_uid = ?, updated_at = ? WHERE id = ?`,
        [uid, now, merchantId]
      );
    }

    return {
      uid,
      merchantId,
      merchantName: merchant.merchant_name || '',
      role: normalizedRole
    };
  }
}

module.exports = { AdminMerchantStaffService };
