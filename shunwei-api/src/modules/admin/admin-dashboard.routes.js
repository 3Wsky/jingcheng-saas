const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { requireAdmin } = require('./admin.auth');
const { AdminDashboardService } = require('./admin-dashboard.service');

const rangeSchema = z.object({
  range: z.enum(['today', '7d', '30d']).optional().default('today')
});

function registerAdminDashboardRoutes(app) {
  const service = new AdminDashboardService();

  app.get('/api/admin/dashboard/summary', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = rangeSchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      return ok(await service.getSummary(parsed.data.range));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '看板数据加载失败');
    }
  });
}

module.exports = { registerAdminDashboardRoutes };
