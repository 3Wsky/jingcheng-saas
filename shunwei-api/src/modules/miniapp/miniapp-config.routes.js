const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { requireAdmin, getAdminSession } = require('../admin/admin.auth');
const { AdminAuditService, getClientIp } = require('../admin/admin-audit.service');
const { MiniappConfigService } = require('./miniapp-config.service');

const entryConfigSchema = z.object({
  staffEntryRoleOnly: z.boolean(),
  merchantEntryRoleOnly: z.boolean()
});

const shareConfigSchema = z.object({
  pic: z.string().trim().max(1000).optional().default(''),
  title: z.string().trim().max(100).optional().default(''),
  desc: z.string().trim().max(200).optional().default(''),
  enabled: z.boolean().optional().default(false)
});

function registerMiniappConfigRoutes(app) {
  const service = new MiniappConfigService();
  const auditService = new AdminAuditService();

  app.get('/api/miniapp/entry-config', async (_request, reply) => {
    try {
      return ok(await service.getEntryConfig());
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '入口配置读取失败');
    }
  });

  app.get('/api/admin/config/miniapp-entries', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      return ok(await service.getEntryConfig());
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '入口配置读取失败');
    }
  });

  app.put('/api/admin/config/miniapp-entries', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = entryConfigSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const session = getAdminSession(request);
    try {
      const data = await service.updateEntryConfig(parsed.data);
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'miniapp_entry_config_update',
        targetType: 'config',
        targetId: 'miniapp_entries',
        payload: parsed.data,
        ip: getClientIp(request)
      });
      return ok(data, '小程序入口配置已更新');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '入口配置更新失败');
    }
  });

  // 小程序首页分享配置（公开读：供小程序首页转发/朋友圈使用）
  app.get('/api/miniapp/share', async (request, reply) => {
    try {
      return ok(await service.getShareForMiniapp(request));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '分享配置读取失败');
    }
  });

  app.get('/api/admin/config/miniapp-share', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      return ok(await service.getShareConfigRaw());
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '分享配置读取失败');
    }
  });

  app.put('/api/admin/config/miniapp-share', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = shareConfigSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const session = getAdminSession(request);
    try {
      const data = await service.updateShareConfig(parsed.data);
      await auditService.write({
        adminUsername: session?.username || '',
        action: 'miniapp_share_config_update',
        targetType: 'config',
        targetId: 'miniapp_share',
        payload: parsed.data,
        ip: getClientIp(request)
      });
      return ok(data, '小程序分享配置已更新');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '分享配置更新失败');
    }
  });
}

module.exports = { registerMiniappConfigRoutes };
