const crypto = require('node:crypto');
const { config } = require('../../shared/config');

const COOKIE_NAME = 'sw_admin_session';

function verifyAdminCredentials(username, password) {
  return safeEqual(username, config.admin.username) && safeEqual(password, config.admin.password);
}

/**
 * 登录暴力破解节流（单进程内存版）。
 * 后台只有一个固定账号、无验证码/无锁定机制，此前 /admin/login 可无限次尝试。
 * 简单滑动窗口：同一来源连续失败达到阈值后锁定一段时间，成功登录即清零。
 * 进程重启会重置计数——对这种单管理员后台的威胁模型是可接受的取舍，
 * 比"完全不限"是明确的安全加固；不引入新依赖，纯内存 Map，量级极小。
 */
class LoginThrottle {
  constructor({ maxAttempts = 5, windowMs = 15 * 60 * 1000, lockoutMs = 15 * 60 * 1000 } = {}) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.lockoutMs = lockoutMs;
    this.records = new Map();
  }

  check(key, now = Date.now()) {
    const rec = this.records.get(key);
    if (!rec) return { locked: false };
    if (rec.lockedUntil && now < rec.lockedUntil) {
      return { locked: true, retryAfterSeconds: Math.ceil((rec.lockedUntil - now) / 1000) };
    }
    return { locked: false };
  }

  recordFailure(key, now = Date.now()) {
    let rec = this.records.get(key);
    if (!rec || now - rec.windowStart > this.windowMs) {
      rec = { count: 0, windowStart: now, lockedUntil: 0 };
    }
    rec.count += 1;
    if (rec.count >= this.maxAttempts) {
      rec.lockedUntil = now + this.lockoutMs;
    }
    this.records.set(key, rec);
  }

  recordSuccess(key) {
    this.records.delete(key);
  }
}

const adminLoginThrottle = new LoginThrottle();

/** Nginx 反代场景下 Fastify 未开 trustProxy 时 request.ip 只会是反代自身地址，优先取 X-Forwarded-For 首段。 */
function getClientKey(request) {
  const xff = String((request.headers && request.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return xff || (request.ip || 'unknown');
}

function createAdminSession(username, kind = 'super') {
  const issuedAt = Date.now();
  const maxAgeMs = config.admin.sessionMaxAgeSeconds * 1000;
  const expiresAt = issuedAt + maxAgeMs;
  const payload = Buffer.from(JSON.stringify({ username, kind, issuedAt, expiresAt })).toString('base64url');
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

function getAdminSession(request) {
  const token = getCookie(request.headers.cookie || '', COOKIE_NAME);
  if (!token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session || session.expiresAt < Date.now()) return null;
    const kind = session.kind || 'super';
    // 超管：用户名必须与 env 配置一致；子管理员：签名可信即认（存在性/停用在登录时校验）
    if (kind === 'super') {
      if (session.username !== config.admin.username) return null;
    } else if (kind !== 'sub') {
      return null;
    }
    return { ...session, kind };
  } catch {
    return null;
  }
}

/** 是否超级管理员会话（子管理员为 false）。用于危险操作(回收/删除/撤销/账号管理)的额外闸门。 */
function isSuperAdminSession(request) {
  const session = getAdminSession(request);
  return Boolean(session && (session.kind || 'super') === 'super');
}

function isAdminAuthenticated(request) {
  return Boolean(getAdminSession(request));
}

function setAdminSessionCookie(reply, username, kind = 'super') {
  const token = createAdminSession(username, kind);
  const isProduction = config.env === 'production';
  reply.header('Set-Cookie', serializeCookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'Strict' : 'Lax',
    path: '/',
    maxAge: config.admin.sessionMaxAgeSeconds
  }));
}

function clearAdminSessionCookie(reply) {
  reply.header('Set-Cookie', serializeCookie(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 0
  }));
}

function requireAdmin(request, reply) {
  if (isAdminAuthenticated(request)) return true;
  if (request.url.startsWith('/api/')) {
    reply.code(401).send({
      status: 401,
      msg: '请先登录后台',
      data: null
    });
    return false;
  }

  reply.redirect('/admin/login');
  return false;
}

/** 危险操作闸门：必须登录且为超级管理员。子管理员会收到 403。 */
function requireSuperAdmin(request, reply) {
  if (!requireAdmin(request, reply)) return false;
  if (!isSuperAdminSession(request)) {
    reply.code(403).send({
      status: 403,
      msg: '此操作仅超级管理员可执行',
      data: null
    });
    return false;
  }
  return true;
}

function sign(value) {
  return crypto
    .createHmac('sha256', config.admin.sessionSecret)
    .update(value)
    .digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getCookie(cookieHeader, name) {
  return String(cookieHeader)
    .split(';')
    .map((item) => item.trim())
    .map((item) => item.split('='))
    .find(([key]) => key === name)?.slice(1).join('=') || '';
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join('; ');
}

module.exports = {
  adminLoginThrottle,
  clearAdminSessionCookie,
  getAdminSession,
  getClientKey,
  isAdminAuthenticated,
  isSuperAdminSession,
  LoginThrottle,
  requireAdmin,
  requireSuperAdmin,
  setAdminSessionCookie,
  verifyAdminCredentials
};
