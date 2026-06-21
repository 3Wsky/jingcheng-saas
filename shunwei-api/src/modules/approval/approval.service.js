const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

class ApprovalService {
  fixedGiftIntegral(tierCode) {
    return tierCode === 'SW299' ? 299000 : tierCode === 'SW199' ? 199000 : 0;
  }

  async matchTierRule(consumeAmount) {
    const amount = Number(consumeAmount || 0);
    const [rules] = await getPool().query(
      `SELECT * FROM ${swTable('tier_rule')}
       WHERE is_active = 1 AND min_amount <= ?
       ORDER BY min_amount DESC LIMIT 1`,
      [amount]
    );
    return rules[0] || null;
  }

  async getTierRules() {
    const [rows] = await getPool().query(
      `SELECT id, min_amount, max_amount, tier_code, voucher_amount, gift_integral
       FROM ${swTable('tier_rule')} WHERE is_active = 1 ORDER BY min_amount ASC`
    );
    return rows.map((row) => ({
      id: Number(row.id),
      minAmount: Number(row.min_amount),
      maxAmount: row.max_amount === null ? null : Number(row.max_amount),
      tierCode: row.tier_code,
      voucherAmount: Number(row.voucher_amount),
      giftIntegral: this.fixedGiftIntegral(row.tier_code)
    }));
  }

  async getTierRuleById(ruleId) {
    const [[rule]] = await getPool().query(
      `SELECT * FROM ${swTable('tier_rule')} WHERE id = ? AND is_active = 1 LIMIT 1`,
      [ruleId]
    );
    return rule || null;
  }

  async createRequest(params) {
    const { clerkUid, customerUid, receiptNo, rule } = params;
    const consumeAmount = Number(rule.min_amount || params.consumeAmount || 0);
    const now = Math.floor(Date.now() / 1000);

    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();

      const [[staff]] = await connection.query(
        `SELECT uid, division_id, is_staff FROM ${legacyTable('user')}
         WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
        [clerkUid]
      );
      const [[managerRole]] = staff ? await connection.query(
        `SELECT 1 AS v FROM ${swTable('store_manager')}
         WHERE manager_uid = ? AND is_active = 1 LIMIT 1`,
        [clerkUid]
      ) : [[]];
      if (!staff || (Number(staff.is_staff) !== 1 && !managerRole)) {
        throw Object.assign(new Error('当前账号无会员管理权限'), { statusCode: 403 });
      }
      const [[customer]] = await connection.query(
        `SELECT uid, spread_uid FROM ${legacyTable('user')}
         WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
        [customerUid]
      );
      if (!customer) throw Object.assign(new Error('会员不存在'), { statusCode: 404 });
      if (Number(customer.spread_uid || 0) !== Number(clerkUid)) {
        throw Object.assign(new Error('只能为本人名下会员申请权益'), { statusCode: 403 });
      }
      const [[pending]] = await connection.query(
        `SELECT id FROM ${swTable('approval_request')}
         WHERE customer_uid = ? AND staff_uid = ? AND status IN ('manager_review', 'admin_review')
         LIMIT 1 FOR UPDATE`,
        [customerUid, clerkUid]
      );
      if (pending) throw Object.assign(new Error('该会员已有待审批申请'), { statusCode: 409 });

      const requestNo = `AP${now}${clerkUid}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const [reqResult] = await connection.query(
        `INSERT INTO ${swTable('approval_request')}
         (request_no, biz_type, customer_uid, staff_uid, division_id, consumption_amount,
          matched_tier_code, matched_voucher_amount, matched_integral, receipt_no,
          status, created_at, updated_at)
         VALUES (?, 'consumption_grant', ?, ?, ?, ?, ?, ?, ?, ?, 'manager_review', ?, ?)`,
        [requestNo, customerUid, clerkUid, Number(staff.division_id || 0), consumeAmount,
         rule.tier_code, Number(rule.voucher_amount || 0),
         this.fixedGiftIntegral(rule.tier_code), receiptNo || '', now, now]
      );
      const requestId = reqResult.insertId;

      await connection.query(
        `INSERT INTO ${swTable('approval_step')}
         (request_id, step_role, operator_uid, action, comment, created_at)
         VALUES (?, 'staff', ?, 'submit', '', ?)`,
        [requestId, clerkUid, now]
      );

      const managers = await this.getManagersForClerk(connection, clerkUid);
      if (!managers.length) {
        throw Object.assign(new Error('当前门店未配置店长，无法提交'), { statusCode: 400 });
      }
      for (const mgr of managers) {
        await connection.query(
          `INSERT INTO ${swTable('approval_todo')}
           (request_id, assignee_uid, todo_type, is_done, created_at, done_at)
           VALUES (?, ?, 'manager_review', 0, ?, 0)`,
          [requestId, mgr.uid, now]
        );
      }

      await connection.commit();
      return {
        requestId,
        requestNo,
        status: 'manager_review',
        matchedRule: {
          id: Number(rule.id),
          tierCode: rule.tier_code,
          voucherAmount: Number(rule.voucher_amount || 0),
          giftIntegral: this.fixedGiftIntegral(rule.tier_code)
        }
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async reviewByManager(managerUid, requestId, action, reason = '') {
    const now = Math.floor(Date.now() / 1000);
    const connection = await getPool().getConnection();

    try {
      await connection.beginTransaction();

      const [[req]] = await connection.query(
        `SELECT * FROM ${swTable('approval_request')} WHERE id = ? FOR UPDATE`,
        [requestId]
      );
      if (!req) throw Object.assign(new Error('审批单不存在'), { statusCode: 404 });
      if (req.status !== 'manager_review') throw Object.assign(new Error('当前状态不允许店长审批'), { statusCode: 400 });
      const [[todo]] = await connection.query(
        `SELECT id FROM ${swTable('approval_todo')}
         WHERE request_id = ? AND assignee_uid = ? AND todo_type = 'manager_review' AND is_done = 0
         LIMIT 1 FOR UPDATE`,
        [requestId, managerUid]
      );
      if (!todo) throw Object.assign(new Error('没有该审批单的店长权限'), { statusCode: 403 });

      if (action === 'approve') {
        await connection.query(
          `UPDATE ${swTable('approval_request')} SET status = 'admin_review', updated_at = ? WHERE id = ?`,
          [now, requestId]
        );
        await connection.query(
          `INSERT INTO ${swTable('approval_step')}
           (request_id, step_role, operator_uid, action, comment, created_at)
           VALUES (?, 'manager', ?, 'approve', ?, ?)`,
          [requestId, managerUid, reason, now]
        );
        await connection.query(
          `UPDATE ${swTable('approval_todo')} SET is_done = 1, done_at = ?
           WHERE request_id = ? AND todo_type = 'manager_review'`,
          [now, requestId]
        );

        const admins = await this.getAdminUids(connection);
        for (const adminUid of admins) {
          await connection.query(
            `INSERT INTO ${swTable('approval_todo')}
             (request_id, assignee_uid, todo_type, is_done, created_at, done_at)
             VALUES (?, ?, 'admin_review', 0, ?, 0)`,
            [requestId, adminUid, now]
          );
        }
      } else {
        await connection.query(
          `UPDATE ${swTable('approval_request')} SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?`,
          [reason, now, requestId]
        );
        await connection.query(
          `INSERT INTO ${swTable('approval_step')}
           (request_id, step_role, operator_uid, action, comment, created_at)
           VALUES (?, 'manager', ?, 'reject', ?, ?)`,
          [requestId, managerUid, reason, now]
        );
        await connection.query(
          `UPDATE ${swTable('approval_todo')} SET is_done = 1, done_at = ?
           WHERE request_id = ? AND todo_type = 'manager_review'`,
          [now, requestId]
        );
      }

      await connection.commit();
      return { requestId, action, newStatus: action === 'approve' ? 'admin_review' : 'rejected' };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async reviewByAdmin(adminUid, requestId, action, reason = '') {
    const now = Math.floor(Date.now() / 1000);
    const connection = await getPool().getConnection();

    try {
      await connection.beginTransaction();

      const [[req]] = await connection.query(
        `SELECT * FROM ${swTable('approval_request')} WHERE id = ? FOR UPDATE`,
        [requestId]
      );
      if (!req) throw Object.assign(new Error('审批单不存在'), { statusCode: 404 });
      if (req.status !== 'admin_review') throw Object.assign(new Error('当前状态不允许超管审批'), { statusCode: 400 });

      if (action === 'approve') {
        const revokeDeadline = now + 24 * 3600;
        await connection.query(
          `UPDATE ${swTable('approval_request')}
           SET status = 'approved', approved_at = ?, revoke_deadline = ?, updated_at = ?
           WHERE id = ?`,
          [now, revokeDeadline, now, requestId]
        );
        await connection.query(
          `INSERT INTO ${swTable('approval_step')}
           (request_id, step_role, operator_uid, action, comment, created_at)
           VALUES (?, 'admin', ?, 'approve', ?, ?)`,
          [requestId, adminUid, reason, now]
        );

        await this.executeGrant(connection, req);
      } else {
        await connection.query(
          `UPDATE ${swTable('approval_request')} SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?`,
          [reason, now, requestId]
        );
        await connection.query(
          `INSERT INTO ${swTable('approval_step')}
           (request_id, step_role, operator_uid, action, comment, created_at)
           VALUES (?, 'admin', ?, 'reject', ?, ?)`,
          [requestId, adminUid, reason, now]
        );
      }

      await connection.query(
        `UPDATE ${swTable('approval_todo')} SET is_done = 1, done_at = ?
         WHERE request_id = ? AND todo_type = 'admin_review'`,
        [now, requestId]
      );

      await connection.commit();
      return { requestId, action, newStatus: action === 'approve' ? 'approved' : 'rejected' };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async executeGrant(connection, req) {
    const now = Math.floor(Date.now() / 1000);
    const uid = req.customer_uid;

    if (Number(req.matched_voucher_amount) > 0) {
      const expireAt = now + 365 * 86400;
      const [batchResult] = await connection.query(
        `INSERT INTO ${swTable('cash_voucher_batch')}
         (uid, source_type, source_id, total_amount, remain_amount, expire_at, status, created_at, updated_at)
         VALUES (?, 'approval_grant', ?, ?, ?, ?, 1, ?, ?)`,
        [uid, `APR${req.id}`, req.matched_voucher_amount, req.matched_voucher_amount, expireAt, now, now]
      );
      await connection.query(
        `INSERT INTO ${swTable('cash_voucher_ledger')}
         (uid, direction, amount, batch_id, merchant_id, operator_uid, biz_id, remark, created_at)
         VALUES (?, 1, ?, ?, 0, 0, ?, '审批通过发放现金券', ?)`,
        [uid, req.matched_voucher_amount, batchResult.insertId, `APR${req.id}`, now]
      );
    }

    if (req.matched_tier_code) {
      const { MembershipService } = require('../membership/membership.service');
      const membershipService = new MembershipService();
      await membershipService.grantApprovalMembership(connection, uid, {
        tierCode: req.matched_tier_code,
        refId: `APR${req.id}`,
        integralAmount: Number(req.matched_integral || 0)
      });
    }
  }

  async getTodos(uid, role) {
    const todoType = role === 'admin' ? 'admin_review' : 'manager_review';
    const [rows] = await getPool().query(
      `SELECT t.*, r.customer_uid, r.consumption_amount, r.matched_tier_code,
              r.matched_voucher_amount, r.matched_integral, r.status AS req_status,
              r.created_at AS req_created_at, r.staff_uid AS clerk_uid
       FROM ${swTable('approval_todo')} t
       JOIN ${swTable('approval_request')} r ON r.id = t.request_id
       WHERE t.assignee_uid = ? AND t.todo_type = ? AND t.is_done = 0
       ORDER BY t.created_at DESC`,
      [uid, todoType]
    );
    return rows;
  }

  /** FZLSaas 超管后台：列出全部待终审（不依赖小程序 JWT uid） */
  async getAdminTodos() {
    const [rows] = await getPool().query(
      `SELECT t.*, r.customer_uid, r.consumption_amount, r.matched_tier_code,
              r.matched_voucher_amount, r.matched_integral, r.status AS req_status,
              r.created_at AS req_created_at, r.staff_uid AS clerk_uid
       FROM ${swTable('approval_todo')} t
       JOIN ${swTable('approval_request')} r ON r.id = t.request_id
       WHERE t.todo_type = 'admin_review' AND t.is_done = 0 AND r.status = 'admin_review'
       ORDER BY t.created_at DESC`
    );
    return rows;
  }

  async resolveDefaultAdminUid() {
    const connection = await getPool().getConnection();
    try {
      const admins = await this.getAdminUids(connection);
      return admins[0] || 1;
    } finally {
      connection.release();
    }
  }

  /** Admin-R1: 全量审批记录列表 */
  async listApprovals(params) {
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize || 20)));
    const offset = (page - 1) * pageSize;

    const conditions = ['1=1'];
    const values = {};

    const statusMap = {
      pending_store: 'manager_review',
      pending_admin: 'admin_review',
      approved: 'approved',
      rejected: 'rejected',
      revoked: 'revoked'
    };
    if (params.status && params.status !== 'all') {
      const dbStatus = statusMap[params.status] || params.status;
      conditions.push('r.status = :status');
      values.status = dbStatus;
    }
    if (params.staffUid) {
      conditions.push('r.staff_uid = :staffUid');
      values.staffUid = Number(params.staffUid);
    }
    if (params.divisionId) {
      conditions.push('r.division_id = :divisionId');
      values.divisionId = Number(params.divisionId);
    }
    if (params.tierCode) {
      conditions.push('r.matched_tier_code = :tierCode');
      values.tierCode = params.tierCode;
    }
    if (params.receiptNo) {
      conditions.push('r.receipt_no LIKE :receiptNo');
      values.receiptNo = `%${params.receiptNo}%`;
    }
    if (params.amountMin) {
      conditions.push('r.consumption_amount >= :amountMin');
      values.amountMin = Number(params.amountMin);
    }
    if (params.amountMax) {
      conditions.push('r.consumption_amount <= :amountMax');
      values.amountMax = Number(params.amountMax);
    }
    if (params.dateFrom) {
      const start = Math.floor(new Date(`${params.dateFrom}T00:00:00`).getTime() / 1000);
      conditions.push('r.created_at >= :dateFrom');
      values.dateFrom = start;
    }
    if (params.dateTo) {
      const end = Math.floor(new Date(`${params.dateTo}T23:59:59`).getTime() / 1000);
      conditions.push('r.created_at <= :dateTo');
      values.dateTo = end;
    }

    const where = conditions.join(' AND ');

    const [[countRow]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM ${swTable('approval_request')} r WHERE ${where}`,
      values
    );

    const [rows] = await getPool().query(
      `SELECT r.*, cu.nickname AS customer_nickname, su.nickname AS staff_nickname
       FROM ${swTable('approval_request')} r
       LEFT JOIN ${legacyTable('user')} cu ON cu.uid = r.customer_uid
       LEFT JOIN ${legacyTable('user')} su ON su.uid = r.staff_uid
       WHERE ${where}
       ORDER BY r.id DESC
       LIMIT :limit OFFSET :offset`,
      { ...values, limit: pageSize, offset }
    );

    const list = [];
    for (const row of rows) {
      const steps = await this.getStepsForRequest(row.id);
      list.push(this.mapApprovalListItem(row, steps));
    }

    return {
      total: Number(countRow?.total || 0),
      page,
      pageSize,
      list
    };
  }

  async getApprovalDetail(requestId) {
    const [[row]] = await getPool().query(
      `SELECT r.*, cu.nickname AS customer_nickname, su.nickname AS staff_nickname
       FROM ${swTable('approval_request')} r
       LEFT JOIN ${legacyTable('user')} cu ON cu.uid = r.customer_uid
       LEFT JOIN ${legacyTable('user')} su ON su.uid = r.staff_uid
       WHERE r.id = ? LIMIT 1`,
      [requestId]
    );
    if (!row) {
      const error = new Error('审批单不存在');
      error.statusCode = 404;
      throw error;
    }
    const steps = await this.getStepsForRequest(requestId);
    return this.mapApprovalListItem(row, steps, true);
  }

  async getStepsForRequest(requestId) {
    try {
      const [steps] = await getPool().query(
        `SELECT * FROM ${swTable('approval_step')} WHERE request_id = ? ORDER BY id ASC`,
        [requestId]
      );
      return steps.map((s) => ({
        stepRole: s.step_role || s.role || '',
        operatorUid: Number(s.operator_uid || s.assignee_uid || 0),
        action: s.action || '',
        comment: s.comment || s.remark || '',
        createdAt: Number(s.created_at || 0)
      }));
    } catch {
      return [];
    }
  }

  mapApprovalListItem(row, steps, includeImages = false) {
    let receiptImages = [];
    if (includeImages && row.receipt_images) {
      try { receiptImages = JSON.parse(row.receipt_images); } catch { receiptImages = []; }
    }
    const displayStatus = {
      manager_review: 'pending_store',
      admin_review: 'pending_admin',
      approved: 'approved',
      rejected: 'rejected',
      revoked: 'revoked'
    }[row.status] || row.status;

    return {
      requestId: row.id,
      requestNo: row.request_no || '',
      customerUid: row.customer_uid,
      customerNickname: row.customer_nickname || '',
      staffUid: row.staff_uid,
      staffNickname: row.staff_nickname || '',
      divisionId: Number(row.division_id || 0),
      consumptionAmount: Number(row.consumption_amount ?? row.consume_amount ?? 0),
      matchedTierCode: row.matched_tier_code || '',
      matchedVoucherAmount: Number(row.matched_voucher_amount || 0),
      matchedIntegral: Number(row.matched_integral || 0),
      receiptNo: row.receipt_no || '',
      receiptImages: includeImages ? receiptImages : undefined,
      status: displayStatus,
      dbStatus: row.status,
      rejectReason: row.reject_reason || '',
      createdAt: Number(row.created_at || 0),
      approvedAt: Number(row.approved_at || 0),
      revokeDeadline: Number(row.revoke_deadline || 0),
      canRevoke: row.status === 'approved' && Number(row.revoke_deadline || 0) > Math.floor(Date.now() / 1000),
      steps
    };
  }

  async getApprovalAutoPassConfig() {
    const [rows] = await getPool().query(
      `SELECT config_key, config_value FROM ${swTable('system_config')}
       WHERE config_key IN ('integral_mall_skip_approval', 'consumption_approval_auto_pass')`
    );
    const map = Object.fromEntries(rows.map((r) => [r.config_key, r.config_value]));
    return {
      integralMall: map.integral_mall_skip_approval === '1' || map.integral_mall_skip_approval === 'true',
      consumption: map.consumption_approval_auto_pass === '1' || map.consumption_approval_auto_pass === 'true'
    };
  }

  async updateApprovalAutoPassConfig(input) {
    const now = Math.floor(Date.now() / 1000);
    const pool = getPool();

    if (input.scope === 'integral_mall' || input.scope === 'all') {
      const enabled = input.scope === 'all' ? input.enabled : input.enabled;
      await pool.query(
        `INSERT INTO ${swTable('system_config')} (config_key, config_value, updated_at)
         VALUES ('integral_mall_skip_approval', ?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = VALUES(updated_at)`,
        [enabled ? '1' : '0', now]
      );
    }

    if (input.scope === 'consumption' || input.scope === 'all') {
      await pool.query(
        `INSERT INTO ${swTable('system_config')} (config_key, config_value, updated_at)
         VALUES ('consumption_approval_auto_pass', ?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = VALUES(updated_at)`,
        [input.enabled ? '1' : '0', now]
      );
    }

    return this.getApprovalAutoPassConfig();
  }

  async revokeApproval(adminUid, requestId, reason = '') {
    const now = Math.floor(Date.now() / 1000);
    const connection = await getPool().getConnection();

    try {
      await connection.beginTransaction();

      const [[req]] = await connection.query(
        `SELECT * FROM ${swTable('approval_request')} WHERE id = ? FOR UPDATE`,
        [requestId]
      );
      if (!req) throw Object.assign(new Error('审批单不存在'), { statusCode: 404 });
      if (req.status !== 'approved') {
        throw Object.assign(new Error('仅已通过终批的记录可撤销'), { statusCode: 400 });
      }
      if (Number(req.revoke_deadline || 0) <= now) {
        throw Object.assign(new Error('已超过 24 小时撤销窗口'), { statusCode: 400 });
      }

      await this.reverseGrant(connection, req);

      await connection.query(
        `UPDATE ${swTable('approval_request')} SET status = 'revoked', updated_at = ? WHERE id = ?`,
        [now, requestId]
      );
      await connection.query(
        `INSERT INTO ${swTable('approval_step')}
         (request_id, step_role, operator_uid, action, comment, created_at)
         VALUES (?, 'admin', ?, 'revoke', ?, ?)`,
        [requestId, adminUid, reason || '超管撤销终批', now]
      );

      await connection.commit();
      return { requestId, newStatus: 'revoked' };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async reverseGrant(connection, req) {
    const now = Math.floor(Date.now() / 1000);
    const uid = req.customer_uid;
    const aprRef = `APR${req.id}`;

    const [voucherBatches] = await connection.query(
      `SELECT id, remain_amount FROM ${swTable('cash_voucher_batch')}
       WHERE uid = ? AND source_type = 'approval_grant' AND source_id = ? AND status = 1`,
      [uid, aprRef]
    );
    for (const batch of voucherBatches) {
      const remain = Number(batch.remain_amount || 0);
      await connection.query(
        `UPDATE ${swTable('cash_voucher_batch')} SET remain_amount = 0, status = 0, updated_at = ? WHERE id = ?`,
        [now, batch.id]
      );
      if (remain > 0) {
        await connection.query(
          `INSERT INTO ${swTable('cash_voucher_ledger')}
           (uid, direction, amount, batch_id, merchant_id, operator_uid, biz_id, remark, created_at)
           VALUES (?, 0, ?, ?, 0, 0, ?, '审批撤销回收现金券', ?)`,
          [uid, remain, batch.id, aprRef, now]
        );
      }
    }

    const integralSources = [
      { sourceType: 'approval_grant', sourceId: aprRef },
      { sourceType: 'membership_grant', sourceId: `offline_approval:${aprRef}` }
    ];
    for (const { sourceType, sourceId } of integralSources) {
      const [batches] = await connection.query(
        `SELECT id, remain_amount FROM ${swTable('integral_batch')}
         WHERE uid = ? AND source_type = ? AND source_id = ? AND status = 1`,
        [uid, sourceType, sourceId]
      );
      for (const batch of batches) {
        await this.voidIntegralBatch(connection, batch, uid, '审批撤销回收积分', aprRef);
      }
    }

    await connection.query(
      `UPDATE ${swTable('user_membership')} SET status = 0, updated_at = ?
       WHERE uid = ? AND source_channel = 'offline_approval' AND source_ref = ? AND status = 1`,
      [now, uid, aprRef]
    );
    await this.syncUserMembershipFields(connection, uid);
  }

  async voidIntegralBatch(connection, batch, uid, remark, bizId) {
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
         VALUES (?, ?, 0, '审批撤销扣减积分', 'integral', 'system_sub', ?, ?, ?, ?, 1, 0, 0)`,
        [uid, bizId, deduct, after, remark, now]
      );
      await connection.query(
        `INSERT INTO ${swTable('integral_ledger')}
         (uid, direction, amount, balance_after, batch_id, biz_type, biz_id, remark, operator_uid, created_at)
         VALUES (?, 0, ?, ?, ?, 'revoke', ?, ?, 0, ?)`,
        [uid, deduct, after, batch.id, bizId, remark, now]
      );
    }
    return deduct;
  }

  async syncUserMembershipFields(connection, uid) {
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

  async getManagersForClerk(connection, clerkUid) {
    const [[user]] = await connection.query(
      `SELECT division_id FROM ${legacyTable('user')} WHERE uid = ? LIMIT 1`,
      [clerkUid]
    );
    const divisionId = Number(user?.division_id || 0);

    const [managers] = await connection.query(
      `SELECT manager_uid AS uid FROM ${swTable('store_manager')}
       WHERE (division_id = ? OR division_id = 0) AND is_active = 1`,
      [divisionId]
    );
    return managers;
  }

  async getAdminUids(connection) {
    const [rows] = await connection.query(
      `SELECT config_value FROM ${swTable('system_config')}
       WHERE config_key = 'approval_admin_uids' LIMIT 1`
    );
    if (rows[0]?.config_value) {
      return rows[0].config_value.split(',').map(s => Number(s.trim())).filter(n => n > 0);
    }
    return [1];
  }
}

module.exports = { ApprovalService };
