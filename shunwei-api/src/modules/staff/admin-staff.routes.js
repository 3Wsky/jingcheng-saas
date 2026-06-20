const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { requireAdmin, getAdminSession } = require('../admin/admin.auth');
const { AdminAuditService, getClientIp } = require('../admin/admin-audit.service');
const { StaffService } = require('./staff.service');

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  keyword: z.string().trim().max(64).optional().default(''),
  divisionId: z.coerce.number().int().optional()
});

const cardSchema = z.object({
  displayName: z.string().trim().max(64).optional().default(''),
  avatar: z.string().trim().max(512).optional().default(''),
  jobTitle: z.string().trim().max(64).optional().default(''),
  bio: z.string().trim().max(500).optional().default(''),
  storeName: z.string().trim().max(128).optional().default(''),
  storeAddress: z.string().trim().max(255).optional().default(''),
  storePhone: z.string().trim().max(20).optional().default(''),
  businessHours: z.string().trim().max(128).optional().default(''),
  latitude: z.coerce.number().optional().default(0),
  longitude: z.coerce.number().optional().default(0),
  wechatQrcode: z.string().trim().max(512).optional().default(''),
  isPublished: z.boolean().optional().default(true)
});

function registerAdminStaffRoutes(app) {
  const service = new StaffService();
  const audit = new AdminAuditService();

  app.get('/api/admin/staff/list', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = listQuerySchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    try {
      return ok(await service.list(parsed.data));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '店员列表加载失败');
    }
  });

  app.get('/api/admin/staff/:uid/stats', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');
    try {
      return ok(await service.getStats(uid));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '店员统计加载失败');
    }
  });

  app.get('/api/admin/staff/:uid/card', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');
    try {
      return ok(await service.getCard(uid));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '名片加载失败');
    }
  });

  app.put('/api/admin/staff/:uid/card', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');
    const parsed = cardSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    const session = getAdminSession(request);
    try {
      const data = await service.upsertCard(uid, parsed.data);
      await audit.write({
        adminUsername: session?.username || '',
        action: 'staff_card_update',
        targetType: 'staff',
        targetId: uid,
        payload: parsed.data,
        ip: getClientIp(request)
      });
      return ok(data, '名片已保存');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '名片保存失败');
    }
  });
}

module.exports = { registerAdminStaffRoutes };
