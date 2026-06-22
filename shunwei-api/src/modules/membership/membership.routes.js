const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { isDatabaseConnectionError } = require('../../shared/mysql');
const { requireAdmin } = require('../admin/admin.auth');
const { MembershipService } = require('./membership.service');

const claimGiftSchema = z.object({
  tierCode: z.enum(['SW199', 'SW299', 'tier_199', 'tier_299']),
  channel: z.enum(['wechat_pay', 'offline_approval', 'admin']),
  refId: z.string().trim().min(1).max(64),
  memberShipId: z.coerce.number().int().positive().optional()
});

const adminGrantSchema = z.object({
  uid: z.coerce.number().int().positive(),
  tierCode: z.enum(['SW199', 'SW299', 'tier_199', 'tier_299']),
  refId: z.string().trim().min(1).max(64).optional(),
  memberShipId: z.coerce.number().int().positive().optional()
});

const skipApprovalSchema = z.object({
  enabled: z.boolean()
});

const planCreateSchema = z.object({
  tierCode: z.string().trim().min(1).max(16),
  title: z.string().trim().min(1).max(64),
  price: z.coerce.number().min(0).max(999999),
  vipDays: z.coerce.number().int().min(0).max(36500),
  giftIntegral: z.coerce.number().int().min(0).max(99999999),
  memberShipId: z.coerce.number().int().min(0).max(99999999).optional().default(0),
  tierRank: z.coerce.number().int().min(0).max(255).optional().default(0),
  sort: z.coerce.number().int().min(-9999).max(9999).optional().default(0),
  isActive: z.boolean().optional().default(true)
});

const planUpdateSchema = planCreateSchema.partial();

const planIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

function registerMembershipRoutes(app) {
  const service = new MembershipService();

  app.get('/api/membership/plans', async (request, reply) => {
    try {
      const plans = await service.getPlans();
      return ok(plans);
    } catch (error) {
      return failMembership(reply, error);
    }
  });

  app.get('/api/membership/me', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const data = await service.getMe(request.auth.uid);
      return ok(data);
    } catch (error) {
      return failMembership(reply, error);
    }
  });

  app.post('/api/membership/claim-gift', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const parsed = claimGiftSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const result = await service.claimGift(request.auth.uid, parsed.data);
      return ok(result, result.duplicate ? '已领取过' : '领取成功');
    } catch (error) {
      return failMembership(reply, error);
    }
  });

  app.get('/api/integral/log', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const page = Math.max(1, Number(request.query.page || 1));
      const limit = Math.min(50, Math.max(1, Number(request.query.limit || 20)));
      const offset = (page - 1) * limit;

      const { getPool, legacyTable } = require('../../shared/mysql');
      const pool = getPool();

      const [[countRow]] = await pool.query(
        `SELECT COUNT(*) AS total FROM ${legacyTable('user_bill')}
         WHERE uid = ? AND category = 'integral' AND status = 1`,
        [request.auth.uid]
      );

      const [rows] = await pool.query(
        `SELECT link_id, pm, title, number, balance, mark, add_time
         FROM ${legacyTable('user_bill')}
         WHERE uid = ? AND category = 'integral' AND status = 1
         ORDER BY add_time DESC
         LIMIT ? OFFSET ?`,
        [request.auth.uid, limit, offset]
      );

      return ok({
        list: rows.map(r => ({
          title: r.title || r.mark || '积分变动',
          number: Number(r.number || 0),
          pm: Number(r.pm || 0),
          balance: Number(r.balance || 0),
          mark: r.mark || '',
          add_time: Number(r.add_time || 0)
        })),
        total: Number(countRow?.total || 0),
        page,
        limit
      });
    } catch (error) {
      return failMembership(reply, error);
    }
  });

  app.get('/api/integral/summary', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const data = await service.getIntegralSummary(request.auth.uid);
      return ok(data);
    } catch (error) {
      return failMembership(reply, error);
    }
  });

  app.get('/api/admin/membership/config', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      return ok(await service.getAdminConfig());
    } catch (error) {
      return failMembership(reply, error);
    }
  });

  app.put('/api/admin/membership/config/integral-mall-skip-approval', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = skipApprovalSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const data = await service.updateSkipApproval(parsed.data.enabled);
      return ok(data, '已更新');
    } catch (error) {
      return failMembership(reply, error);
    }
  });

  app.post('/api/admin/membership/grant', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = adminGrantSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const result = await service.adminGrant(parsed.data);
      return ok(result, result.duplicate ? '已开通' : '开通成功');
    } catch (error) {
      return failMembership(reply, error);
    }
  });

  // ── 会员卡方案管理（甲-1：CRMEB 收款，fzlsaas 管方案）──
  app.get('/api/admin/membership/plans', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      return ok(await service.listPlansAdmin());
    } catch (error) {
      return failMembership(reply, error);
    }
  });

  app.post('/api/admin/membership/plans', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = planCreateSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    try {
      return ok(await service.createPlan(parsed.data), '方案已创建');
    } catch (error) {
      return failMembership(reply, error);
    }
  });

  app.put('/api/admin/membership/plans/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsedParams = planIdParamsSchema.safeParse(request.params || {});
    if (!parsedParams.success) return fail(reply, 400, '参数错误', parsedParams.error.flatten());
    const parsed = planUpdateSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    try {
      return ok(await service.updatePlan(parsedParams.data.id, parsed.data), '方案已更新');
    } catch (error) {
      return failMembership(reply, error);
    }
  });

  app.delete('/api/admin/membership/plans/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsedParams = planIdParamsSchema.safeParse(request.params || {});
    if (!parsedParams.success) return fail(reply, 400, '参数错误', parsedParams.error.flatten());
    try {
      return ok(await service.deletePlan(parsedParams.data.id), '方案已删除');
    } catch (error) {
      return failMembership(reply, error);
    }
  });

  app.get('/api/integral-mall/products', async (request, reply) => {
    try {
      const products = await listIntegralMallProducts();
      return ok(products);
    } catch (error) {
      return failMembership(reply, error);
    }
  });
}

async function listIntegralMallProducts() {
  const { getPool, legacyTable } = require('../../shared/mysql');
  const [rows] = await getPool().query(
    `
    SELECT id, image, title, price, unit_name, stock, is_show
    FROM ${legacyTable('store_integral')}
    WHERE is_del = 0 AND is_show = 1
    ORDER BY sort DESC, id DESC
    `
  );

  return rows.map((row) => ({
    id: row.id,
    image: row.image,
    title: row.title,
    price: Number(row.price || 0),
    unitName: row.unit_name || '',
    canExchange: Number(row.stock || 0) > 0,
    stockHint: Number(row.stock || 0) > 0 ? '' : '暂时无法兑换，过两天试试'
  }));
}

function failMembership(reply, error) {
  if (isDatabaseConnectionError(error)) {
    return fail(reply, 503, 'CRMEB 数据库未连接，请先启动 MySQL', {
      code: error.code,
      message: error.message
    });
  }
  return fail(reply, error.statusCode || 500, error.message || '会员服务异常');
}

module.exports = { registerMembershipRoutes };
