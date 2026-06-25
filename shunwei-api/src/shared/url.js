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
 * - 其余按 "基址 + /相对路径" 拼接
 */
function toPublicUrl(input, request) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return '';
  if (/^(https?:)?\/\//i.test(raw)) return raw;
  if (/^(data|blob):/i.test(raw)) return raw;

  const base = resolveBase(request);
  if (!base) return raw; // 没有可用基址时退回原值，避免拼出错误地址
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return `${base}${path}`;
}

/** 数组版本：对每个元素调用 toPublicUrl，过滤空值。 */
function toPublicUrlList(list, request) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => toPublicUrl(item, request)).filter(Boolean);
}

module.exports = { toPublicUrl, toPublicUrlList };
