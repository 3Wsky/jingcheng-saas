const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { getPool, legacyTable } = require('../../shared/mysql');
const { toPublicUrl, toPublicUrlList, toStoredUrl, toStoredUrlList } = require('../../shared/url');
const { requireAdmin, getAdminSession } = require('../admin/admin.auth');
const { AdminAuditService, getClientIp } = require('../admin/admin-audit.service');
const { IntegralProductExtRepository } = require('./integral-product-ext.repository');
const { ProductsService } = require('../products/products.service');
const { backfillIntegralImageUrls } = require('./integral-image-backfill');
const { IntegralMallService } = require('../integral-mall/integral-mall.service');
const {
  showcaseToIntegralPayload,
  fetchCrmebProducts,
  findIntegralByProductId,
  serializeImages: helperSerializeImages
} = require('./product-collect.helper');

const extRepo = new IntegralProductExtRepository();
const productsService = new ProductsService();

const productSchema = z.object({
  showcaseId: z.string().trim().min(1).max(80).optional(),
  productId: z.coerce.number().int().min(1).optional(),
  title: z.string().trim().min(1).max(128),
  image: z.string().trim().max(512).optional().default(''),
  images: z.array(z.string().trim().max(512)).max(9).optional().default([]),
  price: z.coerce.number().int().min(0),
  stock: z.coerce.number().int().min(0).optional().default(0),
  isShow: z.boolean().optional().default(true),
  sort: z.coerce.number().int().optional().default(0),
  unitName: z.string().trim().max(16).optional().default('件'),
  isHost: z.boolean().optional().default(false),
  quota: z.coerce.number().int().min(0).optional().default(0),
  onceNum: z.coerce.number().int().min(1).optional().default(1),
  num: z.coerce.number().int().min(0).optional().default(0),
  description: z.string().trim().max(8000).optional().default(''),
  specType: z.coerce.number().int().min(0).max(1).optional().default(0),
  attrs: z.array(z.object({
    id: z.coerce.number().int().optional(),
    suk: z.string().trim().max(128).optional(),
    unique: z.string().trim().max(32).optional(),
    integralPrice: z.coerce.number().int().min(0),
    integralQuota: z.coerce.number().int().min(1).optional().default(1),
    stock: z.coerce.number().int().min(0).optional().default(0),
    image: z.string().trim().max(512).optional()
  })).max(50).optional().default([])
});

function parseImages(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeImages(list) {
  const arr = (list || []).filter(Boolean);
  return arr.length ? JSON.stringify(arr) : '';
}

// CRMEB eb_store_integral 标准含 description 列；若某些精简库缺列，自动剔除该列回退，
// 保证积分商品详情能写入 CRMEB 表供小程序读取。
async function insertIntegralRow(pool, cols, vals) {
  try {
    return await pool.query(
      `INSERT INTO ${legacyTable('store_integral')} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      vals
    );
  } catch (error) {
    if (error.code === 'ER_BAD_FIELD_ERROR' && cols.includes('description')) {
      const idx = cols.indexOf('description');
      const c2 = cols.filter((_, i) => i !== idx);
      const v2 = vals.filter((_, i) => i !== idx);
      return pool.query(
        `INSERT INTO ${legacyTable('store_integral')} (${c2.join(', ')}) VALUES (${c2.map(() => '?').join(', ')})`,
        v2
      );
    }
    throw error;
  }
}

async function updateIntegralDescription(pool, id, description) {
  try {
    await pool.query(
      `UPDATE ${legacyTable('store_integral')} SET description = ? WHERE id = ? AND is_del = 0`,
      [description || '', id]
    );
  } catch (error) {
    if (error.code !== 'ER_BAD_FIELD_ERROR') throw error;
  }
}

async function loadExt(productId) {
  const ext = await extRepo.get(productId);
  return ext || {};
}

async function mapProduct(row, request) {
  const ext = await loadExt(row.id);
  const images = parseImages(row.images);
  const attrs = (ext.attrs || []).map((attr) =>
    attr && attr.image ? { ...attr, image: toPublicUrl(attr.image, request) } : attr
  );
  return {
    id: row.id,
    productId: Number(row.product_id || 0),
    title: row.title,
    image: toPublicUrl(row.image || images[0] || '', request),
    images: toPublicUrlList(images, request),
    price: Number(row.price || 0),
    stock: Number(row.stock || 0),
    sales: Number(row.sales || 0),
    isShow: Number(row.is_show) === 1,
    sort: Number(row.sort || 0),
    unitName: row.unit_name || '件',
    isHost: Number(row.is_host) === 1,
    quota: Number(row.quota || 0),
    onceNum: Number(row.once_num || 1),
    num: Number(row.num || 1),
    description: ext.description || '',
    specType: Number(ext.specType || 0),
    attrs,
    showcaseId: ext.showcaseId || '',
    productType: 'integral_verify',
    deliveryType: 'local_verify'
  };
}

async function saveExt(productId, data) {
  const payload = {
    description: data.description || '',
    specType: data.specType || 0,
    attrs: data.attrs || []
  };
  if (data.showcaseId !== undefined) payload.showcaseId = String(data.showcaseId || '');
  await extRepo.save(productId, payload);
}

function normalizeIntegralPayload(d) {
  const payload = { ...d };
  if (payload.specType === 1 && payload.attrs?.length) {
    payload.price = Math.min(...payload.attrs.map((a) => a.integralPrice));
    payload.stock = payload.attrs.reduce((sum, a) => sum + Number(a.stock || 0), 0);
    payload.quota = payload.quota || payload.attrs.reduce((m, a) => Math.max(m, a.integralQuota || 0), 0);
  }
  return payload;
}

// 入库前把图片字段归一化为绝对 URL：CRMEB eb_store_integral 会被 CRMEB PHP /api/store_integral/list
// 直接读取（小程序首页 pointsMall / 导航 points_mall），不经本服务 toPublicUrl，
// 故落库值必须本身是绝对地址，否则小程序 <image> 拿到裸 /uploads/... 无法加载。
function normalizeImageFields(d, request) {
  const payload = { ...d };
  if (payload.image !== undefined) payload.image = toStoredUrl(payload.image, request);
  if (payload.images !== undefined) payload.images = toStoredUrlList(payload.images, request);
  if (Array.isArray(payload.attrs) && payload.attrs.length) {
    payload.attrs = payload.attrs.map((attr) =>
      attr && attr.image ? { ...attr, image: toStoredUrl(attr.image, request) } : attr
    );
  }
  return payload;
}

async function findIntegralByTitle(pool, title) {
  const [[row]] = await pool.query(
    `SELECT id, title FROM ${legacyTable('store_integral')} WHERE title = ? AND is_del = 0 LIMIT 1`,
    [title]
  );
  return row || null;
}

async function getShowcaseProduct(showcaseId) {
  const id = String(showcaseId || '').trim();
  if (!id) return null;
  const data = await productsService.listAdminProducts({ status: 'all' });
  return (data.list || []).find((item) => String(item.id) === id) || null;
}

async function requireShownShowcase(showcaseId, reply) {
  const showcase = await getShowcaseProduct(showcaseId);
  if (!showcase) {
    fail(reply, 404, '展示商品不存在');
    return null;
  }
  if (!showcase.isShow) {
    fail(reply, 400, '仅可选择已上架的展示商品');
    return null;
  }
  return showcase;
}

async function insertIntegralProduct(pool, payload, overrides = {}, request) {
  const base = showcaseToIntegralPayload(payload, overrides);
  const parsed = productSchema.safeParse(base);
  if (!parsed.success) {
    return { ok: false, error: '转换失败', detail: parsed.error.flatten() };
  }

  const d = normalizeImageFields(normalizeIntegralPayload(parsed.data), request);
  const poolRef = pool;
  if (d.productId) {
    const dup = await findIntegralByProductId(poolRef, d.productId);
    if (dup) return { ok: false, skipped: true, reason: '已存在', existingId: dup.id, title: dup.title };
  } else {
    const dupTitle = await findIntegralByTitle(poolRef, d.title);
    if (dupTitle) return { ok: false, skipped: true, reason: '同名已存在', existingId: dupTitle.id, title: dupTitle.title };
  }

  const images = d.images?.length ? d.images : (d.image ? [d.image] : []);
  const now = Math.floor(Date.now() / 1000);
  const cols = ['title', 'image', 'images', 'description', 'price', 'stock', 'is_show', 'sort', 'unit_name', 'is_del', 'add_time'];
  const vals = [d.title, d.image || images[0] || '', helperSerializeImages(images), d.description || '', d.price, d.stock, d.isShow ? 1 : 0, d.sort, d.unitName, 0, now];
  if (d.productId) {
    cols.unshift('product_id');
    vals.unshift(d.productId);
  }

  const [result] = await insertIntegralRow(poolRef, cols, vals);
  await saveExt(result.insertId, d);
  const [[row]] = await poolRef.query(`SELECT * FROM ${legacyTable('store_integral')} WHERE id = ?`, [result.insertId]);
  return { ok: true, product: await mapProduct(row, request) };
}

function summarizeBatch(results) {
  const created = results.filter((r) => r.ok);
  const skipped = results.filter((r) => r.skipped);
  const failed = results.filter((r) => !r.ok && !r.skipped);
  return {
    createdCount: created.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    skipped,
    failed: failed.map((f) => ({ title: f.title, reason: f.reason || f.error })),
    items: created.map((c) => c.product)
  };
}

function registerAdminIntegralMallRoutes(app) {
  const audit = new AdminAuditService();
  const mallService = new IntegralMallService();

  app.get('/api/admin/integral-mall/products', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const page = Math.max(1, Number(request.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    const status = String(request.query.status || 'all');
    const keyword = String(request.query.keyword || '').trim();

    let where = 'is_del = 0';
    const values = [];
    if (status === 'shown') where += ' AND is_show = 1';
    else if (status === 'hidden') where += ' AND is_show = 0';
    if (keyword) {
      where += ' AND title LIKE ?';
      values.push(`%${keyword}%`);
    }

    const [[countRow]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM ${legacyTable('store_integral')} WHERE ${where}`,
      values
    );
    const [rows] = await getPool().query(
      `SELECT id, product_id, title, image, images, price, stock, sales, is_show, sort, unit_name, is_host, quota, once_num, num
       FROM ${legacyTable('store_integral')} WHERE ${where}
       ORDER BY sort DESC, id DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );

    const list = [];
    for (const row of rows) list.push(await mapProduct(row, request));

    const [[shownRow]] = await getPool().query(
      `SELECT COUNT(*) AS c FROM ${legacyTable('store_integral')} WHERE is_del = 0 AND is_show = 1`
    );
    const [[hiddenRow]] = await getPool().query(
      `SELECT COUNT(*) AS c FROM ${legacyTable('store_integral')} WHERE is_del = 0 AND is_show = 0`
    );

    return ok({
      total: Number(countRow?.total || 0),
      page,
      pageSize,
      summary: { shownCount: Number(shownRow?.c || 0), hiddenCount: Number(hiddenRow?.c || 0) },
      list
    });
  });

  app.get('/api/admin/integral-mall/products/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number(request.params.id);
    const [[row]] = await getPool().query(
      `SELECT * FROM ${legacyTable('store_integral')} WHERE id = ? AND is_del = 0`,
      [id]
    );
    if (!row) return fail(reply, 404, '商品不存在');
    return ok(await mapProduct(row, request));
  });

  app.post('/api/admin/integral-mall/products', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const showcaseId = String(request.body?.showcaseId || '').trim();
    const body = { ...request.body };

    if (showcaseId) {
      const showcase = await requireShownShowcase(showcaseId, reply);
      if (!showcase) return;
      if (!body.productId && showcase.crmebId) body.productId = showcase.crmebId;
    }

    const parsed = productSchema.safeParse(body);
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    let d = normalizeIntegralPayload(parsed.data);
    if (!showcaseId) {
      if (!d.title?.trim()) return fail(reply, 400, '请填写商品标题');
      const hasImage = Boolean(d.image?.trim()) || (d.images?.length > 0);
      if (!hasImage) return fail(reply, 400, '请上传商品主图');
    }
    // 落库前归一化为绝对 URL，确保 CRMEB PHP 读取方（小程序首页/导航）也能加载图片
    d = normalizeImageFields(d, request);
    const images = d.images?.length ? d.images : (d.image ? [d.image] : []);
    const now = Math.floor(Date.now() / 1000);
    const cols = ['title', 'image', 'images', 'description', 'price', 'stock', 'is_show', 'sort', 'unit_name', 'is_host', 'quota', 'once_num', 'num', 'exchange_limit_started_at', 'is_del', 'add_time'];
    const vals = [
      d.title, d.image || images[0] || '', serializeImages(images), d.description || '', d.price, d.stock,
      d.isShow ? 1 : 0, d.sort, d.unitName, d.isHost ? 1 : 0, d.quota, d.onceNum, d.num, now, 0, now
    ];
    if (d.productId) {
      cols.unshift('product_id');
      vals.unshift(d.productId);
    }

    const [result] = await insertIntegralRow(getPool(), cols, vals);

    await saveExt(result.insertId, showcaseId ? { ...d, showcaseId } : d);

    const session = getAdminSession(request);
    await audit.write({
      adminUsername: session?.username || '',
      action: 'integral_mall_product_create',
      targetType: 'product',
      targetId: result.insertId,
      payload: d,
      ip: getClientIp(request)
    });

    const [[row]] = await getPool().query(
      `SELECT * FROM ${legacyTable('store_integral')} WHERE id = ?`,
      [result.insertId]
    );
    return ok(await mapProduct(row, request), '创建成功');
  });

  app.put('/api/admin/integral-mall/products/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number(request.params.id);
    const parsed = productSchema.partial().safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    // 落库前归一化为绝对 URL（仅对本次提交了的图片字段生效）
    const d = normalizeImageFields(normalizeIntegralPayload({ ...parsed.data }), request);
    const sets = [];
    const values = [];
    if (d.productId !== undefined) { sets.push('product_id = ?'); values.push(d.productId); }
    if (d.title !== undefined) { sets.push('title = ?'); values.push(d.title); }
    if (d.image !== undefined) { sets.push('image = ?'); values.push(d.image); }
    if (d.images !== undefined) {
      sets.push('images = ?');
      values.push(serializeImages(d.images));
      if (!d.image && d.images[0]) { sets.push('image = ?'); values.push(d.images[0]); }
    }
    if (d.price !== undefined) { sets.push('price = ?'); values.push(d.price); }
    if (d.stock !== undefined) { sets.push('stock = ?'); values.push(d.stock); }
    if (d.isShow !== undefined) { sets.push('is_show = ?'); values.push(d.isShow ? 1 : 0); }
    if (d.sort !== undefined) { sets.push('sort = ?'); values.push(d.sort); }
    if (d.unitName !== undefined) { sets.push('unit_name = ?'); values.push(d.unitName); }
    if (d.isHost !== undefined) { sets.push('is_host = ?'); values.push(d.isHost ? 1 : 0); }
    if (d.quota !== undefined) { sets.push('quota = ?'); values.push(d.quota); }
    if (d.onceNum !== undefined) { sets.push('once_num = ?'); values.push(d.onceNum); }
    if (d.num !== undefined) {
      const [[current]] = await getPool().query(
        `SELECT num FROM ${legacyTable('store_integral')} WHERE id = ? AND is_del = 0 LIMIT 1`,
        [id]
      );
      if (current && Number(current.num || 0) !== Number(d.num)) {
        sets.push('exchange_limit_started_at = ?');
        values.push(Math.floor(Date.now() / 1000));
      }
      sets.push('num = ?');
      values.push(d.num);
    }

    const extFields = ['description', 'specType', 'attrs'];
    const hasExt = extFields.some((k) => d[k] !== undefined);
    if (!sets.length && !hasExt) return fail(reply, 400, '无更新字段');

    if (sets.length) {
      values.push(id);
      await getPool().query(
        `UPDATE ${legacyTable('store_integral')} SET ${sets.join(', ')} WHERE id = ? AND is_del = 0`,
        values
      );
    }
    if (hasExt) await saveExt(id, d);
    // 详情同步写回 CRMEB eb_store_integral.description，保证小程序端能读取到最新详情
    if (d.description !== undefined) await updateIntegralDescription(getPool(), id, d.description);

    const [[row]] = await getPool().query(
      `SELECT * FROM ${legacyTable('store_integral')} WHERE id = ?`,
      [id]
    );
    if (!row) return fail(reply, 404, '商品不存在');
    return ok(await mapProduct(row, request), '已更新');
  });

  app.patch('/api/admin/integral-mall/products/:id/stock', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number(request.params.id);
    const stock = Number(request.body?.stock);
    if (!Number.isFinite(stock) || stock < 0) return fail(reply, 400, 'stock 无效');

    await getPool().query(
      `UPDATE ${legacyTable('store_integral')} SET stock = ? WHERE id = ? AND is_del = 0`,
      [stock, id]
    );
    const [[row]] = await getPool().query(
      `SELECT * FROM ${legacyTable('store_integral')} WHERE id = ?`,
      [id]
    );
    if (!row) return fail(reply, 404, '商品不存在');
    return ok(await mapProduct(row, request), '库存已更新');
  });

  app.patch('/api/admin/integral-mall/products/batch-show', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const ids = Array.isArray(request.body?.ids) ? request.body.ids.map(Number).filter(Boolean) : [];
    const isShow = Boolean(request.body?.isShow);
    if (!ids.length) return fail(reply, 400, '请选择商品');

    await getPool().query(
      `UPDATE ${legacyTable('store_integral')} SET is_show = ? WHERE id IN (${ids.map(() => '?').join(',')}) AND is_del = 0`,
      [isShow ? 1 : 0, ...ids]
    );
    return ok({ updatedCount: ids.length }, '批量状态已更新');
  });

  app.patch('/api/admin/integral-mall/products/reorder', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const ids = Array.isArray(request.body?.ids) ? request.body.ids.map(Number).filter(Boolean) : [];
    if (!ids.length) return fail(reply, 400, '排序列表不能为空');

    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const maxSort = ids.length;
      for (let index = 0; index < ids.length; index += 1) {
        await connection.query(
          `UPDATE ${legacyTable('store_integral')} SET sort = ? WHERE id = ? AND is_del = 0`,
          [maxSort - index, ids[index]]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const session = getAdminSession(request);
    await audit.write({
      adminUsername: session?.username || '',
      action: 'integral_mall_reorder',
      targetType: 'product',
      targetId: 0,
      payload: { ids },
      ip: getClientIp(request)
    });

    return ok({ updatedCount: ids.length }, '排序已保存');
  });

  app.post('/api/admin/integral-mall/products/collect-from-showcase', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const showcaseId = String(request.body?.showcaseId || '').trim();
    if (!showcaseId) return fail(reply, 400, '请选择展示商品');

    const source = await requireShownShowcase(showcaseId, reply);
    if (!source) return;

    const result = await insertIntegralProduct(getPool(), source, { isShow: false }, request);
    if (!result.ok) {
      if (result.skipped) return fail(reply, 409, `该商品已导入积分商城：${result.title}`);
      return fail(reply, 400, result.error || '采集转换失败', result.detail);
    }
    return ok(result.product, '已从展示商品采集');
  });

  app.post('/api/admin/integral-mall/products/collect-batch-showcase', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const showcaseIds = Array.isArray(request.body?.showcaseIds)
      ? request.body.showcaseIds.map(String).filter(Boolean)
      : [];
    const importAll = Boolean(request.body?.all);
    const sourceFilter = String(request.body?.source || '').trim();

    const data = await productsService.listAdminProducts({ status: 'shown', source: sourceFilter || undefined });
    let sources = data.list || [];
    if (showcaseIds.length) {
      const idSet = new Set(showcaseIds);
      sources = sources.filter((item) => idSet.has(String(item.id)));
    } else if (!importAll) {
      return fail(reply, 400, '请选择展示商品或勾选全部导入');
    }

    sources = sources.filter((item) => item.isShow);
    if (!sources.length) return fail(reply, 404, '未找到已上架的展示商品');

    const pool = getPool();
    const results = [];
    for (const source of sources) {
      const r = await insertIntegralProduct(pool, source, { isShow: false }, request);
      results.push({ ...r, title: source.storeName });
    }
    const summary = summarizeBatch(results);
    return ok(summary, `批量导入完成：新增 ${summary.createdCount}，跳过 ${summary.skippedCount}`);
  });

  app.post('/api/admin/integral-mall/products/collect-from-crmeb', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return fail(reply, 400, '积分商品请从已上架展示商品导入，不支持直接导入 CRMEB 商品');
  });

  app.post('/api/admin/integral-mall/products/collect-from-price-tags', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return fail(reply, 400, '请先在商品管理中采集价签并上架展示商品，再从展示商品导入积分商城');
  });

  app.post('/api/admin/integral-mall/products/collect-url', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const url = String(request.body?.url || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) return fail(reply, 400, '请输入有效的商品链接');
    return ok({ status: 'pending', url, message: '链接采集已记录，解析能力下一版接入' }, '已提交');
  });

  app.get('/api/admin/integral-mall/orders', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const page = Math.max(1, Number(request.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    const status = String(request.query.status || 'all');
    const uid = Number(request.query.uid || 0);
    const productId = Number(request.query.productId || 0);
    const dateFrom = String(request.query.dateFrom || '').trim();
    const dateTo = String(request.query.dateTo || '').trim();

    let where = "o.is_del = 0 AND o.order_id NOT LIKE 'DEMOIG%'";
    const values = [];
    if (status === 'pending') where += ' AND o.status NOT IN (3, -1)';
    else if (status === 'verified') where += ' AND o.status = 3';
    else if (status === 'cancelled') where += ' AND o.status = -1';
    if (uid > 0) {
      where += ' AND o.uid = ?';
      values.push(uid);
    }
    if (productId > 0) {
      where += ' AND o.product_id = ?';
      values.push(productId);
    }
    if (dateFrom) {
      where += ' AND o.add_time >= ?';
      values.push(Math.floor(new Date(`${dateFrom}T00:00:00`).getTime() / 1000));
    }
    if (dateTo) {
      where += ' AND o.add_time <= ?';
      values.push(Math.floor(new Date(`${dateTo}T23:59:59`).getTime() / 1000));
    }

    const pool = getPool();
    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS total FROM ${legacyTable('store_integral_order')} o WHERE ${where}`,
      values
    );
    const [rows] = await pool.query(
      `SELECT o.id, o.order_id, o.uid, o.product_id, o.store_name, o.image, o.total_price,
              o.verify_code, o.status, o.add_time, u.nickname AS user_nickname
       FROM ${legacyTable('store_integral_order')} o
       LEFT JOIN ${legacyTable('user')} u ON u.uid = o.uid
       WHERE ${where}
       ORDER BY o.add_time DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );

    return ok({
      total: Number(countRow?.total || 0),
      page,
      pageSize,
      list: rows.map((r) => ({
        id: r.id,
        orderId: r.order_id,
        uid: Number(r.uid || 0),
        userNickname: r.user_nickname || '',
        productId: Number(r.product_id || 0),
        productName: r.store_name || '',
        image: toPublicUrl(r.image || '', request),
        integralCost: Number(r.total_price || 0),
        verifyCode: r.verify_code || '',
        status: Number(r.status || 0),
      statusLabel: Number(r.status) === 3 ? '已核销' : (Number(r.status) === -1 ? '已撤销' : '待核销'),
      createdAt: Number(r.add_time || 0)
      }))
    });
  });

  app.post('/api/admin/integral-mall/orders/:orderId/cancel', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const orderId = String(request.params?.orderId || '').trim();
    if (!orderId || orderId.length > 64) return fail(reply, 400, '订单号无效');

    try {
      const data = await mallService.cancelExchangeByAdmin(orderId);
      const session = getAdminSession(request);
      await audit.write({
        adminUsername: session?.username || '',
        action: 'integral_mall_order_cancel',
        targetType: 'integral_order',
        targetId: data.orderId,
        payload: {
          uid: data.uid,
          productId: data.productId,
          refundIntegral: data.refundIntegral,
          balanceAfter: data.balanceAfter
        },
        ip: getClientIp(request)
      });
      return ok(data, '订单已撤销，积分和库存已恢复');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '撤销失败');
    }
  });

  // 一键修复存量积分商品图片：把 eb_store_integral 历史裸路径改写为绝对 URL，
  // 使小程序首页/导航（走 CRMEB PHP /api/store_integral/list）也能加载图片。幂等可重复执行。
  app.post('/api/admin/integral-mall/backfill-image-urls', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const result = await backfillIntegralImageUrls();
      const session = getAdminSession(request);
      await audit.write({
        adminUsername: session?.username || '',
        action: 'integral_mall_backfill_image_urls',
        targetType: 'product',
        targetId: 0,
        payload: { scanned: result.scanned, updated: result.updated },
        ip: getClientIp(request)
      });
      return ok(result, `已修复 ${result.updated} / ${result.scanned} 个积分商品图片`);
    } catch (error) {
      return fail(reply, 500, error.message || '回填失败');
    }
  });
}

module.exports = { registerAdminIntegralMallRoutes };
