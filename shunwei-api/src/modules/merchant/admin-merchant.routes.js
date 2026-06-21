const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { getPool } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const { requireAdmin, getAdminSession } = require('../admin/admin.auth');
const { AdminAuditService, getClientIp } = require('../admin/admin-audit.service');

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  keyword: z.string().trim().max(64).optional().default('')
});

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

  app.get('/api/admin/merchant/list', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = listQuerySchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const { page, pageSize, keyword } = parsed.data;
    const conditions = ['is_active = 1'];
    const values = [];
    if (keyword) {
      conditions.push('(merchant_name LIKE ? OR contact_name LIKE ? OR contact_phone LIKE ?)');
      values.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    const where = conditions.join(' AND ');
    const offset = (page - 1) * pageSize;

    const [[countRow]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM ${swTable('merchant')} WHERE ${where}`,
      values
    );
    const [rows] = await getPool().query(
      `SELECT m.*,
              (SELECT MAX(l.created_at) FROM ${swTable('cash_voucher_ledger')} l
               WHERE l.merchant_id = m.id AND l.direction = 0) AS last_verify_at
       FROM ${swTable('merchant')} m
       WHERE ${where.replace(/\bis_active\b/g, 'm.is_active')}
       ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );

    return ok({
      total: Number(countRow?.total || 0),
      page,
      pageSize,
      list: rows.map((row) => ({
        ...mapMerchant(row),
        lastVerifyAt: Number(row.last_verify_at || 0)
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
}

module.exports = { registerAdminMerchantRoutes };
