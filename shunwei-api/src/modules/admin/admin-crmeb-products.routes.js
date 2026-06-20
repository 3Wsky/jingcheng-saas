const { ok, fail } = require('../../shared/http');
const { getPool, legacyTable } = require('../../shared/mysql');
const { requireAdmin } = require('../admin/admin.auth');

function parseSliderImages(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  }
}

function mapCrmebProduct(row) {
  const images = parseSliderImages(row.slider_image);
  return {
    id: row.id,
    storeName: row.store_name,
    storeInfo: row.store_info || '',
    image: row.image || images[0] || '',
    sliderImages: images,
    price: Number(row.price || 0),
    stock: Number(row.stock || 0),
    unitName: row.unit_name || '件',
    specType: Number(row.spec_type || 0),
    sort: Number(row.sort || 0),
    isShow: Number(row.is_show) === 1
  };
}

function registerAdminCrmebProductRoutes(app) {
  app.get('/api/admin/crmeb-products', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const page = Math.max(1, Number(request.query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(request.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    const keyword = String(request.query.keyword || '').trim();

    let where = 'is_del = 0';
    const values = [];
    if (keyword) {
      where += ' AND (store_name LIKE ? OR keyword LIKE ? OR id = ?)';
      values.push(`%${keyword}%`, `%${keyword}%`, Number(keyword) || 0);
    }

    const [[countRow]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM ${legacyTable('store_product')} WHERE ${where}`,
      values
    );
    const [rows] = await getPool().query(
      `SELECT id, store_name, store_info, image, slider_image, price, stock, unit_name, spec_type, sort, is_show
       FROM ${legacyTable('store_product')} WHERE ${where}
       ORDER BY sort DESC, id DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );

    return ok({
      total: Number(countRow?.total || 0),
      page,
      pageSize,
      list: rows.map(mapCrmebProduct)
    });
  });

  app.get('/api/admin/crmeb-products/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number(request.params.id);
    const [[row]] = await getPool().query(
      `SELECT id, store_name, store_info, image, slider_image, price, stock, unit_name, spec_type, sort, is_show, give_integral
       FROM ${legacyTable('store_product')} WHERE id = ? AND is_del = 0`,
      [id]
    );
    if (!row) return fail(reply, 404, '商品不存在');

    const [skuRows] = await getPool().query(
      `SELECT id, suk, stock, price, image, \`unique\`, quota
       FROM ${legacyTable('store_product_attr_value')}
       WHERE product_id = ? AND type = 0 AND is_show = 1
       ORDER BY id ASC`,
      [id]
    );

    const [[descRow]] = await getPool().query(
      `SELECT description FROM ${legacyTable('store_product_description')}
       WHERE product_id = ? AND type = 0 LIMIT 1`,
      [id]
    );

    return ok({
      ...mapCrmebProduct(row),
      giveIntegral: Number(row.give_integral || 0),
      description: descRow?.description || '',
      skus: skuRows.map((s) => ({
        id: s.id,
        suk: s.suk,
        stock: Number(s.stock || 0),
        price: Number(s.price || 0),
        image: s.image || '',
        unique: s.unique || '',
        quota: Number(s.quota || 0),
        integralPrice: 0,
        integralQuota: 1
      }))
    });
  });
}

module.exports = { registerAdminCrmebProductRoutes };
