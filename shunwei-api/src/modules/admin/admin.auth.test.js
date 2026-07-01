const test = require('node:test');
const assert = require('node:assert/strict');
const { LoginThrottle, getClientKey } = require('./admin.auth');

// 安全回归：/admin/login 暴力破解节流（此前完全不限次数）。
test('LoginThrottle 达到阈值前不锁定', () => {
  const throttle = new LoginThrottle({ maxAttempts: 5, windowMs: 60000, lockoutMs: 60000 });
  const now = 1000000;
  for (let i = 0; i < 4; i += 1) {
    throttle.recordFailure('1.2.3.4', now);
    assert.equal(throttle.check('1.2.3.4', now).locked, false);
  }
});

test('LoginThrottle 达到阈值后锁定，锁定期内 check 返回 locked+剩余秒数', () => {
  const throttle = new LoginThrottle({ maxAttempts: 5, windowMs: 60000, lockoutMs: 60000 });
  const now = 1000000;
  for (let i = 0; i < 5; i += 1) throttle.recordFailure('1.2.3.4', now);

  const state = throttle.check('1.2.3.4', now + 1000);
  assert.equal(state.locked, true);
  assert.equal(state.retryAfterSeconds, 59);
});

test('LoginThrottle 锁定到期后自动解锁', () => {
  const throttle = new LoginThrottle({ maxAttempts: 5, windowMs: 60000, lockoutMs: 60000 });
  const now = 1000000;
  for (let i = 0; i < 5; i += 1) throttle.recordFailure('1.2.3.4', now);

  assert.equal(throttle.check('1.2.3.4', now + 60001).locked, false);
});

test('LoginThrottle 登录成功清零计数', () => {
  const throttle = new LoginThrottle({ maxAttempts: 5, windowMs: 60000, lockoutMs: 60000 });
  const now = 1000000;
  for (let i = 0; i < 4; i += 1) throttle.recordFailure('1.2.3.4', now);
  throttle.recordSuccess('1.2.3.4');

  for (let i = 0; i < 4; i += 1) throttle.recordFailure('1.2.3.4', now);
  assert.equal(throttle.check('1.2.3.4', now).locked, false, '清零后需要重新累计到阈值才会锁定');
});

test('LoginThrottle 不同来源互不影响', () => {
  const throttle = new LoginThrottle({ maxAttempts: 5, windowMs: 60000, lockoutMs: 60000 });
  const now = 1000000;
  for (let i = 0; i < 5; i += 1) throttle.recordFailure('1.2.3.4', now);
  assert.equal(throttle.check('5.6.7.8', now).locked, false);
});

test('LoginThrottle 超出统计窗口后重新计数，不会误锁定', () => {
  const throttle = new LoginThrottle({ maxAttempts: 5, windowMs: 60000, lockoutMs: 60000 });
  throttle.recordFailure('1.2.3.4', 0);
  throttle.recordFailure('1.2.3.4', 1000);
  throttle.recordFailure('1.2.3.4', 2000);
  throttle.recordFailure('1.2.3.4', 3000);
  // 第 5 次失败发生在窗口之外 → 计数重新从 1 开始，不应触发锁定
  throttle.recordFailure('1.2.3.4', 61000);
  assert.equal(throttle.check('1.2.3.4', 61000).locked, false);
});

test('getClientKey 优先取 X-Forwarded-For 首段，否则退回 request.ip', () => {
  assert.equal(
    getClientKey({ headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }, ip: '127.0.0.1' }),
    '9.9.9.9'
  );
  assert.equal(getClientKey({ headers: {}, ip: '127.0.0.1' }), '127.0.0.1');
  assert.equal(getClientKey({ headers: {} }), 'unknown');
});
