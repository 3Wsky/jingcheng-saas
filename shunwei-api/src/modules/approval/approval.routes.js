const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { isDatabaseConnectionError } = require('../../shared/mysql');
const { ApprovalService } = require('./approval.service');

const submitSchema = z.object({
  customerUid: z.coerce.number().int().positive(),
  consumeAmount: z.coerce.number().positive(),
  receiptNo: z.string().trim().max(64).optional().default('')
});

const reviewSchema = z.object({
  requestId: z.coerce.number().int().positive(),
  action: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(200).optional().default('')
});

function registerApprovalRoutes(app) {
  const service = new ApprovalService();

  app.get('/api/approval/tier-rules', async (request, reply) => {
    try {
      const { getPool } = require('../../shared/mysql');
      const { swTable } = require('../../shared/sw-mysql');
      const [rows] = await getPool().query(
        `SELECT * FROM ${swTable('tier_rule')} WHERE is_active = 1 ORDER BY min_amount ASC`
      );
      return ok(rows);
    } catch (error) {
      return failApproval(reply, error);
    }
  });

  app.post('/api/approval/match', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const amount = Number(request.body?.consumeAmount || 0);
    if (amount <= 0) return fail(reply, 400, '消费金额必须大于0');

    try {
      const rule = await service.matchTierRule(amount);
      return ok(rule ? {
        matched: true,
        tierCode: rule.tier_code,
        voucherAmount: Number(rule.voucher_amount || 0),
        giftIntegral: Number(rule.gift_integral || 0),
        minAmount: Number(rule.min_amount),
        maxAmount: Number(rule.max_amount || 0)
      } : { matched: false });
    } catch (error) {
      return failApproval(reply, error);
    }
  });

  app.post('/api/approval/submit', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const parsed = submitSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const rule = await service.matchTierRule(parsed.data.consumeAmount);
      if (!rule) return fail(reply, 400, '消费金额不在任何档位范围内');

      const result = await service.createRequest({
        clerkUid: request.auth.uid,
        customerUid: parsed.data.customerUid,
        consumeAmount: parsed.data.consumeAmount,
        receiptNo: parsed.data.receiptNo,
        rule
      });
      return ok(result, '提交成功，等待店长审批');
    } catch (error) {
      return failApproval(reply, error);
    }
  });

  app.get('/api/approval/todos', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const role = request.query.role || 'manager';
    try {
      const todos = await service.getTodos(request.auth.uid, role);
      return ok(todos.map(t => ({
        todoId: t.id,
        requestId: t.request_id,
        customerUid: t.customer_uid,
        consumeAmount: Number(t.consumption_amount ?? t.consume_amount ?? 0),
        matchedTierCode: t.matched_tier_code,
        matchedVoucher: Number(t.matched_voucher_amount || 0),
        matchedIntegral: Number(t.matched_integral || 0),
        reqStatus: t.req_status,
        clerkUid: t.staff_uid ?? t.clerk_uid,
        createdAt: Number(t.req_created_at)
      })));
    } catch (error) {
      return failApproval(reply, error);
    }
  });

  app.post('/api/approval/review/manager', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const parsed = reviewSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const result = await service.reviewByManager(
        request.auth.uid, parsed.data.requestId, parsed.data.action, parsed.data.reason
      );
      return ok(result, parsed.data.action === 'approve' ? '已通过，等待超管终审' : '已驳回');
    } catch (error) {
      return failApproval(reply, error);
    }
  });

  app.post('/api/approval/review/admin', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const parsed = reviewSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const result = await service.reviewByAdmin(
        request.auth.uid, parsed.data.requestId, parsed.data.action, parsed.data.reason
      );
      return ok(result, parsed.data.action === 'approve' ? '终审通过，权益已发放' : '已驳回');
    } catch (error) {
      return failApproval(reply, error);
    }
  });
}

function failApproval(reply, error) {
  if (isDatabaseConnectionError(error)) {
    return fail(reply, 503, '数据库未连接', { code: error.code });
  }
  return fail(reply, error.statusCode || 500, error.message || '审批服务异常');
}

module.exports = { registerApprovalRoutes };
