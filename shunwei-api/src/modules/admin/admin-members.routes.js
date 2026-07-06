const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { requireAdmin, getAdminSession } = require('./admin.auth');
const { AdminAuditService, getClientIp } = require('./admin-audit.service');
const { AdminMembersService } = require('./admin-members.service');
const { AdminMerchantStaffService } = require('../merchant/admin-merchant-staff.service');
const { IntegralService } = require('../integral/integral.service');
const { CashVoucherService } = require('../cash-voucher/cash-voucher.service');
const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  keyword: z.string().trim().max(64).optional().default(''),
  tag: z.string().trim().max(128).optional().default(''),
  dualRole: z.enum(['staff_verifier', 'manager_verifier', 'any']).optional(),
  multiRole: z.coerce.boolean().optional(),
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
  spreadUid: z.coerce.number().int().min(0)
});

const batchSpreadSchema = z.object({
  spreadUid: z.coerce.number().int().positive(),
  uids: z.array(z.coerce.number().int().positive()).min(1).max(200),
  onlyUnowned: z.boolean().optional().default(true)
});

const autoSpreadSchema = z.object({
  // 空/缺省 = 全部在职经理；非空 = 只分给勾选的这些经理
  managerUids: z.array(z.coerce.number().int().positive()).max(2000).optional()
});

const integralGrantSchema = z.object({
  uid: z.coerce.number().int().positive(),
  amount: z.coerce.number().int().positive(),
  batchType: z.enum(['gift', 'adjust']).optional().default('gift'),
  expireDays: z.coerce.number().int().min(0).max(3650).optional(),
  remark: z.string().trim().max(200).optional().default('超管手动发放')
});

const demoAssetsSchema = z.object({
  integralAmount: z.coerce.number().int().min(0).max(10000000).optional().default(299000),
  cashVoucherAmount: z.coerce.number().min(0).max(100000).optional().default(500),
  remark: z.string().trim().max(200).optional().default('拍摄演示')
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

const storeManagerSchema = z.object({
  action: z.enum(['grant', 'revoke']),
  divisionId: z.coerce.number().int().optional(),
  storeName: z.string().trim().min(1).max(80).optional()
});

function registerAdminMembersRoutes(app) {
  const membersService = new AdminMembersService();
  const merchantStaffService = new AdminMerchantStaffService();
  const integralService = new IntegralService();
  const cashVoucherService = new CashVoucherService();
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

  // 全部在职客户经理（供前端勾选列表）
  app.get('/api/admin/members/active-managers', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const managers = await membersService.listAllActiveManagers();
      return ok({ managers });
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '获取客户经理失败');
    }
  });

  // 预演：把全部无归属会员按"补齐式均衡"分给（全部或勾选的）在职客户经理（不落库）
  app.post('/api/admin/members/auto-spread/preview', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = autoSpreadSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    try {
      const result = await membersService.autoSpreadPreview(parsed.data.managerUids ?? null);
      return ok(result);
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '预演失败');
    }
  });

  // 执行：一键均衡分配（全部或勾选的经理），落库 + 审计
  app.post('/api/admin/members/auto-spread', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = autoSpreadSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    const managerUids = parsed.data.managerUids ?? null;
    const session = getAdminSession(request);
    try {
      const result = await membersService.autoSpreadAssign(managerUids);
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'member_spread_auto_assign',
        targetType: 'user',
        targetId: 'batch',
        payload: {
          scope: managerUids ? 'selected' : 'all',
          managerUids: managerUids || undefined,
          unownedTotal: result.unownedTotal,
          managerCount: result.managerCount,
          assignedTotal: result.assignedTotal,
          perManager: result.results
        },
        ip: getClientIp(request)
      });
      return ok(result, `已自动分配 ${result.assignedTotal} 名会员给 ${result.managerCount} 位客户经理`);
    } catch (error) {
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'member_spread_auto_assign',
        targetType: 'user',
        targetId: 'batch',
        resultStatus: 'failed',
        resultMessage: error.message,
        ip: getClientIp(request)
      });
      return fail(reply, error.statusCode || 500, error.message || '自动分配失败');
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

  app.put('/api/admin/members/:uid/store-manager', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');

    const parsed = storeManagerSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const session = getAdminSession(request);
    try {
      const result = await membersService.updateStoreManager(
        uid,
        parsed.data.action,
        { divisionId: parsed.data.divisionId, storeName: parsed.data.storeName, appointedBy: session?.uid || 0 }
      );
      await auditService.write({
        adminUsername: session?.username || '',
        action: parsed.data.action === 'grant' ? 'store_manager_grant' : 'store_manager_revoke',
        targetType: 'user',
        targetId: uid,
        payload: parsed.data,
        ip: getClientIp(request)
      });
      return ok(result, parsed.data.action === 'grant' ? '客户主管已设置' : '客户主管已撤销');
    } catch (error) {
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'store_manager_update',
        targetType: 'user',
        targetId: uid,
        payload: parsed.data,
        resultStatus: 'failed',
        resultMessage: error.message,
        ip: getClientIp(request)
      });
      return fail(reply, error.statusCode || 500, error.message || '客户主管更新失败');
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

  app.post('/api/admin/members/:uid/demo-assets', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');
    const parsed = demoAssetsSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const session = getAdminSession(request);
    const now = Math.floor(Date.now() / 1000);
    const result = { uid, integral: null, cashVoucher: null };
    try {
      const { integralAmount, cashVoucherAmount, remark } = parsed.data;
      if (integralAmount > 0) {
        const connection = await getPool().getConnection();
        try {
          await connection.beginTransaction();
          const [[user]] = await connection.query(
            `SELECT integral FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1 FOR UPDATE`,
            [uid]
          );
          if (!user) {
            const error = new Error('用户不存在');
            error.statusCode = 404;
            throw error;
          }
          const beforeIntegral = Number(user.integral || 0);
          const afterIntegral = beforeIntegral + integralAmount;
          const sourceId = `DEMO_INT_${now}_${uid}`;
          const expireAt = now + 7 * 86400;
          const [batch] = await connection.query(
            `INSERT INTO ${swTable('integral_batch')}
             (uid, batch_type, source_type, source_id, total_amount, remain_amount, expire_at, status, remark, created_at, updated_at)
             VALUES (?, 'gift', 'demo_video', ?, ?, ?, ?, 1, ?, ?, ?)`,
            [uid, sourceId, integralAmount, integralAmount, expireAt, `[演示]${remark || '拍摄演示'}`, now, now]
          );
          await connection.query(
            `UPDATE ${legacyTable('user')} SET integral = ? WHERE uid = ?`,
            [afterIntegral, uid]
          );
          await connection.query(
            `INSERT INTO ${swTable('integral_ledger')}
             (uid, direction, amount, balance_after, batch_id, biz_type, biz_id, remark, operator_uid, created_at)
             VALUES (?, 1, ?, ?, ?, 'demo', ?, ?, ?, ?)`,
            [uid, integralAmount, afterIntegral, batch.insertId, sourceId, `[演示]${remark || '拍摄演示'}积分`, session?.uid || 0, now]
          );
          await connection.commit();
          result.integral = { batchId: batch.insertId, amount: integralAmount, balanceAfter: afterIntegral, expireAt };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      }

      if (cashVoucherAmount > 0) {
        result.cashVoucher = await cashVoucherService.grantDemo(uid, cashVoucherAmount, remark || '拍摄演示');
      }

      await auditService.write({
        adminUsername: session?.username || '',
        action: 'demo_assets_grant',
        targetType: 'user',
        targetId: uid,
        payload: parsed.data,
        ip: getClientIp(request)
      });
      return ok(result, '演示资产已发放');
    } catch (error) {
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'demo_assets_grant',
        targetType: 'user',
        targetId: uid,
        payload: parsed.data,
        resultStatus: 'failed',
        resultMessage: error.message,
        ip: getClientIp(request)
      });
      return fail(reply, error.statusCode || 500, error.message || '演示资产发放失败');
    }
  });
}

module.exports = { registerAdminMembersRoutes };
