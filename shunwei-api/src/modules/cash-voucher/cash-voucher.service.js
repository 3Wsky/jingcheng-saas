const { getPool } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

class CashVoucherService {
  async getWallet(uid) {
    const [batches] = await getPool().query(
      `SELECT id, total_amount, remain_amount, expire_at, status, created_at
       FROM ${swTable('cash_voucher_batch')}
       WHERE uid = ? AND status = 1 AND remain_amount > 0
       ORDER BY expire_at ASC`,
      [uid]
    );

    let totalBalance = 0;
    const now = Math.floor(Date.now() / 1000);
    let expiringSoon = 0;

    for (const b of batches) {
      totalBalance += Number(b.remain_amount || 0);
      if (b.expire_at > 0 && b.expire_at <= now + 30 * 86400) {
        expiringSoon += Number(b.remain_amount || 0);
      }
    }

    return {
      balance: totalBalance,
      batchCount: batches.length,
      expiringSoon,
      batches: batches.map(b => ({
        id: b.id,
        totalAmount: Number(b.total_amount),
        remainAmount: Number(b.remain_amount),
        expireAt: Number(b.expire_at),
        createdAt: Number(b.created_at)
      }))
    };
  }

  async getLedger(uid, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const [[countRow]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM ${swTable('cash_voucher_ledger')} WHERE uid = ?`,
      [uid]
    );
    const [rows] = await getPool().query(
      `SELECT id, direction, amount, batch_id, merchant_id, operator_uid, biz_id, remark, created_at
       FROM ${swTable('cash_voucher_ledger')}
       WHERE uid = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [uid, limit, offset]
    );

    return {
      list: rows.map(r => ({
        id: r.id,
        direction: Number(r.direction),
        amount: Number(r.amount),
        batchId: r.batch_id,
        merchantId: Number(r.merchant_id),
        operatorUid: Number(r.operator_uid),
        remark: r.remark || '',
        createdAt: Number(r.created_at)
      })),
      total: Number(countRow?.total || 0),
      page, limit
    };
  }

  async verify(uid, amount, operatorUid, merchantId = 0, remark = '') {
    const verifyAmount = Number(amount);
    if (!verifyAmount || verifyAmount <= 0) {
      const error = new Error('核销金额必须大于0');
      error.statusCode = 400;
      throw error;
    }

    const verifyMode = await this.getVerifyMode();
    if (verifyMode === 'hundred' && verifyAmount % 100 !== 0) {
      const error = new Error('当前核销模式要求整百金额');
      error.statusCode = 400;
      throw error;
    }

    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();

      const [batches] = await connection.query(
        `SELECT id, remain_amount, expire_at
         FROM ${swTable('cash_voucher_batch')}
         WHERE uid = ? AND status = 1 AND remain_amount > 0
         ORDER BY expire_at ASC
         FOR UPDATE`,
        [uid]
      );

      let totalAvailable = 0;
      for (const b of batches) totalAvailable += Number(b.remain_amount || 0);

      if (totalAvailable < verifyAmount) {
        const error = new Error(`现金券余额不足（可用 ${totalAvailable}，需核销 ${verifyAmount}）`);
        error.statusCode = 400;
        throw error;
      }

      let remaining = verifyAmount;
      const now = Math.floor(Date.now() / 1000);
      const bizId = `CV${now}${uid}${Math.random().toString(36).slice(2, 6)}`;

      for (const batch of batches) {
        if (remaining <= 0) break;
        const batchRemain = Number(batch.remain_amount);
        const deduct = Math.min(batchRemain, remaining);

        const newRemain = batchRemain - deduct;
        await connection.query(
          `UPDATE ${swTable('cash_voucher_batch')}
           SET remain_amount = ?, status = ?, updated_at = ?
           WHERE id = ?`,
          [newRemain, newRemain > 0 ? 1 : 0, now, batch.id]
        );

        await connection.query(
          `INSERT INTO ${swTable('cash_voucher_ledger')}
           (uid, direction, amount, batch_id, merchant_id, operator_uid, biz_id, remark, created_at)
           VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?)`,
          [uid, deduct, batch.id, merchantId, operatorUid, bizId, remark || '现金券核销', now]
        );

        remaining -= deduct;
      }

      if (merchantId > 0) {
        await connection.query(
          `UPDATE ${swTable('merchant')}
           SET pending_settlement = pending_settlement + ?, updated_at = ?
           WHERE id = ?`,
          [verifyAmount, now, merchantId]
        );
      }

      await connection.commit();
      return { bizId, amount: verifyAmount, balanceAfter: totalAvailable - verifyAmount };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getVerifyMode() {
    const [rows] = await getPool().query(
      `SELECT config_value FROM ${swTable('system_config')}
       WHERE config_key = 'cash_voucher_verify_mode' LIMIT 1`
    );
    return rows[0]?.config_value || 'any';
  }
}

module.exports = { CashVoucherService };
