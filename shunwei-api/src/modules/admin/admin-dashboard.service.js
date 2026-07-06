const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

const DAY = 86400;
// 自定义区间最多回看的天数（趋势图点数上限，防止一次拉取过多）
const MAX_CUSTOM_TREND_DAYS = 90;

// 将 YYYY-MM-DD 解析为当天 0 点的秒级时间戳（本地时区）；非法返回 null
function parseDateStartSec(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return Math.floor(d.getTime() / 1000);
}

/**
 * 计算区间边界。返回 { range, dayStart, dayEnd, cardStart, cardEnd, trendStart, trendDays }
 * - today/7d/30d：保持原行为——cardStart 恒为今日 0 点、上界为“现在”（即 now）；趋势按各自天数
 * - yesterday：整段 = 昨日 0 点 ~ 今日 0 点；卡片与区间上下界一致；趋势展示近 7 日（含昨日）
 * - custom：整段 = startDate 0 点 ~ endDate 次日 0 点；卡片与区间上下界一致；趋势覆盖整段（上限 90 天）
 */
function getRangeBounds(range, opts = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartSec = Math.floor(todayStart.getTime() / 1000);

  if (range === '7d') {
    const s = todayStartSec - 6 * DAY;
    // 趋势=近 7 日（含今日），向后迭代时起点须为 6 天前
    return { range, dayStart: s, dayEnd: nowSec, cardStart: todayStartSec, cardEnd: nowSec, trendStart: s, trendDays: 7 };
  }
  if (range === '30d') {
    const s = todayStartSec - 29 * DAY;
    // 趋势=近 30 日（含今日），起点须为 29 天前
    return { range, dayStart: s, dayEnd: nowSec, cardStart: todayStartSec, cardEnd: nowSec, trendStart: s, trendDays: 30 };
  }
  if (range === 'yesterday') {
    const yStart = todayStartSec - DAY;
    // 趋势展示近 7 日（以昨日为最后一天）
    const trendStart = todayStartSec - 7 * DAY;
    return { range: 'yesterday', dayStart: yStart, dayEnd: todayStartSec, cardStart: yStart, cardEnd: todayStartSec, trendStart, trendDays: 7 };
  }
  if (range === 'custom') {
    const startSec = parseDateStartSec(opts.startDate);
    let endStartSec = parseDateStartSec(opts.endDate);
    if (startSec == null) return null; // 交由上层报参数错误
    // endDate 缺省时默认与 startDate 同一天
    if (endStartSec == null) endStartSec = startSec;
    if (endStartSec < startSec) return null; // 结束早于开始，非法
    const endExclusive = endStartSec + DAY; // 含 endDate 当天：上界为其次日 0 点
    let trendDays = Math.round((endExclusive - startSec) / DAY);
    if (trendDays < 1) trendDays = 1;
    if (trendDays > MAX_CUSTOM_TREND_DAYS) trendDays = MAX_CUSTOM_TREND_DAYS;
    // 趋势起点：从结束往回 trendDays 天，保证与整段右端对齐且点数受控
    const trendStart = endExclusive - trendDays * DAY;
    return { range: 'custom', dayStart: startSec, dayEnd: endExclusive, cardStart: startSec, cardEnd: endExclusive, trendStart, trendDays };
  }
  // today：卡片/区间为今日，趋势沿用近 7 日（含今日），起点为 6 天前
  return { range: 'today', dayStart: todayStartSec, dayEnd: nowSec, cardStart: todayStartSec, cardEnd: nowSec, trendStart: todayStartSec - 6 * DAY, trendDays: 7 };
}

class AdminDashboardService {
  async sumIntegralGranted(pool, startAt, endAt) {
    const [[row]] = await pool.query(
      `SELECT COALESCE(SUM(l.amount), 0) AS total
       FROM ${swTable('integral_ledger')} l
       LEFT JOIN ${swTable('integral_batch')} b ON b.id = l.batch_id
       WHERE l.direction = 1
         AND l.biz_type = 'grant'
         AND l.amount IN (199000, 299000)
         AND (
           b.source_type = 'approval_grant'
           OR (b.source_type = 'membership_grant' AND b.source_id LIKE 'offline_approval:%')
         )
         AND l.created_at >= ? AND l.created_at < ?`,
      [startAt, endAt]
    );
    return Number(row?.total || 0);
  }

  async sumIntegralConsumed(pool, startAt, endAt) {
    try {
      const [[mallRow]] = await pool.query(
        `SELECT COALESCE(SUM(o.total_price), 0) AS total
         FROM ${legacyTable('store_integral_order')} o
         JOIN ${swTable('integral_mall_verify_log')} v ON v.order_id = o.order_id
         WHERE o.is_del = 0
           AND o.status = 3
           AND o.order_id NOT LIKE 'DEMOIG%'
           AND v.verify_status = 1
           AND v.verified_at >= ? AND v.verified_at < ?`,
        [startAt, endAt]
      );
      return Number(mallRow?.total || 0);
    } catch { /* ignore */ }

    return 0;
  }

  async getSummary(rangeInput, opts = {}) {
    const range = ['today', '7d', '30d', 'yesterday', 'custom'].includes(rangeInput) ? rangeInput : 'today';
    const bounds = getRangeBounds(range, opts);
    if (!bounds) {
      const err = new Error('自定义日期区间参数无效（请检查开始/结束日期）');
      err.statusCode = 400;
      throw err;
    }
    const pool = getPool();
    const now = Math.floor(Date.now() / 1000);

    const [[memberRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM ${legacyTable('user')} WHERE COALESCE(is_del, 0) = 0`
    );

    // 今日核销笔数（固定当天，供导出/兼容用）
    let verifyToday = 0;
    // 本期核销笔数（随 today/7d/30d 变化，供看板核销卡片用）
    let verifyInPeriod = 0;
    try {
      const [[v1today]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${swTable('integral_mall_verify_log')}
         WHERE order_id NOT LIKE 'DEMOIG%' AND created_at >= ? AND created_at < ?`,
        [bounds.cardStart, bounds.cardEnd]
      );
      verifyToday += Number(v1today?.cnt || 0);
      const [[v1period]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${swTable('integral_mall_verify_log')}
         WHERE order_id NOT LIKE 'DEMOIG%' AND created_at >= ? AND created_at < ?`,
        [bounds.dayStart, bounds.dayEnd]
      );
      verifyInPeriod += Number(v1period?.cnt || 0);
    } catch { /* table may not exist */ }

    try {
      // 仅统计真实核销：merchant_id > 0（排除超管回收/撤销，那类 direction=0 但 merchant_id=0）
      const [[v2today]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${swTable('cash_voucher_ledger')}
         WHERE direction = 0 AND merchant_id > 0 AND created_at >= ? AND created_at < ?`,
        [bounds.cardStart, bounds.cardEnd]
      );
      verifyToday += Number(v2today?.cnt || 0);
      const [[v2period]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${swTable('cash_voucher_ledger')}
         WHERE direction = 0 AND merchant_id > 0 AND created_at >= ? AND created_at < ?`,
        [bounds.dayStart, bounds.dayEnd]
      );
      verifyInPeriod += Number(v2period?.cnt || 0);
    } catch { /* ignore */ }

    // 已核销金额（现金券核销 direction=0 且 merchant_id>0 的金额合计，排除超管回收）：累计 + 本期
    let verifyAmountTotal = 0;
    let verifyAmountInPeriod = 0;
    try {
      const [[totalRow]] = await pool.query(
        `SELECT COALESCE(SUM(l.amount), 0) AS total
         FROM ${swTable('cash_voucher_ledger')} l
         LEFT JOIN ${swTable('cash_voucher_batch')} b ON b.id = l.batch_id
         WHERE l.direction = 0 AND l.merchant_id > 0
           AND COALESCE(b.source_type, '') <> 'demo_video'`
      );
      verifyAmountTotal = Number(totalRow?.total || 0);

      const [[periodRow]] = await pool.query(
        `SELECT COALESCE(SUM(l.amount), 0) AS total
         FROM ${swTable('cash_voucher_ledger')} l
         LEFT JOIN ${swTable('cash_voucher_batch')} b ON b.id = l.batch_id
         WHERE l.direction = 0 AND l.merchant_id > 0
           AND COALESCE(b.source_type, '') <> 'demo_video'
           AND l.created_at >= ? AND l.created_at < ?`,
        [bounds.dayStart, bounds.dayEnd]
      );
      verifyAmountInPeriod = Number(periodRow?.total || 0);
    } catch { /* ignore */ }

    let pendingSettlement = 0;
    try {
      const [[settleRow]] = await pool.query(
        `SELECT COALESCE(SUM(pending_settlement), 0) AS total FROM ${swTable('merchant')} WHERE is_active = 1`
      );
      pendingSettlement = Number(settleRow?.total || 0);
    } catch { /* ignore */ }

    let pendingApproval = 0;
    try {
      const [[apprRow]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${swTable('approval_todo')} t
         JOIN ${swTable('approval_request')} r ON r.id = t.request_id
         WHERE t.todo_type = 'admin_review' AND t.is_done = 0 AND r.status = 'admin_review'`
      );
      pendingApproval = Number(apprRow?.cnt || 0);
    } catch { /* ignore */ }

    let integralGrantedToday = 0;
    let integralConsumedToday = 0;
    try {
      integralGrantedToday = await this.sumIntegralGranted(pool, bounds.dayStart, bounds.dayEnd);
      integralConsumedToday = await this.sumIntegralConsumed(pool, bounds.dayStart, bounds.dayEnd);
    } catch { /* ignore */ }

    const [[newUserRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM ${legacyTable('user')}
       WHERE COALESCE(is_del, 0) = 0 AND add_time >= ? AND add_time < ?`,
      [bounds.cardStart, bounds.cardEnd]
    );

    let approvalApprovedToday = 0;
    try {
      const [[approvedRow]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${swTable('approval_request')}
         WHERE status = 'approved' AND approved_at >= ? AND approved_at < ?`,
        [bounds.cardStart, bounds.cardEnd]
      );
      approvalApprovedToday = Number(approvedRow?.cnt || 0);
    } catch { /* ignore */ }

    let cashVoucherGrantTotal = 0;
    let cashVoucherGrantedInPeriod = 0;
    try {
      const [[cashTotalRow]] = await pool.query(
        `SELECT COALESCE(SUM(l.amount), 0) AS total
         FROM ${swTable('cash_voucher_ledger')} l
         LEFT JOIN ${swTable('cash_voucher_batch')} b ON b.id = l.batch_id
         WHERE l.direction = 1 AND COALESCE(b.source_type, '') <> 'demo_video'`
      );
      cashVoucherGrantTotal = Number(cashTotalRow?.total || 0);

      const [[cashPeriodRow]] = await pool.query(
        `SELECT COALESCE(SUM(l.amount), 0) AS total
         FROM ${swTable('cash_voucher_ledger')} l
         LEFT JOIN ${swTable('cash_voucher_batch')} b ON b.id = l.batch_id
         WHERE l.direction = 1 AND COALESCE(b.source_type, '') <> 'demo_video'
           AND l.created_at >= ? AND l.created_at < ?`,
        [bounds.dayStart, bounds.dayEnd]
      );
      cashVoucherGrantedInPeriod = Number(cashPeriodRow?.total || 0);
    } catch { /* ignore */ }

    const trend = await this.buildTrend(pool, bounds.trendStart, bounds.trendDays);

    const fundPool = await this.getFundPool();

    return {
      range,
      // 实际生效的统计区间（秒级时间戳，含 start、不含 end），供前端精确展示所选窗口
      period: { start: bounds.dayStart, end: bounds.dayEnd },
      updatedAt: now,
      cards: {
        memberTotal: Number(memberRow?.cnt || 0),
        verifyToday,
        verifyInPeriod,
        verifyAmountTotal,
        verifyAmountInPeriod,
        pendingSettlement,
        pendingApproval,
        integralGrantedToday,
        integralConsumedToday,
        newUsersToday: Number(newUserRow?.cnt || 0),
        approvalApprovedToday,
        cashVoucherGrantTotal,
        cashVoucherGrantedInPeriod
      },
      fundPool,
      trend
    };
  }

  // 现金池额度：总预算(后台可配) vs 已发放(积分折现 + 现金券)；供看板与小程序进度图复用
  async getFundPool() {
    const pool = getPool();
    const fundPool = {
      budget: 500000,
      integralGrantedTotal: 0,
      cashVoucherGrantedTotal: 0,
      used: 0,
      remain: 0,
      ratio: 0
    };
    try {
      const [[budgetRow]] = await pool.query(
        `SELECT config_value FROM ${swTable('system_config')} WHERE config_key = 'fund_pool_budget' LIMIT 1`
      );
      if (budgetRow?.config_value) fundPool.budget = Number(budgetRow.config_value) || fundPool.budget;

      const [[integralTotal]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM ${swTable('integral_ledger')}
         WHERE direction = 1 AND biz_type IN ('grant','gift','recharge','manual')`
      );
      fundPool.integralGrantedTotal = Number(integralTotal?.total || 0);

      const [[cashTotalRow]] = await pool.query(
        `SELECT COALESCE(SUM(l.amount), 0) AS total
         FROM ${swTable('cash_voucher_ledger')} l
         LEFT JOIN ${swTable('cash_voucher_batch')} b ON b.id = l.batch_id
         WHERE l.direction = 1 AND COALESCE(b.source_type, '') <> 'demo_video'`
      );
      fundPool.cashVoucherGrantedTotal = Number(cashTotalRow?.total || 0);

      const integralAsYuan = Math.round(fundPool.integralGrantedTotal / 1000 * 100) / 100;
      fundPool.used = Math.round((integralAsYuan + fundPool.cashVoucherGrantedTotal) * 100) / 100;
      fundPool.remain = Math.max(0, Math.round((fundPool.budget - fundPool.used) * 100) / 100);
      fundPool.ratio = fundPool.budget > 0
        ? Math.min(1, Math.round(fundPool.used / fundPool.budget * 10000) / 10000)
        : 0;
    } catch { /* ignore */ }
    return fundPool;
  }

  async setFundPoolBudget(budget) {
    const value = Math.max(0, Math.round(Number(budget) * 100) / 100);
    const now = Math.floor(Date.now() / 1000);
    await getPool().query(
      `INSERT INTO ${swTable('system_config')} (config_key, config_value, remark, created_at, updated_at)
       VALUES ('fund_pool_budget', ?, '现金池总预算(元)', ?, ?)
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = VALUES(updated_at)`,
      [String(value), now, now]
    );
    return this.getFundPool();
  }

  async buildTrend(pool, startSec, days) {
    const labels = [];
    const integralGranted = [];
    const integralConsumed = [];

    // 以 startSec 为第 0 天，向后逐日推进 days 天（兼容 today/近N日 与 昨日/自定义 区间）
    for (let i = 0; i < days; i++) {
      const day = new Date(startSec * 1000);
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() + i);
      const dayStart = Math.floor(day.getTime() / 1000);
      const dayEnd = dayStart + 86400;
      const label = `${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      labels.push(label);

      let granted = 0;
      let consumed = 0;
      try {
        granted = await this.sumIntegralGranted(pool, dayStart, dayEnd);
        consumed = await this.sumIntegralConsumed(pool, dayStart, dayEnd);
      } catch { /* ignore */ }

      integralGranted.push(granted);
      integralConsumed.push(consumed);
    }

    return { labels, integralGranted, integralConsumed };
  }
}

module.exports = { AdminDashboardService, getRangeBounds };
