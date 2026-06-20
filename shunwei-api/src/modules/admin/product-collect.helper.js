const { getPool, legacyTable } = require('../../shared/mysql');

function cleanText(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

function absImage(img) {
  const s = cleanText(img);
  if (!s) return '';
  if (/^https?:\/\//.test(s)) return s;
  return `https://ok.xjshunwei.cn${s.startsWith('/') ? '' : '/'}${s}`;
}

function parseSliderImages(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(absImage) : [];
  } catch {
    return String(raw).split(',').map((s) => absImage(s.trim())).filter(Boolean);
  }
}

function normalizeBrand(text) {
  const t = cleanText(text);
  if (/honor|荣耀/i.test(t)) return '荣耀';
  if (/huawei|华为/i.test(t)) return '华为';
  if (/xiaomi|小米|redmi/i.test(t)) return '小米';
  if (/iqoo/i.test(t)) return 'iQOO';
  if (/vivo/i.test(t)) return 'vivo';
  if (/oppo/i.test(t)) return 'OPPO';
  if (/apple|iphone|ipad|苹果/i.test(t)) return 'Apple';
  if (/dji|大疆|osmo/i.test(t)) return 'DJI';
  return '数码';
}

function showcaseToIntegralPayload(source, overrides = {}) {
  const images = (source.sliderImages || []).filter(Boolean).map(absImage);
  const image = absImage(source.image) || images[0] || '';
  const cashPrice = Number(source.price || 0);
  const defaultIntegral = Math.max(1000, Math.round(cashPrice * 10));

  return {
    productId: Number(source.crmebId || source.productId || source.raw?.sourceId || 0) || undefined,
    title: cleanText(source.storeName || source.title),
    image,
    images: images.length ? images : (image ? [image] : []),
    price: overrides.integralPrice ?? defaultIntegral,
    stock: overrides.stock ?? 100,
    isShow: overrides.isShow ?? false,
    sort: Number(source.sort || 0),
    unitName: cleanText(source.unitName) || '件',
    description: cleanText(source.description || source.storeInfo || ''),
    specType: Number(source.specType || 0),
    attrs: []
  };
}

async function fetchCrmebProducts(pool, ids = []) {
  const idList = (ids || []).map(Number).filter((n) => n > 0);
  let where = 'is_del = 0';
  const values = [];
  if (idList.length) {
    where += ` AND id IN (${idList.map(() => '?').join(',')})`;
    values.push(...idList);
  } else {
    where += ' AND is_show = 1';
  }

  const [rows] = await pool.query(
    `SELECT id, store_name, store_info, keyword, image, slider_image, price, ot_price, unit_name, sort, stock, spec_type
     FROM ${legacyTable('store_product')} WHERE ${where}
     ORDER BY sort DESC, id ASC`,
    values
  );

  return rows.map((r) => {
    const images = parseSliderImages(r.slider_image);
    const image = absImage(r.image) || images[0] || '';
    return {
      crmebId: r.id,
      productId: r.id,
      storeName: cleanText(r.store_name),
      storeInfo: cleanText(r.store_info),
      keyword: cleanText(r.keyword),
      price: Math.max(0, Math.round(Number(r.price) || 0)),
      stock: Number(r.stock || 0),
      unitName: cleanText(r.unit_name) || '件',
      sort: Number(r.sort || 0),
      image,
      sliderImages: images,
      description: cleanText(r.store_info),
      specType: Number(r.spec_type || 0),
      source: 'crmeb'
    };
  });
}

async function findIntegralByProductId(pool, productId) {
  const [[row]] = await pool.query(
    `SELECT id, title FROM ${legacyTable('store_integral')} WHERE product_id = ? AND is_del = 0 LIMIT 1`,
    [productId]
  );
  return row || null;
}

function serializeImages(list) {
  const arr = (list || []).filter(Boolean);
  return arr.length ? JSON.stringify(arr) : '';
}

module.exports = {
  cleanText,
  absImage,
  parseSliderImages,
  normalizeBrand,
  showcaseToIntegralPayload,
  fetchCrmebProducts,
  findIntegralByProductId,
  serializeImages
};
