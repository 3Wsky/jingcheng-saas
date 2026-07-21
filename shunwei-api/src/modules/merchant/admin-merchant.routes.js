const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const { requireAdmin, getAdminSession } = require('../admin/admin.auth');
const { AdminAuditService, getClientIp } = require('../admin/admin-audit.service');
const { AdminMerchantStaffService } = require('./admin-merchant-staff.service');
const { CashVoucherService } = require('../cash-voucher/cash-voucher.service');
const { CashVoucherReversalService, ensureCashVoucherReversalSchema } = require('../cash-voucher/cash-voucher-reversal.service');

const manualVerifySchema = z.object({
  uid: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  merchantId: z.coerce.number().int().positive(),
  operatorUid: z.coerce.number().int().positive(),
  remark: z.string().trim().max(200).optional().default('')
});

const reverseVerifySchema = z.object({
  reason: z.string().trim().min(2, '请填写至少2个字的撤回原因').max(200)
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(500).optional().default(20),
  keyword: z.string().trim().max(64).optional().default(''),
  category: z.string().trim().max(64).optional().default(''),
  sortBy: z.enum(['sort', 'id', 'todayAmount', 'monthAmount', 'staffActive', 'staffBound', 'pending', 'lastVerify']).optional().default('sort'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
});

const merchantReorderSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(500)
});

function dayStartTs(d = new Date()) {
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);
}

function monthStartTs(d = new Date()) {
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000);
}

const merchantUpdateSchema = z.object({
  merchantName: z.string().trim().min(1).max(128).optional(),
  category: z.string().trim().max(64).optional(),
  contactName: z.string().trim().max(64).optional(),
  contactPhone: z.string().trim().max(20).optional(),
  canVerify: z.boolean().optional(),
  storeAddress: z.string().trim().max(255).optional(),
  province: z.string().trim().max(32).optional(),
  city: z.string().trim().max(32).optional(),
  district: z.string().trim().max(32).optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  storeImages: z.array(z.string()).optional(),
  businessHours: z.string().trim().max(128).optional(),
  settlementNote: z.string().trim().max(255).optional()
});

// sw_merchant.sort 列（商家显示排序权重，大在前）运行时幂等补列，避免手动跑 SQL
let _merchantSortColEnsured = false;
async function ensureMerchantSortColumn() {
  if (_merchantSortColEnsured) return;
  try {
    await getPool().query(
      `ALTER TABLE ${swTable('merchant')} ADD COLUMN sort int(11) NOT NULL DEFAULT '0' COMMENT '显示排序权重,大在前'`
    );
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME') throw e;
  }
  try {
    await getPool().query(
      `ALTER TABLE ${swTable('merchant')} ADD KEY idx_sort (sort)`
    );
  } catch (e) {
    if (e.code !== 'ER_DUP_KEYNAME') throw e;
  }
  _merchantSortColEnsured = true;
}

function mapMerchant(row) {
  let storeImages = [];
  if (row.store_images) {
    try { storeImages = JSON.parse(row.store_images); } catch { storeImages = []; }
  }
  return {
    id: row.id,
    merchantName: row.merchant_name,
    category: row.category || '',
    contactName: row.contact_name || '',
    contactPhone: row.contact_phone || '',
    loginUid: row.login_uid,
    sort: Number(row.sort || 0),
    canVerify: Number(row.can_verify) === 1,
    pendingSettlement: Number(row.pending_settlement || 0),
    settledTotal: Number(row.settled_total || 0),
    isActive: Number(row.is_active) === 1,
    storeAddress: row.store_address || '',
    province: row.province || '',
    city: row.city || '',
    district: row.district || '',
    latitude: Number(row.latitude || 0),
    longitude: Number(row.longitude || 0),
    storeImages,
    businessHours: row.business_hours || '',
    settlementNote: row.settlement_note || '',
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0)
  };
}

function registerAdminMerchantRoutes(app) {
  const audit = new AdminAuditService();
  const staffService = new AdminMerchantStaffService();
  const cashVoucherService = new CashVoucherService();
  const cashVoucherReversalService = new CashVoucherReversalService();

  app.get('/api/admin/merchant/list', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = listQuerySchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const { page, pageSize, keyword, category, sortBy, sortOrder } = parsed.data;
    await staffService.ensureTable();
    await ensureMerchantSortColumn();
    const conditions = ['m.is_active = 1'];
    const values = [];
    if (keyword) {
      conditions.push('(m.merchant_name LIKE ? OR m.contact_name LIKE ? OR m.contact_phone LIKE ?)');
      values.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (category) {
      conditions.push('m.category = ?');
      values.push(category);
    }
    const where = conditions.join(' AND ');
    const offset = (page - 1) * pageSize;

    const dayStart = dayStartTs();
    const monthStart = monthStartTs();

    const ledger = swTable('cash_voucher_ledger');
    const staffTbl = swTable('merchant_staff');

    const sortColumnMap = {
      sort: 'm.sort',
      id: 'm.id',
      todayAmount: 'today_amount',
      monthAmount: 'month_amount',
      staffActive: 'staff_active',
      staffBound: 'staff_bound',
      pending: 'm.pending_settlement',
      lastVerify: 'last_verify_at'
    };
    const orderCol = sortColumnMap[sortBy] || 'm.sort';
    const orderDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const [[countRow]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM ${swTable('merchant')} m WHERE ${where}`,
      values
    );
    const [rows] = await getPool().query(
      `SELECT m.*,
              (SELECT MAX(l.created_at) FROM ${ledger} l
               WHERE l.merchant_id = m.id AND l.direction = 0 AND l.reversed_at = 0) AS last_verify_at,
              (SELECT COUNT(DISTINCT l.biz_id) FROM ${ledger} l
               WHERE l.merchant_id = m.id AND l.direction = 0 AND l.reversed_at = 0 AND l.created_at >= ?) AS today_count,
              (SELECT COALESCE(SUM(l.amount), 0) FROM ${ledger} l
               WHERE l.merchant_id = m.id AND l.direction = 0 AND l.reversed_at = 0 AND l.created_at >= ?) AS today_amount,
              (SELECT COALESCE(SUM(l.amount), 0) FROM ${ledger} l
               WHERE l.merchant_id = m.id AND l.direction = 0 AND l.reversed_at = 0 AND l.created_at >= ?) AS month_amount,
              (SELECT COUNT(*) FROM ${staffTbl} ms
               WHERE ms.merchant_id = m.id AND ms.is_active = 1) AS staff_bound,
              (SELECT COUNT(DISTINCT l.operator_uid) FROM ${ledger} l
               WHERE l.merchant_id = m.id AND l.direction = 0 AND l.reversed_at = 0 AND l.created_at >= ?) AS staff_active
       FROM ${swTable('merchant')} m
       WHERE ${where}
       ORDER BY ${orderCol} ${orderDir}, m.id DESC LIMIT ? OFFSET ?`,
      [dayStart, dayStart, monthStart, monthStart, ...values, pageSize, offset]
    );

    return ok({
      total: Number(countRow?.total || 0),
      page,
      pageSize,
      list: rows.map((row) => ({
        ...mapMerchant(row),
        lastVerifyAt: Number(row.last_verify_at || 0),
        todayCount: Number(row.today_count || 0),
        todayAmount: Number(row.today_amount || 0),
        monthAmount: Number(row.month_amount || 0),
        staffBound: Number(row.staff_bound || 0),
        staffActive: Number(row.staff_active || 0)
      }))
    });
  });

  // 批量保存商家显示排序（后台拖拽后调用）。body={ ids:[按新顺序排列的商家id] }。
  // 与积分商城/商品排序约定一致：sort = 总数 - 下标，首位 sort 最大，列表按 sort DESC。
  // 放在 :id 路由之前注册，避免 /reorder 命中 /:id。
  app.patch('/api/admin/merchant/reorder', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = merchantReorderSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '排序参数错误', parsed.error.flatten());
    await ensureMerchantSortColumn();

    const ids = parsed.data.ids;
    const now = Math.floor(Date.now() / 1000);
    const maxSort = ids.length;
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      for (let index = 0; index < ids.length; index += 1) {
        await connection.query(
          `UPDATE ${swTable('merchant')} SET sort = ?, updated_at = ? WHERE id = ?`,
          [maxSort - index, now, ids[index]]
        );
      }
      await connection.commit();
    } catch (error) {
      try { await connection.rollback(); } catch { /* ignore */ }
      return fail(reply, 500, error.message || '保存排序失败');
    } finally {
      connection.release();
    }

    const session = getAdminSession(request);
    await audit.write({
      adminUsername: session?.username || '',
      action: 'merchant_reorder',
      targetType: 'merchant',
      targetId: 0,
      payload: { count: ids.length },
      ip: getClientIp(request)
    });

    return ok({ updatedCount: ids.length }, '排序已保存');
  });

  app.get('/api/admin/merchant/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number(request.params.id);
    const [[row]] = await getPool().query(
      `SELECT m.*,
              (SELECT COALESCE(SUM(l.amount), 0)
               FROM ${swTable('cash_voucher_ledger')} l
               WHERE l.merchant_id = m.id AND l.direction = 0 AND l.reversed_at = 0) AS total_verify_amount
       FROM ${swTable('merchant')} m
       WHERE m.id = ? LIMIT 1`,
      [id]
    );
    if (!row) return fail(reply, 404, '商家不存在');
    return ok({
      ...mapMerchant(row),
      totalVerifyAmount: Number(row.total_verify_amount || 0)
    });
  });

  app.put('/api/admin/merchant/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number(request.params.id);
    const parsed = merchantUpdateSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const [[existing]] = await getPool().query(
      `SELECT id FROM ${swTable('merchant')} WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!existing) return fail(reply, 404, '商家不存在');

    const d = parsed.data;
    const now = Math.floor(Date.now() / 1000);
    const sets = ['updated_at = ?'];
    const values = [now];

    const fieldMap = {
      merchantName: 'merchant_name',
      category: 'category',
      contactName: 'contact_name',
      contactPhone: 'contact_phone',
      storeAddress: 'store_address',
      province: 'province',
      city: 'city',
      district: 'district',
      businessHours: 'business_hours',
      settlementNote: 'settlement_note'
    };
    for (const [key, col] of Object.entries(fieldMap)) {
      if (d[key] !== undefined) {
        sets.push(`${col} = ?`);
        values.push(d[key]);
      }
    }
    if (d.canVerify !== undefined) {
      sets.push('can_verify = ?');
      values.push(d.canVerify ? 1 : 0);
    }
    if (d.latitude !== undefined) {
      sets.push('latitude = ?');
      values.push(d.latitude);
    }
    if (d.longitude !== undefined) {
      sets.push('longitude = ?');
      values.push(d.longitude);
    }
    if (d.storeImages !== undefined) {
      sets.push('store_images = ?');
      values.push(JSON.stringify(d.storeImages));
    }

    values.push(id);
    try {
      await getPool().query(
        `UPDATE ${swTable('merchant')} SET ${sets.join(', ')} WHERE id = ?`,
        values
      );
    } catch (error) {
      if (error.code === 'ER_BAD_FIELD_ERROR') {
        return fail(reply, 503, '请先执行 admin-r2 DDL 扩展 sw_merchant 字段');
      }
      throw error;
    }

    const session = getAdminSession(request);
    await audit.write({
      adminUsername: session?.username || '',
      action: 'merchant_update',
      targetType: 'merchant',
      targetId: id,
      payload: parsed.data,
      ip: getClientIp(request)
    });

    const [[row]] = await getPool().query(`SELECT * FROM ${swTable('merchant')} WHERE id = ?`, [id]);
    return ok(mapMerchant(row), '商家信息已更新');
  });

  app.patch('/api/admin/merchant/:id/deactivate', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number(request.params.id);
    const [[existing]] = await getPool().query(
      `SELECT id, merchant_name FROM ${swTable('merchant')} WHERE id = ? AND is_active = 1 LIMIT 1`,
      [id]
    );
    if (!existing) return fail(reply, 404, '商家不存在或已停用');

    const now = Math.floor(Date.now() / 1000);
    await getPool().query(
      `UPDATE ${swTable('merchant')} SET is_active = 0, can_verify = 0, updated_at = ? WHERE id = ?`,
      [now, id]
    );

    const session = getAdminSession(request);
    await audit.write({
      adminUsername: session?.username || '',
      action: 'merchant_deactivate',
      targetType: 'merchant',
      targetId: id,
      payload: { merchantName: existing.merchant_name },
      ip: getClientIp(request)
    });

    return ok({ id }, '商家已停用');
  });

  app.get('/api/admin/merchant/:id/verify-logs', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    await ensureCashVoucherReversalSchema();
    const id = Number(request.params.id);
    const page = Math.max(1, Number(request.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    const dateFrom = request.query.dateFrom
      ? Math.floor(new Date(`${String(request.query.dateFrom)}T00:00:00`).getTime() / 1000)
      : null;
    const dateTo = request.query.dateTo
      ? Math.floor(new Date(`${String(request.query.dateTo)}T23:59:59`).getTime() / 1000)
      : null;

    const conditions = ['merchant_id = ?', 'direction = 0'];
    const values = [id];
    if (dateFrom) {
      conditions.push('created_at >= ?');
      values.push(dateFrom);
    }
    if (dateTo) {
      conditions.push('created_at <= ?');
      values.push(dateTo);
    }
    const where = conditions.join(' AND ');

    const [[countRow]] = await getPool().query(
      `SELECT COUNT(DISTINCT biz_id) AS total FROM ${swTable('cash_voucher_ledger')} WHERE ${where}`,
      values
    );
    const [rows] = await getPool().query(
      `SELECT MIN(id) AS id, uid AS customerUid, SUM(amount) AS amount,
              operator_uid AS operatorUid, biz_id AS bizId, MAX(remark) AS remark,
              MIN(created_at) AS createdAt, MAX(reversed_at) AS reversedAt,
              MAX(reversed_by) AS reversedBy, MAX(reversal_reason) AS reversalReason
       FROM ${swTable('cash_voucher_ledger')}
       WHERE ${where}
       GROUP BY biz_id, uid, operator_uid
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );

    return ok({
      total: Number(countRow?.total || 0),
      page,
      pageSize,
      list: rows.map((r) => ({
        id: r.id,
        customerUid: r.customerUid,
        amount: Number(r.amount),
        operatorUid: Number(r.operatorUid || 0),
        bizId: r.bizId || '',
        remark: r.remark || '',
        createdAt: Number(r.createdAt),
        reversedAt: Number(r.reversedAt || 0),
        reversedBy: r.reversedBy || '',
        reversalReason: r.reversalReason || '',
        status: Number(r.reversedAt || 0) > 0 ? 'reversed' : 'active'
      }))
    });
  });

  app.post('/api/admin/merchant/verify-logs/:bizId/reverse', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const bizId = String(request.params.bizId || '').trim();
    if (!bizId || bizId.length > 64) return fail(reply, 400, '核销业务单号无效');
    const parsed = reverseVerifySchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '请填写撤回原因', parsed.error.flatten());

    const session = getAdminSession(request);
    try {
      const result = await cashVoucherReversalService.reverse({
        bizId,
        reason: parsed.data.reason,
        adminUsername: session?.username || ''
      });
      try {
        await audit.write({
          adminUsername: session?.username || '',
          action: 'cash_voucher_verify_reverse',
          targetType: 'cash_voucher_verify',
          targetId: bizId,
          payload: result,
          ip: getClientIp(request)
        });
      } catch (auditError) {
        request.log.error({ err: auditError, bizId }, 'failed to write reversal audit log');
      }
      return ok(result, `已撤回核销 ¥${result.amount}`);
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '撤回核销失败');
    }
  });

  app.get('/api/admin/merchant/:id/staff-verify-stats', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    await staffService.ensureTable();
    const id = Number(request.params.id);
    const period = String(request.query.period || 'day');
    const dateFrom = request.query.dateFrom
      ? Math.floor(new Date(`${String(request.query.dateFrom)}T00:00:00`).getTime() / 1000)
      : Math.floor(Date.now() / 1000) - 30 * 86400;
    const dateTo = request.query.dateTo
      ? Math.floor(new Date(`${String(request.query.dateTo)}T23:59:59`).getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    let dateFmt;
    if (period === 'month') dateFmt = '%Y-%m';
    else if (period === 'week') dateFmt = '%x-W%v';
    else dateFmt = '%Y-%m-%d';

    const [rows] = await getPool().query(
      `SELECT l.operator_uid,
              u.nickname AS operator_name,
              DATE_FORMAT(FROM_UNIXTIME(l.created_at), ?) AS period_label,
              COUNT(DISTINCT l.biz_id) AS verify_count,
              COALESCE(SUM(l.amount), 0) AS total_amount
       FROM ${swTable('cash_voucher_ledger')} l
       LEFT JOIN ${legacyTable('user')} u ON u.uid = l.operator_uid
       WHERE l.merchant_id = ? AND l.direction = 0 AND l.reversed_at = 0
         AND l.created_at >= ? AND l.created_at <= ?
       GROUP BY l.operator_uid, period_label
       ORDER BY period_label DESC, total_amount DESC`,
      [dateFmt, id, dateFrom, dateTo]
    );

    const staffMap = new Map();
    const periods = new Set();
    for (const r of rows) {
      periods.add(r.period_label);
      const uid = Number(r.operator_uid || 0);
      if (!staffMap.has(uid)) {
        staffMap.set(uid, {
          operatorUid: uid,
          operatorName: r.operator_name || `UID:${uid}`,
          role: 'staff',
          phone: '',
          isOwner: false,
          totalCount: 0,
          totalAmount: 0,
          details: []
        });
      }
      const s = staffMap.get(uid);
      s.totalCount += Number(r.verify_count);
      s.totalAmount += Number(r.total_amount);
      s.details.push({
        period: r.period_label,
        count: Number(r.verify_count),
        amount: Number(r.total_amount)
      });
    }

    // 合入完整核销员花名册（店长/店员 + 商家绑定账号）——即使本期无核销记录也要显示，
    // 便于超管看清该商家共几名核销员、是否已设负责人。
    const [[merchant]] = await getPool().query(
      `SELECT id, login_uid FROM ${swTable('merchant')} WHERE id = ? LIMIT 1`,
      [id]
    );
    const rosterRows = merchant
      ? (await getPool().query(
          `SELECT ms.staff_uid, ms.role, u.nickname, u.phone
           FROM ${swTable('merchant_staff')} ms
           LEFT JOIN ${legacyTable('user')} u ON u.uid = ms.staff_uid
           WHERE ms.merchant_id = ? AND ms.is_active = 1`,
          [id]
        ))[0]
      : [];
    const ownerUid = Number(merchant?.login_uid || 0);
    const applyRoster = (uid, role, nickname, phone, isOwner) => {
      if (!uid) return;
      if (staffMap.has(uid)) {
        const s = staffMap.get(uid);
        s.role = role === 'manager' ? 'manager' : s.role;
        if (!s.phone && phone) s.phone = phone;
        if (isOwner) s.isOwner = true;
        if ((!s.operatorName || /^UID:/.test(s.operatorName)) && nickname) s.operatorName = nickname;
        return;
      }
      staffMap.set(uid, {
        operatorUid: uid,
        operatorName: nickname || `UID:${uid}`,
        role: role === 'manager' ? 'manager' : 'staff',
        phone: phone || '',
        isOwner: !!isOwner,
        totalCount: 0,
        totalAmount: 0,
        details: []
      });
    };
    for (const r of rosterRows) {
      applyRoster(Number(r.staff_uid || 0), r.role, r.nickname, r.phone, false);
    }
    // 商家绑定账号（login_uid）视为负责人；若花名册没有则补进来
    if (ownerUid) {
      if (staffMap.has(ownerUid)) {
        applyRoster(ownerUid, 'manager', '', '', true);
      } else {
        const [[ownerUser]] = await getPool().query(
          `SELECT uid, nickname, phone FROM ${legacyTable('user')} WHERE uid = ? LIMIT 1`,
          [ownerUid]
        );
        applyRoster(ownerUid, 'manager', ownerUser?.nickname || '', ownerUser?.phone || '', true);
      }
    }

    const staff = [...staffMap.values()].sort((a, b) => {
      // 负责人置顶，其次按核销金额倒序
      const am = a.role === 'manager' ? 1 : 0;
      const bm = b.role === 'manager' ? 1 : 0;
      if (am !== bm) return bm - am;
      return b.totalAmount - a.totalAmount;
    });
    const managerCount = staff.filter((s) => s.role === 'manager').length;

    return ok({
      period,
      dateFrom: new Date(dateFrom * 1000).toISOString().slice(0, 10),
      dateTo: new Date(dateTo * 1000).toISOString().slice(0, 10),
      periods: [...periods].sort().reverse(),
      staffCount: staff.length,
      managerCount,
      hasManager: managerCount > 0,
      staff
    });
  });

  app.get('/api/admin/merchant/settlement-summary', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const [[row]] = await getPool().query(
      `SELECT COALESCE(SUM(pending_settlement),0) AS pendingTotal,
              COALESCE(SUM(settled_total),0) AS settledTotal,
              COUNT(*) AS merchantCount
       FROM ${swTable('merchant')} WHERE is_active = 1`
    );
    return ok({
      pendingTotal: Number(row?.pendingTotal || 0),
      settledTotal: Number(row?.settledTotal || 0),
      merchantCount: Number(row?.merchantCount || 0)
    });
  });

  app.get('/api/admin/merchant/overview', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    await staffService.ensureTable();

    const dayStart = dayStartTs();
    const monthStart = monthStartTs();
    const ledger = swTable('cash_voucher_ledger');

    const [[mRow]] = await getPool().query(
      `SELECT COUNT(*) AS merchantCount,
              COALESCE(SUM(pending_settlement), 0) AS pendingTotal,
              COALESCE(SUM(settled_total), 0) AS settledTotal
       FROM ${swTable('merchant')} WHERE is_active = 1`
    );

    const [[sRow]] = await getPool().query(
      `SELECT COUNT(DISTINCT ms.staff_uid) AS staffCount
       FROM ${swTable('merchant_staff')} ms
       JOIN ${swTable('merchant')} m ON m.id = ms.merchant_id AND m.is_active = 1
       WHERE ms.is_active = 1`
    );

    const [[tRow]] = await getPool().query(
      `SELECT COUNT(DISTINCT l.biz_id) AS todayCount,
              COALESCE(SUM(l.amount), 0) AS todayAmount,
              COUNT(DISTINCT l.operator_uid) AS todayActiveStaff
       FROM ${ledger} l
       JOIN ${swTable('merchant')} m ON m.id = l.merchant_id AND m.is_active = 1
       WHERE l.direction = 0 AND l.reversed_at = 0 AND l.created_at >= ?`,
      [dayStart]
    );

    const [[monthRow]] = await getPool().query(
      `SELECT COUNT(DISTINCT l.biz_id) AS monthCount,
              COALESCE(SUM(l.amount), 0) AS monthAmount
       FROM ${ledger} l
       JOIN ${swTable('merchant')} m ON m.id = l.merchant_id AND m.is_active = 1
       WHERE l.direction = 0 AND l.reversed_at = 0 AND l.created_at >= ?`,
      [monthStart]
    );

    const [catRows] = await getPool().query(
      `SELECT DISTINCT category FROM ${swTable('merchant')}
       WHERE is_active = 1 AND category <> '' ORDER BY category`
    );

    return ok({
      merchantCount: Number(mRow?.merchantCount || 0),
      staffCount: Number(sRow?.staffCount || 0),
      todayCount: Number(tRow?.todayCount || 0),
      todayAmount: Number(tRow?.todayAmount || 0),
      todayActiveStaff: Number(tRow?.todayActiveStaff || 0),
      monthCount: Number(monthRow?.monthCount || 0),
      monthAmount: Number(monthRow?.monthAmount || 0),
      pendingTotal: Number(mRow?.pendingTotal || 0),
      settledTotal: Number(mRow?.settledTotal || 0),
      categories: catRows.map((r) => String(r.category || '')).filter(Boolean)
    });
  });

  app.get('/api/admin/merchant/staff-leaderboard', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const period = ['day', 'week', 'month'].includes(String(request.query.period))
      ? String(request.query.period)
      : 'day';
    const merchantId = request.query.merchantId ? Number(request.query.merchantId) : 0;
    const limit = Math.min(200, Math.max(1, Number(request.query.limit || 50)));

    let rangeStart;
    const now = new Date();
    if (period === 'month') {
      rangeStart = monthStartTs(now);
    } else if (period === 'week') {
      const weekStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      weekStartDate.setDate(weekStartDate.getDate() - ((weekStartDate.getDay() + 6) % 7));
      rangeStart = Math.floor(weekStartDate.getTime() / 1000);
    } else {
      rangeStart = dayStartTs(now);
    }
    const customFrom = request.query.dateFrom
      ? Math.floor(new Date(`${String(request.query.dateFrom)}T00:00:00`).getTime() / 1000)
      : null;
    const customTo = request.query.dateTo
      ? Math.floor(new Date(`${String(request.query.dateTo)}T23:59:59`).getTime() / 1000)
      : null;
    const startTs = customFrom !== null ? customFrom : rangeStart;
    const endTs = customTo !== null ? customTo : Math.floor(Date.now() / 1000);

    const ledger = swTable('cash_voucher_ledger');
    const conditions = ['l.direction = 0', 'l.reversed_at = 0', 'l.created_at >= ?', 'l.created_at <= ?', 'm.is_active = 1'];
    const values = [startTs, endTs];
    if (merchantId) {
      conditions.push('l.merchant_id = ?');
      values.push(merchantId);
    }
    const where = conditions.join(' AND ');

    const [rows] = await getPool().query(
      `SELECT l.operator_uid,
              l.merchant_id,
              m.merchant_name,
              u.nickname AS operator_name,
              COUNT(DISTINCT l.biz_id) AS verify_count,
              COALESCE(SUM(l.amount), 0) AS total_amount,
              MAX(l.created_at) AS last_verify_at
       FROM ${ledger} l
       JOIN ${swTable('merchant')} m ON m.id = l.merchant_id
       LEFT JOIN ${legacyTable('user')} u ON u.uid = l.operator_uid
       WHERE ${where}
       GROUP BY l.operator_uid, l.merchant_id
       ORDER BY total_amount DESC
       LIMIT ?`,
      [...values, limit]
    );

    const list = rows.map((r, idx) => ({
      rank: idx + 1,
      operatorUid: Number(r.operator_uid || 0),
      operatorName: r.operator_name || `UID:${Number(r.operator_uid || 0)}`,
      merchantId: Number(r.merchant_id || 0),
      merchantName: r.merchant_name || '',
      verifyCount: Number(r.verify_count || 0),
      totalAmount: Number(r.total_amount || 0),
      lastVerifyAt: Number(r.last_verify_at || 0)
    }));

    return ok({
      period,
      merchantId,
      dateFrom: new Date(startTs * 1000).toISOString().slice(0, 10),
      dateTo: new Date(endTs * 1000).toISOString().slice(0, 10),
      totalCount: list.reduce((sum, r) => sum + r.verifyCount, 0),
      totalAmount: list.reduce((sum, r) => sum + r.totalAmount, 0),
      list
    });
  });

  // ========== 后台手动核销现金券（小程序故障时的兜底入口）==========

  // 查询客户现金券余额（用于手动核销前确认对象）
  app.get('/api/admin/cash-voucher/lookup', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.query.uid || 0);
    if (!uid || uid <= 0) return fail(reply, 400, '请输入有效的客户 UID');
    try {
      const [[user]] = await getPool().query(
        `SELECT uid, nickname, phone FROM ${legacyTable('user')}
         WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
        [uid]
      );
      if (!user) return fail(reply, 404, '客户不存在');
      const wallet = await cashVoucherService.getWallet(uid);
      return ok({
        uid: Number(user.uid),
        nickname: user.nickname || '',
        phone: user.phone || '',
        balance: Number(wallet.balance || 0),
        batchCount: Number(wallet.batchCount || 0)
      });
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '客户查询失败');
    }
  });

  // 查询某商家的可选核销员（店长 + 店员 + 绑定账号）
  app.get('/api/admin/merchant/:id/verify-staff', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const merchantId = Number(request.params.id);
    if (!merchantId) return fail(reply, 400, '商家 ID 无效');
    await staffService.ensureTable();

    const [[merchant]] = await getPool().query(
      `SELECT id, merchant_name, login_uid FROM ${swTable('merchant')} WHERE id = ? LIMIT 1`,
      [merchantId]
    );
    if (!merchant) return fail(reply, 404, '商家不存在');

    const [rows] = await getPool().query(
      `SELECT ms.staff_uid, ms.role, u.nickname, u.phone
       FROM ${swTable('merchant_staff')} ms
       LEFT JOIN ${legacyTable('user')} u ON u.uid = ms.staff_uid
       WHERE ms.merchant_id = ? AND ms.is_active = 1
       ORDER BY ms.role = 'manager' DESC, ms.id ASC`,
      [merchantId]
    );

    const staffMap = new Map();
    for (const r of rows) {
      const uid = Number(r.staff_uid || 0);
      if (!uid) continue;
      staffMap.set(uid, {
        uid,
        role: r.role === 'manager' ? 'manager' : 'staff',
        nickname: r.nickname || `UID:${uid}`,
        phone: r.phone || ''
      });
    }

    // 商家绑定账号（login_uid）若不在核销员表中也补进来，作为店长
    const ownerUid = Number(merchant.login_uid || 0);
    if (ownerUid && !staffMap.has(ownerUid)) {
      const [[ownerUser]] = await getPool().query(
        `SELECT uid, nickname, phone FROM ${legacyTable('user')} WHERE uid = ? LIMIT 1`,
        [ownerUid]
      );
      staffMap.set(ownerUid, {
        uid: ownerUid,
        role: 'manager',
        nickname: ownerUser?.nickname || `UID:${ownerUid}`,
        phone: ownerUser?.phone || ''
      });
    }

    return ok({
      merchantId,
      merchantName: merchant.merchant_name || '',
      list: [...staffMap.values()]
    });
  });

  // 执行手动核销：复用与小程序完全一致的核销事务
  app.post('/api/admin/cash-voucher/manual-verify', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = manualVerifySchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const { uid, amount, merchantId, operatorUid, remark } = parsed.data;
    const session = getAdminSession(request);

    // 校验商家有效且具备核销权限
    const [[merchant]] = await getPool().query(
      `SELECT id, merchant_name, login_uid, can_verify, is_active FROM ${swTable('merchant')} WHERE id = ? LIMIT 1`,
      [merchantId]
    );
    if (!merchant || Number(merchant.is_active) !== 1) {
      return fail(reply, 404, '商家不存在或已停用');
    }
    if (Number(merchant.can_verify) !== 1) {
      return fail(reply, 400, '该商家未开通核销权限');
    }

    // 校验核销员属于该商家（核销员表中存在，或为商家绑定账号）
    await staffService.ensureTable();
    const [[staffRow]] = await getPool().query(
      `SELECT id FROM ${swTable('merchant_staff')}
       WHERE merchant_id = ? AND staff_uid = ? AND is_active = 1 LIMIT 1`,
      [merchantId, operatorUid]
    );
    const isOwner = Number(merchant.login_uid || 0) === operatorUid;
    if (!staffRow && !isOwner) {
      return fail(reply, 400, '所选核销员不属于该商家');
    }

    const finalRemark = remark || `后台手动核销（操作管理员：${session?.username || '-'}）`;
    try {
      const result = await cashVoucherService.verify(uid, amount, operatorUid, merchantId, finalRemark);
      await audit.write({
        adminUsername: session?.username || '',
        action: 'cash_voucher_manual_verify',
        targetType: 'user',
        targetId: uid,
        payload: {
          uid,
          amount: result.amount,
          merchantId,
          merchantName: merchant.merchant_name || '',
          operatorUid,
          bizId: result.bizId,
          balanceAfter: result.balanceAfter,
          remark: finalRemark
        },
        ip: getClientIp(request)
      });
      return ok(result, '手动核销成功');
    } catch (error) {
      await audit.write({
        adminUsername: session?.username || '',
        action: 'cash_voucher_manual_verify',
        targetType: 'user',
        targetId: uid,
        payload: { uid, amount, merchantId, operatorUid, remark: finalRemark },
        resultStatus: 'failed',
        resultMessage: error.message,
        ip: getClientIp(request)
      });
      return fail(reply, error.statusCode || 500, error.message || '手动核销失败');
    }
  });
}

module.exports = { registerAdminMerchantRoutes, ensureMerchantSortColumn };
