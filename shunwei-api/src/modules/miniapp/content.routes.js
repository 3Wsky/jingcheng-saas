const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { requireAdmin, getAdminSession } = require('../admin/admin.auth');
const { AdminAuditService, getClientIp } = require('../admin/admin-audit.service');
const { ContentService } = require('./content.service');

// 现金券使用须知：标题 + 条款数组
const cashVoucherTermsSchema = z.object({
  title: z.string().max(60).optional(),
  items: z.array(z.string().max(1000)).max(60)
});

// 消费券活动说明：活动名 + 副标题 + 提示 + 分段（每段标题 + 条款数组）
const activityRulesSchema = z.object({
  activityName: z.string().max(60).optional(),
  subTitle: z.string().max(60).optional(),
  notice: z.string().max(2000).optional(),
  sections: z.array(z.object({
    title: z.string().max(60),
    items: z.array(z.string().max(2000)).max(80)
  })).max(60)
});

const updateSchema = z.object({
  cashVoucherTerms: cashVoucherTermsSchema.optional(),
  activityRules: activityRulesSchema.optional()
}).refine((v) => v.cashVoucherTerms !== undefined || v.activityRules !== undefined, {
  message: '至少需要提供一段内容'
});

function registerContentRoutes(app) {
  const service = new ContentService();
  const auditService = new AdminAuditService();

  // 公开读取（小程序用，免登录）
  app.get('/api/miniapp/content', async (_request, reply) => {
    try {
      return ok(await service.getContent());
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '内容读取失败');
    }
  });

  // 后台读取
  app.get('/api/admin/config/mp-content', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      return ok(await service.getContent());
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '内容读取失败');
    }
  });

  // 后台保存
  app.put('/api/admin/config/mp-content', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = updateSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const session = getAdminSession(request);
    try {
      const data = await service.updateContent(parsed.data, 0);
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'mp_content_update',
        targetType: 'config',
        targetId: 'mp_content',
        payload: { keys: Object.keys(parsed.data) },
        ip: getClientIp(request)
      });
      return ok(data, '内容已更新');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '内容更新失败');
    }
  });
}

module.exports = { registerContentRoutes };
