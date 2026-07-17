const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeConfig,
  selectNextCard,
  extractApprovalProductModel,
  isPhoneLikeNickname,
  mapApprovalLiveFeed,
  mapIntegralLiveFeed,
  buildMiniappCodeUrl
} = require('./coupon-landing.routes');

test('coupon landing config keeps a unique ordered manager list', () => {
  const result = normalizeConfig({ managerUids: [4, '2', 4, 0, -1], cursor: 3 });
  assert.deepEqual(result.managerUids, [4, 2]);
  assert.equal(result.cursor, 3);
});

test('coupon landing config only keeps the fixed miniapp code file', () => {
  const valid = normalizeConfig({
    miniappCodePath: '/uploads/miniapp/coupon-landing.png',
    miniappCodeUpdatedAt: 123
  });
  assert.equal(valid.miniappCodePath, '/uploads/miniapp/coupon-landing.png');
  assert.equal(valid.miniappCodeUpdatedAt, 123);

  const invalid = normalizeConfig({
    miniappCodePath: '/uploads/other.png',
    miniappCodeUpdatedAt: 123
  });
  assert.equal(invalid.miniappCodePath, '');
});

test('coupon landing miniapp code URL includes a cache version', () => {
  const url = buildMiniappCodeUrl(null, '/uploads/miniapp/coupon-landing.jpg', 456);
  assert.match(url, /api\/file\?p=uploads\/miniapp\/coupon-landing\.jpg&v=456$/);
});

test('coupon landing manager cards rotate in configured order', async () => {
  const state = { managerUids: [11, 22, 33, 44], cursor: 0 };
  const shown = [];
  for (let i = 0; i < 6; i += 1) {
    const selected = await selectNextCard(state, async (uid) => ({ uid }));
    state.cursor = selected.cursor;
    shown.push(selected.payload.staffUid);
  }
  assert.deepEqual(shown, [11, 22, 33, 44, 11, 22]);
});

test('coupon landing rotation skips unavailable cards without duplicates', async () => {
  const state = { managerUids: [11, 22, 33], cursor: 0 };
  const shown = [];
  for (let i = 0; i < 4; i += 1) {
    const selected = await selectNextCard(state, async (uid) => {
      if (uid === 11) throw new Error('unpublished');
      return { uid };
    });
    state.cursor = selected.cursor;
    shown.push(selected.payload.staffUid);
  }
  assert.deepEqual(shown, [22, 33, 22, 33]);
});

test('coupon landing approval feed includes the customer, model and benefits', () => {
  const receiptNo = '[产品1] 手机/Mate 80 Pro/¥5999/IMEI:123';
  assert.equal(extractApprovalProductModel(receiptNo), 'Mate 80 Pro');
  const event = mapApprovalLiveFeed({
    id: 8,
    customer_nickname: '小王',
    receipt_no: receiptNo,
    matched_voucher_amount: 300,
    matched_integral: 199000,
    updated_at: 100
  });
  assert.deepEqual(event, {
    id: 'approval-8',
    type: 'approval',
    customerNickname: '小王',
    productModel: 'Mate 80 Pro',
    voucherAmount: 300,
    points: 199000,
    occurredAt: 100
  });
});

test('coupon landing integral feed maps a real points order', () => {
  assert.deepEqual(mapIntegralLiveFeed({
    id: 3,
    customer_nickname: '小李',
    store_name: '蓝牙耳机',
    total_price: 19900,
    add_time: 80
  }), {
    id: 'integral-3',
    type: 'integral',
    customerNickname: '小李',
    productName: '蓝牙耳机',
    voucherAmount: 0,
    points: 19900,
    occurredAt: 80
  });
});

test('coupon landing excludes phone-formatted customer nicknames', () => {
  assert.equal(isPhoneLikeNickname('152****8807'), true);
  assert.equal(isPhoneLikeNickname('15212348807'), true);
  assert.equal(isPhoneLikeNickname('小米同学'), false);
});
