const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const { SnCatalogService } = require('../admin/sn-catalog.service');
const { ApprovalCodeUsageService } = require('./approval-code-usage.service');

class ApprovalService {
  constructor() {
    this.codeUsage = new ApprovalCodeUsageService();
  }

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
    const consumeAmount = Number(params.consumeAmount || rule.min_amount || 0);
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

      // 防作弊①：收据里的 IMEI1/SN 不能是已被其它单用过的（一码一次，直接拦死）
      const usage = await this.codeUsage.checkUsable(receiptNo || '', { conn: connection });
      if (!usage.usable) {
        const c = usage.conflicts[0];
        const label = (c.type === 'imei1' ? 'IMEI' : 'SN') + '「' + (c.raw || c.norm) + '」';
        throw Object.assign(
          new Error(`该${label}已被使用过，不能重复申请权益`),
          { statusCode: 409 }
        );
      }

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

        // 终审「按码自动通过」：店长初审通过后，若开启该开关且收据里的 IMEI1/SN 在产品库命中，
        // 则系统自动完成超管终审并发放权益（免人工终审）。命中不到则维持人工终审。
        const autoPassed = await this.tryAutoPassByCode(connection, requestId, admins[0] || 1, now);
        await connection.commit();
        return { requestId, action, newStatus: autoPassed ? 'approved' : 'admin_review', autoPassed };
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

  /** 读取「按码自动终审」开关（system_config: consumption_auto_pass_on_code_match）。默认关闭。 */
  async isAutoPassByCodeEnabled(connection) {
    const db = connection || getPool();
    try {
      const [[row]] = await db.query(
        `SELECT config_value FROM ${swTable('system_config')}
         WHERE config_key = 'consumption_auto_pass_on_code_match' LIMIT 1`
      );
      const v = row && row.config_value;
      return v === '1' || v === 'true';
    } catch {
      return false;
    }
  }

  /**
   * 终审「按码自动通过」：在同一事务内调用（店长初审通过后）。
   * 条件：开关开启 + 该单已处于 admin_review + 收据里的 IMEI1/SN 在产品库命中。
   * 命中则系统自动完成超管终审（写 step、关 admin todo、发放权益），返回 true；否则返回 false（维持人工终审）。
   */
  async tryAutoPassByCode(connection, requestId, systemAdminUid, now) {
    if (!(await this.isAutoPassByCodeEnabled(connection))) return false;

    const [[req]] = await connection.query(
      `SELECT * FROM ${swTable('approval_request')} WHERE id = ? FOR UPDATE`,
      [requestId]
    );
    if (!req || req.status !== 'admin_review') return false;

    let matched = false;
    try {
      const catalog = new SnCatalogService();
      const result = await catalog.verifyCodes({ receiptNo: req.receipt_no || '' });
      // 安全口径：必须「有码」且「全部码都命中」才自动通过（多产品时只命中一部分→转人工终审）
      matched = !!(result && result.hasCode && result.allMatched);
      // 防作弊①：若任一码已被其它单用过 → 不自动通过（排除自身单），转人工终审
      if (matched) {
        const usage = await this.codeUsage.checkUsable(req.receipt_no || '', { excludeRequestId: Number(requestId), conn: connection });
        if (!usage.usable) matched = false;
      }
    } catch {
      // 产品库异常时不自动通过，安全降级为人工终审
      return false;
    }
    if (!matched) return false;

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
      [requestId, systemAdminUid, '系统按 IMEI/SN 码核对通过自动终审', now]
    );
    await connection.query(
      `UPDATE ${swTable('approval_todo')} SET is_done = 1, done_at = ?
       WHERE request_id = ? AND todo_type = 'admin_review'`,
      [now, requestId]
    );
    await this.executeGrant(connection, req);
    return true;
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

    // 防作弊①：发放成功后登记该单的 IMEI1/SN 为"已用"（唯一约束兜底，杜绝一码多领）
    try {
      await this.codeUsage.registerForRequest(connection, req);
    } catch (err) {
      // 唯一键冲突 = 该码已被登记（并发兜底）。发放已完成，这里不应回滚整单，仅记录。
      if (!(err && (err.code === 'ER_DUP_ENTRY' || /duplicate/i.test(String(err.message))))) throw err;
    }
  }

  async getTodos(uid, role) {
    const todoType = role === 'admin' ? 'admin_review' : 'manager_review';
    const [rows] = await getPool().query(
      `SELECT t.*, r.customer_uid, r.consumption_amount, r.matched_tier_code,
              r.matched_voucher_amount, r.matched_integral, r.status AS req_status,
              r.created_at AS req_created_at, r.staff_uid AS clerk_uid, r.receipt_no,
              cu.nickname AS customer_nickname, su.nickname AS staff_nickname
       FROM ${swTable('approval_todo')} t
       JOIN ${swTable('approval_request')} r ON r.id = t.request_id
       LEFT JOIN ${legacyTable('user')} cu ON cu.uid = r.customer_uid
       LEFT JOIN ${legacyTable('user')} su ON su.uid = r.staff_uid
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
              r.created_at AS req_created_at, r.staff_uid AS clerk_uid,
              cu.nickname AS customer_nickname, su.nickname AS staff_nickname
       FROM ${swTable('approval_todo')} t
       JOIN ${swTable('approval_request')} r ON r.id = t.request_id
       LEFT JOIN ${legacyTable('user')} cu ON cu.uid = r.customer_uid
       LEFT JOIN ${legacyTable('user')} su ON su.uid = r.staff_uid
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

  /**
   * 管理员终审页「当日自动审批」统计（自然日，今天 00:00 起）。
   * 返回：
   *  - autoApproved：今日系统自动终审笔数（admin approve 步骤带"自动终审"备注）
   *  - manualApproved：今日人工终审笔数
   *  - pending：当前仍挂在待终审(admin_review)的笔数（今日到达终审环节的）
   *  - notAutoReasons：今日"本可评估却未自动"的原因分类汇总（免审关/码未全命中/码被占用/无码/异常）
   *  - autoPassEnabled：当前免审开关是否开启
   */
  async getAutoPassStatsToday() {
    const pool = getPool();
    const now = new Date();
    const todayStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime() / 1000);
    const AUTO_MARK = '%自动终审%';

    // 今日 admin 通过步骤（区分自动/人工）
    const [[autoRow]] = await pool.query(
      `SELECT COUNT(DISTINCT request_id) AS c FROM ${swTable('approval_step')}
       WHERE step_role = 'admin' AND action = 'approve' AND created_at >= ? AND comment LIKE ?`,
      [todayStart, AUTO_MARK]
    );
    const [[manualRow]] = await pool.query(
      `SELECT COUNT(DISTINCT request_id) AS c FROM ${swTable('approval_step')}
       WHERE step_role = 'admin' AND action = 'approve' AND created_at >= ? AND (comment IS NULL OR comment NOT LIKE ?)`,
      [todayStart, AUTO_MARK]
    );
    const autoApproved = Number(autoRow?.c || 0);
    const manualApproved = Number(manualRow?.c || 0);

    // 今日到达/仍在"待终审"的单（用于统计挂起 + 归因未自动）
    const [pendingRows] = await pool.query(
      `SELECT r.id, r.receipt_no FROM ${swTable('approval_request')} r
       WHERE r.status = 'admin_review'
         AND EXISTS (
           SELECT 1 FROM ${swTable('approval_step')} s
           WHERE s.request_id = r.id AND s.step_role = 'manager' AND s.action = 'approve' AND s.created_at >= ?
         )`,
      [todayStart]
    );
    const pending = pendingRows.length;

    // 归因：今日"人工通过"的单 + 今日仍挂起的单，为什么没自动？逐单用同一套口径判定
    const autoPassEnabled = await this.isAutoPassByCodeEnabled();
    const reasons = { switchOff: 0, noCode: 0, notAllMatched: 0, reused: 0, other: 0 };

    // 今日人工通过的单号
    const [manualIdRows] = await pool.query(
      `SELECT DISTINCT s.request_id AS id, r.receipt_no AS receipt_no
       FROM ${swTable('approval_step')} s
       JOIN ${swTable('approval_request')} r ON r.id = s.request_id
       WHERE s.step_role = 'admin' AND s.action = 'approve' AND s.created_at >= ? AND (s.comment IS NULL OR s.comment NOT LIKE ?)`,
      [todayStart, AUTO_MARK]
    );
    const toDiagnose = [...manualIdRows, ...pendingRows];

    if (toDiagnose.length) {
      const catalog = new SnCatalogService();
      for (const r of toDiagnose) {
        if (!autoPassEnabled) { reasons.switchOff += 1; continue; }
        let v = null;
        try {
          // eslint-disable-next-line no-await-in-loop
          v = await catalog.verifyCodes({ receiptNo: r.receipt_no || '' });
        } catch { v = null; }
        if (!v || !v.hasCode) { reasons.noCode += 1; continue; }
        if (!v.allMatched) { reasons.notAllMatched += 1; continue; }
        let reused = false;
        try {
          // eslint-disable-next-line no-await-in-loop
          const usage = await this.codeUsage.checkUsable(r.receipt_no || '', { excludeRequestId: Number(r.id) });
          reused = !usage.usable;
        } catch { reused = false; }
        if (reused) { reasons.reused += 1; continue; }
        reasons.other += 1;
      }
    }

    return {
      date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
      autoPassEnabled,
      autoApproved,
      manualApproved,
      pending,
      notAutoTotal: manualApproved + pending,
      notAutoReasons: reasons
    };
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
    // autoPass 过滤：'1'=系统自动终审的单，'0'=人工终审的单（按 admin approve 步骤的备注区分）
    if (params.autoPass === '1' || params.autoPass === 1 || params.autoPass === true) {
      conditions.push(`EXISTS (SELECT 1 FROM ${swTable('approval_step')} s
        WHERE s.request_id = r.id AND s.step_role = 'admin' AND s.action = 'approve' AND s.comment LIKE '%自动终审%')`);
    } else if (params.autoPass === '0' || params.autoPass === 0 || params.autoPass === false) {
      conditions.push(`EXISTS (SELECT 1 FROM ${swTable('approval_step')} s
        WHERE s.request_id = r.id AND s.step_role = 'admin' AND s.action = 'approve' AND (s.comment IS NULL OR s.comment NOT LIKE '%自动终审%'))`);
    }

    const where = conditions.join(' AND ');

    const [[countRow]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM ${swTable('approval_request')} r WHERE ${where}`,
      values
    );

    const [rows] = await getPool().query(
      `SELECT r.*, cu.nickname AS customer_nickname, cu.phone AS customer_phone,
              su.nickname AS staff_nickname, su.phone AS staff_phone
       FROM ${swTable('approval_request')} r
       LEFT JOIN ${legacyTable('user')} cu ON cu.uid = r.customer_uid
       LEFT JOIN ${legacyTable('user')} su ON su.uid = r.staff_uid
       WHERE ${where}
       ORDER BY r.id DESC
       LIMIT :limit OFFSET :offset`,
      { ...values, limit: pageSize, offset }
    );

    // 批量取 steps（避免 N+1：原先每条审批单单独查一次 steps）
    const stepsByRequest = await this.getStepsForRequests(rows.map((r) => r.id));
    const list = rows.map((row) => this.mapApprovalListItem(row, stepsByRequest[row.id] || []));

    return {
      total: Number(countRow?.total || 0),
      page,
      pageSize,
      list
    };
  }

  /** 一次性按多个 requestId 批量取步骤，返回 { [requestId]: steps[] }，避免列表 N+1 查询 */
  async getStepsForRequests(requestIds) {
    const ids = (requestIds || []).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
    if (!ids.length) return {};
    try {
      const [steps] = await getPool().query(
        `SELECT s.*, u.nickname AS operator_nickname, u.phone AS operator_phone
         FROM ${swTable('approval_step')} s
         LEFT JOIN ${legacyTable('user')} u ON u.uid = s.operator_uid
         WHERE s.request_id IN (${ids.map(() => '?').join(',')})
         ORDER BY s.id ASC`,
        ids
      );
      const grouped = {};
      for (const s of steps) {
        const rid = Number(s.request_id);
        if (!grouped[rid]) grouped[rid] = [];
        grouped[rid].push({
          stepRole: s.step_role || s.role || '',
          operatorUid: Number(s.operator_uid || s.assignee_uid || 0),
          operatorNickname: s.operator_nickname || '',
          operatorPhone: s.operator_phone || '',
          action: s.action || '',
          comment: s.comment || s.remark || '',
          createdAt: Number(s.created_at || 0)
        });
      }
      return grouped;
    } catch {
      return {};
    }
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
    const detail = this.mapApprovalListItem(row, steps, true);
    // 附带 IMEI/SN 码核对结果 + 是否已被其它单用过，便于超管在后台一眼判断
    try {
      const catalog = new SnCatalogService();
      const v = await catalog.verifyCodes({ receiptNo: row.receipt_no || '' });
      let reused = false;
      let reusedConflicts = [];
      try {
        const usage = await this.codeUsage.checkUsable(row.receipt_no || '', { excludeRequestId: Number(requestId) });
        reused = !usage.usable;
        reusedConflicts = usage.conflicts;
      } catch { /* 台账异常不影响详情展示 */ }
      // 隐藏品类：命中大疆型号时给出 category='大疆'，供后台终审显示产品类型
      const hitCategory = v.hit
        ? SnCatalogService.inferCategory({ model: v.hit.model || '', brand: v.hit.brand || '' })
        : '';
      detail.codeVerify = {
        hasCode: v.hasCode,
        matched: v.matched,
        matchedBy: v.matchedBy,
        hit: v.hit || null,
        category: hitCategory,
        totalCodes: v.totalCodes,
        matchedCount: v.matchedCount,
        allMatched: v.allMatched,
        reused,
        reusedConflicts
      };
    } catch {
      detail.codeVerify = { hasCode: false, matched: false, matchedBy: '', hit: null, category: '', reused: false, reusedConflicts: [] };
    }
    return detail;
  }

  async getStepsForRequest(requestId) {
    try {
      const [steps] = await getPool().query(
        `SELECT s.*, u.nickname AS operator_nickname, u.phone AS operator_phone
         FROM ${swTable('approval_step')} s
         LEFT JOIN ${legacyTable('user')} u ON u.uid = s.operator_uid
         WHERE s.request_id = ? ORDER BY s.id ASC`,
        [requestId]
      );
      return steps.map((s) => ({
        stepRole: s.step_role || s.role || '',
        operatorUid: Number(s.operator_uid || s.assignee_uid || 0),
        operatorNickname: s.operator_nickname || '',
        operatorPhone: s.operator_phone || '',
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
      customerPhone: row.customer_phone || '',
      staffUid: row.staff_uid,
      staffNickname: row.staff_nickname || '',
      staffPhone: row.staff_phone || '',
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
    // 消费审批免审统一用 consumption_auto_pass_on_code_match（即 tryAutoPassByCode 读取的键），
    // 语义：店长初审通过 + 收据 IMEI1/SN 在产品库命中 → 自动终审发放。
    // 旧键 consumption_approval_auto_pass 已废弃（从未被审批流消费），仅向后兼容读取做兜底。
    const [rows] = await getPool().query(
      `SELECT config_key, config_value FROM ${swTable('system_config')}
       WHERE config_key IN ('integral_mall_skip_approval', 'consumption_auto_pass_on_code_match', 'consumption_approval_auto_pass')`
    );
    const map = Object.fromEntries(rows.map((r) => [r.config_key, r.config_value]));
    const on = (v) => v === '1' || v === 'true';
    return {
      integralMall: on(map.integral_mall_skip_approval),
      consumption: on(map.consumption_auto_pass_on_code_match) || on(map.consumption_approval_auto_pass)
    };
  }

  async updateApprovalAutoPassConfig(input) {
    const now = Math.floor(Date.now() / 1000);
    const pool = getPool();

    if (input.scope === 'integral_mall' || input.scope === 'all') {
      await pool.query(
        `INSERT INTO ${swTable('system_config')} (config_key, config_value, updated_at)
         VALUES ('integral_mall_skip_approval', ?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = VALUES(updated_at)`,
        [input.enabled ? '1' : '0', now]
      );
    }

    if (input.scope === 'consumption' || input.scope === 'all') {
      const val = input.enabled ? '1' : '0';
      // 写入功能键（tryAutoPassByCode 读取）；旧键一并同步，避免历史 UI/数据不一致
      await pool.query(
        `INSERT INTO ${swTable('system_config')} (config_key, config_value, updated_at)
         VALUES ('consumption_auto_pass_on_code_match', ?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = VALUES(updated_at)`,
        [val, now]
      );
      await pool.query(
        `INSERT INTO ${swTable('system_config')} (config_key, config_value, updated_at)
         VALUES ('consumption_approval_auto_pass', ?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = VALUES(updated_at)`,
        [val, now]
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

    // 锁定用户行后重读积分，避免审批撤销扣分与并发积分变动互相覆盖（丢失更新）。
    const [[userRow]] = await connection.query(
      `SELECT integral FROM ${legacyTable('user')} WHERE uid = ? LIMIT 1 FOR UPDATE`,
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
