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

// 安全回归：claimGift() 对 wechat_pay 渠道按真实支付金额倒推档位，不采信客户端 tierCode。
test('pickTierByPaidAmount 未配置方案价格时按默认199/299门槛', () => {
  assert.equal(MembershipService.pickTierByPaidAmount(299, []), 'SW299');
  assert.equal(MembershipService.pickTierByPaidAmount(199, []), 'SW199');
  assert.equal(MembershipService.pickTierByPaidAmount(198, []), '');
  assert.equal(MembershipService.pickTierByPaidAmount(0, []), '');
  assert.equal(MembershipService.pickTierByPaidAmount(-1, []), '');
});

test('pickTierByPaidAmount 按后台配置的方案价格取满足条件的最高档', () => {
  const plans = [
    { tierCode: 'SW199', price: 199, tierRank: 1 },
    { tierCode: 'SW299', price: 299, tierRank: 2 }
  ];
  assert.equal(MembershipService.pickTierByPaidAmount(299, plans), 'SW299');
  assert.equal(MembershipService.pickTierByPaidAmount(250, plans), 'SW199');
  assert.equal(MembershipService.pickTierByPaidAmount(199, plans), 'SW199');
  assert.equal(MembershipService.pickTierByPaidAmount(50, plans), '');
});

test('pickTierByPaidAmount 未配置价格的方案(price=0)不参与匹配，退回默认门槛', () => {
  const plans = [{ tierCode: 'SW199', price: 0, tierRank: 1 }];
  assert.equal(MembershipService.pickTierByPaidAmount(199, plans), 'SW199');
});
