const test = require('node:test');
const assert = require('node:assert/strict');
const { VerifyTokenService } = require('./verify-token.service');

function makeService() {
  const svc = new VerifyTokenService('test-secret-not-for-prod');
  svc.destroy(); // 单测不需要后台清理定时器，避免 keep-alive 影响进程退出
  return svc;
}

test('generate + validate 正常往返成功，且只能核销一次', () => {
  const svc = makeService();
  const token = svc.generate(42);
  const first = svc.validate(token);
  assert.equal(first.valid, true);
  assert.equal(first.uid, 42);

  const second = svc.validate(token);
  assert.equal(second.valid, false);
  assert.match(second.reason, /已使用/);
});

test('peek 不消费 nonce，之后仍可 validate 一次', () => {
  const svc = makeService();
  const token = svc.generate(7);
  const peeked = svc.peek(token);
  assert.equal(peeked.valid, true);
  assert.equal(peeked.uid, 7);

  const validated = svc.validate(token);
  assert.equal(validated.valid, true, 'peek 不应消费 nonce');
});

test('签名长度不匹配的伪造 token 不抛异常，返回签名无效', () => {
  const svc = makeService();
  const token = svc.generate(1);
  const [prefix, payloadAndSig] = [token.slice(0, 7), token.slice(7)];
  const dotIdx = payloadAndSig.lastIndexOf('.');
  const payloadB64 = payloadAndSig.slice(0, dotIdx);
  const tamperedShort = `${prefix}${payloadB64}.x`;
  const tamperedLong = `${prefix}${payloadB64}.${'x'.repeat(999)}`;

  assert.doesNotThrow(() => {
    const r = svc.validate(tamperedShort);
    assert.equal(r.valid, false);
    assert.match(r.reason, /签名无效/);
  });
  assert.doesNotThrow(() => {
    const r = svc.validate(tamperedLong);
    assert.equal(r.valid, false);
    assert.match(r.reason, /签名无效/);
  });
  assert.doesNotThrow(() => {
    const r = svc.peek(tamperedShort);
    assert.equal(r.valid, false);
  });
  assert.doesNotThrow(() => {
    const r = svc.extractNonce(tamperedShort);
    assert.equal(r.valid, false);
  });
});

test('篡改 payload（uid 改成别人）会因签名不匹配被拒绝', () => {
  const svc = makeService();
  const token = svc.generate(1);
  const dotIdx = token.lastIndexOf('.');
  const payloadB64 = token.slice(7, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  const forgedPayload = Buffer.from(JSON.stringify({ ...payload, uid: 999 })).toString('base64url');
  const forgedToken = `sw-pay:${forgedPayload}.${sig}`;

  const result = svc.validate(forgedToken);
  assert.equal(result.valid, false);
  assert.match(result.reason, /签名无效/);
});

test('过期 token 被拒绝', () => {
  const svc = makeService();
  const realNow = Date.now;
  Date.now = () => realNow() - 61_000;
  const token = svc.generate(5);
  Date.now = realNow;

  const result = svc.validate(token);
  assert.equal(result.valid, false);
  assert.match(result.reason, /过期/);
});

test('格式错误/空 token 均返回 invalid 而不抛异常', () => {
  const svc = makeService();
  for (const bad of [null, undefined, '', 'not-a-token', 'sw-pay:no-dot-here', 123]) {
    assert.doesNotThrow(() => {
      const r = svc.validate(bad);
      assert.equal(r.valid, false);
    });
  }
});
