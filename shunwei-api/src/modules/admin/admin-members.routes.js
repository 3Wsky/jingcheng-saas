const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { requireAdmin, getAdminSession } = require('./admin.auth');
const { AdminAuditService, getClientIp } = require('./admin-audit.service');
const { AdminMembersService } = require('./admin-members.service');
const { AdminMerchantStaffService } = require('../merchant/admin-merchant-staff.service');
const { IntegralService } = require('../integral/integral.service');

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  keyword: z.string().trim().max(64).optional().default(''),
  tag: z.string().trim().max(128).optional().default(''),
  searchType: z.enum(['all', 'uid', 'phone', 'nickname']).optional().default('all'),
  sortBy: z.string().optional().default('register_desc'),
  spreadUid: z.coerce.number().int().positive().optional(),
  unownedOnly: z.coerce.boolean().optional()
});

const staffRoleSchema = z.object({
  action: z.enum(['grant', 'revoke']),
  divisionId: z.coerce.number().int().optional(),
  storeName: z.string().trim().min(1).max(80).optional()
}).superRefine((data, ctx) => {
  if (data.action === 'grant' && !data.storeName && !data.divisionId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '开通店员需填写门店名称',
      path: ['storeName']
    });
  }
});

const spreadUpdateSchema = z.object({
  spreadUid: z.coerce.number().int().positive()
});

const batchSpreadSchema = z.object({
  spreadUid: z.coerce.number().int().positive(),
  uids: z.array(z.coerce.number().int().positive()).min(1).max(200),
  onlyUnowned: z.boolean().optional().default(true)
});

const integralGrantSchema = z.object({
  uid: z.coerce.number().int().positive(),
  amount: z.coerce.number().int().positive(),
  batchType: z.enum(['gift', 'adjust']).optional().default('gift'),
  expireDays: z.coerce.number().int().min(0).max(3650).optional(),
  remark: z.string().trim().max(200).optional().default('超管手动发放')
});

const merchantRoleSchema = z.object({
  action: z.enum(['grant', 'revoke']),
  merchantId: z.coerce.number().int().positive().optional(),
  role: z.enum(['staff', 'manager']).optional()
}).superRefine((data, ctx) => {
  if (data.action === 'grant' && (!data.merchantId || !data.role)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '开通商家角色需选择商家与角色', path: ['merchantId'] });
  }
  if (data.action === 'revoke' && !data.merchantId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '撤销商家角色需指定商家', path: ['merchantId'] });
  }
});

function registerAdminMembersRoutes(app) {
  const membersService = new AdminMembersService();
  const merchantStaffService = new AdminMerchantStaffService();
  const integralService = new IntegralService();
  const auditService = new AdminAuditService();

  app.get('/api/admin/merchant/options', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const list = await merchantStaffService.listMerchantOptions();
      return ok({ list });
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '商家列表加载失败');
    }
  });

  app.get('/api/admin/members/list', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = listQuerySchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      return ok(await membersService.list(parsed.data));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '会员列表加载失败');
    }
  });

  app.get('/api/admin/members/:uid/detail', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');

    try {
      return ok(await membersService.getDetail(uid));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '会员详情加载失败');
    }
  });

  app.put('/api/admin/members/:uid/spread', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');

    const parsed = spreadUpdateSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const session = getAdminSession(request);
    try {
      const result = await membersService.updateSpread(uid, parsed.data.spreadUid);
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'member_spread_update',
        targetType: 'user',
        targetId: uid,
        payload: { spreadUid: parsed.data.spreadUid, spreadNickname: result.spreadNickname },
        ip: getClientIp(request)
      });
      return ok(result, '归属店员已更新');
    } catch (error) {
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'member_spread_update',
        targetType: 'user',
        targetId: uid,
        payload: parsed.data,
        resultStatus: 'failed',
        resultMessage: error.message,
        ip: getClientIp(request)
      });
      return fail(reply, error.statusCode || 500, error.message || '归属更新失败');
    }
  });

  app.post('/api/admin/members/batch-spread', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = batchSpreadSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const session = getAdminSession(request);
    try {
      const result = await membersService.batchAssignSpread(
        parsed.data.spreadUid,
        parsed.data.uids,
        { onlyUnowned: parsed.data.onlyUnowned }
      );
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'member_spread_batch_update',
        targetType: 'user',
        targetId: parsed.data.spreadUid,
        payload: {
          spreadUid: parsed.data.spreadUid,
          uids: parsed.data.uids,
          onlyUnowned: parsed.data.onlyUnowned,
          success: result.success,
          failed: result.failed
        },
        ip: getClientIp(request)
      });
      return ok(result, `归属已更新：成功 ${result.success} / 失败 ${result.failed}`);
    } catch (error) {
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'member_spread_batch_update',
        targetType: 'user',
        targetId: parsed.data.spreadUid,
        payload: parsed.data,
        resultStatus: 'failed',
        resultMessage: error.message,
        ip: getClientIp(request)
      });
      return fail(reply, error.statusCode || 500, error.message || '批量归属更新失败');
    }
  });

  app.put('/api/admin/members/:uid/staff-role', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');

    const parsed = staffRoleSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const session = getAdminSession(request);
    try {
      const result = await membersService.updateStaffRole(
        uid,
        parsed.data.action,
        parsed.data.divisionId,
        parsed.data.storeName
      );
      await auditService.write({
        adminUsername: session?.username || '',
        action: parsed.data.action === 'grant' ? 'staff_role_grant' : 'staff_role_revoke',
        targetType: 'user',
        targetId: uid,
        payload: parsed.data,
        ip: getClientIp(request)
      });
      return ok(result, parsed.data.action === 'grant' ? '店员权限已开通' : '店员权限已撤销');
    } catch (error) {
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'staff_role_update',
        targetType: 'user',
        targetId: uid,
        payload: parsed.data,
        resultStatus: 'failed',
        resultMessage: error.message,
        ip: getClientIp(request)
      });
      return fail(reply, error.statusCode || 500, error.message || '店员权限更新失败');
    }
  });

  app.put('/api/admin/members/:uid/merchant-role', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');
    const parsed = merchantRoleSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    const session = getAdminSession(request);
    try {
      const result = await merchantStaffService.updateUserMerchantRole(
        uid,
        parsed.data.action,
        parsed.data.merchantId,
        parsed.data.role
      );
      await auditService.write({
        adminUsername: session?.username || '',
        action: parsed.data.action === 'grant' ? 'merchant_role_grant' : 'merchant_role_revoke',
        targetType: 'user',
        targetId: uid,
        payload: parsed.data,
        ip: getClientIp(request)
      });
      return ok(result, parsed.data.action === 'grant' ? '商家角色已开通' : '商家角色已撤销');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '商家角色更新失败');
    }
  });

  app.post('/api/admin/integral/grant', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = integralGrantSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const session = getAdminSession(request);
    const adminRef = `ADMIN${Date.now()}`;
    try {
      const result = await integralService.grantManual({
        ...parsed.data,
        adminRef,
        operatorUid: 0
      });
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'integral_grant',
        targetType: 'user',
        targetId: parsed.data.uid,
        payload: parsed.data,
        ip: getClientIp(request)
      });
      return ok(result, '积分发放成功');
    } catch (error) {
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'integral_grant',
        targetType: 'user',
        targetId: parsed.data.uid,
        payload: parsed.data,
        resultStatus: 'failed',
        resultMessage: error.message,
        ip: getClientIp(request)
      });
      return fail(reply, error.statusCode || 500, error.message || '积分发放失败');
    }
  });
}

module.exports = { registerAdminMembersRoutes };
