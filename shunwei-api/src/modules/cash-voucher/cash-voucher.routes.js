const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { isDatabaseConnectionError } = require('../../shared/mysql');
const { CashVoucherService } = require('./cash-voucher.service');

const verifySchema = z.object({
  uid: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  merchantId: z.coerce.number().int().min(0).optional().default(0),
  remark: z.string().trim().max(200).optional().default('')
});

function registerCashVoucherRoutes(app) {
  const service = new CashVoucherService();

  app.get('/api/cash-voucher/wallet', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      return ok(await service.getWallet(request.auth.uid));
    } catch (error) {
      return failCV(reply, error);
    }
  });

  app.get('/api/cash-voucher/ledger', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const page = Math.max(1, Number(request.query.page || 1));
      const limit = Math.min(50, Math.max(1, Number(request.query.limit || 20)));
      return ok(await service.getLedger(request.auth.uid, page, limit));
    } catch (error) {
      return failCV(reply, error);
    }
  });

  app.post('/api/cash-voucher/verify', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const parsed = verifySchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const result = await service.verify(
        parsed.data.uid,
        parsed.data.amount,
        request.auth.uid,
        parsed.data.merchantId,
        parsed.data.remark
      );
      return ok(result, '核销成功');
    } catch (error) {
      return failCV(reply, error);
    }
  });
}

function failCV(reply, error) {
  if (isDatabaseConnectionError(error)) {
    return fail(reply, 503, '数据库未连接', { code: error.code });
  }
  return fail(reply, error.statusCode || 500, error.message || '现金券服务异常');
}

module.exports = { registerCashVoucherRoutes };
