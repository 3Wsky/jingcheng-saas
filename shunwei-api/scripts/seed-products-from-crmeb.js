/**
 * 从 CRMEB eb_store_product 表把"在售/未删除"的商品种子到 shunwei-api 的展示商品库
 * (data/products.json)，并标记 isShow=true，使新小程序 shunwei-app-v2 的商品页有真实数据。
 *
 * 用法：cd CMB/shunwei-api && node scripts/seed-products-from-crmeb.js
 * 幂等：按 productKey(crmeb:<id>) 合并，已存在则更新基础字段、保留 isShow。
 */
const path = require('node:path');
const { getPool, legacyTable } = require('../src/shared/mysql');
const { ProductsRepository } = require('../src/modules/products/products.repository');

function cleanText(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
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
function absImage(img) {
  const s = cleanText(img);
  if (!s) return '';
  if (/^https?:\/\//.test(s)) return s;
  // CRMEB 相对路径补全到生产域名
  return 'https://ok.xjshunwei.cn' + (s.startsWith('/') ? '' : '/') + s;
}

async function main() {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT id, store_name, store_info, keyword, image, price, ot_price, unit_name, sort
       FROM ${legacyTable('store_product')}
      WHERE is_del = 0 AND is_show = 1
      ORDER BY sort DESC, id ASC`
  );

  const now = new Date().toISOString();
  const incoming = rows.map((r) => {
    const brand = normalizeBrand(r.store_name);
    const price = Math.max(0, Math.round(Number(r.price) || 0));
    return {
      productKey: `crmeb:${r.id}`,
      crmebId: r.id,
      brand,
      model: cleanText(r.store_name),
      storeName: cleanText(r.store_name),
      storeInfo: cleanText(r.store_info) || `${brand} 正品`,
      keyword: cleanText(r.keyword) || cleanText(r.store_name),
      price,
      otPrice: Math.max(0, Math.round(Number(r.ot_price) || 0)),
      unitName: cleanText(r.unit_name) || '台',
      image: absImage(r.image),
      sliderImages: [],
      recommendImage: '',
      isShow: true,
      isHot: false,
      isBest: false,
      isNew: false,
      sort: Number.isFinite(Number(r.sort)) ? Number(r.sort) : 0,
      specType: 0,
      attrs: [],
      skuPrices: [],
      colors: [],
      features: [],
      specs: {},
      paramsList: [],
      description: cleanText(r.store_info),
      source: 'crmeb',
      priceStatus: price > 0 ? 'available' : 'pending',
      scrapedAt: now,
      raw: { sourceTable: 'eb_store_product', sourceId: r.id }
    };
  });

  const repo = new ProductsRepository();
  let created = 0;
  let updated = 0;
  const nano = () => 'p' + Math.random().toString(36).slice(2, 12);

  await repo.updateAll((state) => {
    const byKey = new Map(state.products.map((p) => [p.productKey, p]));
    for (const item of incoming) {
      const exist = byKey.get(item.productKey);
      if (exist) {
        Object.assign(exist, item, {
          id: exist.id,
          isShow: exist.isShow === undefined ? item.isShow : exist.isShow,
          createdAt: exist.createdAt || now,
          updatedAt: now
        });
        updated += 1;
      } else {
        const rec = { ...item, id: nano(), createdAt: now, updatedAt: now, importedAt: now };
        state.products.push(rec);
        byKey.set(rec.productKey, rec);
        created += 1;
      }
    }
    state.products.sort((a, b) => Number(b.sort || 0) - Number(a.sort || 0));
    return state;
  });

  console.log(`[seed-products] 完成: 来源 ${rows.length} 条, 新建 ${created}, 更新 ${updated}`);
  console.log(`[seed-products] 输出: ${path.resolve(repo.filePath)}`);
  await pool.end();
}

main().catch((e) => {
  console.error('[seed-products] 失败:', e.message);
  process.exit(1);
});
