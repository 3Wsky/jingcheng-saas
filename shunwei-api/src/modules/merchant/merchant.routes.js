const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const { isDatabaseConnectionError } = require('../../shared/mysql');
const { CashVoucherService } = require('../cash-voucher/cash-voucher.service');

const verifySchema = z.object({
  customerUid: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  remark: z.string().trim().max(200).optional().default('')
});

const withdrawSchema = z.object({
  amount: z.coerce.number().positive().optional(),
  withdrawAll: z.boolean().optional().default(false),
  remark: z.string().trim().max(200).optional().default('')
});

function registerMerchantRoutes(app) {
  const cvService = new CashVoucherService();

  app.get('/api/merchant/access', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const access = await resolveMerchantAccess(request.auth.uid);
      return ok(mapAccess(access));
    } catch (error) {
      return failMerchant(reply, error);
    }
  });

  app.get('/api/merchants/available', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const [rows] = await getPool().query(
        `SELECT id, merchant_name, category, contact_phone, store_address,
                latitude, longitude, store_images, business_hours
         FROM ${swTable('merchant')}
         WHERE is_active = 1 AND can_verify = 1
         ORDER BY id DESC`
      );
      return ok(rows.map((row) => {
        let images = [];
        try { images = JSON.parse(row.store_images || '[]'); } catch { images = []; }
        return {
          id: Number(row.id),
          merchantName: row.merchant_name || '',
          category: row.category || '',
          contactPhone: row.contact_phone || '',
          storeAddress: row.store_address || '',
          latitude: Number(row.latitude || 0),
          longitude: Number(row.longitude || 0),
          cover: images[0] || '',
          businessHours: row.business_hours || ''
        };
      }));
    } catch (error) {
      return failMerchant(reply, error);
    }
  });

  app.get('/api/merchant/me', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const access = await resolveMerchantAccess(request.auth.uid);
      return ok(mapAccess(access));
    } catch (error) {
      return failMerchant(reply, error);
    }
  });

  app.post('/api/merchant/verify-voucher', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const parsed = verifySchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const access = await resolveMerchantAccess(request.auth.uid);
      const merchant = access.merchant;
      if (!merchant.can_verify) return fail(reply, 403, '商家核销权限未开通');

      const result = await cvService.verify(
        parsed.data.customerUid,
        parsed.data.amount,
        request.auth.uid,
        merchant.id,
        parsed.data.remark || `${merchant.merchant_name}核销`
      );
      return ok(result, '核销成功');
    } catch (error) {
      return failMerchant(reply, error);
    }
  });

  app.get('/api/merchant/dashboard', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const access = await resolveMerchantAccess(request.auth.uid);
      const merchant = access.merchant;
      const now = new Date();
      const dayStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
      const weekStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      weekStartDate.setDate(weekStartDate.getDate() - ((weekStartDate.getDay() + 6) % 7));
      const weekStart = Math.floor(weekStartDate.getTime() / 1000);
      const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
      const [[stats]] = await getPool().query(
        `SELECT
           COALESCE(SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END), 0) AS today_amount,
           COALESCE(SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END), 0) AS week_amount,
           COALESCE(SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END), 0) AS month_amount,
           COALESCE(SUM(amount), 0) AS total_amount,
           COUNT(*) AS verify_count
         FROM ${swTable('cash_voucher_ledger')}
         WHERE merchant_id = ? AND direction = 0`,
        [dayStart, weekStart, monthStart, merchant.id]
      );
      const [[withdrawing]] = await getPool().query(
        `SELECT COALESCE(SUM(amount), 0) AS amount FROM ${swTable('merchant_settlement')}
         WHERE merchant_id = ? AND status = 'pending'`,
        [merchant.id]
      );
      return ok({
        ...mapAccess(access),
        todayAmount: Number(stats.today_amount || 0),
        weekAmount: Number(stats.week_amount || 0),
        monthAmount: Number(stats.month_amount || 0),
        totalAmount: Number(stats.total_amount || 0),
        verifyCount: Number(stats.verify_count || 0),
        availableAmount: Number(merchant.pending_settlement || 0),
        withdrawingAmount: Number(withdrawing.amount || 0),
        settledTotal: Number(merchant.settled_total || 0)
      });
    } catch (error) {
      return failMerchant(reply, error);
    }
  });

  app.post('/api/merchant/withdrawals', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const parsed = withdrawSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const access = await resolveMerchantAccess(request.auth.uid, connection);
      if (!access.isManager) throw Object.assign(new Error('仅店长可申请提现'), { statusCode: 403 });
      const [[merchant]] = await connection.query(
        `SELECT id, pending_settlement FROM ${swTable('merchant')}
         WHERE id = ? AND is_active = 1 FOR UPDATE`,
        [access.merchant.id]
      );
      const available = Number(merchant?.pending_settlement || 0);
      const amount = parsed.data.withdrawAll ? available : Number(parsed.data.amount || 0);
      if (amount <= 0) throw Object.assign(new Error('暂无可提现金额'), { statusCode: 400 });
      if (amount > available) {
        throw Object.assign(new Error(`可提现金额不足（可提现 ¥${available}）`), { statusCode: 400 });
      }
      const now = Math.floor(Date.now() / 1000);
      const expectedAt = now + 3 * 86400;
      await connection.query(
        `UPDATE ${swTable('merchant')}
         SET pending_settlement = pending_settlement - ?, updated_at = ? WHERE id = ?`,
        [amount, now, merchant.id]
      );
      const [result] = await connection.query(
        `INSERT INTO ${swTable('merchant_settlement')}
         (merchant_id, amount, status, settled_by, settled_at, remark, created_at, applicant_uid, expected_at)
         VALUES (?, ?, 'pending', 0, 0, ?, ?, ?, ?)`,
        [merchant.id, amount, parsed.data.remark || '商家提现申请', now, request.auth.uid, expectedAt]
      );
      await connection.commit();
      return ok({
        withdrawalId: result.insertId,
        amount,
        availableAfter: available - amount,
        expectedAt
      }, '提现申请已提交，预计T+3到账');
    } catch (error) {
      await connection.rollback();
      return failMerchant(reply, error);
    } finally {
      connection.release();
    }
  });

  app.get('/api/merchant/withdrawals', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const access = await resolveMerchantAccess(request.auth.uid);
      if (!access.isManager) return fail(reply, 403, '仅店长可查看提现记录');
      const [rows] = await getPool().query(
        `SELECT id, amount, status, remark, created_at, settled_at, expected_at
         FROM ${swTable('merchant_settlement')}
         WHERE merchant_id = ? ORDER BY id DESC LIMIT 50`,
        [access.merchant.id]
      );
      return ok(rows.map((row) => ({
        id: Number(row.id), amount: Number(row.amount), status: row.status,
        remark: row.remark || '', createdAt: Number(row.created_at || 0),
        settledAt: Number(row.settled_at || 0), expectedAt: Number(row.expected_at || 0)
      })));
    } catch (error) {
      return failMerchant(reply, error);
    }
  });

  app.get('/api/merchant/settlement', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const access = await resolveMerchantAccess(request.auth.uid);
      const merchant = access.merchant;
      const [records] = await getPool().query(
        `SELECT id, amount, status, settled_by, settled_at, remark, created_at
         FROM ${swTable('merchant_settlement')}
         WHERE merchant_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
        [merchant.id]
      );

      return ok({
        merchantName: merchant.merchant_name,
        pendingSettlement: Number(merchant.pending_settlement || 0),
        settledTotal: Number(merchant.settled_total || 0),
        records: records.map(r => ({
          id: r.id,
          amount: Number(r.amount),
          status: r.status,
          settledAt: Number(r.settled_at),
          remark: r.remark || '',
          createdAt: Number(r.created_at)
        }))
      });
    } catch (error) {
      return failMerchant(reply, error);
    }
  });
}

function pickMerchantFields(row) {
  return {
    id: Number(row.id),
    merchant_name: row.merchant_name || '',
    category: row.category || '',
    contact_name: row.contact_name || '',
    contact_phone: row.contact_phone || '',
    login_uid: Number(row.login_uid || 0),
    can_verify: Number(row.can_verify || 0),
    pending_settlement: Number(row.pending_settlement || 0),
    settled_total: Number(row.settled_total || 0),
    is_active: Number(row.is_active || 0)
  };
}

async function resolveMerchantAccess(uid, db = getPool()) {
  try {
    const [staffRows] = await db.query(
      `SELECT ms.role, m.id, m.merchant_name, m.category, m.contact_name, m.contact_phone,
              m.login_uid, m.can_verify, m.pending_settlement, m.settled_total, m.is_active
       FROM ${swTable('merchant_staff')} ms
       JOIN ${swTable('merchant')} m ON m.id = ms.merchant_id
       WHERE ms.staff_uid = ? AND ms.is_active = 1 AND m.is_active = 1
       ORDER BY CASE ms.role WHEN 'manager' THEN 0 ELSE 1 END, ms.id DESC
       LIMIT 1`,
      [uid]
    );
    if (staffRows[0]) {
      const row = staffRows[0];
      return {
        merchant: pickMerchantFields(row),
        isStaff: true,
        isManager: row.role === 'manager',
        divisionId: 0
      };
    }
  } catch { /* table may not exist yet */ }

  let merchant = await getMerchantByUidWithDb(uid, db);
  if (merchant) {
    return {
      merchant: pickMerchantFields(merchant),
      isStaff: true,
      isManager: true,
      divisionId: 0
    };
  }

  const [[actor]] = await db.query(
    `SELECT uid, is_staff, division_id FROM ${legacyTable('user')}
     WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
    [uid]
  );
  if (!actor) throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
  const divisionId = Number(actor.division_id || 0);
  const [[manager]] = await db.query(
    `SELECT 1 AS v FROM ${swTable('store_manager')}
     WHERE manager_uid = ? AND is_active = 1 AND (division_id = ? OR division_id = 0) LIMIT 1`,
    [uid, divisionId]
  );
  if (divisionId > 0) {
    const [rows] = await db.query(
      `SELECT m.id, m.merchant_name, m.category, m.contact_name, m.contact_phone,
              m.login_uid, m.can_verify, m.pending_settlement, m.settled_total, m.is_active
       FROM ${swTable('merchant')} m
       JOIN ${legacyTable('user')} owner ON owner.uid = m.login_uid
       WHERE owner.division_id = ? AND m.is_active = 1 ORDER BY m.id DESC LIMIT 1`,
      [divisionId]
    );
    merchant = rows[0] || null;
  }
  const isManager = Boolean(manager);
  const isStaff = Number(actor.is_staff) === 1 || Boolean(merchant && Number(merchant.login_uid) === Number(uid));
  if (!merchant || (!isStaff && !isManager)) {
    throw Object.assign(new Error('未配置商家核销权限'), { statusCode: 403 });
  }
  return {
    merchant: pickMerchantFields(merchant),
    isStaff,
    isManager: isManager || Number(merchant.login_uid) === Number(uid),
    divisionId
  };
}

async function getMerchantByUidWithDb(uid, db) {
  const [rows] = await db.query(
    `SELECT id, merchant_name, category, contact_name, contact_phone,
            login_uid, can_verify, pending_settlement, settled_total, is_active
     FROM ${swTable('merchant')} WHERE login_uid = ? AND is_active = 1 LIMIT 1`,
    [uid]
  );
  return rows[0] || null;
}

function mapAccess(access) {
  return {
    merchantId: Number(access.merchant.id),
    merchantName: access.merchant.merchant_name || '',
    canVerify: Number(access.merchant.can_verify) === 1,
    isStaff: access.isStaff,
    isManager: access.isManager,
    divisionId: access.divisionId
  };
}

function failMerchant(reply, error) {
  if (isDatabaseConnectionError(error)) {
    return fail(reply, 503, '数据库未连接', { code: error.code });
  }
  return fail(reply, error.statusCode || 500, error.message || '商家服务异常');
}

module.exports = { registerMerchantRoutes, resolveMerchantAccess };
