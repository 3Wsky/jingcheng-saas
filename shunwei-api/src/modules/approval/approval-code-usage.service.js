const { getPool } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const { SnCatalogService } = require('../admin/sn-catalog.service');

/**
 * 审批「已用码」台账：防止同一个 IMEI1 / SN 被重复用于申请会员权益（一码一次）。
 * - 每次审批通过发放时登记该单的所有 IMEI/SN（code_norm 唯一约束 = 数据库级防重）。
 * - 提交 / 审核 / 自动终审前查此表，已用的码直接拦截。
 */
class ApprovalCodeUsageService {
  async ensureTable() {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS ${swTable('approval_code_usage')} (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        code_norm varchar(64) NOT NULL DEFAULT '',
        code_type varchar(8) NOT NULL DEFAULT '',
        code_raw varchar(64) NOT NULL DEFAULT '',
        request_id bigint(20) unsigned NOT NULL DEFAULT '0',
        customer_uid bigint(20) unsigned NOT NULL DEFAULT '0',
        used_at int(10) unsigned NOT NULL DEFAULT '0',
        PRIMARY KEY (id),
        UNIQUE KEY uk_code_norm (code_norm),
        KEY idx_request (request_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  /** 从收据串解析出归一化码列表：[{ norm, type:'imei1'|'sn', raw }]（已去重） */
  static parseCodes(receiptNo) {
    const { imeis, sns } = SnCatalogService.extractCodes(receiptNo || '');
    const out = [];
    const seen = new Set();
    for (const v of imeis) {
      const norm = SnCatalogService.normalizeImei(v);
      if (norm && !seen.has(norm)) { seen.add(norm); out.push({ norm, type: 'imei1', raw: v }); }
    }
    for (const v of sns) {
      const norm = SnCatalogService.normalizeSn(v);
      if (norm && !seen.has(norm)) { seen.add(norm); out.push({ norm, type: 'sn', raw: v }); }
    }
    return out;
  }

  /**
   * 检查收据里的码是否有"已被别的单用过的"。
   * @returns { codes:[...], conflicts:[{norm,type,raw,requestId,usedAt,customerUid}] , usable:boolean }
   * excludeRequestId：核对自身单时排除自己（避免自己登记的码挡自己）。
   * conn 可为事务连接或 pool。
   */
  async checkUsable(receiptNo, { excludeRequestId = 0, conn } = {}) {
    const db = conn || getPool();
    await this.ensureTable();
    const codes = ApprovalCodeUsageService.parseCodes(receiptNo);
    if (!codes.length) return { codes, conflicts: [], usable: true };

    const norms = codes.map((c) => c.norm);
    const [rows] = await db.query(
      `SELECT code_norm, code_type, code_raw, request_id, customer_uid, used_at
       FROM ${swTable('approval_code_usage')}
       WHERE code_norm IN (?) ${excludeRequestId ? 'AND request_id <> ?' : ''}`,
      excludeRequestId ? [norms, excludeRequestId] : [norms]
    );
    const conflicts = rows.map((r) => ({
      norm: r.code_norm,
      type: r.code_type,
      raw: r.code_raw,
      requestId: Number(r.request_id),
      customerUid: Number(r.customer_uid),
      usedAt: Number(r.used_at)
    }));
    return { codes, conflicts, usable: conflicts.length === 0 };
  }

  /** 单码是否已用（供小程序录入即时提示）。返回 { used, type, usedAt, requestId } */
  async checkSingle({ imei = '', sn = '' } = {}) {
    await this.ensureTable();
    const norm = imei ? SnCatalogService.normalizeImei(imei) : SnCatalogService.normalizeSn(sn);
    if (!norm) return { used: false };
    const [[row]] = await getPool().query(
      `SELECT code_type, request_id, used_at FROM ${swTable('approval_code_usage')} WHERE code_norm = ? LIMIT 1`,
      [norm]
    );
    if (!row) return { used: false };
    return { used: true, type: row.code_type, usedAt: Number(row.used_at), requestId: Number(row.request_id) };
  }

  /**
   * 登记某审批单的所有码为"已用"（在发放事务内调用）。
   * 用 INSERT IGNORE：唯一约束撞上则跳过（已被别单登记，理论上提交时已拦，这里是最终兜底）。
   * conn 必须为发放所在事务连接。
   */
  async registerForRequest(conn, req) {
    await this.ensureTable();
    const codes = ApprovalCodeUsageService.parseCodes(req && req.receipt_no);
    if (!codes.length) return { registered: 0 };
    const now = Math.floor(Date.now() / 1000);
    let registered = 0;
    for (const c of codes) {
      const [res] = await conn.query(
        `INSERT IGNORE INTO ${swTable('approval_code_usage')}
         (code_norm, code_type, code_raw, request_id, customer_uid, used_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [c.norm, c.type, String(c.raw).slice(0, 64), Number(req.id), Number(req.customer_uid || 0), now]
      );
      if (res && res.affectedRows) registered += 1;
    }
    return { registered, total: codes.length };
  }

  /**
   * 一次性回填：把历史已通过(approved)审批单的码登记进台账，保证老码也算"已用"。
   * 幂等（INSERT IGNORE）。返回处理统计。
   */
  async backfillFromApproved() {
    await this.ensureTable();
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, customer_uid, receipt_no, approved_at, updated_at
       FROM ${swTable('approval_request')}
       WHERE status = 'approved' AND receipt_no <> ''
       ORDER BY id ASC`
    );
    let inserted = 0;
    let scanned = 0;
    for (const r of rows) {
      const codes = ApprovalCodeUsageService.parseCodes(r.receipt_no);
      if (!codes.length) continue;
      scanned += 1;
      const usedAt = Number(r.approved_at || r.updated_at || 0);
      for (const c of codes) {
        const [res] = await pool.query(
          `INSERT IGNORE INTO ${swTable('approval_code_usage')}
           (code_norm, code_type, code_raw, request_id, customer_uid, used_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [c.norm, c.type, String(c.raw).slice(0, 64), Number(r.id), Number(r.customer_uid || 0), usedAt]
        );
        if (res && res.affectedRows) inserted += 1;
      }
    }
    return { approvedScanned: scanned, codesInserted: inserted };
  }
}

module.exports = { ApprovalCodeUsageService };
