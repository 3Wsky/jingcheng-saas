const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

function maskPhone(phone) {
  const value = String(phone || '');
  if (value.length < 7) return value;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

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

  async list(params = {}) {
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize || 20)));
    const keyword = String(params.keyword || '').trim();

    const pool = getPool();
    const table = legacyTable('system_store');
    const userTable = legacyTable('user');

    const conditions = ['COALESCE(s.is_del, 0) = 0'];
    const values = [];
    if (keyword) {
      conditions.push('s.name LIKE ?');
      values.push(`%${keyword}%`);
    }
    const where = conditions.join(' AND ');

    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS total FROM ${table} s WHERE ${where}`,
      values
    );
    const offset = (page - 1) * pageSize;

    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.phone, s.address, s.detailed_address, s.day_time, s.is_show, s.add_time,
              COUNT(DISTINCT CASE WHEN u.is_staff = 1 AND COALESCE(u.is_del, 0) = 0 THEN u.uid END) AS staffCount
       FROM ${table} s
       LEFT JOIN ${userTable} u ON u.division_id = s.id
       WHERE ${where}
       GROUP BY s.id, s.name, s.phone, s.address, s.detailed_address, s.day_time, s.is_show, s.add_time
       ORDER BY s.id DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );

    return {
      total: Number(countRow?.total || 0),
      page,
      pageSize,
      list: (rows || []).map((row) => ({
        id: Number(row.id),
        name: String(row.name || '').trim(),
        phone: String(row.phone || ''),
        address: String(row.address || ''),
        detailedAddress: String(row.detailed_address || ''),
        dayTime: String(row.day_time || ''),
        isShow: Number(row.is_show ?? 1) === 1,
        staffCount: Number(row.staffCount || 0),
        addTime: Number(row.add_time || 0)
      }))
    };
  }

  async findById(rawId) {
    const id = Number(rawId || 0);
    if (!id) return null;
    const pool = getPool();
    const table = legacyTable('system_store');
    const [[row]] = await pool.query(
      `SELECT id, name FROM ${table} WHERE id = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
      [id]
    );
    if (!row) return null;
    return { id: Number(row.id), name: String(row.name || '').trim() };
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

  normalizeInput(input = {}) {
    const name = String(input.name || '').trim();
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
    return {
      name,
      phone: String(input.phone || '').trim().slice(0, 20),
      address: String(input.address || '').trim().slice(0, 255),
      detailedAddress: String(input.detailedAddress || '').trim().slice(0, 255),
      dayTime: String(input.dayTime || '').trim().slice(0, 128),
      isShow: input.isShow === false ? 0 : 1
    };
  }

  async create(input = {}) {
    const data = this.normalizeInput(input);
    const existing = await this.findByName(data.name);
    if (existing) {
      const error = new Error('该门店名称已存在');
      error.statusCode = 409;
      throw error;
    }

    const pool = getPool();
    const table = legacyTable('system_store');
    const now = Math.floor(Date.now() / 1000);

    try {
      const [result] = await pool.query(
        `INSERT INTO ${table}
         (name, phone, address, detailed_address, image, latitude, longitude, valid_time, day_time, add_time, is_show, is_del)
         VALUES (?, ?, ?, ?, '', '', '', '', ?, ?, ?, 0)`,
        [data.name, data.phone, data.address, data.detailedAddress, data.dayTime, now, data.isShow]
      );
      return { id: Number(result.insertId), ...data, staffCount: 0, created: true };
    } catch (error) {
      const [result] = await pool.query(
        `INSERT INTO ${table} (name, phone, address, day_time, add_time, is_show, is_del) VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [data.name, data.phone, data.address, data.dayTime, now, data.isShow]
      );
      return { id: Number(result.insertId), ...data, staffCount: 0, created: true };
    }
  }

  async update(rawId, input = {}) {
    const id = Number(rawId || 0);
    if (!id) {
      const error = new Error('门店 ID 无效');
      error.statusCode = 400;
      throw error;
    }
    const current = await this.findById(id);
    if (!current) {
      const error = new Error('门店不存在');
      error.statusCode = 404;
      throw error;
    }
    const data = this.normalizeInput(input);

    const duplicate = await this.findByName(data.name);
    if (duplicate && duplicate.id !== id) {
      const error = new Error('该门店名称已存在');
      error.statusCode = 409;
      throw error;
    }

    const pool = getPool();
    const table = legacyTable('system_store');
    try {
      await pool.query(
        `UPDATE ${table}
         SET name = ?, phone = ?, address = ?, detailed_address = ?, day_time = ?, is_show = ?
         WHERE id = ?`,
        [data.name, data.phone, data.address, data.detailedAddress, data.dayTime, data.isShow, id]
      );
    } catch (error) {
      await pool.query(
        `UPDATE ${table} SET name = ?, phone = ?, address = ?, day_time = ?, is_show = ? WHERE id = ?`,
        [data.name, data.phone, data.address, data.dayTime, data.isShow, id]
      );
    }
    return { id, ...data };
  }

  async countStaff(rawId) {
    const id = Number(rawId || 0);
    if (!id) return 0;
    const pool = getPool();
    const userTable = legacyTable('user');
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM ${userTable}
       WHERE division_id = ? AND is_staff = 1 AND COALESCE(is_del, 0) = 0`,
      [id]
    );
    return Number(row?.cnt || 0);
  }

  async listStaff(rawId) {
    const id = Number(rawId || 0);
    if (!id) {
      const error = new Error('门店 ID 无效');
      error.statusCode = 400;
      throw error;
    }
    const store = await this.findById(id);
    if (!store) {
      const error = new Error('门店不存在');
      error.statusCode = 404;
      throw error;
    }

    const pool = getPool();
    const userTable = legacyTable('user');
    const [rows] = await pool.query(
      `SELECT u.uid, u.nickname, u.phone,
              (SELECT COUNT(*) FROM ${userTable} m
               WHERE m.spread_uid = u.uid AND COALESCE(m.is_del, 0) = 0) AS memberCount
       FROM ${userTable} u
       WHERE u.division_id = ? AND u.is_staff = 1 AND COALESCE(u.is_del, 0) = 0
       ORDER BY u.uid DESC
       LIMIT 500`,
      [id]
    );

    return {
      store: { id: store.id, name: store.name },
      list: (rows || []).map((row) => ({
        uid: Number(row.uid),
        nickname: String(row.nickname || ''),
        phone: maskPhone(row.phone),
        memberCount: Number(row.memberCount || 0)
      }))
    };
  }

  async transferStaff(fromId, targetStoreName, uids = null) {
    const sourceId = Number(fromId || 0);
    if (!sourceId) {
      const error = new Error('源门店 ID 无效');
      error.statusCode = 400;
      throw error;
    }
    const source = await this.findById(sourceId);
    if (!source) {
      const error = new Error('源门店不存在');
      error.statusCode = 404;
      throw error;
    }

    const target = await this.resolveOrCreateByName(targetStoreName);
    if (target.id === sourceId) {
      const error = new Error('目标门店不能与当前门店相同');
      error.statusCode = 400;
      throw error;
    }

    const pool = getPool();
    const userTable = legacyTable('user');

    const conditions = ['division_id = ?', 'is_staff = 1', 'COALESCE(is_del, 0) = 0'];
    const values = [sourceId];
    const selected = Array.isArray(uids)
      ? uids.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0)
      : null;
    if (selected && selected.length) {
      conditions.push(`uid IN (${selected.map(() => '?').join(',')})`);
      values.push(...selected);
    }

    let movedUids = selected && selected.length ? selected : null;
    if (!movedUids) {
      const [movedRows] = await pool.query(
        `SELECT uid FROM ${userTable} WHERE ${conditions.join(' AND ')}`,
        values
      );
      movedUids = (movedRows || []).map((row) => Number(row.uid));
    }

    const [result] = await pool.query(
      `UPDATE ${userTable} SET division_id = ? WHERE ${conditions.join(' AND ')}`,
      [target.id, ...values]
    );

    const cardsSynced = await this.syncCardStoreName(movedUids, target.name);

    return {
      fromDivisionId: sourceId,
      fromStoreName: source.name,
      toDivisionId: target.id,
      toStoreName: target.name,
      moved: Number(result?.affectedRows || 0),
      cardsSynced
    };
  }

  // 同步已存在名片的门店名（不为没有名片的店员创建空名片；缺表时静默跳过）
  async syncCardStoreName(uids, storeName) {
    const list = Array.isArray(uids)
      ? uids.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0)
      : [];
    const name = String(storeName || '').trim();
    if (!list.length || !name) return 0;

    const pool = getPool();
    const now = Math.floor(Date.now() / 1000);
    const placeholders = list.map(() => '?').join(',');
    try {
      const [result] = await pool.query(
        `UPDATE ${swTable('staff_card')}
         SET store_name = ?, updated_at = ?
         WHERE staff_uid IN (${placeholders})`,
        [name, now, ...list]
      );
      return Number(result?.affectedRows || 0);
    } catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE') return 0;
      throw error;
    }
  }

  async remove(rawId) {
    const id = Number(rawId || 0);
    if (!id) {
      const error = new Error('门店 ID 无效');
      error.statusCode = 400;
      throw error;
    }
    const current = await this.findById(id);
    if (!current) {
      const error = new Error('门店不存在');
      error.statusCode = 404;
      throw error;
    }

    const staffCount = await this.countStaff(id);
    if (staffCount > 0) {
      const error = new Error(`该门店仍有 ${staffCount} 名客户经理归属，请先转移后再删除`);
      error.statusCode = 409;
      throw error;
    }

    const pool = getPool();
    const table = legacyTable('system_store');
    const now = Math.floor(Date.now() / 1000);
    try {
      await pool.query(`UPDATE ${table} SET is_del = 1, is_show = 0 WHERE id = ?`, [id]);
    } catch (error) {
      await pool.query(`UPDATE ${table} SET is_del = 1 WHERE id = ?`, [id]);
    }
    return { id, name: current.name, removed: true, removedAt: now };
  }
}

module.exports = { AdminStoresService };
