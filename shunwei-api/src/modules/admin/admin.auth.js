const crypto = require('node:crypto');
const { config } = require('../../shared/config');

const COOKIE_NAME = 'sw_admin_session';

function verifyAdminCredentials(username, password) {
  return safeEqual(username, config.admin.username) && safeEqual(password, config.admin.password);
}

function createAdminSession(username) {
  const issuedAt = Date.now();
  const maxAgeMs = config.admin.sessionMaxAgeSeconds * 1000;
  const expiresAt = issuedAt + maxAgeMs;
  const payload = Buffer.from(JSON.stringify({ username, issuedAt, expiresAt })).toString('base64url');
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
    if (session.username !== config.admin.username) return null;
    return session;
  } catch {
    return null;
  }
}

function isAdminAuthenticated(request) {
  return Boolean(getAdminSession(request));
}

function setAdminSessionCookie(reply, username) {
  const token = createAdminSession(username);
  reply.header('Set-Cookie', serializeCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
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
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join('; ');
}

module.exports = {
  clearAdminSessionCookie,
  getAdminSession,
  isAdminAuthenticated,
  requireAdmin,
  setAdminSessionCookie,
  verifyAdminCredentials
};
