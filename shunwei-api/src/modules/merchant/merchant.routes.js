const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { getPool } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const { isDatabaseConnectionError } = require('../../shared/mysql');
const { CashVoucherService } = require('../cash-voucher/cash-voucher.service');

const verifySchema = z.object({
  customerUid: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  remark: z.string().trim().max(200).optional().default('')
});

function registerMerchantRoutes(app) {
  const cvService = new CashVoucherService();

  app.get('/api/merchant/me', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const merchant = await getMerchantByUid(request.auth.uid);
      if (!merchant) return fail(reply, 404, '未绑定商家账户');
      return ok(merchant);
    } catch (error) {
      return failMerchant(reply, error);
    }
  });

  app.post('/api/merchant/verify-voucher', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const parsed = verifySchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const merchant = await getMerchantByUid(request.auth.uid);
      if (!merchant) return fail(reply, 403, '未绑定商家账户');
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

  app.get('/api/merchant/settlement', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const merchant = await getMerchantByUid(request.auth.uid);
      if (!merchant) return fail(reply, 404, '未绑定商家账户');

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

async function getMerchantByUid(uid) {
  const [rows] = await getPool().query(
    `SELECT id, merchant_name, category, contact_name, contact_phone,
            login_uid, can_verify, pending_settlement, settled_total, is_active
     FROM ${swTable('merchant')}
     WHERE login_uid = ? AND is_active = 1
     LIMIT 1`,
    [uid]
  );
  return rows[0] || null;
}

function failMerchant(reply, error) {
  if (isDatabaseConnectionError(error)) {
    return fail(reply, 503, '数据库未连接', { code: error.code });
  }
  return fail(reply, error.statusCode || 500, error.message || '商家服务异常');
}

module.exports = { registerMerchantRoutes };
