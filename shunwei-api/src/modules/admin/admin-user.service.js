const crypto = require('node:crypto');
const { getPool } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

/**
 * 子管理员账号（仅 fzlsaas 网站端生效，不影响小程序）。
 * - 超级管理员来自 env（config.admin），不入此表；此表仅存"子管理员"。
 * - 密码用 scrypt 加盐哈希（Node 自带，不引入新依赖，不存明文）。
 * - 子管理员权限受限：回收/删除/撤销/账号管理等危险操作由 requireSuperAdmin 拦截。
 */
class AdminUserService {
  async ensureTable() {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS ${swTable('admin_user')} (
        id int(10) unsigned NOT NULL AUTO_INCREMENT,
        username varchar(64) NOT NULL DEFAULT '',
        password_hash varchar(255) NOT NULL DEFAULT '',
        status tinyint(1) NOT NULL DEFAULT '1' COMMENT '1启用 0停用',
        remark varchar(255) NOT NULL DEFAULT '',
        created_at int(10) unsigned NOT NULL DEFAULT '0',
        updated_at int(10) unsigned NOT NULL DEFAULT '0',
        PRIMARY KEY (id),
        UNIQUE KEY uk_username (username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='子管理员账号(仅网站端)'
    `);
  }

  /** scrypt 加盐哈希，格式 scrypt$<saltHex>$<hashHex> */
  static hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(String(password), salt, 64);
    return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
  }

  /** 校验明文密码与存储哈希是否匹配（时间安全比较） */
  static verifyPassword(password, stored) {
    try {
      const [algo, saltHex, hashHex] = String(stored || '').split('$');
      if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
      const salt = Buffer.from(saltHex, 'hex');
      const expected = Buffer.from(hashHex, 'hex');
      const derived = crypto.scryptSync(String(password), salt, expected.length);
      return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  static normalizeUsername(username) {
    return String(username || '').trim();
  }

  /** 登录校验：返回 { ok, reason }。仅启用状态的子管理员可登录。 */
  async verifyLogin(username, password) {
    await this.ensureTable();
    const uname = AdminUserService.normalizeUsername(username);
    if (!uname) return { ok: false };
    const [[row]] = await getPool().query(
      `SELECT id, username, password_hash, status FROM ${swTable('admin_user')} WHERE username = ? LIMIT 1`,
      [uname]
    );
    if (!row) return { ok: false };
    if (Number(row.status) !== 1) return { ok: false, reason: 'disabled' };
    if (!AdminUserService.verifyPassword(password, row.password_hash)) return { ok: false };
    return { ok: true, username: row.username };
  }

  /** 账号是否存在且启用（用于会话二次校验，可选） */
  async isActive(username) {
    await this.ensureTable();
    const [[row]] = await getPool().query(
      `SELECT status FROM ${swTable('admin_user')} WHERE username = ? LIMIT 1`,
      [AdminUserService.normalizeUsername(username)]
    );
    return !!row && Number(row.status) === 1;
  }

  async list() {
    await this.ensureTable();
    const [rows] = await getPool().query(
      `SELECT id, username, status, remark, created_at, updated_at
       FROM ${swTable('admin_user')} ORDER BY id DESC`
    );
    return rows.map((r) => ({
      id: Number(r.id),
      username: r.username,
      status: Number(r.status),
      remark: r.remark || '',
      createdAt: Number(r.created_at || 0),
      updatedAt: Number(r.updated_at || 0)
    }));
  }

  /** 新增子管理员。用户名唯一，且不能与超管用户名冲突。 */
  async create({ username, password, remark = '', superUsername = '' }) {
    await this.ensureTable();
    const uname = AdminUserService.normalizeUsername(username);
    if (!uname) throw Object.assign(new Error('账号不能为空'), { statusCode: 400 });
    if (uname.length < 3 || uname.length > 64) throw Object.assign(new Error('账号长度需 3-64 位'), { statusCode: 400 });
    if (!/^[A-Za-z0-9_.-]+$/.test(uname)) throw Object.assign(new Error('账号仅限字母/数字/._-'), { statusCode: 400 });
    if (superUsername && uname === superUsername) throw Object.assign(new Error('账号不能与超级管理员相同'), { statusCode: 409 });
    if (!password || String(password).length < 8) throw Object.assign(new Error('密码至少 8 位'), { statusCode: 400 });

    const now = Math.floor(Date.now() / 1000);
    try {
      const [res] = await getPool().query(
        `INSERT INTO ${swTable('admin_user')} (username, password_hash, status, remark, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?, ?)`,
        [uname, AdminUserService.hashPassword(password), String(remark || '').slice(0, 255), now, now]
      );
      return { id: res.insertId, username: uname };
    } catch (err) {
      if (err && (err.code === 'ER_DUP_ENTRY' || /duplicate/i.test(String(err.message)))) {
        throw Object.assign(new Error('该账号已存在'), { statusCode: 409 });
      }
      throw err;
    }
  }

  async resetPassword(id, password) {
    await this.ensureTable();
    if (!password || String(password).length < 8) throw Object.assign(new Error('密码至少 8 位'), { statusCode: 400 });
    const now = Math.floor(Date.now() / 1000);
    const [res] = await getPool().query(
      `UPDATE ${swTable('admin_user')} SET password_hash = ?, updated_at = ? WHERE id = ?`,
      [AdminUserService.hashPassword(password), now, Number(id)]
    );
    if (!res.affectedRows) throw Object.assign(new Error('账号不存在'), { statusCode: 404 });
    return { id: Number(id) };
  }

  /** 子管理员自助改密：校验旧密码后更新 */
  async changeOwnPassword(username, currentPassword, newPassword) {
    await this.ensureTable();
    if (!newPassword || String(newPassword).length < 8) throw Object.assign(new Error('新密码至少 8 位'), { statusCode: 400 });
    const [[row]] = await getPool().query(
      `SELECT id, password_hash FROM ${swTable('admin_user')} WHERE username = ? LIMIT 1`,
      [AdminUserService.normalizeUsername(username)]
    );
    if (!row) throw Object.assign(new Error('账号不存在'), { statusCode: 404 });
    if (!AdminUserService.verifyPassword(currentPassword, row.password_hash)) {
      throw Object.assign(new Error('当前密码错误'), { statusCode: 403 });
    }
    const now = Math.floor(Date.now() / 1000);
    await getPool().query(
      `UPDATE ${swTable('admin_user')} SET password_hash = ?, updated_at = ? WHERE id = ?`,
      [AdminUserService.hashPassword(newPassword), now, row.id]
    );
    return { id: Number(row.id) };
  }

  async setStatus(id, status) {
    await this.ensureTable();
    const now = Math.floor(Date.now() / 1000);
    const [res] = await getPool().query(
      `UPDATE ${swTable('admin_user')} SET status = ?, updated_at = ? WHERE id = ?`,
      [status ? 1 : 0, now, Number(id)]
    );
    if (!res.affectedRows) throw Object.assign(new Error('账号不存在'), { statusCode: 404 });
    return { id: Number(id), status: status ? 1 : 0 };
  }

  async remove(id) {
    await this.ensureTable();
    const [res] = await getPool().query(
      `DELETE FROM ${swTable('admin_user')} WHERE id = ?`,
      [Number(id)]
    );
    if (!res.affectedRows) throw Object.assign(new Error('账号不存在'), { statusCode: 404 });
    return { id: Number(id) };
  }
}

module.exports = { AdminUserService };
