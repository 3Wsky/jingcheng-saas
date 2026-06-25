const { config } = require('./config');

// 从请求头兜底推导公网基址（在未配置 PUBLIC_BASE_URL 时使用）。
// 优先用 X-Forwarded-Proto / X-Forwarded-Host（Nginx 反代场景），否则退回 request.protocol + host。
function deriveBaseFromRequest(request) {
  if (!request || !request.headers) return '';
  const headers = request.headers;
  const proto = String(headers['x-forwarded-proto'] || request.protocol || 'http')
    .split(',')[0]
    .trim();
  const host = String(headers['x-forwarded-host'] || headers.host || '')
    .split(',')[0]
    .trim();
  if (!host) return '';
  const prefix = String(headers['x-forwarded-prefix'] || '').split(',')[0].trim().replace(/\/+$/, '');
  return `${proto}://${host}${prefix}`;
}

function resolveBase(request) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  return deriveBaseFromRequest(request).replace(/\/+$/, '');
}

/**
 * 把图片/文件路径补成可被浏览器与小程序访问的绝对 URL。
 * - 空值原样返回（保持 ''）
 * - data: / blob: / http(s):// 开头的原样返回（兼容旧 CRMEB 绝对图 & base64）
 * - // 协议相对地址原样返回
 * - 其余按 "基址 + /api/file?p=uploads/..." 拼接
 *
 * Nginx 对 .png/.jpg 等扩展名有 `location ~*` 正则规则，截获所有带这些后缀的请求。
 * /api/file?p=... 路由的 URL 路径不含文件后缀，Nginx 不会拦截。
 */
function toPublicUrl(input, request) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return '';
  if (/^(data|blob):/i.test(raw)) return raw;

  const base = resolveBase(request);

  if (/^(https?:)?\/\//i.test(raw)) {
    if (!base) return raw;
    // 修正先前写入 DB 的 /uploads/ 或 /api/uploads/ 旧格式绝对 URL
    const baseNoSlash = base.replace(/\/+$/, '');
    const uploadsPattern = raw.match(new RegExp(`^${baseNoSlash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/(?:api\\/)?uploads\\/(.+)`));
    if (uploadsPattern) {
      return `${baseNoSlash}/api/file?p=uploads/${uploadsPattern[1]}`;
    }
    return raw;
  }

  if (!base) return raw;
  let urlPath = raw.startsWith('/') ? raw : `/${raw}`;
  const relMatch = urlPath.match(/^\/(?:api\/)?uploads\/(.+)/);
  if (relMatch) {
    return `${base}/api/file?p=uploads/${relMatch[1]}`;
  }
  return `${base}${urlPath}`;
}

/** 数组版本：对每个元素调用 toPublicUrl，过滤空值。 */
function toPublicUrlList(list, request) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => toPublicUrl(item, request)).filter(Boolean);
}

/**
 * 入库前归一化：把图片路径转成「绝对可访问 URL」后再写入 DB。
 *
 * 与 toPublicUrl 的区别在使用场景：
 * - toPublicUrl：读取出图时调用，存量裸路径在响应里临时补全（不改库）。
 * - toStoredUrl：写入 CRMEB eb_store_integral 等「会被其它系统（如 CRMEB PHP）直接读取」的表前调用，
 *   让落库值本身就是绝对 URL，从而 CRMEB PHP /api/store_integral/list 等不经过本服务 toPublicUrl 的
 *   读取方也能拿到可加载的图片（小程序首页 pointsMall / 导航 points_mall 即走 CRMEB PHP 读取）。
 *
 * 语义与 toPublicUrl 完全一致（同样的相对→绝对、绝对旧格式纠正、http(s)/data 保留），
 * 故它是幂等的：已是 /api/file?p= 形式的绝对 URL 原样返回。
 */
function toStoredUrl(input, request) {
  return toPublicUrl(input, request);
}

/** 数组版本：入库前归一化每个元素，过滤空值。 */
function toStoredUrlList(list, request) {
  return toPublicUrlList(list, request);
}

module.exports = { toPublicUrl, toPublicUrlList, toStoredUrl, toStoredUrlList };
