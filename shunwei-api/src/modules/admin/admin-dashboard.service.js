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
      const [[v2]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${swTable('cash_voucher_ledger')}
         WHERE direction = 0 AND created_at >= ?`,
        [bounds.cardStart]
      );
      verifyToday += Number(v2?.cnt || 0);
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

    const trend = await this.buildTrend(pool, bounds.dayStart, bounds.trendDays);

    return {
      range,
      updatedAt: now,
      cards: {
        memberTotal: Number(memberRow?.cnt || 0),
        verifyToday,
        pendingSettlement,
        pendingApproval,
        integralGrantedToday,
        integralConsumedToday,
        newUsersToday: Number(newUserRow?.cnt || 0),
        approvalApprovedToday
      },
      trend
    };
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
