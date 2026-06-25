const { getPool, legacyTable } = require('../../shared/mysql');
const { toStoredUrl } = require('../../shared/url');

// 把 eb_store_integral 里历史写入的「裸相对路径 / 旧绝对格式」图片，统一改写为可加载的绝对 URL。
//
// 背景：小程序首页 pointsMall 组件与导航「积分商城」(pages/points_mall/*) 读取的是
//   CRMEB PHP /api/store_integral/list，它直接返回 eb_store_integral.image 原始值，
//   不经过本服务的 toPublicUrl 补全。若库里存的是 /uploads/...（无域名、无 /sw-api），
//   小程序 <image> 无法加载。本服务的「积分兑换」页因走 toPublicUrl 读取补全，故能显示——
//   于是出现「同一商品在自定义页能显示、在首页/导航不显示」的现象。
//
// 修复：把落库值本身改成绝对 URL（与写入侧 normalizeImageFields 同一套 toStoredUrl 规则），
//   两类读取方就都能拿到可加载地址。改写是幂等的：已是绝对 /api/file?p= 形式的行不会被重复修改。

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

// 仅当字符串是「需要补全的相对/旧格式」时返回新值；已正确或为外链则返回原值。
// 复用 toStoredUrl 保证与写入侧完全一致；request 传 null 时用 config.publicBaseUrl。
function normalizeOne(value) {
  return toStoredUrl(value, null);
}

/**
 * 扫描并修复 eb_store_integral 的 image / images 字段。
 * @returns {Promise<{scanned:number, updated:number, samples:Array}>}
 */
async function backfillIntegralImageUrls() {
  const pool = getPool();
  const table = legacyTable('store_integral');

  const [rows] = await pool.query(
    `SELECT id, image, images FROM ${table} WHERE is_del = 0`
  );

  let updated = 0;
  const samples = [];

  for (const row of rows) {
    const oldImage = row.image == null ? '' : String(row.image);
    const newImage = oldImage ? normalizeOne(oldImage) : '';

    const oldImagesArr = parseImages(row.images);
    const newImagesArr = oldImagesArr.map((img) => (img ? normalizeOne(img) : img)).filter(Boolean);
    const oldImagesRaw = row.images == null ? '' : String(row.images);
    const newImagesRaw = serializeImages(newImagesArr);

    const imageChanged = newImage !== oldImage;
    const imagesChanged = newImagesRaw !== oldImagesRaw;
    if (!imageChanged && !imagesChanged) continue;

    await pool.query(
      `UPDATE ${table} SET image = ?, images = ? WHERE id = ?`,
      [newImage, newImagesRaw, row.id]
    );
    updated += 1;
    if (samples.length < 10) {
      samples.push({ id: row.id, from: oldImage, to: newImage });
    }
  }

  return { scanned: rows.length, updated, samples };
}

// 启动时一次性自愈：非阻塞、吞错，绝不影响服务启动。
async function runStartupBackfillSafe(logger) {
  try {
    const result = await backfillIntegralImageUrls();
    if (result.updated > 0) {
      (logger?.info ? logger.info.bind(logger) : console.log)(
        `[integral-image-backfill] normalized ${result.updated}/${result.scanned} eb_store_integral rows`
      );
    }
    return result;
  } catch (error) {
    (logger?.warn ? logger.warn.bind(logger) : console.warn)(
      `[integral-image-backfill] skipped: ${error.code || ''} ${error.message || error}`
    );
    return { scanned: 0, updated: 0, samples: [], error: error.message };
  }
}

module.exports = { backfillIntegralImageUrls, runStartupBackfillSafe };
