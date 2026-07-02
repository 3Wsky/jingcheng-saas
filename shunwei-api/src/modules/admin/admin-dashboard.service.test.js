const test = require('node:test');
const assert = require('node:assert/strict');
const { getRangeBounds } = require('./admin-dashboard.service');

const DAY = 86400;

function todayStartSec() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

test('today: 卡片=今日、上界为现在、趋势近7日(含今日)', () => {
  const b = getRangeBounds('today');
  const ts = todayStartSec();
  assert.equal(b.range, 'today');
  assert.equal(b.cardStart, ts);
  assert.equal(b.dayStart, ts);
  assert.ok(b.dayEnd >= ts, '上界应 >= 今日0点(约等于现在)');
  assert.equal(b.trendDays, 7);
  assert.equal(b.trendStart, ts - 6 * DAY, '趋势起点=6天前，向后迭代7天正好含今日');
});

test('7d/30d: 保持原语义(卡片仍为今日、趋势为近N日)', () => {
  const ts = todayStartSec();
  const b7 = getRangeBounds('7d');
  assert.equal(b7.cardStart, ts);
  assert.equal(b7.dayStart, ts - 6 * DAY);
  assert.equal(b7.trendDays, 7);
  assert.equal(b7.trendStart, ts - 6 * DAY);

  const b30 = getRangeBounds('30d');
  assert.equal(b30.cardStart, ts);
  assert.equal(b30.dayStart, ts - 29 * DAY);
  assert.equal(b30.trendDays, 30);
  assert.equal(b30.trendStart, ts - 29 * DAY);
});

test('yesterday: 整段=[昨日0点,今日0点)，卡片与区间同界', () => {
  const ts = todayStartSec();
  const b = getRangeBounds('yesterday');
  assert.equal(b.range, 'yesterday');
  assert.equal(b.dayStart, ts - DAY);
  assert.equal(b.dayEnd, ts, '上界为今日0点(不含今日)');
  assert.equal(b.cardStart, ts - DAY, '卡片下界=昨日0点');
  assert.equal(b.cardEnd, ts, '卡片上界=今日0点');
  assert.equal(b.trendDays, 7);
  assert.equal(b.trendStart, ts - 7 * DAY, '趋势以昨日为最后一天，起点=7天前');
});

test('custom 单日: start=end 时区间为该日一整天', () => {
  const b = getRangeBounds('custom', { startDate: '2026-01-15', endDate: '2026-01-15' });
  assert.ok(b, '应返回有效边界');
  const dayStart = Math.floor(new Date(2026, 0, 15, 0, 0, 0, 0).getTime() / 1000);
  assert.equal(b.dayStart, dayStart);
  assert.equal(b.dayEnd, dayStart + DAY, '含当天：上界为次日0点');
  assert.equal(b.trendDays, 1);
  assert.equal(b.trendStart, dayStart);
});

test('custom 多日: 含 endDate 当天，趋势天数=闭区间天数', () => {
  const b = getRangeBounds('custom', { startDate: '2026-01-10', endDate: '2026-01-12' });
  const s = Math.floor(new Date(2026, 0, 10, 0, 0, 0, 0).getTime() / 1000);
  const e = Math.floor(new Date(2026, 0, 12, 0, 0, 0, 0).getTime() / 1000) + DAY;
  assert.equal(b.dayStart, s);
  assert.equal(b.dayEnd, e);
  assert.equal(b.trendDays, 3, '10/11/12 共3天');
  assert.equal(b.trendStart, e - 3 * DAY);
});

test('custom endDate 缺省时默认与 startDate 同日', () => {
  const b = getRangeBounds('custom', { startDate: '2026-02-01' });
  const s = Math.floor(new Date(2026, 1, 1, 0, 0, 0, 0).getTime() / 1000);
  assert.equal(b.dayStart, s);
  assert.equal(b.dayEnd, s + DAY);
  assert.equal(b.trendDays, 1);
});

test('custom 趋势天数封顶 90 天', () => {
  const b = getRangeBounds('custom', { startDate: '2020-01-01', endDate: '2026-01-01' });
  assert.ok(b);
  assert.equal(b.trendDays, 90, '超长区间趋势点数封顶 90');
  // 卡片/区间仍覆盖完整区间（上界为 endDate 次日0点）
  const e = Math.floor(new Date(2026, 0, 1, 0, 0, 0, 0).getTime() / 1000) + DAY;
  assert.equal(b.dayEnd, e);
});

test('custom 非法: 缺 startDate / 结束早于开始 / 格式错误 → null', () => {
  assert.equal(getRangeBounds('custom', {}), null);
  assert.equal(getRangeBounds('custom', { startDate: '2026-03-10', endDate: '2026-03-01' }), null);
  assert.equal(getRangeBounds('custom', { startDate: 'not-a-date' }), null);
  assert.equal(getRangeBounds('custom', { startDate: '2026-13-40' }), null, '越界月/日应判非法');
});

test('未知 range 回退为 today', () => {
  const b = getRangeBounds('week');
  assert.equal(b.range, 'today');
  assert.equal(b.cardStart, todayStartSec());
});
