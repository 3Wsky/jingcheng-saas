const { getPool } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function businessError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

let schemaReady = false;

async function ensureCashVoucherReversalSchema(pool = getPool()) {
  if (schemaReady) return;

  const columns = [
    ['reversed_at', "int(10) unsigned NOT NULL DEFAULT '0' COMMENT '核销撤回时间，0=未撤回' AFTER created_at"],
    ['reversed_by', "varchar(64) NOT NULL DEFAULT '' COMMENT '执行撤回的管理员账号' AFTER reversed_at"],
    ['reversal_reason', "varchar(255) NOT NULL DEFAULT '' COMMENT '核销撤回原因' AFTER reversed_by"]
  ];
  for (const [name, definition] of columns) {
    try {
      await pool.query(
        `ALTER TABLE ${swTable('cash_voucher_ledger')} ADD COLUMN ${name} ${definition}`
      );
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
  try {
    await pool.query(
      `ALTER TABLE ${swTable('cash_voucher_ledger')} ADD KEY idx_biz_reversed (biz_id, reversed_at)`
    );
  } catch (error) {
    if (error.code !== 'ER_DUP_KEYNAME') throw error;
  }

  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${swTable('cash_voucher_reversal')} (
      id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
      original_biz_id varchar(64) NOT NULL,
      uid int(10) unsigned NOT NULL DEFAULT '0',
      merchant_id int(10) unsigned NOT NULL DEFAULT '0',
      operator_uid int(10) unsigned NOT NULL DEFAULT '0',
      amount decimal(12,2) NOT NULL DEFAULT '0.00',
      admin_username varchar(64) NOT NULL DEFAULT '',
      reason varchar(255) NOT NULL DEFAULT '',
      pending_before decimal(12,2) NOT NULL DEFAULT '0.00',
      pending_after decimal(12,2) NOT NULL DEFAULT '0.00',
      created_at int(10) unsigned NOT NULL DEFAULT '0',
      PRIMARY KEY (id),
      UNIQUE KEY uk_original_biz_id (original_biz_id),
      KEY idx_merchant_created (merchant_id, created_at),
      KEY idx_uid_created (uid, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='现金券核销撤回记录'`
  );
  schemaReady = true;
}

class CashVoucherReversalService {
  constructor(pool = getPool()) {
    this.pool = pool;
  }

  async reverse({ bizId, reason, adminUsername }) {
    await ensureCashVoucherReversalSchema(this.pool);
    const connection = await this.pool.getConnection();
    const now = Math.floor(Date.now() / 1000);

    try {
      await connection.beginTransaction();

      const [ledgerRows] = await connection.query(
        `SELECT id, uid, amount, batch_id, merchant_id, operator_uid, reversed_at
         FROM ${swTable('cash_voucher_ledger')}
         WHERE biz_id = ? AND direction = 0 AND merchant_id > 0
         ORDER BY id ASC FOR UPDATE`,
        [bizId]
      );
      if (!ledgerRows.length) throw businessError('核销记录不存在', 404);
      if (ledgerRows.some((row) => Number(row.reversed_at || 0) > 0)) {
        throw businessError('该笔核销已经撤回，不能重复操作', 409);
      }

      const uid = Number(ledgerRows[0].uid);
      const merchantId = Number(ledgerRows[0].merchant_id);
      const operatorUid = Number(ledgerRows[0].operator_uid || 0);
      if (ledgerRows.some((row) => (
        Number(row.uid) !== uid
        || Number(row.merchant_id) !== merchantId
        || Number(row.operator_uid || 0) !== operatorUid
        || Number(row.batch_id || 0) <= 0
        || Number(row.amount || 0) <= 0
      ))) {
        throw businessError('核销流水数据不一致，已停止撤回', 409);
      }

      const amount = roundMoney(ledgerRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
      if (amount <= 0) throw businessError('核销金额异常，已停止撤回', 409);

      const restoreByBatch = new Map();
      for (const row of ledgerRows) {
        const batchId = Number(row.batch_id);
        restoreByBatch.set(batchId, roundMoney((restoreByBatch.get(batchId) || 0) + Number(row.amount || 0)));
      }
      const batchIds = [...restoreByBatch.keys()].sort((a, b) => a - b);
      const placeholders = batchIds.map(() => '?').join(',');
      const [batches] = await connection.query(
        `SELECT id, uid, total_amount, remain_amount, expire_at
         FROM ${swTable('cash_voucher_batch')}
         WHERE id IN (${placeholders}) ORDER BY id ASC FOR UPDATE`,
        batchIds
      );
      if (batches.length !== batchIds.length || batches.some((batch) => Number(batch.uid) !== uid)) {
        throw businessError('原现金券批次不完整，已停止撤回', 409);
      }

      const [[merchant]] = await connection.query(
        `SELECT id, merchant_name, pending_settlement
         FROM ${swTable('merchant')} WHERE id = ? FOR UPDATE`,
        [merchantId]
      );
      if (!merchant) throw businessError('核销商家不存在，已停止撤回', 409);
      const pendingBefore = roundMoney(merchant.pending_settlement || 0);
      if (pendingBefore + 0.001 < amount) {
        throw businessError('该笔核销已进入结算流程，待结算余额不足，不能自动撤回', 409);
      }
      const pendingAfter = roundMoney(pendingBefore - amount);

      for (const batch of batches) {
        const restored = restoreByBatch.get(Number(batch.id)) || 0;
        const remainAfter = roundMoney(Number(batch.remain_amount || 0) + restored);
        if (remainAfter > roundMoney(batch.total_amount || 0) + 0.001) {
          throw businessError('现金券批次余额校验失败，已停止撤回', 409);
        }
        const expireAt = Number(batch.expire_at || 0);
        const status = remainAfter > 0 && (expireAt === 0 || expireAt > now) ? 1 : -1;
        await connection.query(
          `UPDATE ${swTable('cash_voucher_batch')}
           SET remain_amount = ?, status = ?, updated_at = ? WHERE id = ?`,
          [remainAfter, status, now, batch.id]
        );
      }

      const [merchantUpdate] = await connection.query(
        `UPDATE ${swTable('merchant')}
         SET pending_settlement = ?, updated_at = ?
         WHERE id = ? AND pending_settlement >= ?`,
        [pendingAfter, now, merchantId, amount]
      );
      if (!merchantUpdate.affectedRows) {
        throw businessError('商家待结算金额已变化，请刷新后重试', 409);
      }

      await connection.query(
        `INSERT INTO ${swTable('cash_voucher_reversal')}
         (original_biz_id, uid, merchant_id, operator_uid, amount, admin_username,
          reason, pending_before, pending_after, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [bizId, uid, merchantId, operatorUid, amount, adminUsername, reason, pendingBefore, pendingAfter, now]
      );

      const [ledgerUpdate] = await connection.query(
        `UPDATE ${swTable('cash_voucher_ledger')}
         SET reversed_at = ?, reversed_by = ?, reversal_reason = ?
         WHERE biz_id = ? AND direction = 0 AND merchant_id = ? AND reversed_at = 0`,
        [now, adminUsername, reason, bizId, merchantId]
      );
      if (Number(ledgerUpdate.affectedRows) !== ledgerRows.length) {
        throw businessError('核销流水状态已变化，请刷新后重试', 409);
      }

      await connection.commit();
      return {
        bizId,
        uid,
        merchantId,
        merchantName: merchant.merchant_name || '',
        operatorUid,
        amount,
        restoredBatchCount: batches.length,
        pendingBefore,
        pendingAfter,
        reversedAt: now,
        reason
      };
    } catch (error) {
      try { await connection.rollback(); } catch { /* preserve original error */ }
      if (error && error.code === 'ER_DUP_ENTRY') {
        throw businessError('该笔核销已经撤回，不能重复操作', 409);
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = {
  CashVoucherReversalService,
  ensureCashVoucherReversalSchema,
  roundMoney
};
