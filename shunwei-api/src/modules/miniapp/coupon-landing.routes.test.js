const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeConfig, selectNextCard } = require('./coupon-landing.routes');

test('coupon landing config keeps a unique ordered manager list', () => {
  const result = normalizeConfig({ managerUids: [4, '2', 4, 0, -1], cursor: 3 });
  assert.deepEqual(result.managerUids, [4, 2]);
  assert.equal(result.cursor, 3);
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
