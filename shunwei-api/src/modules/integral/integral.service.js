const { legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

/**
 * 积分服务：统一积分变动入口（对齐 migrations/mvp1/002）
 */
class IntegralService {
  /**
   * 发放会员开卡赠送积分（事务内调用）
   */
  async grantMembershipGiftIntegral(connection, params) {
    const {
      uid,
      amount,
      sourceType,
      sourceId,
      expireDays,
      bizId,
      remark,
      operatorUid = 0
    } = params;

    const giftAmount = Number(amount || 0);
    if (!uid || giftAmount <= 0) {
      return { batchId: null, granted: 0 };
    }

    const existing = await this.findBatchBySource(connection, sourceType, sourceId);
    if (existing) {
      return { batchId: existing.id, granted: 0, duplicate: true };
    }

    const now = Math.floor(Date.now() / 1000);
    const expireAt = expireDays > 0 ? now + expireDays * 86400 : 0;

    const [userRows] = await connection.query(
      `SELECT integral FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
      [uid]
    );
    if (!userRows[0]) {
      const error = new Error('用户不存在');
      error.statusCode = 404;
      throw error;
    }

    const beforeIntegral = Number(userRows[0].integral || 0);
    const afterIntegral = beforeIntegral + giftAmount;

    const [batchResult] = await connection.query(
      `
      INSERT INTO ${swTable('integral_batch')}
        (uid, batch_type, source_type, source_id, total_amount, remain_amount, expire_at, status, remark, created_at, updated_at)
      VALUES (?, 'gift', ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `,
      [uid, sourceType, sourceId, giftAmount, giftAmount, expireAt, remark || '', now, now]
    );

    await connection.query(
      `UPDATE ${legacyTable('user')} SET integral = ? WHERE uid = ?`,
      [afterIntegral, uid]
    );

    await connection.query(
      `
      INSERT INTO ${legacyTable('user_bill')}
        (uid, link_id, pm, title, category, type, number, balance, mark, add_time, status, take, frozen_time)
      VALUES (?, ?, 1, '会员开卡赠送积分', 'integral', 'system_add', ?, ?, ?, ?, 1, 0, 0)
      `,
      [uid, String(bizId || sourceId || batchResult.insertId), giftAmount, afterIntegral, remark || '会员开卡赠送', now]
    );

    await connection.query(
      `
      INSERT INTO ${swTable('integral_ledger')}
        (uid, direction, amount, balance_after, batch_id, biz_type, biz_id, remark, operator_uid, created_at)
      VALUES (?, 1, ?, ?, ?, 'grant', ?, ?, ?, ?)
      `,
      [uid, giftAmount, afterIntegral, batchResult.insertId, bizId || sourceId, remark || '', operatorUid, now]
    );

    return { batchId: batchResult.insertId, granted: giftAmount, balanceAfter: afterIntegral };
  }

  /** 超管手动发放积分 */
  async grantManual(params) {
    const {
      uid,
      amount,
      batchType = 'gift',
      expireDays,
      remark = '超管手动发放',
      operatorUid = 0,
      adminRef
    } = params;

    const giftAmount = Number(amount || 0);
    if (!uid || giftAmount <= 0) {
      const error = new Error('积分数量无效');
      error.statusCode = 400;
      throw error;
    }

    const connection = await require('../../shared/mysql').getPool().getConnection();
    try {
      await connection.beginTransaction();
      const sourceId = adminRef || `MANUAL${Date.now()}`;
      const now = Math.floor(Date.now() / 1000);
      const resolvedExpireDays = expireDays !== undefined
        ? Number(expireDays)
        : (batchType === 'adjust' ? 0 : 365);
      const expireAt = resolvedExpireDays > 0 ? now + resolvedExpireDays * 86400 : 0;
      const resolvedBatchType = batchType === 'adjust' ? 'adjust' : 'gift';

      const [userRows] = await connection.query(
        `SELECT integral FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
        [uid]
      );
      if (!userRows[0]) {
        const error = new Error('用户不存在');
        error.statusCode = 404;
        throw error;
      }

      const beforeIntegral = Number(userRows[0].integral || 0);
      const afterIntegral = beforeIntegral + giftAmount;

      const [batchResult] = await connection.query(
        `INSERT INTO ${swTable('integral_batch')}
         (uid, batch_type, source_type, source_id, total_amount, remain_amount, expire_at, status, remark, created_at, updated_at)
         VALUES (?, ?, 'manual', ?, ?, ?, ?, 1, ?, ?, ?)`,
        [uid, resolvedBatchType, sourceId, giftAmount, giftAmount, expireAt, remark, now, now]
      );

      await connection.query(
        `UPDATE ${legacyTable('user')} SET integral = ? WHERE uid = ?`,
        [afterIntegral, uid]
      );

      await connection.query(
        `INSERT INTO ${legacyTable('user_bill')}
         (uid, link_id, pm, title, category, type, number, balance, mark, add_time, status, take, frozen_time)
         VALUES (?, ?, 1, '超管手动发放积分', 'integral', 'system_add', ?, ?, ?, ?, 1, 0, 0)`,
        [uid, sourceId, giftAmount, afterIntegral, remark, now]
      );

      await connection.query(
        `INSERT INTO ${swTable('integral_ledger')}
         (uid, direction, amount, balance_after, batch_id, biz_type, biz_id, remark, operator_uid, created_at)
         VALUES (?, 1, ?, ?, ?, 'manual', ?, ?, ?, ?)`,
        [uid, giftAmount, afterIntegral, batchResult.insertId, sourceId, remark, operatorUid, now]
      );

      await connection.commit();
      return { batchId: batchResult.insertId, uid, amount: giftAmount, balanceAfter: afterIntegral };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async findBatchBySource(connection, sourceType, sourceId) {
    const [rows] = await connection.query(
      `
      SELECT id, uid, remain_amount
      FROM ${swTable('integral_batch')}
      WHERE source_type = ? AND source_id = ?
      LIMIT 1
      `,
      [sourceType, sourceId]
    );
    return rows[0] || null;
  }

  async buildSummary(uid, batches, totalIntegral) {
    const now = Math.floor(Date.now() / 1000);
    let giftRemaining = 0;
    let rechargeRemaining = 0;
    let expiringIn7Days = 0;

    for (const batch of batches) {
      const remain = Number(batch.remain_amount || 0);
      if (batch.batch_type === 'recharge') {
        rechargeRemaining += remain;
      } else {
        giftRemaining += remain;
      }
      if (batch.expire_at > 0 && batch.expire_at <= now + 7 * 86400) {
        expiringIn7Days += remain;
      }
    }

    return {
      totalIntegral: Number(totalIntegral || 0),
      giftRemaining,
      rechargeRemaining,
      expiringIn7Days,
      batchCount: batches.length
    };
  }
}

module.exports = { IntegralService };
