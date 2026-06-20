const test = require('node:test');
const assert = require('node:assert/strict');
const { MembershipService } = require('./membership.service');

test('normalizeTierCode 兼容旧别名', () => {
  const service = new MembershipService();
  assert.equal(service.normalizeTierCode('tier_199'), 'SW199');
  assert.equal(service.normalizeTierCode('tier_299'), 'SW299');
  assert.equal(service.normalizeTierCode('SW199'), 'SW199');
});

test('resolveMembershipChange 取高不降级', () => {
  const service = new MembershipService();
  const now = Math.floor(Date.now() / 1000);
  const currentExpire = now + 100 * 86400;

  const downgradeCase = service.resolveMembershipChange('SW299', 'SW199', currentExpire, 365);
  assert.equal(downgradeCase.afterTier, 'SW299');
  assert.equal(downgradeCase.afterOverdue, currentExpire + 365 * 86400);

  const upgradeCase = service.resolveMembershipChange('SW199', 'SW299', currentExpire, 365);
  assert.equal(upgradeCase.afterTier, 'SW299');
  assert.equal(upgradeCase.afterOverdue, currentExpire + 365 * 86400);
});

test('resolveMembershipChange 新用户从当前时间起算', () => {
  const service = new MembershipService();
  const before = Math.floor(Date.now() / 1000);
  const result = service.resolveMembershipChange('', 'SW199', 0, 365);
  assert.equal(result.afterTier, 'SW199');
  assert.ok(result.afterOverdue >= before + 365 * 86400);
});
