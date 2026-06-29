const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { requireAdmin, getAdminSession } = require('../admin/admin.auth');
const { AdminAuditService, getClientIp } = require('../admin/admin-audit.service');
const { SnCatalogService } = require('./sn-catalog.service');

const itemSchema = z.object({
  snCode: z.string().trim().min(1).max(64),
  brand: z.string().trim().max(64).optional().default(''),
  model: z.string().trim().max(128).optional().default(''),
  price: z.coerce.number().min(0).optional().default(0),
  remark: z.string().trim().max(255).optional().default('')
});

const importSchema = z.object({
  items: z.array(itemSchema).min(1).max(20000)
});

function registerSnCatalogRoutes(app) {
  const service = new SnCatalogService();
  const audit = new AdminAuditService();

  // ===== 小程序端：识别出 SN 后查询型号/价格（店员可调用）=====
  app.get('/api/staff/sn-lookup', async (request, reply) => {
    if (!request.auth || !request.auth.uid) return fail(reply, 401, '请先登录');
    const sn = String(request.query.sn || '').trim();
    if (!sn) return fail(reply, 400, '请提供 SN');
    try {
      const result = await service.lookup(sn);
      return ok(result);
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '查询失败');
    }
  });

  // ===== 后台管理：SN 产品库 CRUD + 批量导入 =====
  app.get('/api/admin/sn-catalog', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      return ok(await service.list({
        page: request.query.page,
        pageSize: request.query.pageSize,
        keyword: request.query.keyword
      }));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '加载失败');
    }
  });

  app.post('/api/admin/sn-catalog', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = itemSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    try {
      const result = await service.upsertOne(parsed.data);
      const session = getAdminSession(request);
      await audit.write({
        adminUsername: session?.username || '',
        action: 'sn_catalog_upsert',
        targetType: 'sn',
        targetId: 0,
        payload: { snCode: parsed.data.snCode, model: parsed.data.model, price: parsed.data.price },
        ip: getClientIp(request)
      });
      return ok(result, '已保存');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '保存失败');
    }
  });

  app.post('/api/admin/sn-catalog/import', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = importSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误（items 必须是 SN 数组）', parsed.error.flatten());
    try {
      const result = await service.bulkImport(parsed.data.items);
      const session = getAdminSession(request);
      await audit.write({
        adminUsername: session?.username || '',
        action: 'sn_catalog_import',
        targetType: 'sn',
        targetId: 0,
        payload: result,
        ip: getClientIp(request)
      });
      return ok(result, `导入完成：处理 ${result.processed || 0} 条，跳过 ${result.skipped || 0} 条`);
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '导入失败');
    }
  });

  app.delete('/api/admin/sn-catalog/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const result = await service.remove(request.params.id);
      const session = getAdminSession(request);
      await audit.write({
        adminUsername: session?.username || '',
        action: 'sn_catalog_delete',
        targetType: 'sn',
        targetId: Number(request.params.id) || 0,
        payload: {},
        ip: getClientIp(request)
      });
      return ok(result, '已删除');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '删除失败');
    }
  });
}

module.exports = { registerSnCatalogRoutes };
