const crypto = require('node:crypto');

// 企业微信回调消息加解密（WXBizMsgCrypt）
// 文档：https://developer.work.weixin.qq.com/document/path/90968
// - 签名：sha1(sort(token, timestamp, nonce, encrypt))
// - 加解密：AES-256-CBC，key = base64decode(encodingAESKey + '=')，iv = key 前 16 字节
//   明文结构：random(16) + msgLen(4, 大端) + msg + receiveId

function sha1(...args) {
  const sorted = args.map((a) => String(a)).sort().join('');
  return crypto.createHash('sha1').update(sorted, 'utf8').digest('hex');
}

/** 校验签名（GET 验证 echostr 与 POST 接收事件都用） */
function verifySignature(token, signature, timestamp, nonce, encrypt) {
  if (!token || !signature) return false;
  const expect = sha1(token, timestamp, nonce, encrypt);
  // 时间安全比较
  const a = Buffer.from(expect);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getAesKey(encodingAesKey) {
  const key = Buffer.from(encodingAesKey + '=', 'base64');
  if (key.length !== 32) {
    throw new Error('EncodingAESKey 非法（解码后必须为 32 字节）');
  }
  return key;
}

/** PKCS7 去填充 */
function pkcs7Unpad(buf) {
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) return buf;
  return buf.slice(0, buf.length - pad);
}

/** PKCS7 填充 */
function pkcs7Pad(buf) {
  const blockSize = 32;
  const padLen = blockSize - (buf.length % blockSize) || blockSize;
  const pad = Buffer.alloc(padLen, padLen);
  return Buffer.concat([buf, pad]);
}

/**
 * 解密企微密文，返回 { message, receiveId }
 */
function decrypt(encodingAesKey, encryptText) {
  const aesKey = getAesKey(encodingAesKey);
  const iv = aesKey.slice(0, 16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
  decipher.setAutoPadding(false);
  let decrypted = Buffer.concat([decipher.update(Buffer.from(encryptText, 'base64')), decipher.final()]);
  decrypted = pkcs7Unpad(decrypted);

  // 跳过前 16 字节随机数
  const content = decrypted.slice(16);
  const msgLen = content.readUInt32BE(0);
  const message = content.slice(4, 4 + msgLen).toString('utf8');
  const receiveId = content.slice(4 + msgLen).toString('utf8');
  return { message, receiveId };
}

/**
 * 加密明文（被动回复时用；本场景欢迎语走主动 API，一般用不到，但补全以备）
 */
function encrypt(encodingAesKey, message, receiveId) {
  const aesKey = getAesKey(encodingAesKey);
  const iv = aesKey.slice(0, 16);
  const random16 = crypto.randomBytes(16);
  const msgBuf = Buffer.from(message, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msgBuf.length, 0);
  const raw = Buffer.concat([random16, lenBuf, msgBuf, Buffer.from(receiveId, 'utf8')]);
  const padded = pkcs7Pad(raw);
  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

module.exports = { sha1, verifySignature, decrypt, encrypt };
