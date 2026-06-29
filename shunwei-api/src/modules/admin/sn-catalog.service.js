const { getPool } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

/**
 * SN 产品库：SN 码 → 型号 / 价格 映射。
 * 用于小程序拍照识别出 SN 后，查询型号与价格自动回填；查不到则手动输入。
 * 数据由管理员从 ERP（如管家婆）导出后导入。
 */
class SnCatalogService {
  async ensureTable() {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS ${swTable('sn_catalog')} (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        sn_code varchar(64) NOT NULL DEFAULT '',
        sn_norm varchar(64) NOT NULL DEFAULT '',
        brand varchar(64) NOT NULL DEFAULT '',
        model varchar(128) NOT NULL DEFAULT '',
        price decimal(10,2) NOT NULL DEFAULT '0.00',
        remark varchar(255) NOT NULL DEFAULT '',
        created_at int(10) unsigned NOT NULL DEFAULT '0',
        updated_at int(10) unsigned NOT NULL DEFAULT '0',
        PRIMARY KEY (id),
        UNIQUE KEY uk_sn_norm (sn_norm),
        KEY idx_model (model)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  /** 归一化 SN：去首尾空格、去内部空格、转大写，保证匹配稳定（SN 不区分大小写） */
  static normalizeSn(sn) {
    return String(sn || '').trim().replace(/\s+/g, '').toUpperCase();
  }

  static roundPrice(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
  }

  /** 小程序识别后调用：按 SN 精确（归一化后）查产品 */
  async lookup(sn) {
    const norm = SnCatalogService.normalizeSn(sn);
    if (!norm) return { found: false, sn: '', brand: '', model: '', price: 0 };
    await this.ensureTable();
    const [[row]] = await getPool().query(
      `SELECT sn_code, brand, model, price FROM ${swTable('sn_catalog')} WHERE sn_norm = ? LIMIT 1`,
      [norm]
    );
    if (!row) return { found: false, sn, brand: '', model: '', price: 0 };
    return {
      found: true,
      sn: row.sn_code || sn,
      brand: row.brand || '',
      model: row.model || '',
      price: Number(row.price || 0)
    };
  }

  async list({ page = 1, pageSize = 20, keyword = '' } = {}) {
    await this.ensureTable();
    const safePage = Math.max(1, Number(page) || 1);
    const safeSize = Math.min(200, Math.max(1, Number(pageSize) || 20));
    const offset = (safePage - 1) * safeSize;

    const conditions = [];
    const values = [];
    const kw = String(keyword || '').trim();
    if (kw) {
      conditions.push('(sn_code LIKE ? OR model LIKE ? OR brand LIKE ?)');
      values.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [[countRow]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM ${swTable('sn_catalog')} ${where}`,
      values
    );
    const [rows] = await getPool().query(
      `SELECT id, sn_code, brand, model, price, remark, created_at, updated_at
       FROM ${swTable('sn_catalog')} ${where}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...values, safeSize, offset]
    );

    return {
      total: Number(countRow?.total || 0),
      page: safePage,
      pageSize: safeSize,
      list: rows.map((r) => ({
        id: Number(r.id),
        snCode: r.sn_code || '',
        brand: r.brand || '',
        model: r.model || '',
        price: Number(r.price || 0),
        remark: r.remark || '',
        createdAt: Number(r.created_at || 0),
        updatedAt: Number(r.updated_at || 0)
      }))
    };
  }

  async upsertOne({ snCode, brand = '', model = '', price = 0, remark = '' }) {
    const norm = SnCatalogService.normalizeSn(snCode);
    if (!norm) {
      const err = new Error('SN 不能为空');
      err.statusCode = 400;
      throw err;
    }
    await this.ensureTable();
    const now = Math.floor(Date.now() / 1000);
    await getPool().query(
      `INSERT INTO ${swTable('sn_catalog')} (sn_code, sn_norm, brand, model, price, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         sn_code = VALUES(sn_code), brand = VALUES(brand), model = VALUES(model),
         price = VALUES(price), remark = VALUES(remark), updated_at = VALUES(updated_at)`,
      [
        String(snCode).trim(),
        norm,
        String(brand || '').trim().slice(0, 64),
        String(model || '').trim().slice(0, 128),
        SnCatalogService.roundPrice(price),
        String(remark || '').trim().slice(0, 255),
        now,
        now
      ]
    );
    return { snCode: String(snCode).trim() };
  }

  /** 批量导入：items=[{snCode, brand, model, price, remark}]；返回成功/跳过统计 */
  async bulkImport(items) {
    await this.ensureTable();
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return { inserted: 0, updated: 0, skipped: 0, total: 0 };

    const now = Math.floor(Date.now() / 1000);
    const seen = new Set();
    const rows = [];
    let skipped = 0;
    for (const it of list) {
      const norm = SnCatalogService.normalizeSn(it && it.snCode);
      if (!norm || seen.has(norm)) { skipped += 1; continue; }
      seen.add(norm);
      rows.push([
        String(it.snCode).trim(),
        norm,
        String(it.brand || '').trim().slice(0, 64),
        String(it.model || '').trim().slice(0, 128),
        SnCatalogService.roundPrice(it.price),
        String(it.remark || '').trim().slice(0, 255),
        now,
        now
      ]);
    }
    if (!rows.length) return { inserted: 0, updated: 0, skipped, total: list.length };

    // 分批 INSERT ... ON DUPLICATE KEY UPDATE，避免单条 SQL 过大
    const CHUNK = 500;
    let affected = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(',');
      const [res] = await getPool().query(
        `INSERT INTO ${swTable('sn_catalog')} (sn_code, sn_norm, brand, model, price, remark, created_at, updated_at)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           sn_code = VALUES(sn_code), brand = VALUES(brand), model = VALUES(model),
           price = VALUES(price), remark = VALUES(remark), updated_at = VALUES(updated_at)`,
        chunk.flat()
      );
      // mysql affectedRows: 新增计 1，更新计 2
      affected += Number(res?.affectedRows || 0);
    }
    return { processed: rows.length, skipped, total: list.length };
  }

  async remove(id) {
    await this.ensureTable();
    const numId = Number(id);
    if (!numId) {
      const err = new Error('id 无效');
      err.statusCode = 400;
      throw err;
    }
    await getPool().query(`DELETE FROM ${swTable('sn_catalog')} WHERE id = ?`, [numId]);
    return { id: numId };
  }

  async clearAll() {
    await this.ensureTable();
    await getPool().query(`TRUNCATE TABLE ${swTable('sn_catalog')}`);
    return { cleared: true };
  }

  async count() {
    await this.ensureTable();
    const [[row]] = await getPool().query(`SELECT COUNT(*) AS total FROM ${swTable('sn_catalog')}`);
    return Number(row?.total || 0);
  }
}

module.exports = { SnCatalogService };
