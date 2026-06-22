const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { requireAdmin, getAdminSession } = require('./admin.auth');
const { AdminAuditService, getClientIp } = require('./admin-audit.service');
const { ApprovalService } = require('../approval/approval.service');

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.string().optional().default('all'),
  staffUid: z.coerce.number().int().optional(),
  divisionId: z.coerce.number().int().optional(),
  amountMin: z.coerce.number().optional(),
  amountMax: z.coerce.number().optional(),
  tierCode: z.string().trim().optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  receiptNo: z.string().trim().optional()
});

const autoPassSchema = z.object({
  enabled: z.boolean(),
  scope: z.enum(['integral_mall', 'consumption', 'all']).optional().default('consumption')
});

const tierRuleSchema = z.object({
  minAmount: z.coerce.number().min(0),
  maxAmount: z.coerce.number().min(0).nullable().optional(),
  tierCode: z.enum(['SW199', 'SW299']),
  voucherAmount: z.coerce.number().min(0),
  isActive: z.boolean().optional().default(true)
});

function registerAdminApprovalRoutes(app) {
  const approvalService = new ApprovalService();
  const auditService = new AdminAuditService();

  app.get('/api/admin/approval/list', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = listQuerySchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      return ok(await approvalService.listApprovals(parsed.data));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '审批列表加载失败');
    }
  });

  app.get('/api/admin/approval/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const requestId = Number(request.params.id);
    if (!requestId) return fail(reply, 400, 'id 无效');

    try {
      return ok(await approvalService.getApprovalDetail(requestId));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '审批详情加载失败');
    }
  });

  app.get('/api/admin/config/approval-auto-pass', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      return ok(await approvalService.getApprovalAutoPassConfig());
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '配置读取失败');
    }
  });

  app.put('/api/admin/config/approval-auto-pass', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = autoPassSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const session = getAdminSession(request);
    try {
      const data = await approvalService.updateApprovalAutoPassConfig(parsed.data);
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'approval_config_update',
        targetType: 'config',
        targetId: parsed.data.scope,
        payload: parsed.data,
        ip: getClientIp(request)
      });
      return ok(data, '免审配置已更新');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '配置更新失败');
    }
  });

  app.get('/api/admin/tier-rules', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const { getPool } = require('../../shared/mysql');
      const { swTable } = require('../../shared/sw-mysql');
      const [rows] = await getPool().query(
        `SELECT id, min_amount, max_amount, tier_code, voucher_amount, gift_integral, is_active
         FROM ${swTable('tier_rule')} ORDER BY min_amount ASC`
      );
      return ok(rows.map(r => ({
        id: Number(r.id),
        minAmount: Number(r.min_amount),
        maxAmount: r.max_amount != null ? Number(r.max_amount) : null,
        tierCode: r.tier_code,
        voucherAmount: Number(r.voucher_amount),
        giftIntegral: approvalService.fixedGiftIntegral(r.tier_code),
        isActive: Number(r.is_active) === 1
      })));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '档位规则读取失败');
    }
  });

  app.post('/api/admin/tier-rules', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = tierRuleSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const session = getAdminSession(request);
    const { getPool } = require('../../shared/mysql');
    const { swTable } = require('../../shared/sw-mysql');
    const now = Math.floor(Date.now() / 1000);
    try {
      const [result] = await getPool().query(
        `INSERT INTO ${swTable('tier_rule')}
         (min_amount, max_amount, tier_code, voucher_amount, gift_integral, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [parsed.data.minAmount, parsed.data.maxAmount ?? null, parsed.data.tierCode,
         parsed.data.voucherAmount, approvalService.fixedGiftIntegral(parsed.data.tierCode),
         parsed.data.isActive ? 1 : 0, now, now]
      );
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'tier_rule_create',
        targetType: 'tier_rule',
        targetId: String(result.insertId),
        payload: parsed.data,
        ip: getClientIp(request)
      });
      return ok({ id: result.insertId }, '档位规则已创建');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '档位规则创建失败');
    }
  });

  app.put('/api/admin/tier-rules/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number(request.params.id);
    if (!id) return fail(reply, 400, 'id 无效');
    const parsed = tierRuleSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const session = getAdminSession(request);
    const { getPool } = require('../../shared/mysql');
    const { swTable } = require('../../shared/sw-mysql');
    const now = Math.floor(Date.now() / 1000);
    try {
      await getPool().query(
        `UPDATE ${swTable('tier_rule')}
         SET min_amount = ?, max_amount = ?, tier_code = ?, voucher_amount = ?,
             gift_integral = ?, is_active = ?, updated_at = ?
         WHERE id = ?`,
        [parsed.data.minAmount, parsed.data.maxAmount ?? null, parsed.data.tierCode,
         parsed.data.voucherAmount, approvalService.fixedGiftIntegral(parsed.data.tierCode),
         parsed.data.isActive ? 1 : 0, now, id]
      );
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'tier_rule_update',
        targetType: 'tier_rule',
        targetId: String(id),
        payload: parsed.data,
        ip: getClientIp(request)
      });
      return ok({ id }, '档位规则已更新');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '档位规则更新失败');
    }
  });

  app.delete('/api/admin/tier-rules/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number(request.params.id);
    if (!id) return fail(reply, 400, 'id 无效');

    const session = getAdminSession(request);
    const { getPool } = require('../../shared/mysql');
    const { swTable } = require('../../shared/sw-mysql');
    const now = Math.floor(Date.now() / 1000);
    try {
      await getPool().query(
        `UPDATE ${swTable('tier_rule')} SET is_active = 0, updated_at = ? WHERE id = ?`,
        [now, id]
      );
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'tier_rule_delete',
        targetType: 'tier_rule',
        targetId: String(id),
        payload: {},
        ip: getClientIp(request)
      });
      return ok({ id }, '档位规则已停用');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '档位规则删除失败');
    }
  });

  app.post('/api/admin/approval/:id/revoke', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const requestId = Number(request.params.id);
    if (!requestId) return fail(reply, 400, 'id 无效');

    const session = getAdminSession(request);
    const reason = String(request.body?.reason || '').trim();
    try {
      const result = await approvalService.revokeApproval(session?.uid || 0, requestId, reason);
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'approval_revoke',
        targetType: 'approval',
        targetId: String(requestId),
        payload: { reason },
        ip: getClientIp(request)
      });
      return ok(result, '终批已撤销，权益已回滚');
    } catch (error) {
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'approval_revoke',
        targetType: 'approval',
        targetId: String(requestId),
        resultStatus: 'failed',
        resultMessage: error.message || '撤销失败',
        payload: { reason },
        ip: getClientIp(request)
      });
      return fail(reply, error.statusCode || 500, error.message || '撤销失败');
    }
  });
}

module.exports = { registerAdminApprovalRoutes };
