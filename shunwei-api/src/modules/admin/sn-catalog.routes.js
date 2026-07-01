const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { requireAdmin, getAdminSession } = require('../admin/admin.auth');
const { AdminAuditService, getClientIp } = require('../admin/admin-audit.service');
const { SnCatalogService } = require('./sn-catalog.service');

// 导入项：以 IMEI1 为主键身份，SN 可空（手机多数无 SN）。
// 不在此处强制"至少一个"——交由 service.buildRows 跳过空行，避免单条坏行拖垮整批导入。
const itemSchema = z.object({
  snCode: z.string().trim().max(64).optional().default(''),
  imei1: z.string().trim().max(32).optional().default(''),
  brand: z.string().trim().max(64).optional().default(''),
  model: z.string().trim().max(128).optional().default(''),
  price: z.coerce.number().min(0).optional().default(0),
  remark: z.string().trim().max(255).optional().default('')
});

// 单条新增/编辑：必须至少有 IMEI1 或 SN
const upsertSchema = itemSchema.refine(
  (v) => (v.snCode && v.snCode.length) || (v.imei1 && v.imei1.length),
  { message: 'IMEI1 与 SN 不能同时为空' }
);

const importSchema = z.object({
  items: z.array(itemSchema).min(1).max(50000),
  // replace=true：整库替换（清空后写入最新全量）；默认 false=增量 upsert
  replace: z.coerce.boolean().optional().default(false)
});

function registerSnCatalogRoutes(app) {
  const service = new SnCatalogService();
  const audit = new AdminAuditService();

  // ===== 小程序端：识别出 IMEI1/SN 后查询型号/价格（店员可调用）=====
  // IMEI1 优先、SN 兜底；命中返回型号/价格用于自动回填；并返回该码是否已被使用过（防重复）
  app.get('/api/staff/sn-lookup', async (request, reply) => {
    if (!request.auth || !request.auth.uid) return fail(reply, 401, '请先登录');
    const sn = String(request.query.sn || '').trim();
    const imei = String(request.query.imei || request.query.imei1 || '').trim();
    if (!sn && !imei) return fail(reply, 400, '请提供 IMEI 或 SN');
    try {
      const result = await service.lookupByCode({ imei, sn });
      // 附带"是否已用过"，店员录入时即时提示，避免重复申请
      try {
        const { ApprovalCodeUsageService } = require('../approval/approval-code-usage.service');
        const usage = new ApprovalCodeUsageService();
        const u = await usage.checkSingle({ imei, sn });
        result.used = !!u.used;
        if (u.used) result.usedAt = u.usedAt;
      } catch { result.used = false; }
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
        keyword: request.query.keyword,
        category: request.query.category,
        brand: request.query.brand
      }));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '加载失败');
    }
  });

  // 分类分面：各品类条数 + 品牌列表（供前端品类 Tab / 品牌下拉）
  app.get('/api/admin/sn-catalog/facets', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      return ok(await service.facets());
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '统计失败');
    }
  });

  app.post('/api/admin/sn-catalog', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = upsertSchema.safeParse(request.body || {});
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
    if (!parsed.success) return fail(reply, 400, '参数错误（items 必须是设备数组）', parsed.error.flatten());
    try {
      const { items, replace } = parsed.data;
      const result = replace ? await service.replaceAll(items) : await service.bulkImport(items);
      const session = getAdminSession(request);
      await audit.write({
        adminUsername: session?.username || '',
        action: replace ? 'sn_catalog_replace' : 'sn_catalog_import',
        targetType: 'sn',
        targetId: 0,
        payload: result,
        ip: getClientIp(request)
      });
      const verb = replace ? '整库替换' : '导入';
      return ok(result, `${verb}完成：写入 ${result.processed || 0} 条，跳过 ${result.skipped || 0} 条`);
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
