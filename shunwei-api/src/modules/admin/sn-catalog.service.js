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
        imei1 varchar(32) NOT NULL DEFAULT '',
        imei1_norm varchar(32) NOT NULL DEFAULT '',
        match_key varchar(64) NOT NULL DEFAULT '',
        brand varchar(64) NOT NULL DEFAULT '',
        model varchar(128) NOT NULL DEFAULT '',
        price decimal(10,2) NOT NULL DEFAULT '0.00',
        remark varchar(255) NOT NULL DEFAULT '',
        created_at int(10) unsigned NOT NULL DEFAULT '0',
        updated_at int(10) unsigned NOT NULL DEFAULT '0',
        PRIMARY KEY (id),
        UNIQUE KEY uk_match_key (match_key),
        KEY idx_sn_norm (sn_norm),
        KEY idx_imei1_norm (imei1_norm),
        KEY idx_model (model)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // 兼容已存在的旧表：补列 / 索引 / 切换唯一键（幂等）
    await this.ensureSchemaUpgrade();
  }

  /**
   * 旧表升级（幂等，吞掉"列/索引已存在"类报错）：
   *  - 补 imei1 / imei1_norm / match_key 列
   *  - 回填 match_key = imei1_norm 优先，否则 sn_norm
   *  - 唯一键从 uk_sn_norm 切换到 uk_match_key（SN 可空，IMEI1 为主键身份）
   */
  async ensureSchemaUpgrade() {
    const table = swTable('sn_catalog');
    // 1) 补列
    const addColumns = [
      `ALTER TABLE ${table} ADD COLUMN imei1 varchar(32) NOT NULL DEFAULT '' AFTER sn_norm`,
      `ALTER TABLE ${table} ADD COLUMN imei1_norm varchar(32) NOT NULL DEFAULT '' AFTER imei1`,
      `ALTER TABLE ${table} ADD COLUMN match_key varchar(64) NOT NULL DEFAULT '' AFTER imei1_norm`
    ];
    for (const sql of addColumns) await this.runIgnoringDup(sql);

    // 2) 回填 match_key（仅对空 match_key 的历史行）
    try {
      await getPool().query(
        `UPDATE ${table} SET match_key = IF(imei1_norm <> '', imei1_norm, sn_norm) WHERE match_key = ''`
      );
    } catch { /* 忽略：列可能尚未就绪的极端时序 */ }

    // 3) 删除旧唯一键 uk_sn_norm（若存在），改为普通索引 idx_sn_norm
    await this.runIgnoringDup(`ALTER TABLE ${table} DROP INDEX uk_sn_norm`, true);
    await this.runIgnoringDup(`ALTER TABLE ${table} ADD KEY idx_sn_norm (sn_norm)`);
    await this.runIgnoringDup(`ALTER TABLE ${table} ADD KEY idx_imei1_norm (imei1_norm)`);

    // 4) 建立新唯一键 uk_match_key（若历史数据存在 match_key 重复会失败 → 退化为普通索引兜底）
    try {
      await getPool().query(`ALTER TABLE ${table} ADD UNIQUE KEY uk_match_key (match_key)`);
    } catch (err) {
      const code = err && err.code;
      if (code === 'ER_DUP_KEYNAME' || /exists/i.test(String(err && err.message))) {
        // 唯一键已存在，正常
      } else if (code === 'ER_DUP_ENTRY' || /duplicate entry/i.test(String(err && err.message))) {
        // 历史数据有重复设备，先建普通索引保证可用，去重交由整库替换导入处理
        await this.runIgnoringDup(`ALTER TABLE ${table} ADD KEY idx_match_key (match_key)`);
      } else {
        throw err;
      }
    }
  }

  /** 执行可能因"已存在/不存在"而报错的 DDL，幂等吞错。dropMode=true 时同时吞"索引不存在" */
  async runIgnoringDup(sql, dropMode = false) {
    try {
      await getPool().query(sql);
    } catch (err) {
      const code = err && err.code;
      const msg = String(err && err.message);
      const dupCol = code === 'ER_DUP_FIELDNAME';
      const dupKey = code === 'ER_DUP_KEYNAME';
      const missing = dropMode && (code === 'ER_CANT_DROP_FIELD_OR_KEY' || /check that.*exists/i.test(msg));
      if (!dupCol && !dupKey && !missing && !/duplicate|exists/i.test(msg)) throw err;
    }
  }

  /** 构造设备唯一身份键：IMEI1 优先，缺失则用 SN（均已归一化） */
  static buildMatchKey(imeiNorm, snNorm) {
    return imeiNorm || snNorm || '';
  }

  /** 归一化 SN：去首尾空格、去内部空格、转大写，保证匹配稳定（SN 不区分大小写） */
  static normalizeSn(sn) {
    return String(sn || '').trim().replace(/\s+/g, '').toUpperCase();
  }

  /** 归一化 IMEI：只保留数字（IMEI 为纯数字，去空格/横线等） */
  static normalizeImei(imei) {
    return String(imei || '').replace(/\D/g, '');
  }

  static roundPrice(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
  }

  /** 小程序识别后调用：按 SN 精确（归一化后）查产品（保留旧签名兼容调用方） */
  async lookup(sn) {
    return this.lookupByCode({ sn });
  }

  /**
   * 按标识码查产品库：IMEI1 优先，SN 兜底，并做 SN↔IMEI 交叉兜底。
   * 入参 { imei, sn }（任一即可，二者都给则先 IMEI1 后 SN）。
   * 交叉兜底：员工常把 IMEI 填进 SN 栏（或反之），故一个码在"本栏"查不到时，
   * 用同一串码去"另一栏"再查一次（IMEI 列用去非数字后的值，SN 列用去空格大写后的值）。
   * 只按精确相等匹配，不会命中库里不存在的设备，故不放松防作弊口径。
   * 返回 { found, matchedBy: 'imei1'|'sn'|'', sn, imei1, brand, model, price }。
   */
  async lookupByCode({ imei = '', sn = '' } = {}) {
    await this.ensureTable();
    const imeiNorm = SnCatalogService.normalizeImei(imei);
    const snNorm = SnCatalogService.normalizeSn(sn);

    const empty = { found: false, matchedBy: '', sn: snNorm ? String(sn).trim() : '', imei1: imeiNorm, brand: '', model: '', price: 0 };
    if (!imeiNorm && !snNorm) return empty;

    const pool = getPool();
    const byImei = async (val) => {
      if (!val) return null;
      const [[row]] = await pool.query(
        `SELECT sn_code, imei1, brand, model, price FROM ${swTable('sn_catalog')} WHERE imei1_norm = ? LIMIT 1`,
        [val]
      );
      return row || null;
    };
    const bySn = async (val) => {
      if (!val) return null;
      const [[row]] = await pool.query(
        `SELECT sn_code, imei1, brand, model, price FROM ${swTable('sn_catalog')} WHERE sn_norm = ? LIMIT 1`,
        [val]
      );
      return row || null;
    };

    // 1) IMEI 标签：先查 IMEI1 列，查不到再交叉查 SN 列（用 SN 归一化的同串）
    if (imeiNorm) {
      const hit = await byImei(imeiNorm);
      if (hit) return SnCatalogService.toLookupHit(hit, 'imei1', { imei: imeiNorm, sn });
      const crossSnNorm = SnCatalogService.normalizeSn(imei);
      const cross = await bySn(crossSnNorm);
      if (cross) return SnCatalogService.toLookupHit(cross, 'sn', { imei: imeiNorm, sn });
    }

    // 2) SN 标签：先查 SN 列，查不到再交叉查 IMEI1 列（用 IMEI 归一化的同串）
    if (snNorm) {
      const hit = await bySn(snNorm);
      if (hit) return SnCatalogService.toLookupHit(hit, 'sn', { imei: imeiNorm, sn });
      // 仅当"整串 SN 本身就是一个完整 15 位 IMEI"（纯数字、长度15）时才交叉查 IMEI 列，
      // 避免把普通字母数字 SN 里抽出的一段数字误当 IMEI 造成误命中。
      const snDigits = SnCatalogService.normalizeImei(sn);
      const snIsPureImei = snDigits.length === 15 && snDigits === SnCatalogService.normalizeSn(sn);
      if (snIsPureImei) {
        const cross = await byImei(snDigits);
        if (cross) return SnCatalogService.toLookupHit(cross, 'imei1', { imei: imeiNorm, sn });
      }
    }

    return empty;
  }

  static toLookupHit(row, matchedBy, input) {
    return {
      found: true,
      matchedBy,
      sn: row.sn_code || (input && input.sn ? String(input.sn).trim() : ''),
      imei1: row.imei1 || (input && input.imei ? String(input.imei) : ''),
      brand: row.brand || '',
      model: row.model || '',
      price: Number(row.price || 0)
    };
  }

  /** 可用品类（前端 Tab 用；顺序即展示顺序，'all' 由前端自加） */
  static CATEGORIES = ['手机', '平板', '电脑', '智能穿戴', '无人机', '其他'];

  /**
   * 由型号/品牌/有无 IMEI1 推断品类（库里无 category 字段，靠启发式）。
   *  - 有 IMEI1 → 手机（手机才有 IMEI）
   *  - 型号/品牌含无人机/大疆/相机/云台/运动相机 → 无人机
   *  - 含 平板/pad → 平板；含 笔记本/电脑/matebook/book/pro 16 等 → 电脑
   *  - 含 手表/watch/手环/band/耳机/buds/耳机 → 智能穿戴
   *  - 其余 → 其他
   */
  static inferCategory({ imei1 = '', model = '', brand = '' } = {}) {
    if (String(imei1 || '').trim()) return '手机';
    const t = `${String(model || '')} ${String(brand || '')}`.toLowerCase();
    if (/无人机|大疆|dji|云台|运动相机|osmo|pocket|action|mavic|air\s?\d|mini\s?\d|flip|neo/.test(t)) return '无人机';
    if (/平板|pad/.test(t)) return '平板';
    if (/笔记本|电脑|matebook|notebook|book|拯救者|thinkpad|游戏本|台式/.test(t)) return '电脑';
    if (/手表|watch|手环|band|耳机|buds|freebuds|gt\s?\d|穿戴|耳夹/.test(t)) return '智能穿戴';
    return '其他';
  }

  /**
   * 品类 → SQL WHERE 片段（用于分页正确的按品类筛选）。返回 { sql, params } 或 null（不筛）。
   * 与 inferCategory 保持一致的口径：手机=有imei1；其它=无imei1且型号/品牌命中该类关键词；
   * 其他=无imei1且不命中任何已知品类。
   */
  static categoryWhere(category) {
    const cat = String(category || '').trim();
    if (!cat || cat === 'all') return null;
    if (cat === '手机') return { sql: "imei1_norm <> ''", params: [] };

    const like = (kws) => ({
      sql: '(' + kws.map(() => '(model LIKE ? OR brand LIKE ?)').join(' OR ') + ')',
      params: kws.flatMap((k) => [`%${k}%`, `%${k}%`])
    });
    const droneKw = ['无人机', '大疆', 'DJI', '云台', 'Osmo', 'Pocket', 'Action', 'Mavic', 'Flip', 'Neo'];
    const padKw = ['平板', 'Pad'];
    const pcKw = ['笔记本', '电脑', 'MateBook', 'Book', '拯救者', 'ThinkPad'];
    const wearKw = ['手表', 'Watch', '手环', 'Band', '耳机', 'Buds', '穿戴'];

    const noImei = "imei1_norm = ''";
    if (cat === '无人机') { const l = like(droneKw); return { sql: `${noImei} AND ${l.sql}`, params: l.params }; }
    if (cat === '平板') { const l = like(padKw); return { sql: `${noImei} AND ${l.sql}`, params: l.params }; }
    if (cat === '电脑') { const l = like(pcKw); return { sql: `${noImei} AND ${l.sql}`, params: l.params }; }
    if (cat === '智能穿戴') { const l = like(wearKw); return { sql: `${noImei} AND ${l.sql}`, params: l.params }; }
    if (cat === '其他') {
      // 其他 = 无 imei1 且不命中 无人机/平板/电脑/穿戴 任一关键词
      const all = [...droneKw, ...padKw, ...pcKw, ...wearKw];
      const notLike = all.map(() => '(model NOT LIKE ? AND brand NOT LIKE ?)').join(' AND ');
      return { sql: `${noImei} AND ${notLike}`, params: all.flatMap((k) => [`%${k}%`, `%${k}%`]) };
    }
    return null;
  }

  async list({ page = 1, pageSize = 20, keyword = '', category = '', brand = '' } = {}) {
    await this.ensureTable();
    const safePage = Math.max(1, Number(page) || 1);
    const safeSize = Math.min(200, Math.max(1, Number(pageSize) || 20));
    const offset = (safePage - 1) * safeSize;

    const conditions = [];
    const values = [];
    const kw = String(keyword || '').trim();
    if (kw) {
      conditions.push('(sn_code LIKE ? OR imei1 LIKE ? OR model LIKE ? OR brand LIKE ?)');
      values.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`);
    }
    const br = String(brand || '').trim();
    if (br) {
      conditions.push('brand = ?');
      values.push(br);
    }
    const catWhere = SnCatalogService.categoryWhere(category);
    if (catWhere) {
      conditions.push(`(${catWhere.sql})`);
      values.push(...catWhere.params);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [[countRow]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM ${swTable('sn_catalog')} ${where}`,
      values
    );
    const [rows] = await getPool().query(
      `SELECT id, sn_code, imei1, brand, model, price, remark, created_at, updated_at
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
        imei1: r.imei1 || '',
        brand: r.brand || '',
        model: r.model || '',
        category: SnCatalogService.inferCategory({ imei1: r.imei1, model: r.model, brand: r.brand }),
        price: Number(r.price || 0),
        remark: r.remark || '',
        createdAt: Number(r.created_at || 0),
        updatedAt: Number(r.updated_at || 0)
      }))
    };
  }

  /**
   * 分类分面统计：返回各品类条数 + 品牌列表（含条数），供前端做 Tab 与品牌下拉。
   * 品类计数用与 categoryWhere 一致的口径逐类 COUNT，保证与筛选结果对得上。
   */
  async facets() {
    await this.ensureTable();
    const pool = getPool();
    const [[totalRow]] = await pool.query(`SELECT COUNT(*) AS c FROM ${swTable('sn_catalog')}`);
    const total = Number(totalRow?.c || 0);

    const categories = [];
    for (const cat of SnCatalogService.CATEGORIES) {
      const w = SnCatalogService.categoryWhere(cat);
      // eslint-disable-next-line no-await-in-loop
      const [[row]] = await pool.query(
        `SELECT COUNT(*) AS c FROM ${swTable('sn_catalog')} WHERE ${w.sql}`,
        w.params
      );
      categories.push({ category: cat, count: Number(row?.c || 0) });
    }

    const [brandRows] = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(brand), ''), '未填品牌') AS brand, COUNT(*) AS c
       FROM ${swTable('sn_catalog')} GROUP BY brand ORDER BY c DESC LIMIT 100`
    );
    const brands = brandRows.map((r) => ({ brand: r.brand, count: Number(r.c || 0) }));

    return { total, categories, brands };
  }

  async upsertOne({ snCode = '', imei1 = '', brand = '', model = '', price = 0, remark = '' }) {
    const snNorm = SnCatalogService.normalizeSn(snCode);
    const imeiNorm = SnCatalogService.normalizeImei(imei1);
    // 以 IMEI1 为主键身份，IMEI1 与 SN 至少有一个
    if (!imeiNorm && !snNorm) {
      const err = new Error('IMEI1 与 SN 不能同时为空');
      err.statusCode = 400;
      throw err;
    }
    const matchKey = SnCatalogService.buildMatchKey(imeiNorm, snNorm);
    await this.ensureTable();
    const now = Math.floor(Date.now() / 1000);
    await getPool().query(
      `INSERT INTO ${swTable('sn_catalog')} (sn_code, sn_norm, imei1, imei1_norm, match_key, brand, model, price, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         sn_code = VALUES(sn_code), sn_norm = VALUES(sn_norm), imei1 = VALUES(imei1), imei1_norm = VALUES(imei1_norm),
         brand = VALUES(brand), model = VALUES(model),
         price = VALUES(price), remark = VALUES(remark), updated_at = VALUES(updated_at)`,
      [
        String(snCode || '').trim(),
        snNorm,
        String(imei1 || '').trim(),
        imeiNorm,
        matchKey,
        String(brand || '').trim().slice(0, 64),
        String(model || '').trim().slice(0, 128),
        SnCatalogService.roundPrice(price),
        String(remark || '').trim().slice(0, 255),
        now,
        now
      ]
    );
    return { snCode: String(snCode || '').trim(), imei1: String(imei1 || '').trim() };
  }

  /**
   * 把导入项归一化为去重后的待写行（IMEI1 为主键身份去重）。
   * 入参 items=[{snCode, imei1, brand, model, price, remark}]；
   * 返回 { rows, skipped }：rows 为按 match_key 去重后的 SQL 行（10 列），skipped 为被跳过的条数。
   */
  static buildRows(items, now) {
    const list = Array.isArray(items) ? items : [];
    const seen = new Map(); // match_key -> rowIndex（同 key 后者覆盖前者，保留最新）
    const rows = [];
    let skipped = 0;
    for (const it of list) {
      const snNorm = SnCatalogService.normalizeSn(it && it.snCode);
      const imeiNorm = SnCatalogService.normalizeImei(it && it.imei1);
      const matchKey = SnCatalogService.buildMatchKey(imeiNorm, snNorm);
      if (!matchKey) { skipped += 1; continue; } // IMEI1 与 SN 都空 → 跳过
      const row = [
        String((it && it.snCode) || '').trim(),
        snNorm,
        String((it && it.imei1) || '').trim(),
        imeiNorm,
        matchKey,
        String((it && it.brand) || '').trim().slice(0, 64),
        String((it && it.model) || '').trim().slice(0, 128),
        SnCatalogService.roundPrice(it && it.price),
        String((it && it.remark) || '').trim().slice(0, 255),
        now,
        now
      ];
      if (seen.has(matchKey)) {
        rows[seen.get(matchKey)] = row; // 同设备覆盖为最新
        skipped += 1;
      } else {
        seen.set(matchKey, rows.length);
        rows.push(row);
      }
    }
    return { rows, skipped };
  }

  /**
   * 批量导入（增量 upsert）：items=[{snCode, imei1, brand, model, price, remark}]。
   * 以 IMEI1 为主键身份去重，IMEI1 为空才用 SN；返回处理/跳过统计。
   */
  async bulkImport(items) {
    await this.ensureTable();
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return { processed: 0, skipped: 0, total: 0 };

    const now = Math.floor(Date.now() / 1000);
    const { rows, skipped } = SnCatalogService.buildRows(list, now);
    if (!rows.length) return { processed: 0, skipped, total: list.length };

    await this.insertRows(getPool(), rows);
    return { processed: rows.length, skipped, total: list.length, mode: 'append' };
  }

  /**
   * 整库替换导入：清空后写入（事务内 TRUNCATE → 批量插入），用于"每次上传最新全量"。
   * items 同 bulkImport。返回 { processed, skipped, total, mode:'replace' }。
   */
  async replaceAll(items) {
    await this.ensureTable();
    const list = Array.isArray(items) ? items : [];
    const now = Math.floor(Date.now() / 1000);
    const { rows, skipped } = SnCatalogService.buildRows(list, now);

    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      // DELETE 而非 TRUNCATE：TRUNCATE 在部分 MySQL 下隐式提交、且无法回滚
      await conn.query(`DELETE FROM ${swTable('sn_catalog')}`);
      if (rows.length) await this.insertRows(conn, rows);
      await conn.commit();
    } catch (err) {
      try { await conn.rollback(); } catch { /* ignore */ }
      throw err;
    } finally {
      conn.release();
    }
    return { processed: rows.length, skipped, total: list.length, mode: 'replace' };
  }

  /** 分批 INSERT ... ON DUPLICATE KEY UPDATE（10 列），避免单条 SQL 过大。conn 可为 pool 或事务连接 */
  async insertRows(conn, rows) {
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
      await conn.query(
        `INSERT INTO ${swTable('sn_catalog')} (sn_code, sn_norm, imei1, imei1_norm, match_key, brand, model, price, remark, created_at, updated_at)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           sn_code = VALUES(sn_code), sn_norm = VALUES(sn_norm), imei1 = VALUES(imei1), imei1_norm = VALUES(imei1_norm),
           brand = VALUES(brand), model = VALUES(model),
           price = VALUES(price), remark = VALUES(remark), updated_at = VALUES(updated_at)`,
        chunk.flat()
      );
    }
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

  /**
   * 从申请收据串里提取所有标识码（IMEI / IMEI1 / IMEI2 / SN）。
   * 收据串形如：`[产品1] 手机/型号/¥价格/IMEI:xxx; [产品2] 智能穿戴/型号/¥价/SN:yyy`
   * 返回 { imeis: string[], sns: string[] }（已去重、归一化）。
   */
  static extractCodes(receiptNo) {
    const text = String(receiptNo || '');
    const imeis = new Set();
    const sns = new Set();

    // IMEI / IMEI1 / IMEI2 标签
    const imeiRe = /IMEI\s*\d?\s*[:：]\s*([0-9][0-9\s-]{12,18}[0-9])/gi;
    let m;
    while ((m = imeiRe.exec(text)) !== null) {
      const norm = SnCatalogService.normalizeImei(m[1]);
      if (norm) imeis.add(norm);
    }

    // SN 标签
    const snRe = /\bSN\s*[:：]\s*([A-Za-z0-9-]{4,40})/gi;
    while ((m = snRe.exec(text)) !== null) {
      const norm = SnCatalogService.normalizeSn(m[1]);
      if (norm) sns.add(norm);
    }

    return { imeis: [...imeis], sns: [...sns] };
  }

  /**
   * 校验一组标识码是否在产品库命中（IMEI1 优先、SN 兜底）。
   * 入参 { imeis?: string[], sns?: string[] } 或 { receiptNo }。
   * 返回 { hasCode, matched, matchedBy, hit, totalCodes, matchedCount, allMatched }：
   *  - hasCode：是否解析出任何码（没有码时无法核对）
   *  - matched：是否至少命中一条产品库记录（任一命中）
   *  - matchedBy：第一条命中的方式 'imei1' | 'sn' | ''
   *  - hit：第一条命中的产品 { sn, imei1, model, price }
   *  - totalCodes：解析出的去重码总数；matchedCount：命中数；allMatched：是否全部命中
   */
  async verifyCodes(input = {}) {
    await this.ensureTable();
    let imeis = Array.isArray(input.imeis) ? input.imeis : [];
    let sns = Array.isArray(input.sns) ? input.sns : [];
    if (input.receiptNo) {
      const parsed = SnCatalogService.extractCodes(input.receiptNo);
      imeis = imeis.concat(parsed.imeis);
      sns = sns.concat(parsed.sns);
    }
    imeis = [...new Set(imeis.map((x) => SnCatalogService.normalizeImei(x)).filter(Boolean))];
    sns = [...new Set(sns.map((x) => SnCatalogService.normalizeSn(x)).filter(Boolean))];

    const totalCodes = imeis.length + sns.length;
    const empty = { hasCode: false, matched: false, matchedBy: '', hit: null, totalCodes: 0, matchedCount: 0, allMatched: false };
    if (!totalCodes) return empty;

    let matchedCount = 0;
    let firstHit = null;
    let firstBy = '';
    for (const imei of imeis) {
      const r = await this.lookupByCode({ imei });
      if (r.found) {
        matchedCount += 1;
        if (!firstHit) { firstHit = { sn: r.sn, imei1: r.imei1, model: r.model, price: r.price }; firstBy = 'imei1'; }
      }
    }
    for (const sn of sns) {
      const r = await this.lookupByCode({ sn });
      if (r.found) {
        matchedCount += 1;
        if (!firstHit) { firstHit = { sn: r.sn, imei1: r.imei1, model: r.model, price: r.price }; firstBy = 'sn'; }
      }
    }

    return {
      hasCode: true,
      matched: matchedCount > 0,
      matchedBy: firstBy,
      hit: firstHit,
      totalCodes,
      matchedCount,
      allMatched: matchedCount === totalCodes
    };
  }
}

module.exports = { SnCatalogService };
