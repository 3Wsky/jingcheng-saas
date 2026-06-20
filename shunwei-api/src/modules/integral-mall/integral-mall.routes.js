const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { isDatabaseConnectionError } = require('../../shared/mysql');
const { config } = require('../../shared/config');
const { MembershipService } = require('../membership/membership.service');
const { IntegralMallService } = require('./integral-mall.service');

const verifySchema = z.object({
  orderId: z.string().trim().min(1).max(64)
});

const payCallbackSchema = z.object({
  uid: z.coerce.number().int().positive(),
  memberShipId: z.coerce.number().int().positive(),
  orderId: z.string().trim().min(1).max(64),
  payPrice: z.coerce.number().optional()
});

function registerIntegralMallRoutes(app) {
  const mallService = new IntegralMallService();
  const membershipService = new MembershipService();

  app.get('/api/staff/me', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const { getPool, legacyTable } = require('../../shared/mysql');
      const [[user]] = await getPool().query(
        `SELECT uid, nickname, avatar, is_staff, division_id
         FROM ${legacyTable('user')}
         WHERE uid = ? AND COALESCE(is_del,0) = 0 LIMIT 1`,
        [request.auth.uid]
      );
      if (!user) return fail(reply, 404, '用户不存在');
      const { swTable } = require('../../shared/sw-mysql');
      let isManager = 0;
      try {
        const [[mgr]] = await getPool().query(
          `SELECT 1 AS v FROM ${swTable('store_manager')}
           WHERE manager_uid = ? AND is_active = 1 LIMIT 1`,
          [user.uid]
        );
        isManager = mgr ? 1 : 0;
      } catch { /* ignore */ }
      return ok({
        uid: user.uid,
        nickname: user.nickname || '',
        avatar: user.avatar || '',
        is_staff: Number(user.is_staff || 0),
        is_manager: isManager,
        division_id: Number(user.division_id || 0)
      });
    } catch (error) {
      return failMall(reply, error);
    }
  });

  app.get('/api/staff/verify-history', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const page = Math.max(1, Number(request.query.page || 1));
      const limit = Math.min(50, Math.max(1, Number(request.query.limit || 10)));
      const offset = (page - 1) * limit;

      const { getPool } = require('../../shared/mysql');
      const { swTable } = require('../../shared/sw-mysql');
      const [rows] = await getPool().query(
        `SELECT integral_order_id, order_id, product_id, uid, verify_code,
                verify_status, verified_at, created_at, remark
         FROM ${swTable('integral_mall_verify_log')}
         WHERE staff_uid = ?
         ORDER BY verified_at DESC
         LIMIT ? OFFSET ?`,
        [request.auth.uid, limit, offset]
      );

      return ok({
        list: rows.map(r => ({
          orderId: r.order_id,
          productId: r.product_id,
          customerUid: r.uid,
          verifyCode: r.verify_code || '',
          verifiedAt: Number(r.verified_at || 0),
          remark: r.remark || ''
        })),
        page,
        limit
      });
    } catch (error) {
      return failMall(reply, error);
    }
  });

  app.post('/api/staff/integral-mall/verify', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const parsed = verifySchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const data = await mallService.verifyPickup(request.auth.uid, parsed.data.orderId);
      return ok(data, '核销成功');
    } catch (error) {
      return failMall(reply, error);
    }
  });

  app.get('/api/staff/customer/:uid/benefits', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const customerUid = Number(request.params.uid);
    if (!customerUid) return fail(reply, 400, '客户 uid 无效');

    try {
      await mallService.assertStaff(request.auth.uid);
      const data = await mallService.getCustomerBenefits(customerUid);
      return ok(data);
    } catch (error) {
      return failMall(reply, error);
    }
  });

  app.post('/api/integral-mall/exchange', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');

    const schema = z.object({
      productId: z.coerce.number().int().positive()
    });
    const parsed = schema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const data = await mallService.exchange(request.auth.uid, parsed.data.productId);
      return ok(data, '兑换成功');
    } catch (error) {
      return failMall(reply, error);
    }
  });

  app.get('/api/integral-mall/orders', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const page = Math.max(1, Number(request.query.page || 1));
      const limit = Math.min(50, Math.max(1, Number(request.query.limit || 20)));
      const data = await mallService.listUserOrders(request.auth.uid, page, limit);
      return ok(data);
    } catch (error) {
      return failMall(reply, error);
    }
  });

  app.post('/api/integral-mall/verify-by-code', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const schema = z.object({
      verifyCode: z.string().trim().min(1).max(64)
    });
    const parsed = schema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const data = await mallService.verifyPickup(request.auth.uid, parsed.data.verifyCode);
      return ok(data, '核销成功');
    } catch (error) {
      return failMall(reply, error);
    }
  });

  app.post('/api/internal/membership/pay-callback', async (request, reply) => {
    const token = String(request.headers['x-internal-token'] || '');
    if (!token || token !== config.internal.token) {
      return fail(reply, 401, '内部回调鉴权失败');
    }

    const parsed = payCallbackSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const shipMap = await membershipService.repository.getShipMapByShipId(parsed.data.memberShipId);
      const tierCode = shipMap ? shipMap.tier_code : 'SW199';
      const result = await membershipService.claimGift(parsed.data.uid, {
        tierCode,
        channel: 'wechat_pay',
        refId: parsed.data.orderId,
        memberShipId: parsed.data.memberShipId
      });
      return ok(result, result.duplicate ? '已处理' : '开卡赠积分完成');
    } catch (error) {
      return failMall(reply, error);
    }
  });
}

function failMall(reply, error) {
  if (isDatabaseConnectionError(error)) {
    return fail(reply, 503, 'CRMEB 数据库未连接', { code: error.code, message: error.message });
  }
  return fail(reply, error.statusCode || 500, error.message || '积分商城服务异常');
}

module.exports = { registerIntegralMallRoutes };
