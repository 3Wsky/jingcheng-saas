const { getPool, legacyTable } = require('../../shared/mysql');

class AdminStoresService {
  async listOptions() {
    const pool = getPool();
    const table = legacyTable('system_store');
    const userTable = legacyTable('user');

    let rows = [];
    try {
      [rows] = await pool.query(
        `SELECT s.id, s.name, COUNT(u.uid) AS staffCount
         FROM ${table} s
         LEFT JOIN ${userTable} u ON u.division_id = s.id AND u.is_staff = 1 AND COALESCE(u.is_del, 0) = 0
         WHERE COALESCE(s.is_del, 0) = 0 AND TRIM(COALESCE(s.name, '')) <> ''
         GROUP BY s.id, s.name
         ORDER BY staffCount DESC, s.id DESC
         LIMIT 200`
      );
    } catch {
      [rows] = await pool.query(
        `SELECT id, name FROM ${table}
         WHERE COALESCE(is_del, 0) = 0 AND TRIM(COALESCE(name, '')) <> ''
         ORDER BY id DESC
         LIMIT 200`
      );
    }

    return (rows || []).map((row) => ({
      id: Number(row.id),
      name: String(row.name || '').trim(),
      staffCount: Number(row.staffCount || 0)
    })).filter((row) => row.name);
  }

  async findByName(rawName) {
    const name = String(rawName || '').trim();
    if (!name) return null;

    const pool = getPool();
    const table = legacyTable('system_store');
    const [[row]] = await pool.query(
      `SELECT id, name FROM ${table}
       WHERE TRIM(name) = ? AND COALESCE(is_del, 0) = 0
       LIMIT 1`,
      [name]
    );
    if (!row) return null;
    return { id: Number(row.id), name: String(row.name || '').trim() };
  }

  async resolveOrCreateByName(rawName) {
    const name = String(rawName || '').trim();
    if (!name) {
      const error = new Error('请输入门店名称');
      error.statusCode = 400;
      throw error;
    }
    if (name.length > 80) {
      const error = new Error('门店名称不能超过 80 字');
      error.statusCode = 400;
      throw error;
    }

    const existing = await this.findByName(name);
    if (existing) return { ...existing, created: false };

    const pool = getPool();
    const table = legacyTable('system_store');
    const now = Math.floor(Date.now() / 1000);

    try {
      const [result] = await pool.query(
        `INSERT INTO ${table}
         (name, phone, address, detailed_address, image, latitude, longitude, valid_time, day_time, add_time, is_show, is_del)
         VALUES (?, '', '', '', '', '', '', '', '', ?, 1, 0)`,
        [name, now]
      );
      return { id: Number(result.insertId), name, created: true };
    } catch (error) {
      const [result] = await pool.query(
        `INSERT INTO ${table} (name, add_time, is_show, is_del) VALUES (?, ?, 1, 0)`,
        [name, now]
      );
      return { id: Number(result.insertId), name, created: true };
    }
  }

  async resolveDivisionIdByName(rawName) {
    const store = await this.resolveOrCreateByName(rawName);
    return store.id;
  }
}

module.exports = { AdminStoresService };
