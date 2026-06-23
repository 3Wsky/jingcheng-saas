const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const { requireAdmin, getAdminSession } = require('../admin/admin.auth');
const { AdminAuditService, getClientIp } = require('../admin/admin-audit.service');
const { AdminMerchantStaffService } = require('./admin-merchant-staff.service');

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  keyword: z.string().trim().max(64).optional().default(''),
  category: z.string().trim().max(64).optional().default(''),
  sortBy: z.enum(['id', 'todayAmount', 'monthAmount', 'staffActive', 'staffBound', 'pending', 'lastVerify']).optional().default('id'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
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

  app.get('/api/admin/merchant/list', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = listQuerySchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const { page, pageSize, keyword, category, sortBy, sortOrder } = parsed.data;
    await staffService.ensureTable();
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
      id: 'm.id',
      todayAmount: 'today_amount',
      monthAmount: 'month_amount',
      staffActive: 'staff_active',
      staffBound: 'staff_bound',
      pending: 'm.pending_settlement',
      lastVerify: 'last_verify_at'
    };
    const orderCol = sortColumnMap[sortBy] || 'm.id';
    const orderDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const [[countRow]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM ${swTable('merchant')} m WHERE ${where}`,
      values
    );
    const [rows] = await getPool().query(
      `SELECT m.*,
              (SELECT MAX(l.created_at) FROM ${ledger} l
               WHERE l.merchant_id = m.id AND l.direction = 0) AS last_verify_at,
              (SELECT COUNT(*) FROM ${ledger} l
               WHERE l.merchant_id = m.id AND l.direction = 0 AND l.created_at >= ?) AS today_count,
              (SELECT COALESCE(SUM(l.amount), 0) FROM ${ledger} l
               WHERE l.merchant_id = m.id AND l.direction = 0 AND l.created_at >= ?) AS today_amount,
              (SELECT COALESCE(SUM(l.amount), 0) FROM ${ledger} l
               WHERE l.merchant_id = m.id AND l.direction = 0 AND l.created_at >= ?) AS month_amount,
              (SELECT COUNT(*) FROM ${staffTbl} ms
               WHERE ms.merchant_id = m.id AND ms.is_active = 1) AS staff_bound,
              (SELECT COUNT(DISTINCT l.operator_uid) FROM ${ledger} l
               WHERE l.merchant_id = m.id AND l.direction = 0 AND l.created_at >= ?) AS staff_active
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

  app.get('/api/admin/merchant/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number(request.params.id);
    const [[row]] = await getPool().query(
      `SELECT * FROM ${swTable('merchant')} WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!row) return fail(reply, 404, '商家不存在');
    return ok(mapMerchant(row));
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
      `SELECT COUNT(*) AS total FROM ${swTable('cash_voucher_ledger')} WHERE ${where}`,
      values
    );
    const [rows] = await getPool().query(
      `SELECT id, uid AS customerUid, amount, operator_uid AS operatorUid, biz_id AS bizId, remark, created_at AS createdAt
       FROM ${swTable('cash_voucher_ledger')}
       WHERE ${where}
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
        settlementStatus: 'pending'
      }))
    });
  });

  app.get('/api/admin/merchant/:id/staff-verify-stats', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
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
              COUNT(*) AS verify_count,
              COALESCE(SUM(l.amount), 0) AS total_amount
       FROM ${swTable('cash_voucher_ledger')} l
       LEFT JOIN ${legacyTable('user')} u ON u.uid = l.operator_uid
       WHERE l.merchant_id = ? AND l.direction = 0
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

    return ok({
      period,
      dateFrom: new Date(dateFrom * 1000).toISOString().slice(0, 10),
      dateTo: new Date(dateTo * 1000).toISOString().slice(0, 10),
      periods: [...periods].sort().reverse(),
      staff: [...staffMap.values()].sort((a, b) => b.totalAmount - a.totalAmount)
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
      `SELECT COUNT(*) AS todayCount,
              COALESCE(SUM(l.amount), 0) AS todayAmount,
              COUNT(DISTINCT l.operator_uid) AS todayActiveStaff
       FROM ${ledger} l
       JOIN ${swTable('merchant')} m ON m.id = l.merchant_id AND m.is_active = 1
       WHERE l.direction = 0 AND l.created_at >= ?`,
      [dayStart]
    );

    const [[monthRow]] = await getPool().query(
      `SELECT COUNT(*) AS monthCount,
              COALESCE(SUM(l.amount), 0) AS monthAmount
       FROM ${ledger} l
       JOIN ${swTable('merchant')} m ON m.id = l.merchant_id AND m.is_active = 1
       WHERE l.direction = 0 AND l.created_at >= ?`,
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
    const conditions = ['l.direction = 0', 'l.created_at >= ?', 'l.created_at <= ?', 'm.is_active = 1'];
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
              COUNT(*) AS verify_count,
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
}

module.exports = { registerAdminMerchantRoutes };
