const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

function getRangeBounds(range) {
  const nowSec = Math.floor(Date.now() / 1000);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartSec = Math.floor(todayStart.getTime() / 1000);

  if (range === '7d') {
    return { range, dayStart: todayStartSec - 6 * 86400, trendDays: 7, cardStart: todayStartSec };
  }
  if (range === '30d') {
    return { range, dayStart: todayStartSec - 29 * 86400, trendDays: 30, cardStart: todayStartSec };
  }
  return { range: 'today', dayStart: todayStartSec, trendDays: 7, cardStart: todayStartSec };
}

class AdminDashboardService {
  async getSummary(rangeInput) {
    const range = ['today', '7d', '30d'].includes(rangeInput) ? rangeInput : 'today';
    const bounds = getRangeBounds(range);
    const pool = getPool();
    const now = Math.floor(Date.now() / 1000);

    const [[memberRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM ${legacyTable('user')} WHERE COALESCE(is_del, 0) = 0`
    );

    let verifyToday = 0;
    try {
      const [[v1]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${swTable('integral_mall_verify_log')}
         WHERE created_at >= ?`,
        [bounds.cardStart]
      );
      verifyToday += Number(v1?.cnt || 0);
    } catch { /* table may not exist */ }

    try {
      // 仅统计真实核销：merchant_id > 0（排除超管回收/撤销，那类 direction=0 但 merchant_id=0）
      const [[v2]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${swTable('cash_voucher_ledger')}
         WHERE direction = 0 AND merchant_id > 0 AND created_at >= ?`,
        [bounds.cardStart]
      );
      verifyToday += Number(v2?.cnt || 0);
    } catch { /* ignore */ }

    // 已核销金额（现金券核销 direction=0 且 merchant_id>0 的金额合计，排除超管回收）：累计 + 本期
    let verifyAmountTotal = 0;
    let verifyAmountInPeriod = 0;
    try {
      const [[totalRow]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM ${swTable('cash_voucher_ledger')}
         WHERE direction = 0 AND merchant_id > 0`
      );
      verifyAmountTotal = Number(totalRow?.total || 0);

      const [[periodRow]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM ${swTable('cash_voucher_ledger')}
         WHERE direction = 0 AND merchant_id > 0 AND created_at >= ?`,
        [bounds.dayStart]
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
      const [[grantRow]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM ${swTable('integral_ledger')}
         WHERE direction = 1 AND biz_type IN ('grant','gift','recharge','legacy_import','manual')
         AND created_at >= ?`,
        [bounds.cardStart]
      );
      integralGrantedToday = Number(grantRow?.total || 0);

      const [[consumeRow]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM ${swTable('integral_ledger')}
         WHERE direction = 0 AND biz_type IN ('consume','exchange','expire','deduct')
         AND created_at >= ?`,
        [bounds.cardStart]
      );
      integralConsumedToday = Number(consumeRow?.total || 0);
    } catch { /* ignore */ }

    const [[newUserRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM ${legacyTable('user')}
       WHERE COALESCE(is_del, 0) = 0 AND add_time >= ?`,
      [bounds.cardStart]
    );

    let approvalApprovedToday = 0;
    try {
      const [[approvedRow]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${swTable('approval_request')}
         WHERE status = 'approved' AND approved_at >= ?`,
        [bounds.cardStart]
      );
      approvalApprovedToday = Number(approvedRow?.cnt || 0);
    } catch { /* ignore */ }

    let cashVoucherGrantTotal = 0;
    let cashVoucherGrantedInPeriod = 0;
    try {
      const [[cashTotalRow]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM ${swTable('cash_voucher_ledger')}
         WHERE direction = 1`
      );
      cashVoucherGrantTotal = Number(cashTotalRow?.total || 0);

      const [[cashPeriodRow]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM ${swTable('cash_voucher_ledger')}
         WHERE direction = 1 AND created_at >= ?`,
        [bounds.dayStart]
      );
      cashVoucherGrantedInPeriod = Number(cashPeriodRow?.total || 0);
    } catch { /* ignore */ }

    const trend = await this.buildTrend(pool, bounds.dayStart, bounds.trendDays);

    const fundPool = await this.getFundPool();

    return {
      range,
      updatedAt: now,
      cards: {
        memberTotal: Number(memberRow?.cnt || 0),
        verifyToday,
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
        `SELECT COALESCE(SUM(amount), 0) AS total FROM ${swTable('cash_voucher_ledger')}
         WHERE direction = 1`
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

    for (let i = days - 1; i >= 0; i--) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - i);
      const dayStart = Math.floor(day.getTime() / 1000);
      const dayEnd = dayStart + 86400;
      const label = `${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      labels.push(label);

      let granted = 0;
      let consumed = 0;
      try {
        const [[g]] = await pool.query(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM ${swTable('integral_ledger')}
           WHERE direction = 1 AND biz_type IN ('grant','gift','recharge','legacy_import','manual')
           AND created_at >= ? AND created_at < ?`,
          [dayStart, dayEnd]
        );
        granted = Number(g?.total || 0);

        const [[c]] = await pool.query(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM ${swTable('integral_ledger')}
           WHERE direction = 0 AND biz_type IN ('consume','exchange','expire','deduct')
           AND created_at >= ? AND created_at < ?`,
          [dayStart, dayEnd]
        );
        consumed = Number(c?.total || 0);
      } catch { /* ignore */ }

      integralGranted.push(granted);
      integralConsumed.push(consumed);
    }

    return { labels, integralGranted, integralConsumed };
  }
}

module.exports = { AdminDashboardService };
