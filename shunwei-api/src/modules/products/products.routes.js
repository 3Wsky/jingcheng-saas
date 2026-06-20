const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { requireAdmin } = require('../admin/admin.auth');
const { ProductsService } = require('./products.service');

const listQuerySchema = z.object({
  keyword: z.string().trim().max(80).optional().default(''),
  brand: z.string().trim().max(40).optional().default(''),
  status: z.enum(['all', 'shown', 'hidden']).optional().default('all'),
  source: z.string().trim().max(40).optional().default('')
});

const idParamsSchema = z.object({
  id: z.string().trim().min(1).max(80)
});

const collectFromCrmebSchema = z.object({
  ids: z.array(z.coerce.number().int().min(1)).max(200).optional(),
  isShow: z.boolean().optional()
});

const importSchema = z.object({
  isShow: z.boolean().optional(),
  dataDir: z.string().trim().max(260).optional()
});

const collectUrlSchema = z.object({
  url: z.string().trim().min(8).max(512),
  platform: z.string().trim().max(32).optional()
});

const showSchema = z.object({
  isShow: z.boolean()
});

const batchShowSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(80)).min(1).max(200),
  isShow: z.boolean()
});

const reorderSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(80)).min(1).max(500)
});

const updateProductSchema = z.object({
  storeName: z.string().trim().min(1).max(120).optional(),
  storeInfo: z.string().trim().max(240).optional(),
  keyword: z.string().trim().max(240).optional(),
  price: z.union([z.string(), z.number()]).optional(),
  otPrice: z.union([z.string(), z.number()]).optional(),
  unitName: z.string().trim().min(1).max(12).optional(),
  image: z.string().trim().max(1000).optional(),
  sliderImages: z.array(z.string().trim().max(1000)).max(12).optional(),
  recommendImage: z.string().trim().max(1000).optional(),
  isShow: z.boolean().optional(),
  isHot: z.boolean().optional(),
  isBest: z.boolean().optional(),
  isNew: z.boolean().optional(),
  sort: z.coerce.number().int().min(-999999).max(999999).optional(),
  features: z.array(z.string().trim().max(160)).max(30).optional(),
  specs: z.record(z.string(), z.string()).optional(),
  paramsList: z.array(z.object({
    name: z.string().trim().min(1).max(40),
    value: z.string().trim().min(1).max(240),
    sort: z.coerce.number().int().min(0).max(9999).optional(),
    status: z.boolean().optional()
  })).max(80).optional(),
  description: z.string().trim().max(4000).optional()
});

function registerProductRoutes(app) {
  const service = new ProductsService();

  app.get('/api/products', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '商品查询参数错误', parsed.error.flatten());
    return ok(await service.listPublicProducts(parsed.data));
  });

  app.get('/api/products/:id', async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params || {});
    if (!parsed.success) return fail(reply, 400, '商品参数错误', parsed.error.flatten());
    const product = await service.getPublicProduct(parsed.data.id);
    if (!product) return fail(reply, 404, '商品不存在');
    return ok(product);
  });

  app.get('/api/admin/products', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const parsed = listQuerySchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '商品查询参数错误', parsed.error.flatten());
    return ok(await service.listAdminProducts(parsed.data));
  });

  app.get('/api/admin/products/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const parsed = idParamsSchema.safeParse(request.params || {});
    if (!parsed.success) return fail(reply, 400, '商品参数错误', parsed.error.flatten());
    const data = await service.listAdminProducts({ status: 'all' });
    const product = (data.list || []).find((item) => String(item.id) === String(parsed.data.id));
    if (!product) return fail(reply, 404, '商品不存在');
    return ok(product);
  });

  app.post('/api/admin/products/collect', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const parsed = importSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '采集参数错误', parsed.error.flatten());
    try {
      return ok(await service.importFromPriceTags(parsed.data), '商品采集完成');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '商品采集失败');
    }
  });

  app.post('/api/admin/products/collect-from-crmeb', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const parsed = collectFromCrmebSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, 'CRMEB 导入参数错误', parsed.error.flatten());
    try {
      return ok(await service.importFromCrmeb(parsed.data), 'CRMEB 商品导入完成');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || 'CRMEB 商品导入失败');
    }
  });

  app.post('/api/admin/products/collect-url', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const url = String(request.body?.url || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) return fail(reply, 400, '请输入有效的商品链接');
    return ok({
      status: 'pending',
      url,
      message: '链接采集已记录，完整解析能力将在下一版接入（当前请使用价签采集）'
    }, '已提交');
  });

  app.post('/api/admin/products/import-price-tags', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const parsed = importSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '导入参数错误', parsed.error.flatten());

    try {
      return ok(await service.importFromPriceTags(parsed.data), '导入完成');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '导入失败');
    }
  });

  app.patch('/api/admin/products/:id/show', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const parsedParams = idParamsSchema.safeParse(request.params || {});
    if (!parsedParams.success) return fail(reply, 400, '商品参数错误', parsedParams.error.flatten());
    const parsedBody = showSchema.safeParse(request.body || {});
    if (!parsedBody.success) return fail(reply, 400, '上下架参数错误', parsedBody.error.flatten());

    try {
      return ok(await service.updateProductShow(parsedParams.data.id, parsedBody.data.isShow), '状态已更新');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '状态更新失败');
    }
  });

  app.patch('/api/admin/products/batch-show', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const parsed = batchShowSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '批量上下架参数错误', parsed.error.flatten());
    return ok(await service.batchUpdateShow(parsed.data.ids, parsed.data.isShow), '批量状态已更新');
  });

  app.patch('/api/admin/products/reorder', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const parsed = reorderSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '排序参数错误', parsed.error.flatten());
    try {
      return ok(await service.reorderProducts(parsed.data.ids), '排序已保存');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '排序保存失败');
    }
  });

  app.put('/api/admin/products/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const parsedParams = idParamsSchema.safeParse(request.params || {});
    if (!parsedParams.success) return fail(reply, 400, '商品参数错误', parsedParams.error.flatten());
    const parsedBody = updateProductSchema.safeParse(request.body || {});
    if (!parsedBody.success) return fail(reply, 400, '商品保存参数错误', parsedBody.error.flatten());

    try {
      return ok(await service.updateProduct(parsedParams.data.id, parsedBody.data), '商品已保存');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '商品保存失败');
    }
  });
}

module.exports = { registerProductRoutes };
