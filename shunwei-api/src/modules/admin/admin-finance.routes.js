const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const { requireAdmin, getAdminSession } = require('./admin.auth');
const { AdminAuditService, getClientIp } = require('./admin-audit.service');

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  uid: z.coerce.number().int().positive().optional(),
  keyword: z.string().trim().max(64).optional().default(''),
  direction: z.coerce.number().int().min(0).max(1).optional(),
  bizType: z.string().trim().max(32).optional().default(''),
  startAt: z.coerce.number().int().min(0).optional(),
  endAt: z.coerce.number().int().min(0).optional()
});

const settlementMarkSchema = z.object({
  merchantId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  remark: z.string().trim().max(255).optional().default('')
});

function fmtTs(ts) {
  return Number(ts || 0);
}

function registerAdminFinanceRoutes(app) {
  const audit = new AdminAuditService();

  app.get('/api/admin/finance/summary', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const pool = getPool();
    const [[cashRow]] = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 1 THEN amount ELSE 0 END), 0) AS grantTotal,
         COALESCE(SUM(CASE WHEN direction = 0 THEN amount ELSE 0 END), 0) AS verifyTotal,
         COUNT(*) AS ledgerCount
       FROM ${swTable('cash_voucher_ledger')}`
    );
    const [[integralRow]] = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 1 THEN amount ELSE 0 END), 0) AS grantTotal,
         COALESCE(SUM(CASE WHEN direction = 0 THEN amount ELSE 0 END), 0) AS consumeTotal,
         COUNT(*) AS ledgerCount
       FROM ${swTable('integral_ledger')}`
    );
    const [[settleRow]] = await pool.query(
      `SELECT COALESCE(SUM(pending_settlement), 0) AS pendingTotal,
              COALESCE(SUM(settled_total), 0) AS settledTotal
       FROM ${swTable('merchant')} WHERE is_active = 1`
    );
    const [[rechargeRow]] = await pool.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN pay_status = 1 THEN pay_amount ELSE 0 END), 0) AS paidAmount
       FROM ${swTable('integral_recharge_order')}`
    ).catch(() => [[{ total: 0, paidAmount: 0 }]]);

    const [[modeRow]] = await pool.query(
      `SELECT config_value FROM ${swTable('system_config')}
       WHERE config_key = 'cash_voucher_verify_mode' LIMIT 1`
    );

    return ok({
      cashVoucher: {
        grantTotal: Number(cashRow?.grantTotal || 0),
        verifyTotal: Number(cashRow?.verifyTotal || 0),
        ledgerCount: Number(cashRow?.ledgerCount || 0)
      },
      integral: {
        grantTotal: Number(integralRow?.grantTotal || 0),
        consumeTotal: Number(integralRow?.consumeTotal || 0),
        ledgerCount: Number(integralRow?.ledgerCount || 0)
      },
      settlement: {
        pendingTotal: Number(settleRow?.pendingTotal || 0),
        settledTotal: Number(settleRow?.settledTotal || 0)
      },
      recharge: {
        orderCount: Number(rechargeRow?.total || 0),
        paidAmount: Number(rechargeRow?.paidAmount || 0)
      },
      verifyMode: modeRow?.config_value || 'any'
    });
  });

  app.get('/api/admin/finance/cash-voucher-ledger', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = pageQuerySchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const { page, pageSize, uid, keyword, direction, startAt, endAt } = parsed.data;
    const conditions = ['1=1'];
    const values = [];

    if (uid) {
      conditions.push('l.uid = ?');
      values.push(uid);
    }
    if (direction !== undefined) {
      conditions.push('l.direction = ?');
      values.push(direction);
    }
    if (startAt) {
      conditions.push('l.created_at >= ?');
      values.push(startAt);
    }
    if (endAt) {
      conditions.push('l.created_at <= ?');
      values.push(endAt);
    }
    if (keyword) {
      conditions.push('(l.biz_id LIKE ? OR l.remark LIKE ? OR CAST(l.uid AS CHAR) LIKE ?)');
      values.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const where = conditions.join(' AND ');
    const offset = (page - 1) * pageSize;

    const [[countRow]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM ${swTable('cash_voucher_ledger')} l WHERE ${where}`,
      values
    );
    const [rows] = await getPool().query(
      `SELECT l.id, l.uid, l.direction, l.amount, l.batch_id AS batchId, l.merchant_id AS merchantId,
              l.operator_uid AS operatorUid, l.biz_id AS bizId, l.remark, l.created_at AS createdAt,
              m.merchant_name AS merchantName,
              u.nickname AS userNickname
       FROM ${swTable('cash_voucher_ledger')} l
       LEFT JOIN ${swTable('merchant')} m ON m.id = l.merchant_id
       LEFT JOIN ${legacyTable('user')} u ON u.uid = l.uid
       WHERE ${where}
       ORDER BY l.id DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );

    return ok({
      total: Number(countRow?.total || 0),
      page,
      pageSize,
      list: rows.map((r) => ({
        id: r.id,
        uid: r.uid,
        userNickname: r.userNickname || '',
        direction: Number(r.direction),
        amount: Number(r.amount),
        batchId: r.batchId,
        merchantId: Number(r.merchantId || 0),
        merchantName: r.merchantName || (Number(r.merchantId) > 0 ? '' : '本店'),
        operatorUid: Number(r.operatorUid || 0),
        bizId: r.bizId || '',
        remark: r.remark || '',
        createdAt: fmtTs(r.createdAt)
      }))
    });
  });

  app.get('/api/admin/finance/integral-ledger', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = pageQuerySchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const { page, pageSize, uid, keyword, direction, bizType, startAt, endAt } = parsed.data;
    const conditions = ['1=1'];
    const values = [];

    if (uid) {
      conditions.push('l.uid = ?');
      values.push(uid);
    }
    if (direction !== undefined) {
      conditions.push('l.direction = ?');
      values.push(direction);
    }
    if (bizType) {
      conditions.push('l.biz_type = ?');
      values.push(bizType);
    }
    if (startAt) {
      conditions.push('l.created_at >= ?');
      values.push(startAt);
    }
    if (endAt) {
      conditions.push('l.created_at <= ?');
      values.push(endAt);
    }
    if (keyword) {
      conditions.push('(l.biz_id LIKE ? OR l.remark LIKE ? OR CAST(l.uid AS CHAR) LIKE ?)');
      values.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const where = conditions.join(' AND ');
    const offset = (page - 1) * pageSize;

    const [[countRow]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM ${swTable('integral_ledger')} l WHERE ${where}`,
      values
    );
    const [rows] = await getPool().query(
      `SELECT l.id, l.uid, l.direction, l.amount, l.balance_after AS balanceAfter,
              l.batch_id AS batchId, l.biz_type AS bizType, l.biz_id AS bizId,
              l.operator_uid AS operatorUid, l.remark, l.created_at AS createdAt,
              u.nickname AS userNickname
       FROM ${swTable('integral_ledger')} l
       LEFT JOIN ${legacyTable('user')} u ON u.uid = l.uid
       WHERE ${where}
       ORDER BY l.id DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );

    return ok({
      total: Number(countRow?.total || 0),
      page,
      pageSize,
      list: rows.map((r) => ({
        id: r.id,
        uid: r.uid,
        userNickname: r.userNickname || '',
        direction: Number(r.direction),
        amount: Number(r.amount),
        balanceAfter: Number(r.balanceAfter || 0),
        batchId: r.batchId,
        bizType: r.bizType || '',
        bizId: r.bizId || '',
        operatorUid: Number(r.operatorUid || 0),
        remark: r.remark || '',
        createdAt: fmtTs(r.createdAt)
      }))
    });
  });

  app.get('/api/admin/finance/recharge/list', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = pageQuerySchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const { page, pageSize, uid, keyword, startAt, endAt } = parsed.data;
    const conditions = ['1=1'];
    const values = [];

    if (uid) {
      conditions.push('o.uid = ?');
      values.push(uid);
    }
    if (startAt) {
      conditions.push('o.created_at >= ?');
      values.push(startAt);
    }
    if (endAt) {
      conditions.push('o.created_at <= ?');
      values.push(endAt);
    }
    if (keyword) {
      conditions.push('(o.order_no LIKE ? OR CAST(o.uid AS CHAR) LIKE ?)');
      values.push(`%${keyword}%`, `%${keyword}%`);
    }

    const where = conditions.join(' AND ');
    const offset = (page - 1) * pageSize;

    try {
      const [[countRow]] = await getPool().query(
        `SELECT COUNT(*) AS total FROM ${swTable('integral_recharge_order')} o WHERE ${where}`,
        values
      );
      const [rows] = await getPool().query(
        `SELECT o.id, o.order_no AS orderNo, o.uid, o.pay_amount AS payAmount,
                o.integral_amount AS integralAmount, o.exchange_rate AS exchangeRate,
                o.pay_status AS payStatus, o.pay_type AS payType, o.paid_at AS paidAt,
                o.created_at AS createdAt, u.nickname AS userNickname
         FROM ${swTable('integral_recharge_order')} o
         LEFT JOIN ${legacyTable('user')} u ON u.uid = o.uid
         WHERE ${where}
         ORDER BY o.id DESC
         LIMIT ? OFFSET ?`,
        [...values, pageSize, offset]
      );

      return ok({
        total: Number(countRow?.total || 0),
        page,
        pageSize,
        list: rows.map((r) => ({
          id: r.id,
          orderNo: r.orderNo,
          uid: r.uid,
          userNickname: r.userNickname || '',
          payAmount: Number(r.payAmount),
          integralAmount: Number(r.integralAmount),
          exchangeRate: Number(r.exchangeRate),
          payStatus: Number(r.payStatus),
          payType: r.payType || 'weixin',
          paidAt: fmtTs(r.paidAt),
          createdAt: fmtTs(r.createdAt)
        }))
      });
    } catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE') {
        return ok({ total: 0, page, pageSize, list: [] });
      }
      throw error;
    }
  });

  app.get('/api/admin/finance/settlement/list', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = pageQuerySchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const { page, pageSize, keyword } = parsed.data;
    const conditions = ['is_active = 1'];
    const values = [];
    if (keyword) {
      conditions.push('(merchant_name LIKE ? OR contact_name LIKE ?)');
      values.push(`%${keyword}%`, `%${keyword}%`);
    }
    const where = conditions.join(' AND ');
    const offset = (page - 1) * pageSize;

    const [[countRow]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM ${swTable('merchant')} WHERE ${where}`,
      values
    );
    const [rows] = await getPool().query(
      `SELECT id, merchant_name AS merchantName, category, contact_phone AS contactPhone,
              pending_settlement AS pendingSettlement, settled_total AS settledTotal,
              settlement_note AS settlementNote, updated_at AS updatedAt
       FROM ${swTable('merchant')}
       WHERE ${where}
       ORDER BY pending_settlement DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );

    return ok({
      total: Number(countRow?.total || 0),
      page,
      pageSize,
      list: rows.map((r) => ({
        id: r.id,
        merchantName: r.merchantName,
        category: r.category || '',
        contactPhone: r.contactPhone || '',
        pendingSettlement: Number(r.pendingSettlement || 0),
        settledTotal: Number(r.settledTotal || 0),
        settlementNote: r.settlementNote || '',
        updatedAt: fmtTs(r.updatedAt)
      }))
    });
  });

  app.get('/api/admin/finance/settlement/records', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const page = Math.max(1, Number(request.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize || 20)));
    const merchantId = Number(request.query.merchantId || 0);
    const offset = (page - 1) * pageSize;

    const conditions = ['1=1'];
    const values = [];
    if (merchantId > 0) {
      conditions.push('s.merchant_id = ?');
      values.push(merchantId);
    }
    const where = conditions.join(' AND ');

    try {
      const [[countRow]] = await getPool().query(
        `SELECT COUNT(*) AS total FROM ${swTable('merchant_settlement')} s WHERE ${where}`,
        values
      );
      const [rows] = await getPool().query(
        `SELECT s.id, s.merchant_id AS merchantId, s.amount, s.status, s.settled_by AS settledBy,
                s.settled_at AS settledAt, s.remark, s.created_at AS createdAt,
                m.merchant_name AS merchantName
         FROM ${swTable('merchant_settlement')} s
         LEFT JOIN ${swTable('merchant')} m ON m.id = s.merchant_id
         WHERE ${where}
         ORDER BY s.id DESC
         LIMIT ? OFFSET ?`,
        [...values, pageSize, offset]
      );

      return ok({
        total: Number(countRow?.total || 0),
        page,
        pageSize,
        list: rows.map((r) => ({
          id: r.id,
          merchantId: r.merchantId,
          merchantName: r.merchantName || '',
          amount: Number(r.amount),
          status: r.status,
          settledBy: Number(r.settledBy || 0),
          settledAt: fmtTs(r.settledAt),
          remark: r.remark || '',
          createdAt: fmtTs(r.createdAt)
        }))
      });
    } catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE') {
        return ok({ total: 0, page, pageSize, list: [] });
      }
      throw error;
    }
  });

  app.post('/api/admin/finance/settlement/mark', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = settlementMarkSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const { merchantId, amount, remark } = parsed.data;
    const connection = await getPool().getConnection();
    const now = Math.floor(Date.now() / 1000);

    try {
      await connection.beginTransaction();

      const [[merchant]] = await connection.query(
        `SELECT id, merchant_name, pending_settlement FROM ${swTable('merchant')}
         WHERE id = ? AND is_active = 1 FOR UPDATE`,
        [merchantId]
      );
      if (!merchant) {
        const error = new Error('商家不存在');
        error.statusCode = 404;
        throw error;
      }

      const pending = Number(merchant.pending_settlement || 0);
      if (amount > pending) {
        const error = new Error(`待结算金额不足（待结算 ¥${pending}，请求 ¥${amount}）`);
        error.statusCode = 400;
        throw error;
      }

      await connection.query(
        `UPDATE ${swTable('merchant')}
         SET pending_settlement = pending_settlement - ?,
             settled_total = settled_total + ?,
             updated_at = ?
         WHERE id = ?`,
        [amount, amount, now, merchantId]
      );

      await connection.query(
        `INSERT INTO ${swTable('merchant_settlement')}
         (merchant_id, amount, status, settled_by, settled_at, remark, created_at)
         VALUES (?, ?, 'settled', 0, ?, ?, ?)`,
        [merchantId, amount, now, remark || '线下已结算', now]
      );

      await connection.commit();

      const session = getAdminSession(request);
      await audit.write({
        adminUsername: session?.username || '',
        action: 'settlement_mark',
        targetType: 'merchant',
        targetId: merchantId,
        payload: { amount, remark },
        ip: getClientIp(request)
      });

      return ok({
        merchantId,
        amount,
        pendingAfter: pending - amount
      }, '已标记结算');
    } catch (error) {
      await connection.rollback();
      return fail(reply, error.statusCode || 500, error.message || '结算失败');
    } finally {
      connection.release();
    }
  });

  app.get('/api/admin/finance/verify-mode', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const [rows] = await getPool().query(
      `SELECT config_value FROM ${swTable('system_config')}
       WHERE config_key = 'cash_voucher_verify_mode' LIMIT 1`
    );
    return ok({ mode: rows[0]?.config_value || 'any' });
  });
}

module.exports = { registerAdminFinanceRoutes };
