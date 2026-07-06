const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

const DEMO_SOURCE_TYPE = 'demo_video';
const DEMO_REMARK_PREFIX = '[演示]';

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function isDemoSource(sourceType) {
  return String(sourceType || '') === DEMO_SOURCE_TYPE;
}

function withDemoRemark(remark) {
  const text = String(remark || '').trim() || '演示现金券';
  return text.startsWith(DEMO_REMARK_PREFIX) ? text : `${DEMO_REMARK_PREFIX}${text}`;
}

class CashVoucherService {
  async getAssets(uid) {
    const [[user]] = await getPool().query(
      `SELECT uid, integral FROM ${legacyTable('user')}
       WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
      [uid]
    );
    if (!user) throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
    const wallet = await this.getWallet(uid);
    return {
      uid: Number(uid),
      integral: Number(user.integral || 0),
      cashVoucher: Number(wallet.balance || 0)
    };
  }

  async getWallet(uid) {
    const [batches] = await getPool().query(
      `SELECT id, total_amount, remain_amount, expire_at, status, source_type, source_id, created_at
       FROM ${swTable('cash_voucher_batch')}
       WHERE uid = ? AND status = 1 AND remain_amount > 0
       ORDER BY expire_at ASC`,
      [uid]
    );

    const demoBatches = batches.filter((b) => isDemoSource(b.source_type));
    const visibleBatches = demoBatches.length ? demoBatches : batches;
    let totalBalance = 0;
    const now = Math.floor(Date.now() / 1000);
    let expiringSoon = 0;

    for (const b of visibleBatches) {
      totalBalance += Number(b.remain_amount || 0);
      if (b.expire_at > 0 && b.expire_at <= now + 30 * 86400) {
        expiringSoon += Number(b.remain_amount || 0);
      }
    }

    const [[totals]] = await getPool().query(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 1 THEN amount ELSE 0 END), 0) AS total_granted,
         COALESCE(SUM(CASE WHEN direction = 0 THEN amount ELSE 0 END), 0) AS total_used
       FROM ${swTable('cash_voucher_ledger')} WHERE uid = ?`,
      [uid]
    );

    return {
      balance: totalBalance,
      totalGranted: Number(totals?.total_granted || 0),
      totalUsed: Number(totals?.total_used || 0),
      batchCount: visibleBatches.length,
      expiringSoon,
      isDemo: demoBatches.length > 0,
      realBalanceHidden: demoBatches.length > 0
        ? batches.filter((b) => !isDemoSource(b.source_type)).reduce((sum, b) => sum + Number(b.remain_amount || 0), 0)
        : 0,
      batches: visibleBatches.map(b => ({
        id: b.id,
        totalAmount: Number(b.total_amount),
        remainAmount: Number(b.remain_amount),
        expireAt: Number(b.expire_at),
        sourceType: b.source_type || '',
        sourceId: b.source_id || '',
        createdAt: Number(b.created_at)
      }))
    };
  }

  async grantDemo(uid, amount, remark = '') {
    const demoAmount = roundMoney(amount);
    if (!uid || demoAmount <= 0) {
      const error = new Error('演示现金券金额无效');
      error.statusCode = 400;
      throw error;
    }

    const now = Math.floor(Date.now() / 1000);
    const expireAt = now + 7 * 86400;
    const bizId = `DEMO_CV_${now}_${uid}`;
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [[user]] = await connection.query(
        `SELECT uid FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
        [uid]
      );
      if (!user) {
        const error = new Error('用户不存在');
        error.statusCode = 404;
        throw error;
      }
      const [result] = await connection.query(
        `INSERT INTO ${swTable('cash_voucher_batch')}
         (uid, source_type, source_id, total_amount, remain_amount, expire_at, status, remark, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [uid, DEMO_SOURCE_TYPE, bizId, demoAmount, demoAmount, expireAt, withDemoRemark(remark), now, now]
      );
      await connection.query(
        `INSERT INTO ${swTable('cash_voucher_ledger')}
         (uid, direction, amount, batch_id, merchant_id, operator_uid, biz_id, remark, created_at)
         VALUES (?, 1, ?, ?, 0, 0, ?, ?, ?)`,
        [uid, demoAmount, result.insertId, bizId, withDemoRemark(remark || '拍摄演示发放'), now]
      );
      await connection.commit();
      return { batchId: result.insertId, uid, amount: demoAmount, expireAt };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getLedger(uid, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const [[countRow]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM ${swTable('cash_voucher_ledger')} WHERE uid = ?`,
      [uid]
    );
    const [rows] = await getPool().query(
      `SELECT l.id, l.direction, l.amount, l.batch_id, l.merchant_id, l.operator_uid,
              l.biz_id, l.remark, l.created_at, m.merchant_name
       FROM ${swTable('cash_voucher_ledger')} l
       LEFT JOIN ${swTable('merchant')} m ON m.id = l.merchant_id
       WHERE l.uid = ?
       ORDER BY l.created_at DESC
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
        merchantName: r.merchant_name || '',
        operatorUid: Number(r.operator_uid),
        remark: r.remark || '',
        createdAt: Number(r.created_at)
      })),
      total: Number(countRow?.total || 0),
      page, limit
    };
  }

  async ensureNonceTable() {
    if (this._nonceTableReady) return;
    try {
      await getPool().query(
        `CREATE TABLE IF NOT EXISTS ${swTable('cash_voucher_nonce')} (
          nonce varchar(64) NOT NULL COMMENT '核销码一次性随机串',
          biz_id varchar(64) NOT NULL DEFAULT '',
          uid int(10) unsigned NOT NULL DEFAULT '0',
          amount decimal(12,2) NOT NULL DEFAULT '0.00',
          created_at int(10) unsigned NOT NULL DEFAULT '0',
          PRIMARY KEY (nonce)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='现金券核销幂等去重'`
      );
    } catch (e) { /* 表已存在或无权限时忽略，降级为内存去重 */ }
    this._nonceTableReady = true;
  }

  // idempotencyKey: 出码 token 的一次性 nonce，用于 DB 级幂等（同一张码绝不二次扣款，且重启/多实例下仍生效）
  async verify(uid, amount, operatorUid, merchantId = 0, remark = '', idempotencyKey = '') {
    const verifyAmount = roundMoney(amount);
    if (!verifyAmount || verifyAmount <= 0) {
      const error = new Error('核销金额必须大于0');
      error.statusCode = 400;
      throw error;
    }

    if (idempotencyKey) await this.ensureNonceTable();

    const verifyMode = await this.getVerifyMode();
    if (verifyMode === 'hundred') {
      const cents = Math.round(verifyAmount * 100);
      if (cents % 10000 !== 0) {
        const error = new Error('当前核销模式要求整百金额');
        error.statusCode = 400;
        throw error;
      }
    }

    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();

      // DB 级幂等：先抢占 nonce（唯一主键）。同一张核销码二次提交会撞主键 → 整笔回滚，绝不二次扣款。
      const now0 = Math.floor(Date.now() / 1000);
      const bizId = `CV${now0}${uid}${Math.random().toString(36).slice(2, 6)}`;
      if (idempotencyKey && this._nonceTableReady) {
        try {
          await connection.query(
            `INSERT INTO ${swTable('cash_voucher_nonce')} (nonce, biz_id, uid, amount, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [idempotencyKey, bizId, uid, verifyAmount, now0]
          );
        } catch (e) {
          if (e && e.code === 'ER_DUP_ENTRY') {
            const error = new Error('该核销码已使用，请让顾客生成新码');
            error.statusCode = 409;
            throw error;
          }
          throw e;
        }
      }

      const [batches] = await connection.query(
        `SELECT id, remain_amount, expire_at, source_type
         FROM ${swTable('cash_voucher_batch')}
         WHERE uid = ? AND status = 1 AND remain_amount > 0
         ORDER BY expire_at ASC
         FOR UPDATE`,
        [uid]
      );

      const demoBatches = batches.filter((b) => isDemoSource(b.source_type));
      const isDemoVerify = demoBatches.length > 0;
      const usableBatches = isDemoVerify ? demoBatches : batches;

      let totalAvailable = 0;
      for (const b of usableBatches) totalAvailable += roundMoney(b.remain_amount || 0);
      totalAvailable = roundMoney(totalAvailable);

      if (totalAvailable + 0.001 < verifyAmount) {
        const error = new Error(`${isDemoVerify ? '演示现金券' : '现金券'}余额不足（可用 ${totalAvailable}，需核销 ${verifyAmount}）`);
        error.statusCode = 400;
        throw error;
      }

      let remaining = verifyAmount;
      const now = now0;

      let deductedTotal = 0;
      let ledgerRows = 0;
      for (const batch of usableBatches) {
        if (remaining <= 0) break;
        const batchRemain = roundMoney(batch.remain_amount);
        const deduct = roundMoney(Math.min(batchRemain, remaining));

        const newRemain = roundMoney(batchRemain - deduct);
        const [upd] = await connection.query(
          `UPDATE ${swTable('cash_voucher_batch')}
           SET remain_amount = ?, status = ?, updated_at = ?
           WHERE id = ? AND remain_amount = ?`,
          [newRemain, newRemain > 0 ? 1 : 0, now, batch.id, batchRemain]
        );
        // 乐观锁：若该批次余额已被并发改动（affectedRows=0），中止整笔事务，避免“扣不到却记账”
        if (!upd.affectedRows) {
          const error = new Error('核销繁忙，请重试');
          error.statusCode = 409;
          throw error;
        }

        const verifyRemark = isDemoVerify ? withDemoRemark(remark || '演示核销') : (remark || '现金券核销');
        const [ins] = await connection.query(
          `INSERT INTO ${swTable('cash_voucher_ledger')}
           (uid, direction, amount, batch_id, merchant_id, operator_uid, biz_id, remark, created_at)
           VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?)`,
          [uid, deduct, batch.id, isDemoVerify ? 0 : merchantId, operatorUid, bizId, verifyRemark, now]
        );
        if (ins.affectedRows) ledgerRows += 1;

        deductedTotal = roundMoney(deductedTotal + deduct);
        remaining = roundMoney(remaining - deduct);
      }

      // 一致性自检：实际扣减必须等于核销金额，否则回滚（绝不允许“商家入账≠用户扣减”）
      if (roundMoney(deductedTotal) !== verifyAmount) {
        const error = new Error('核销扣减异常已自动取消，请重试');
        error.statusCode = 500;
        throw error;
      }

      if (!isDemoVerify && merchantId > 0) {
        await connection.query(
          `UPDATE ${swTable('merchant')}
           SET pending_settlement = pending_settlement + ?, updated_at = ?
           WHERE id = ?`,
          [verifyAmount, now, merchantId]
        );
      }

      await connection.commit();

      // 核销审计日志：每笔成功核销都落日志，便于事后核对“商家成功是否=用户扣减”
      try {
        console.log('[cash-voucher.verify] OK', JSON.stringify({
          bizId, uid, operatorUid, merchantId,
          verifyAmount, deductedTotal, ledgerRows,
          balanceBefore: totalAvailable,
          balanceAfter: roundMoney(totalAvailable - verifyAmount),
          at: now
        }));
      } catch (e) { /* ignore logging error */ }

      return { bizId, amount: verifyAmount, balanceAfter: roundMoney(totalAvailable - verifyAmount), isDemo: isDemoVerify };
    } catch (error) {
      await connection.rollback();
      try {
        console.error('[cash-voucher.verify] ROLLBACK', JSON.stringify({
          uid, operatorUid, merchantId, verifyAmount,
          reason: error.message
        }));
      } catch (e) { /* ignore */ }
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

  // 按 nonce 回查这张核销码到底成没成功。
  // nonce 表只有在 verify() 事务成功提交后才会留下记录（幂等主键），
  // 因此「查得到 = 真的核销成功了」「查不到 = 没成功，可安全重试」。
  async lookupVerifyByNonce(nonce) {
    if (!nonce) return { verified: false };
    await this.ensureNonceTable();
    if (!this._nonceTableReady) return { verified: false, unknown: true };
    let rows;
    try {
      [rows] = await getPool().query(
        `SELECT nonce, biz_id, uid, amount, created_at
         FROM ${swTable('cash_voucher_nonce')} WHERE nonce = ? LIMIT 1`,
        [nonce]
      );
    } catch (e) {
      // 表不存在/查询异常时无法判定，返回 unknown 让前端保持谨慎提示
      return { verified: false, unknown: true };
    }
    const row = rows && rows[0];
    if (!row) return { verified: false };

    // 已核销：顺带返回该用户当前余额，便于前端展示「本次核销 ¥X｜剩余 ¥Y」
    let balanceAfter = null;
    try {
      const wallet = await this.getWallet(Number(row.uid));
      balanceAfter = roundMoney(wallet.balance || 0);
    } catch (e) { /* 余额查询失败不影响“已核销”结论 */ }

    return {
      verified: true,
      uid: Number(row.uid),
      amount: roundMoney(row.amount || 0),
      bizId: row.biz_id || '',
      balanceAfter,
      verifiedAt: Number(row.created_at || 0)
    };
  }
}

module.exports = { CashVoucherService };
