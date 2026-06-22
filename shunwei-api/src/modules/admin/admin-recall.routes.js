const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const { requireAdmin, getAdminSession } = require('./admin.auth');
const { AdminAuditService, getClientIp } = require('./admin-audit.service');

const recallVoucherSchema = z.object({
  batchId: z.coerce.number().int().positive().optional(),
  reason: z.string().trim().max(200).optional().default('超管回收现金券')
});

const recallMembershipSchema = z.object({
  membershipId: z.coerce.number().int().positive().optional(),
  reclaimIntegral: z.boolean().optional().default(true),
  reason: z.string().trim().max(200).optional().default('超管回收会员权益')
});

const recallIntegralSchema = z.object({
  batchId: z.coerce.number().int().positive().optional(),
  amount: z.coerce.number().int().positive().optional(),
  reason: z.string().trim().max(200).optional().default('超管回收积分')
});

function registerAdminRecallRoutes(app) {
  const audit = new AdminAuditService();

  app.post('/api/admin/members/:uid/recall-voucher', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');

    const parsed = recallVoucherSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const { batchId, reason } = parsed.data;
    const session = getAdminSession(request);
    const connection = await getPool().getConnection();
    const now = Math.floor(Date.now() / 1000);

    try {
      await connection.beginTransaction();

      const batchCondition = batchId
        ? 'AND id = ?'
        : '';
      const batchValues = batchId
        ? [uid, batchId]
        : [uid];

      const [batches] = await connection.query(
        `SELECT id, remain_amount, source_type, source_id
         FROM ${swTable('cash_voucher_batch')}
         WHERE uid = ? AND status = 1 AND remain_amount > 0 ${batchCondition}
         FOR UPDATE`,
        batchValues
      );

      if (!batches.length) {
        await connection.rollback();
        return fail(reply, 400, batchId ? '该现金券批次不存在或已无余额' : '该用户无可回收的现金券');
      }

      let totalRecalled = 0;
      const recalledBatches = [];
      const bizId = `RECALL${now}`;

      for (const batch of batches) {
        const remain = Number(batch.remain_amount || 0);
        if (remain <= 0) continue;

        await connection.query(
          `UPDATE ${swTable('cash_voucher_batch')}
           SET remain_amount = 0, status = 0, updated_at = ? WHERE id = ?`,
          [now, batch.id]
        );

        await connection.query(
          `INSERT INTO ${swTable('cash_voucher_ledger')}
           (uid, direction, amount, batch_id, merchant_id, operator_uid, biz_id, remark, created_at)
           VALUES (?, 0, ?, ?, 0, 0, ?, ?, ?)`,
          [uid, remain, batch.id, bizId, reason, now]
        );

        totalRecalled += remain;
        recalledBatches.push({ batchId: batch.id, amount: remain, sourceType: batch.source_type });
      }

      await connection.commit();

      await audit.write({
        adminUsername: session?.username || '',
        action: 'recall_cash_voucher',
        targetType: 'user',
        targetId: uid,
        payload: { totalRecalled, batchCount: recalledBatches.length, reason, recalledBatches },
        ip: getClientIp(request)
      });

      return ok({
        uid,
        totalRecalled,
        batchCount: recalledBatches.length,
        recalledBatches
      }, `已回收 ¥${totalRecalled} 现金券`);
    } catch (error) {
      await connection.rollback();
      return fail(reply, error.statusCode || 500, error.message || '回收现金券失败');
    } finally {
      connection.release();
    }
  });

  app.post('/api/admin/members/:uid/recall-membership', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');

    const parsed = recallMembershipSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const { membershipId, reclaimIntegral, reason } = parsed.data;
    const session = getAdminSession(request);
    const connection = await getPool().getConnection();
    const now = Math.floor(Date.now() / 1000);

    try {
      await connection.beginTransaction();

      const membershipCondition = membershipId
        ? 'AND id = ?'
        : '';
      const membershipValues = membershipId
        ? [uid, membershipId]
        : [uid];

      const [memberships] = await connection.query(
        `SELECT id, tier_code, source_channel, source_ref, granted_integral
         FROM ${swTable('user_membership')}
         WHERE uid = ? AND status = 1 ${membershipCondition}
         FOR UPDATE`,
        membershipValues
      );

      if (!memberships.length) {
        await connection.rollback();
        return fail(reply, 400, membershipId ? '该会员记录不存在或已失效' : '该用户无有效会员可回收');
      }

      const bizId = `RECALL${now}`;
      let totalIntegralReclaimed = 0;
      const recalledItems = [];

      for (const mem of memberships) {
        await connection.query(
          `UPDATE ${swTable('user_membership')} SET status = 0, updated_at = ? WHERE id = ?`,
          [now, mem.id]
        );

        if (reclaimIntegral) {
          const sourceTypes = [];
          const sourceIds = [];

          if (mem.source_channel === 'offline_approval') {
            sourceTypes.push({ type: 'approval_grant', id: mem.source_ref });
            sourceTypes.push({ type: 'membership_grant', id: `offline_approval:${mem.source_ref}` });
          } else {
            sourceTypes.push({ type: 'membership_grant', id: `${mem.source_channel}:${mem.source_ref}` });
          }

          for (const { type, id } of sourceTypes) {
            const [integralBatches] = await connection.query(
              `SELECT id, remain_amount FROM ${swTable('integral_batch')}
               WHERE uid = ? AND source_type = ? AND source_id = ? AND status = 1
               FOR UPDATE`,
              [uid, type, id]
            );

            for (const batch of integralBatches) {
              const deducted = await voidIntegralBatch(connection, batch, uid, reason, bizId);
              totalIntegralReclaimed += deducted;
            }
          }
        }

        recalledItems.push({
          membershipId: mem.id,
          tierCode: mem.tier_code,
          sourceChannel: mem.source_channel,
          integralReclaimed: reclaimIntegral
        });
      }

      await syncUserMembershipFields(connection, uid);
      await connection.commit();

      await audit.write({
        adminUsername: session?.username || '',
        action: 'recall_membership',
        targetType: 'user',
        targetId: uid,
        payload: { reason, reclaimIntegral, totalIntegralReclaimed, recalledItems },
        ip: getClientIp(request)
      });

      return ok({
        uid,
        membershipCount: recalledItems.length,
        totalIntegralReclaimed,
        recalledItems
      }, `已回收 ${recalledItems.length} 条会员权益${reclaimIntegral ? `，扣回积分 ${totalIntegralReclaimed}` : ''}`);
    } catch (error) {
      await connection.rollback();
      return fail(reply, error.statusCode || 500, error.message || '回收会员权益失败');
    } finally {
      connection.release();
    }
  });

  app.post('/api/admin/members/:uid/recall-integral', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');

    const parsed = recallIntegralSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const { batchId, amount: specifiedAmount, reason } = parsed.data;
    const session = getAdminSession(request);
    const connection = await getPool().getConnection();
    const now = Math.floor(Date.now() / 1000);

    try {
      await connection.beginTransaction();

      const bizId = `RECALL${now}`;
      let totalDeducted = 0;

      if (batchId) {
        const [[batch]] = await connection.query(
          `SELECT id, remain_amount FROM ${swTable('integral_batch')}
           WHERE id = ? AND uid = ? AND status = 1 FOR UPDATE`,
          [batchId, uid]
        );
        if (!batch || Number(batch.remain_amount) <= 0) {
          await connection.rollback();
          return fail(reply, 400, '该积分批次不存在或已无余额');
        }
        totalDeducted = await voidIntegralBatch(connection, batch, uid, reason, bizId);
      } else if (specifiedAmount) {
        const [[userRow]] = await connection.query(
          `SELECT integral FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1 FOR UPDATE`,
          [uid]
        );
        if (!userRow) {
          await connection.rollback();
          return fail(reply, 404, '用户不存在');
        }
        const currentIntegral = Number(userRow.integral || 0);
        if (currentIntegral <= 0) {
          await connection.rollback();
          return fail(reply, 400, '该用户当前积分为0');
        }

        const deductAmount = Math.min(specifiedAmount, currentIntegral);
        const afterIntegral = currentIntegral - deductAmount;

        await connection.query(
          `UPDATE ${legacyTable('user')} SET integral = ? WHERE uid = ?`,
          [afterIntegral, uid]
        );
        await connection.query(
          `INSERT INTO ${legacyTable('user_bill')}
           (uid, link_id, pm, title, category, type, number, balance, mark, add_time, status, take, frozen_time)
           VALUES (?, ?, 0, '超管回收积分', 'integral', 'system_sub', ?, ?, ?, ?, 1, 0, 0)`,
          [uid, bizId, deductAmount, afterIntegral, reason, now]
        );
        await connection.query(
          `INSERT INTO ${swTable('integral_ledger')}
           (uid, direction, amount, balance_after, batch_id, biz_type, biz_id, remark, operator_uid, created_at)
           VALUES (?, 0, ?, ?, 0, 'recall', ?, ?, 0, ?)`,
          [uid, deductAmount, afterIntegral, bizId, reason, now]
        );
        totalDeducted = deductAmount;
      } else {
        await connection.rollback();
        return fail(reply, 400, '请指定 batchId 或 amount');
      }

      await connection.commit();

      await audit.write({
        adminUsername: session?.username || '',
        action: 'recall_integral',
        targetType: 'user',
        targetId: uid,
        payload: { batchId, specifiedAmount, totalDeducted, reason },
        ip: getClientIp(request)
      });

      return ok({ uid, totalDeducted }, `已回收 ${totalDeducted} 积分`);
    } catch (error) {
      await connection.rollback();
      return fail(reply, error.statusCode || 500, error.message || '回收积分失败');
    } finally {
      connection.release();
    }
  });
}

async function voidIntegralBatch(connection, batch, uid, remark, bizId) {
  const now = Math.floor(Date.now() / 1000);
  const remain = Number(batch.remain_amount || 0);
  if (remain <= 0) {
    await connection.query(
      `UPDATE ${swTable('integral_batch')} SET status = 0, updated_at = ? WHERE id = ?`,
      [now, batch.id]
    );
    return 0;
  }

  const [[userRow]] = await connection.query(
    `SELECT integral FROM ${legacyTable('user')} WHERE uid = ? LIMIT 1`,
    [uid]
  );
  const current = Number(userRow?.integral || 0);
  const deduct = Math.min(remain, current);
  const after = current - deduct;

  await connection.query(
    `UPDATE ${swTable('integral_batch')} SET remain_amount = 0, status = 0, updated_at = ? WHERE id = ?`,
    [now, batch.id]
  );
  if (deduct > 0) {
    await connection.query(
      `UPDATE ${legacyTable('user')} SET integral = ? WHERE uid = ?`,
      [after, uid]
    );
    await connection.query(
      `INSERT INTO ${legacyTable('user_bill')}
       (uid, link_id, pm, title, category, type, number, balance, mark, add_time, status, take, frozen_time)
       VALUES (?, ?, 0, '超管回收积分', 'integral', 'system_sub', ?, ?, ?, ?, 1, 0, 0)`,
      [uid, bizId, deduct, after, remark, now]
    );
    await connection.query(
      `INSERT INTO ${swTable('integral_ledger')}
       (uid, direction, amount, balance_after, batch_id, biz_type, biz_id, remark, operator_uid, created_at)
       VALUES (?, 0, ?, ?, ?, 'recall', ?, ?, 0, ?)`,
      [uid, deduct, after, batch.id, bizId, remark, now]
    );
  }
  return deduct;
}

async function syncUserMembershipFields(connection, uid) {
  const now = Math.floor(Date.now() / 1000);
  const [rows] = await connection.query(
    `SELECT um.expire_at, sm.tier_rank
     FROM ${swTable('user_membership')} um
     LEFT JOIN ${swTable('membership_ship_map')} sm ON sm.tier_code = um.tier_code
     WHERE um.uid = ? AND um.status = 1 AND um.expire_at > ?
     ORDER BY sm.tier_rank DESC, um.expire_at DESC
     LIMIT 1`,
    [uid, now]
  );
  if (rows[0]) {
    await connection.query(
      `UPDATE ${legacyTable('user')} SET is_money_level = 2, overdue_time = ? WHERE uid = ?`,
      [Number(rows[0].expire_at || 0), uid]
    );
  } else {
    await connection.query(
      `UPDATE ${legacyTable('user')} SET is_money_level = 0, is_ever_level = 0, overdue_time = 0 WHERE uid = ?`,
      [uid]
    );
  }
}

module.exports = { registerAdminRecallRoutes };
