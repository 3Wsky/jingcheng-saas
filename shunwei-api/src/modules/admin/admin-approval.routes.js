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
