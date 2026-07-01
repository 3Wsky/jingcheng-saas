const crypto = require('node:crypto');

const TOKEN_TTL_MS = 60_000;
const NONCE_CLEANUP_INTERVAL_MS = 120_000;

class VerifyTokenService {
  constructor(secret) {
    this._secret = secret || process.env.ADMIN_SESSION_SECRET || 'dev-verify-token-secret';
    this._usedNonces = new Map();
    this._cleanupTimer = setInterval(() => this._cleanup(), NONCE_CLEANUP_INTERVAL_MS);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }

  generate(uid) {
    const ts = Date.now();
    const nonce = crypto.randomBytes(8).toString('hex');
    const payload = JSON.stringify({ uid: Number(uid), ts, n: nonce });
    const payloadB64 = Buffer.from(payload).toString('base64url');
    const sig = this._sign(payloadB64);
    return `sw-pay:${payloadB64}.${sig}`;
  }

  validate(token) {
    if (!token || typeof token !== 'string') {
      return { valid: false, reason: '无效的核销码' };
    }

    const stripped = token.startsWith('sw-pay:') ? token.slice(7) : token;
    const dotIdx = stripped.lastIndexOf('.');
    if (dotIdx < 0) return { valid: false, reason: '核销码格式错误' };

    const payloadB64 = stripped.slice(0, dotIdx);
    const sig = stripped.slice(dotIdx + 1);

    const expected = this._sign(payloadB64);
    if (!this._signatureMatches(sig, expected)) {
      return { valid: false, reason: '核销码签名无效' };
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    } catch {
      return { valid: false, reason: '核销码数据损坏' };
    }

    const { uid, ts, n: nonce } = payload;
    if (!uid || !ts || !nonce) return { valid: false, reason: '核销码内容不完整' };

    const age = Date.now() - ts;
    if (age > TOKEN_TTL_MS) return { valid: false, reason: '核销码已过期，请让顾客刷新' };
    if (age < -5000) return { valid: false, reason: '核销码时间异常' };

    if (this._usedNonces.has(nonce)) {
      return { valid: false, reason: '该核销码已使用，请让顾客生成新码' };
    }

    this._usedNonces.set(nonce, Date.now());
    return { valid: true, uid: Number(uid), nonce };
  }

  peek(token) {
    if (!token || typeof token !== 'string') {
      return { valid: false, reason: '无效的核销码' };
    }
    const stripped = token.startsWith('sw-pay:') ? token.slice(7) : token;
    const dotIdx = stripped.lastIndexOf('.');
    if (dotIdx < 0) return { valid: false, reason: '核销码格式错误' };

    const payloadB64 = stripped.slice(0, dotIdx);
    const sig = stripped.slice(dotIdx + 1);
    const expected = this._sign(payloadB64);
    if (!this._signatureMatches(sig, expected)) {
      return { valid: false, reason: '核销码签名无效' };
    }
    let payload;
    try { payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()); } catch { return { valid: false, reason: '核销码数据损坏' }; }
    const { uid, ts } = payload;
    if (!uid || !ts) return { valid: false, reason: '核销码内容不完整' };
    const age = Date.now() - ts;
    if (age > TOKEN_TTL_MS) return { valid: false, reason: '核销码已过期' };
    if (age < -5000) return { valid: false, reason: '核销码时间异常' };
    return { valid: true, uid: Number(uid) };
  }

  // 仅校验签名并取出 nonce/uid，不消费 nonce、不校验 TTL。
  // 用于「核销结果回查」：此时核销码本就已被提交、可能已过期/已用，
  // 我们只需要拿到它的 nonce 去 DB nonce 表里查这笔到底成没成功。
  extractNonce(token) {
    if (!token || typeof token !== 'string') {
      return { valid: false, reason: '无效的核销码' };
    }
    const stripped = token.startsWith('sw-pay:') ? token.slice(7) : token;
    const dotIdx = stripped.lastIndexOf('.');
    if (dotIdx < 0) return { valid: false, reason: '核销码格式错误' };

    const payloadB64 = stripped.slice(0, dotIdx);
    const sig = stripped.slice(dotIdx + 1);
    const expected = this._sign(payloadB64);
    if (!this._signatureMatches(sig, expected)) {
      return { valid: false, reason: '核销码签名无效' };
    }
    let payload;
    try { payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()); } catch { return { valid: false, reason: '核销码数据损坏' }; }
    const { uid, n: nonce } = payload;
    if (!uid || !nonce) return { valid: false, reason: '核销码内容不完整' };
    return { valid: true, uid: Number(uid), nonce };
  }

  _sign(data) {
    return crypto.createHmac('sha256', this._secret).update(data).digest('base64url');
  }

  /**
   * crypto.timingSafeEqual 要求两个 Buffer 等长，否则直接 throw RangeError。
   * 核销码里的签名段来自请求体，长度完全由攻击者/畸形客户端控制——
   * 不判等长直接比较，会被随手一个短/长伪造签名的请求打出未捕获异常
   * （虽然上层路由有 try/catch 兜底转成 500，但会泄露实现细节且掩盖了本该返回的"签名无效"）。
   */
  _signatureMatches(sig, expected) {
    const sigBuf = Buffer.from(String(sig || ''));
    const expectedBuf = Buffer.from(String(expected || ''));
    if (sigBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  }

  _cleanup() {
    const cutoff = Date.now() - TOKEN_TTL_MS * 3;
    for (const [nonce, usedAt] of this._usedNonces) {
      if (usedAt < cutoff) this._usedNonces.delete(nonce);
    }
  }

  destroy() {
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
  }
}

let _instance;
function getVerifyTokenService() {
  if (!_instance) _instance = new VerifyTokenService();
  return _instance;
}

module.exports = { VerifyTokenService, getVerifyTokenService };
