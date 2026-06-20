const crypto = require('node:crypto');
const { config } = require('./config');

function parseLegacyToken(rawToken) {
  const token = String(rawToken || '').replace(/^Bearer\s+/i, '').trim();
  if (!token || token === 'undefined') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header;
  let payload;

  try {
    header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
  } catch (error) {
    return null;
  }

  if (header.alg !== 'HS256') return null;

  const expectedSignature = crypto
    .createHmac('sha256', config.legacy.appKey)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const actualSignature = base64UrlDecode(encodedSignature);

  if (
    expectedSignature.length !== actualSignature.length ||
    !crypto.timingSafeEqual(expectedSignature, actualSignature)
  ) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const leeway = config.legacy.tokenLeewaySeconds;
  if (payload.exp && now > Number(payload.exp) + leeway) return null;
  if (payload.nbf && now + leeway < Number(payload.nbf)) return null;

  const uid = payload && payload.jti ? Number(payload.jti.id) : 0;
  if (!Number.isInteger(uid) || uid <= 0) return null;

  return {
    uid,
    type: payload.jti.type || '',
    payload
  };
}

function base64UrlDecode(value) {
  let input = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64');
}

module.exports = { parseLegacyToken };
