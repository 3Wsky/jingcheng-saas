const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const { isDatabaseConnectionError } = require('../../shared/mysql');
const { CashVoucherService } = require('../cash-voucher/cash-voucher.service');
const { getVerifyTokenService } = require('../cash-voucher/verify-token.service');
const { ensureMerchantSortColumn } = require('./admin-merchant.routes');

const verifySchema = z.object({
  verifyToken: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  remark: z.string().trim().max(200).optional().default(''),
  merchantId: z.coerce.number().int().nonnegative().optional().default(0)
});

const suspendSchema = z.object({
  action: z.enum(['suspend', 'resume']),
  resumeHour: z.coerce.number().int().min(0).max(23).optional().default(8),
  merchantId: z.coerce.number().int().nonnegative().optional().default(0)
});

const withdrawSchema = z.object({
  amount: z.coerce.number().positive().optional(),
  withdrawAll: z.boolean().optional().default(false),
  remark: z.string().trim().max(200).optional().default(''),
  merchantId: z.coerce.number().int().nonnegative().optional().default(0)
});

function registerMerchantRoutes(app) {
  const cvService = new CashVoucherService();

  app.get('/api/merchant/access', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const access = await resolveMerchantAccess(request.auth.uid, getPool(), Number(request.query?.merchantId || 0));
      return ok(mapAccess(access));
    } catch (error) {
      return failMerchant(reply, error);
    }
  });

  // 一人多店：返回当前账号可操作的全部门店（供工作台顶部切换）。
  app.get('/api/merchant/my-stores', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const list = await listMerchantAccess(request.auth.uid);
      return ok({
        total: list.length,
        stores: list.map((x) => ({
          merchantId: Number(x.merchant.id),
          merchantName: x.merchant.merchant_name || '',
          category: x.merchant.category || '',
          canVerify: Number(x.merchant.can_verify) === 1,
          isManager: !!x.isManager,
          role: x.isManager ? 'manager' : 'staff'
        }))
      });
    } catch (error) {
      return failMerchant(reply, error);
    }
  });

  app.get('/api/merchants/available', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      try { await ensureMerchantSortColumn(); } catch { /* 列已存在或权限问题不阻断查询 */ }
      const [rows] = await getPool().query(
        `SELECT id, merchant_name, category, contact_phone, store_address,
                latitude, longitude, store_images, business_hours
         FROM ${swTable('merchant')}
         WHERE is_active = 1 AND can_verify = 1
         ORDER BY sort DESC, id DESC`
      );
      return ok(rows.map((row) => {
        let images = [];
        try { images = JSON.parse(row.store_images || '[]'); } catch { images = []; }
        images = (Array.isArray(images) ? images : []).filter(Boolean);
        return {
          id: Number(row.id),
          merchantName: row.merchant_name || '',
          category: row.category || '',
          contactPhone: row.contact_phone || '',
          storeAddress: row.store_address || '',
          latitude: Number(row.latitude || 0),
          longitude: Number(row.longitude || 0),
          cover: images[0] || '',
          images,
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
      const access = await resolveMerchantAccess(request.auth.uid, getPool(), Number(request.query?.merchantId || 0));
      return ok(mapAccess(access));
    } catch (error) {
      return failMerchant(reply, error);
    }
  });

  app.post('/api/merchant/preview-verify', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const token = String(request.body?.verifyToken || '').trim();
    if (!token) return fail(reply, 400, '请提供核销码');

    try {
      await resolveMerchantAccess(request.auth.uid, getPool(), Number(request.body?.merchantId || 0));
      const tokenResult = getVerifyTokenService().peek(token);
      if (!tokenResult.valid) return fail(reply, 403, tokenResult.reason);

      const [[user]] = await getPool().query(
        `SELECT uid, nickname FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
        [tokenResult.uid]
      );
      if (!user) return fail(reply, 404, '用户不存在');

      const wallet = await cvService.getWallet(tokenResult.uid);
      const verifyMode = await cvService.getVerifyMode();
      return ok({
        uid: tokenResult.uid,
        nickname: user.nickname || '',
        balance: wallet.balance,
        verifyMode
      });
    } catch (error) {
      return failMerchant(reply, error);
    }
  });

  app.post('/api/merchant/verify-voucher', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const parsed = verifySchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const tokenResult = getVerifyTokenService().validate(parsed.data.verifyToken);
      if (!tokenResult.valid) return fail(reply, 403, tokenResult.reason);

      const access = await resolveMerchantAccess(request.auth.uid, getPool(), Number(parsed.data.merchantId || 0));
      const merchant = access.merchant;
      if (!merchant.can_verify) return fail(reply, 403, '商家核销权限未开通');

      await ensureSuspendedColumn();
      const [[staffStatus]] = await getPool().query(
        `SELECT suspended_until FROM ${swTable('merchant_staff')}
         WHERE merchant_id = ? AND staff_uid = ? AND is_active = 1 LIMIT 1`,
        [merchant.id, request.auth.uid]
      );
      if (staffStatus && Number(staffStatus.suspended_until || 0) > Math.floor(Date.now() / 1000)) {
        return fail(reply, 403, '你的核销权限已被暂停，请联系商家负责人');
      }

      const result = await cvService.verify(
        tokenResult.uid,
        parsed.data.amount,
        request.auth.uid,
        merchant.id,
        parsed.data.remark || `${merchant.merchant_name}核销`,
        tokenResult.nonce || ''
      );
      return ok(result, '核销成功');
    } catch (error) {
      return failMerchant(reply, error);
    }
  });

  // 核销结果回查：核销员遇到网络异常（结果未知）时，凭原核销码回查这笔到底成没成功。
  // 依据 DB nonce 表（核销成功才会落记录），实现「网络恢复后自动确认，免去手动核对」。
  app.post('/api/merchant/verify-status', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const token = String(request.body?.verifyToken || '').trim();
    if (!token) return fail(reply, 400, '请提供核销码');
    try {
      await resolveMerchantAccess(request.auth.uid, getPool(), Number(request.body?.merchantId || 0));
      const parsedToken = getVerifyTokenService().extractNonce(token);
      if (!parsedToken.valid) return fail(reply, 400, parsedToken.reason || '核销码无法识别');
      const status = await cvService.lookupVerifyByNonce(parsedToken.nonce);
      return ok(status);
    } catch (error) {
      return failMerchant(reply, error);
    }
  });

  app.get('/api/merchant/staff', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const access = await resolveMerchantAccess(request.auth.uid, getPool(), Number(request.query?.merchantId || 0));
      if (!access.isManager) return fail(reply, 403, '仅商家负责人可查看员工列表');
      await ensureSuspendedColumn();
      const [rows] = await getPool().query(
        `SELECT ms.staff_uid, ms.role, ms.suspended_until, u.nickname, u.avatar
         FROM ${swTable('merchant_staff')} ms
         LEFT JOIN ${legacyTable('user')} u ON u.uid = ms.staff_uid
         WHERE ms.merchant_id = ? AND ms.is_active = 1
         ORDER BY CASE ms.role WHEN 'manager' THEN 0 ELSE 1 END, ms.id ASC`,
        [access.merchant.id]
      );
      const now = Math.floor(Date.now() / 1000);
      return ok(rows.map(r => ({
        uid: Number(r.staff_uid),
        nickname: r.nickname || '',
        avatar: r.avatar || '',
        role: r.role,
        isSuspended: Number(r.suspended_until || 0) > now,
        suspendedUntil: Number(r.suspended_until || 0)
      })));
    } catch (error) {
      return failMerchant(reply, error);
    }
  });

  app.put('/api/merchant/staff/:uid/suspend', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const targetUid = Number(request.params.uid);
    if (!targetUid) return fail(reply, 400, 'uid 无效');
    const parsed = suspendSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const access = await resolveMerchantAccess(request.auth.uid, getPool(), Number(parsed.data.merchantId || 0));
      if (!access.isManager) return fail(reply, 403, '仅商家负责人可操作');
      if (targetUid === request.auth.uid) return fail(reply, 400, '不能暂停自己的权限');
      await ensureSuspendedColumn();
      const now = Math.floor(Date.now() / 1000);

      if (parsed.data.action === 'suspend') {
        const [[merchantRow]] = await getPool().query(
          `SELECT business_hours FROM ${swTable('merchant')} WHERE id = ? LIMIT 1`,
          [access.merchant.id]
        );
        let openHour = parsed.data.resumeHour;
        const bh = String(merchantRow?.business_hours || '').trim();
        const bhMatch = bh.match(/^(\d{1,2})/);
        if (bhMatch) openHour = Math.min(23, Math.max(0, Number(bhMatch[1])));

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(openHour, 0, 0, 0);
        const suspendedUntil = Math.floor(tomorrow.getTime() / 1000);
        await getPool().query(
          `UPDATE ${swTable('merchant_staff')}
           SET suspended_until = ?, updated_at = ?
           WHERE merchant_id = ? AND staff_uid = ? AND is_active = 1`,
          [suspendedUntil, now, access.merchant.id, targetUid]
        );
        const resumeText = String(openHour).padStart(2, '0') + ':00';
        return ok({ uid: targetUid, isSuspended: true, suspendedUntil, resumeText }, `已暂停核销权限，次日 ${resumeText} 自动恢复`);
      } else {
        await getPool().query(
          `UPDATE ${swTable('merchant_staff')}
           SET suspended_until = 0, updated_at = ?
           WHERE merchant_id = ? AND staff_uid = ? AND is_active = 1`,
          [now, access.merchant.id, targetUid]
        );
        return ok({ uid: targetUid, isSuspended: false }, '已恢复核销权限');
      }
    } catch (error) {
      return failMerchant(reply, error);
    }
  });

  app.get('/api/merchant/dashboard', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const access = await resolveMerchantAccess(request.auth.uid, getPool(), Number(request.query?.merchantId || 0));
      const merchant = access.merchant;
      const scope = String(request.query?.scope || '').trim().toLowerCase();
      const personalScope = ['mine', 'self', 'personal'].includes(scope);
      const now = new Date();
      const dayStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
      const weekStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      weekStartDate.setDate(weekStartDate.getDate() - ((weekStartDate.getDay() + 6) % 7));
      const weekStart = Math.floor(weekStartDate.getTime() / 1000);
      const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
      const ledgerWhere = [`merchant_id = ?`, `direction = 0`];
      const ledgerValues = [merchant.id];
      if (personalScope) {
        ledgerWhere.push(`operator_uid = ?`);
        ledgerValues.push(request.auth.uid);
      }
      const [[stats]] = await getPool().query(
        `SELECT
           COALESCE(SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END), 0) AS today_amount,
           COALESCE(SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END), 0) AS week_amount,
           COALESCE(SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END), 0) AS month_amount,
           COALESCE(SUM(amount), 0) AS total_amount,
           COUNT(*) AS verify_count,
           COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS today_count,
           COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS week_count,
           COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS month_count,
           COUNT(DISTINCT uid) AS customer_count
         FROM ${swTable('cash_voucher_ledger')}
         WHERE ${ledgerWhere.join(' AND ')}`,
        [dayStart, weekStart, monthStart, dayStart, weekStart, monthStart, ...ledgerValues]
      );
      const [[withdrawing]] = await getPool().query(
        `SELECT COALESCE(SUM(amount), 0) AS amount FROM ${swTable('merchant_settlement')}
         WHERE merchant_id = ? AND status = 'pending'`,
        [merchant.id]
      );

      const [recentRecords] = await getPool().query(
        `SELECT l.id, l.uid, l.amount, l.operator_uid, l.remark, l.created_at,
                u.nickname AS customer_nickname, op.nickname AS operator_nickname
         FROM ${swTable('cash_voucher_ledger')} l
         LEFT JOIN ${legacyTable('user')} u ON u.uid = l.uid
         LEFT JOIN ${legacyTable('user')} op ON op.uid = l.operator_uid
         WHERE l.${ledgerWhere.join(' AND l.')}
         ORDER BY l.created_at DESC LIMIT 10`,
        ledgerValues
      );

      let staffStats = [];
      if (access.isManager) {
        const [staffRows] = await getPool().query(
          `SELECT l.operator_uid, u.nickname,
                  COUNT(*) AS verify_count,
                  COALESCE(SUM(l.amount), 0) AS verify_amount,
                  COALESCE(SUM(CASE WHEN l.created_at >= ? THEN l.amount ELSE 0 END), 0) AS today_amount
           FROM ${swTable('cash_voucher_ledger')} l
           LEFT JOIN ${legacyTable('user')} u ON u.uid = l.operator_uid
           WHERE l.merchant_id = ? AND l.direction = 0
           GROUP BY l.operator_uid
           ORDER BY verify_amount DESC`,
          [dayStart, merchant.id]
        );
        staffStats = staffRows.map(r => ({
          uid: Number(r.operator_uid),
          nickname: r.nickname || `UID${r.operator_uid}`,
          verifyCount: Number(r.verify_count),
          verifyAmount: Number(r.verify_amount),
          todayAmount: Number(r.today_amount)
        }));
      }

      return ok({
        ...mapAccess(access),
        todayAmount: Number(stats.today_amount || 0),
        weekAmount: Number(stats.week_amount || 0),
        monthAmount: Number(stats.month_amount || 0),
        totalAmount: Number(stats.total_amount || 0),
        verifyCount: Number(stats.verify_count || 0),
        todayCount: Number(stats.today_count || 0),
        weekCount: Number(stats.week_count || 0),
        monthCount: Number(stats.month_count || 0),
        customerCount: Number(stats.customer_count || 0),
        availableAmount: Number(merchant.pending_settlement || 0),
        withdrawingAmount: Number(withdrawing.amount || 0),
        settledTotal: Number(merchant.settled_total || 0),
        recentRecords: recentRecords.map(r => ({
          id: r.id,
          customerUid: Number(r.uid),
          customerNickname: r.customer_nickname || '',
          amount: Number(r.amount),
          operatorUid: Number(r.operator_uid || 0),
          operatorNickname: r.operator_nickname || '',
          remark: r.remark || '',
          createdAt: Number(r.created_at)
        })),
        staffStats
      });
    } catch (error) {
      return failMerchant(reply, error);
    }
  });

  app.post('/api/merchant/withdrawals', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const parsed = withdrawSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    try {
      await ensureSettlementColumns();
    } catch (error) {
      return failMerchant(reply, error);
    }
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const access = await resolveMerchantAccess(request.auth.uid, connection, Number(parsed.data.merchantId || 0));
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
      const access = await resolveMerchantAccess(request.auth.uid, getPool(), Number(request.query?.merchantId || 0));
      if (!access.isManager) return fail(reply, 403, '仅店长可查看提现记录');
      await ensureSettlementColumns();
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
      const access = await resolveMerchantAccess(request.auth.uid, getPool(), Number(request.query?.merchantId || 0));
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

let _columnEnsured = false;
async function ensureSuspendedColumn() {
  if (_columnEnsured) return;
  try {
    await getPool().query(
      `ALTER TABLE ${swTable('merchant_staff')} ADD COLUMN suspended_until int(10) unsigned NOT NULL DEFAULT '0'`
    );
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME') throw e;
  }
  _columnEnsured = true;
}

// 商家提现申请（admin-r5 迁移）所需的两列。生产若未手动执行该迁移，
// 提现/结算接口一打开就会 Unknown column 报错。这里在运行时幂等补列，
// 让接口自愈（与 ensureSuspendedColumn 同思路），无需手动 SSH 跑 SQL。
let _settlementColumnsEnsured = false;
async function ensureSettlementColumns() {
  if (_settlementColumnsEnsured) return;
  const alters = [
    `ALTER TABLE ${swTable('merchant_settlement')} ADD COLUMN applicant_uid int(10) unsigned NOT NULL DEFAULT '0' COMMENT '提现申请人uid'`,
    `ALTER TABLE ${swTable('merchant_settlement')} ADD COLUMN expected_at int(10) unsigned NOT NULL DEFAULT '0' COMMENT '预计到账时间(T+3)'`
  ];
  for (const sql of alters) {
    try {
      await getPool().query(sql);
    } catch (e) {
      // 列已存在=正常（幂等）；表不存在则保留给上层 catch 处理
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    }
  }
  try {
    await getPool().query(
      `ALTER TABLE ${swTable('merchant_settlement')} ADD KEY idx_merchant_status_created (merchant_id, status, created_at)`
    );
  } catch (e) {
    if (e.code !== 'ER_DUP_KEYNAME') throw e;
  }
  _settlementColumnsEnsured = true;
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

/**
 * 汇总某人可访问的所有商家（支持一人负责多店）。
 * 来源：merchant_staff(role) + 该人作为 login_uid 的商家 + 门店 division 兜底。
 * 返回按角色(负责人优先)+排序权重降序的列表：[{ merchant, isManager, isStaff, source }]。
 */
async function listMerchantAccess(uid, db = getPool()) {
  const byId = new Map(); // merchantId -> { merchant(pick), isManager, isStaff, source }
  const put = (row, { isManager, source }) => {
    const id = Number(row.id);
    if (!id) return;
    const existing = byId.get(id);
    if (existing) {
      // 已存在则取"更高"权限（负责人 > 员工）
      existing.isManager = existing.isManager || isManager;
      existing.isStaff = true;
      return;
    }
    byId.set(id, { merchant: pickMerchantFields(row), isManager, isStaff: true, source, sort: Number(row.sort || 0) });
  };

  // 1) merchant_staff 明细（可多店）
  try {
    const [staffRows] = await db.query(
      `SELECT ms.role, m.id, m.merchant_name, m.category, m.contact_name, m.contact_phone,
              m.login_uid, m.can_verify, m.pending_settlement, m.settled_total, m.is_active, m.sort
       FROM ${swTable('merchant_staff')} ms
       JOIN ${swTable('merchant')} m ON m.id = ms.merchant_id
       WHERE ms.staff_uid = ? AND ms.is_active = 1 AND m.is_active = 1`,
      [uid]
    );
    for (const row of staffRows) put(row, { isManager: row.role === 'manager', source: 'assigned' });
  } catch { /* merchant_staff 表可能不存在 */ }

  // 2) 作为 login_uid 的商家（负责人，可多店）
  try {
    const [ownerRows] = await db.query(
      `SELECT id, merchant_name, category, contact_name, contact_phone,
              login_uid, can_verify, pending_settlement, settled_total, is_active, sort
       FROM ${swTable('merchant')} WHERE login_uid = ? AND is_active = 1`,
      [uid]
    );
    for (const row of ownerRows) put(row, { isManager: true, source: 'owner' });
  } catch { /* ignore */ }

  // 3) 若上面都没有，走门店 division 兜底（老逻辑）
  if (byId.size === 0) {
    const [[actor]] = await db.query(
      `SELECT uid, is_staff, division_id FROM ${legacyTable('user')}
       WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
      [uid]
    );
    if (actor) {
      const divisionId = Number(actor.division_id || 0);
      if (divisionId > 0) {
        const [[manager]] = await db.query(
          `SELECT 1 AS v FROM ${swTable('store_manager')}
           WHERE manager_uid = ? AND is_active = 1 AND (division_id = ? OR division_id = 0) LIMIT 1`,
          [uid, divisionId]
        );
        const [rows] = await db.query(
          `SELECT m.id, m.merchant_name, m.category, m.contact_name, m.contact_phone,
                  m.login_uid, m.can_verify, m.pending_settlement, m.settled_total, m.is_active, m.sort
           FROM ${swTable('merchant')} m
           JOIN ${legacyTable('user')} owner ON owner.uid = m.login_uid
           WHERE owner.division_id = ? AND m.is_active = 1 ORDER BY m.sort DESC, m.id DESC`,
          [divisionId]
        );
        const isMgr = Boolean(manager) || Number(actor.is_staff) === 1;
        for (const row of rows) put(row, { isManager: isMgr, source: 'division' });
      }
    }
  }

  const list = [...byId.values()];
  list.sort((a, b) => (b.isManager - a.isManager) || (b.sort - a.sort) || (b.merchant.id - a.merchant.id));
  return list;
}

/**
 * 解析当前操作的商家访问权限。
 * @param merchantId 可选：指定要操作的门店（一人多店时用于切换）。传了但无权访问则抛 403。
 * 不传时返回该人的"首选门店"（负责人优先、排序权重高者），保持旧行为。
 */
async function resolveMerchantAccess(uid, db = getPool(), merchantId = 0) {
  const list = await listMerchantAccess(uid, db);
  const targetId = Number(merchantId || 0);

  if (targetId) {
    const found = list.find((x) => Number(x.merchant.id) === targetId);
    if (!found) throw Object.assign(new Error('你没有该门店的操作权限'), { statusCode: 403 });
    return { merchant: found.merchant, isStaff: found.isStaff, isManager: found.isManager, divisionId: 0 };
  }

  if (!list.length) {
    throw Object.assign(new Error('未配置商家核销权限'), { statusCode: 403 });
  }
  const primary = list[0];
  return { merchant: primary.merchant, isStaff: primary.isStaff, isManager: primary.isManager, divisionId: 0 };
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

module.exports = { registerMerchantRoutes, resolveMerchantAccess, listMerchantAccess, ensureSettlementColumns };
