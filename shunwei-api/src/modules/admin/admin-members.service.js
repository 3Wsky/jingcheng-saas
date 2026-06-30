const { getPool, legacyTable } = require('../../shared/mysql');
const { AdminStoresService } = require('./admin-stores.service');
const { AdminMerchantStaffService } = require('../merchant/admin-merchant-staff.service');
const { swTable } = require('../../shared/sw-mysql');
const { IntegralService } = require('../integral/integral.service');

function maskPhone(phone) {
  const value = String(phone || '');
  if (value.length < 7) return value;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function buildTags(row) {
  const tags = [];
  if (row.tier_code === 'SW199') tags.push('tier199');
  if (row.tier_code === 'SW299') tags.push('tier299');
  if (!row.tier_code) tags.push('normal');
  if (Number(row.is_staff) === 1) tags.push('staff');
  if (Number(row.is_manager) === 1) tags.push('manager');
  if (Number(row.is_merchant) === 1) tags.push('merchant');
  if (Number(row.is_merchant_staff) === 1) tags.push('merchant_staff');
  return tags;
}

function tagMatches(row, tagFilter) {
  if (!tagFilter.length) return true;
  const tags = buildTags(row);
  return tagFilter.every((t) => tags.includes(t));
}

function countRoles(row) {
  let n = 0;
  if (Number(row.is_staff) === 1) n++;
  if (Number(row.is_manager) === 1) n++;
  if (Number(row.is_merchant) === 1) n++;
  if (Number(row.is_merchant_staff) === 1) n++;
  return n;
}

function multiRoleMatches(row, multiRole, dualRole) {
  if (multiRole) return countRoles(row) >= 2;
  if (!dualRole) return true;
  const isStaff = Number(row.is_staff) === 1;
  const isManager = Number(row.is_manager) === 1;
  const isMerchantStaff = Number(row.is_merchant_staff) === 1;
  switch (dualRole) {
    case 'staff_verifier':
      return isStaff && isMerchantStaff;
    case 'manager_verifier':
      return isManager && isMerchantStaff;
    case 'any':
      return (isStaff || isManager) && isMerchantStaff;
    default:
      return true;
  }
}

class AdminMembersService {
  async list(params) {
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize || 20)));
    const keyword = String(params.keyword || '').trim();
    const searchType = String(params.searchType || 'all');
    const tagFilter = String(params.tag || '').split(',').map((s) => s.trim()).filter(Boolean);
    const dualRole = String(params.dualRole || '').trim();
    const multiRole = Boolean(params.multiRole);
    const pool = getPool();

    const conditions = ['COALESCE(u.is_del, 0) = 0'];
    const values = [];

    if (params.unownedOnly) {
      conditions.push('COALESCE(u.spread_uid, 0) = 0');
    } else if (params.spreadUid) {
      conditions.push('u.spread_uid = ?');
      values.push(Number(params.spreadUid));
    }

    if (keyword) {
      if (searchType === 'uid' && /^\d+$/.test(keyword)) {
        conditions.push('u.uid = ?');
        values.push(Number(keyword));
      } else if (searchType === 'phone') {
        conditions.push('u.phone LIKE ?');
        values.push(`%${keyword}%`);
      } else if (searchType === 'nickname') {
        conditions.push('u.nickname LIKE ?');
        values.push(`%${keyword}%`);
      } else if (/^\d+$/.test(keyword)) {
        conditions.push('(u.uid = ? OR u.phone LIKE ?)');
        values.push(Number(keyword), `%${keyword}%`);
      } else {
        conditions.push('(u.nickname LIKE ? OR u.phone LIKE ?)');
        values.push(`%${keyword}%`, `%${keyword}%`);
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const baseSql = `
      SELECT u.uid, u.nickname, u.phone, u.avatar, u.integral, u.spread_uid, u.is_staff, u.division_id, u.add_time,
             m.tier_code, m.expire_at AS membership_expire_at,
             COALESCE(cv.cash_voucher_balance, 0) AS cash_voucher_balance,
             sp.nickname AS spread_nickname,
             EXISTS(SELECT 1 FROM ${swTable('store_manager')} sm WHERE sm.manager_uid = u.uid AND sm.is_active = 1) AS is_manager,
             EXISTS(SELECT 1 FROM ${swTable('merchant')} mer WHERE mer.login_uid = u.uid AND mer.is_active = 1) AS is_merchant,
             EXISTS(SELECT 1 FROM ${swTable('merchant_staff')} mst JOIN ${swTable('merchant')} mst_m ON mst_m.id = mst.merchant_id AND mst_m.is_active = 1 WHERE mst.staff_uid = u.uid AND mst.is_active = 1) AS is_merchant_staff,
             (SELECT MAX(r.created_at) FROM ${swTable('approval_request')} r WHERE r.customer_uid = u.uid) AS last_approval_at
      FROM ${legacyTable('user')} u
      LEFT JOIN (
        SELECT s1.uid, s1.tier_code, s1.expire_at
        FROM ${swTable('user_membership')} s1
        WHERE s1.status = 1 AND s1.expire_at > UNIX_TIMESTAMP()
          AND s1.id = (
            SELECT s2.id FROM ${swTable('user_membership')} s2
            WHERE s2.uid = s1.uid AND s2.status = 1 AND s2.expire_at > UNIX_TIMESTAMP()
            ORDER BY CASE s2.tier_code WHEN 'SW299' THEN 2 WHEN 'SW199' THEN 1 ELSE 0 END DESC, s2.expire_at DESC
            LIMIT 1
          )
      ) m ON m.uid = u.uid
      LEFT JOIN (
        SELECT uid, SUM(remain_amount) AS cash_voucher_balance
        FROM ${swTable('cash_voucher_batch')} WHERE status = 1 GROUP BY uid
      ) cv ON cv.uid = u.uid
      LEFT JOIN ${legacyTable('user')} sp ON sp.uid = u.spread_uid
      ${where}
      ORDER BY u.uid DESC
    `;

    const [allRows] = await pool.query(baseSql, values);
    let filtered = tagFilter.length ? allRows.filter((row) => tagMatches(row, tagFilter)) : allRows;
    if (multiRole || dualRole) {
      filtered = filtered.filter((row) => multiRoleMatches(row, multiRole, dualRole));
    }
    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const slice = filtered.slice(offset, offset + pageSize);

    return {
      total,
      page,
      pageSize,
      list: slice.map((row) => ({
        uid: row.uid,
        nickname: row.nickname || '',
        phone: maskPhone(row.phone),
        avatar: row.avatar || '',
        tags: buildTags(row),
        tierCode: row.tier_code || '',
        membershipExpireAt: Number(row.membership_expire_at || 0),
        integralBalance: Number(row.integral || 0),
        integralFrozen: 0,
        cashVoucherBalance: Number(row.cash_voucher_balance || 0),
        spreadUid: Number(row.spread_uid || 0),
        spreadNickname: row.spread_nickname || '',
        registerAt: Number(row.add_time || 0),
        lastApprovalAt: Number(row.last_approval_at || 0)
      }))
    };
  }

  async getDetail(uid) {
    const pool = getPool();
    const [[user]] = await pool.query(
      `SELECT uid, nickname, phone, avatar, integral, spread_uid, is_staff, division_id, add_time
       FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
      [uid]
    );
    if (!user) {
      const error = new Error('用户不存在');
      error.statusCode = 404;
      throw error;
    }

    let spreadNickname = '';
    if (user.spread_uid) {
      const [[spread]] = await pool.query(
        `SELECT nickname FROM ${legacyTable('user')} WHERE uid = ? LIMIT 1`,
        [user.spread_uid]
      );
      spreadNickname = spread?.nickname || '';
    }

    const [memberships] = await pool.query(
      `SELECT id, tier_code, source_channel, granted_integral, start_at, expire_at, status
       FROM ${swTable('user_membership')} WHERE uid = ? ORDER BY id DESC LIMIT 20`,
      [uid]
    );

    const [batches] = await pool.query(
      `SELECT id AS batchId, batch_type AS batchType, total_amount AS totalAmount, remain_amount AS remainAmount,
              expire_at AS expireAt, source_type AS sourceType, remark, created_at AS createdAt
       FROM ${swTable('integral_batch')} WHERE uid = ? AND status = 1 ORDER BY expire_at ASC, id ASC`,
      [uid]
    );

    const integralService = new IntegralService();
    const integralSummary = await integralService.buildSummary(uid, batches, user.integral);

    let cashVoucherBatches = [];
    try {
      const [cvRows] = await pool.query(
        `SELECT id AS batchId, total_amount AS totalAmount, remain_amount AS remainAmount,
                expire_at AS expireAt, source_type AS sourceType, created_at AS createdAt
         FROM ${swTable('cash_voucher_batch')} WHERE uid = ? AND status = 1 ORDER BY id DESC`,
        [uid]
      );
      cashVoucherBatches = cvRows;
    } catch { /* ignore */ }

    // 现金券消费（核销）明细：direction=0 表示核销支出，含商家与核销员
    let cashVoucherUsage = [];
    let cashVoucherUsedTotal = 0;
    try {
      const [usageRows] = await pool.query(
        `SELECT l.id, l.amount, l.merchant_id AS merchantId, l.operator_uid AS operatorUid,
                l.biz_id AS bizId, l.remark, l.created_at AS createdAt,
                m.merchant_name AS merchantName, u.nickname AS operatorNickname
         FROM ${swTable('cash_voucher_ledger')} l
         LEFT JOIN ${swTable('merchant')} m ON m.id = l.merchant_id
         LEFT JOIN ${legacyTable('user')} u ON u.uid = l.operator_uid
         WHERE l.uid = ? AND l.direction = 0 AND l.merchant_id > 0
         ORDER BY l.id DESC LIMIT 50`,
        [uid]
      );
      cashVoucherUsage = usageRows.map((r) => ({
        id: Number(r.id),
        amount: Number(r.amount || 0),
        merchantId: Number(r.merchantId || 0),
        merchantName: r.merchantName || '',
        operatorUid: Number(r.operatorUid || 0),
        operatorNickname: r.operatorNickname || '',
        bizId: r.bizId || '',
        remark: r.remark || '',
        createdAt: Number(r.createdAt || 0)
      }));

      const [[usedRow]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM ${swTable('cash_voucher_ledger')}
         WHERE uid = ? AND direction = 0 AND merchant_id > 0`,
        [uid]
      );
      cashVoucherUsedTotal = Number(usedRow?.total || 0);
    } catch { /* ignore */ }

    let approvalHistory = [];
    try {
      const [apprRows] = await pool.query(
        `SELECT id AS requestId, request_no AS requestNo, consumption_amount AS consumptionAmount,
                matched_tier_code AS matchedTierCode, status, staff_uid AS staffUid,
                created_at AS createdAt, approved_at AS approvedAt
         FROM ${swTable('approval_request')} WHERE customer_uid = ? ORDER BY id DESC LIMIT 20`,
        [uid]
      );
      approvalHistory = apprRows;
    } catch { /* ignore */ }

    const [[tierRow]] = await pool.query(
      `SELECT tier_code, expire_at FROM ${swTable('user_membership')}
       WHERE uid = ? AND status = 1 AND expire_at > UNIX_TIMESTAMP()
       ORDER BY CASE tier_code WHEN 'SW299' THEN 2 WHEN 'SW199' THEN 1 ELSE 0 END DESC LIMIT 1`,
      [uid]
    );

    const [[merchantRow]] = await pool.query(
      `SELECT id FROM ${swTable('merchant')} WHERE login_uid = ? AND is_active = 1 LIMIT 1`,
      [uid]
    );

    let merchantRoles = { list: [], owned: [], assigned: [] };
    try {
      merchantRoles = await new AdminMerchantStaffService().getUserMerchantRoles(uid);
    } catch { /* ignore */ }

    const [[isMerchantStaff]] = await pool.query(
      `SELECT 1 AS v FROM ${swTable('merchant_staff')} ms
       JOIN ${swTable('merchant')} m ON m.id = ms.merchant_id AND m.is_active = 1
       WHERE ms.staff_uid = ? AND ms.is_active = 1 LIMIT 1`,
      [uid]
    );

    const tags = buildTags({
      tier_code: tierRow?.tier_code,
      is_staff: user.is_staff,
      is_manager: 0,
      is_merchant: merchantRow ? 1 : 0,
      is_merchant_staff: isMerchantStaff ? 1 : 0
    });

    const [[isManager]] = await pool.query(
      `SELECT 1 AS v FROM ${swTable('store_manager')} WHERE manager_uid = ? AND is_active = 1 LIMIT 1`,
      [uid]
    );
    if (isManager) tags.push('manager');

    return {
      profile: {
        uid: user.uid,
        nickname: user.nickname || '',
        phone: maskPhone(user.phone),
        avatar: user.avatar || '',
        tags,
        tierCode: tierRow?.tier_code || '',
        membershipExpireAt: Number(tierRow?.expire_at || 0),
        isStaff: Number(user.is_staff || 0) === 1,
        divisionId: Number(user.division_id || 0),
        spreadUid: Number(user.spread_uid || 0),
        spreadNickname
      },
      integralSummary,
      integralBatches: batches,
      cashVoucherBatches,
      cashVoucherUsage,
      cashVoucherUsedTotal,
      membershipRecords: memberships.map((m) => ({
        id: m.id,
        tierCode: m.tier_code,
        sourceChannel: m.source_channel,
        grantedIntegral: Number(m.granted_integral || 0),
        startAt: Number(m.start_at || 0),
        expireAt: Number(m.expire_at || 0),
        status: Number(m.status)
      })),
      approvalHistory,
      isMerchant: Boolean(merchantRow) || merchantRoles.list.length > 0,
      merchantId: merchantRow?.id || merchantRoles.list[0]?.merchantId || null,
      merchantRoles: merchantRoles.list
    };
  }

  async batchAssignSpread(spreadUid, uids, { onlyUnowned = true } = {}) {
    const uniqueUids = [...new Set((uids || []).map((id) => Number(id)).filter((id) => id > 0))];
    if (!uniqueUids.length) {
      const error = new Error('请指定至少一名会员');
      error.statusCode = 400;
      throw error;
    }
    if (uniqueUids.length > 200) {
      const error = new Error('单次最多变更 200 名会员归属');
      error.statusCode = 400;
      throw error;
    }

    const results = [];
    for (const uid of uniqueUids) {
      if (uid === spreadUid) {
        results.push({ uid, ok: false, error: '不能将用户归属设为自己' });
        continue;
      }
      try {
        if (onlyUnowned) {
          const pool = getPool();
          const [[row]] = await pool.query(
            `SELECT spread_uid FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
            [uid]
          );
          if (!row) {
            results.push({ uid, ok: false, error: '用户不存在' });
            continue;
          }
          if (Number(row.spread_uid || 0) > 0) {
            results.push({ uid, ok: false, error: '已有归属店员' });
            continue;
          }
        }
        await this.updateSpread(uid, spreadUid);
        results.push({ uid, ok: true });
      } catch (error) {
        results.push({ uid, ok: false, error: error.message || '归属更新失败' });
      }
    }

    const success = results.filter((item) => item.ok).length;
    return {
      spreadUid,
      total: results.length,
      success,
      failed: results.length - success,
      results
    };
  }

  async updateSpread(uid, spreadUid) {
    const pool = getPool();
    const [[user]] = await pool.query(
      `SELECT uid FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
      [uid]
    );
    if (!user) {
      const error = new Error('用户不存在');
      error.statusCode = 404;
      throw error;
    }

    // spreadUid=0 表示清除归属，无需校验店员存在
    if (Number(spreadUid) === 0) {
      await pool.query(
        `UPDATE ${legacyTable('user')} SET spread_uid = 0 WHERE uid = ?`,
        [uid]
      );
      return { uid, spreadUid: 0, spreadNickname: '' };
    }

    if (uid === spreadUid) {
      const error = new Error('不能将用户归属设为自己');
      error.statusCode = 400;
      throw error;
    }

    const [[staff]] = await pool.query(
      `SELECT u.uid, u.nickname FROM ${legacyTable('user')} u
       WHERE u.uid = ? AND COALESCE(u.is_del, 0) = 0
         AND (u.is_staff = 1 OR EXISTS(
           SELECT 1 FROM ${swTable('store_manager')} sm
           WHERE sm.manager_uid = u.uid AND sm.is_active = 1
         ))
       LIMIT 1`,
      [spreadUid]
    );
    if (!staff) {
      const error = new Error('归属店员不存在或未开通店员/店长权限');
      error.statusCode = 400;
      throw error;
    }

    await pool.query(
      `UPDATE ${legacyTable('user')} SET spread_uid = ? WHERE uid = ?`,
      [spreadUid, uid]
    );
    return { uid, spreadUid, spreadNickname: staff.nickname || '' };
  }

  async updateStaffRole(uid, action, divisionId, storeName) {
    const pool = getPool();
    const storesService = new AdminStoresService();
    const [[user]] = await pool.query(
      `SELECT uid FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
      [uid]
    );
    if (!user) {
      const error = new Error('用户不存在');
      error.statusCode = 404;
      throw error;
    }

    if (action === 'grant') {
      let resolvedDivisionId = Number(divisionId || 0);
      let resolvedStoreName = '';

      if (storeName) {
        const store = await storesService.resolveOrCreateByName(storeName);
        resolvedDivisionId = store.id;
        resolvedStoreName = store.name;
      } else if (resolvedDivisionId > 0) {
        const storeTable = legacyTable('system_store');
        const [[storeRow]] = await pool.query(
          `SELECT name FROM ${storeTable} WHERE id = ? LIMIT 1`,
          [resolvedDivisionId]
        );
        resolvedStoreName = storeRow?.name ? String(storeRow.name).trim() : `门店#${resolvedDivisionId}`;
      }

      if (!resolvedDivisionId || resolvedDivisionId <= 0) {
        const error = new Error('开通店员需指定门店名称');
        error.statusCode = 400;
        throw error;
      }
      await pool.query(
        `UPDATE ${legacyTable('user')} SET is_staff = 1, division_id = ? WHERE uid = ?`,
        [resolvedDivisionId, uid]
      );
      return {
        uid,
        isStaff: true,
        divisionId: resolvedDivisionId,
        storeName: resolvedStoreName || undefined
      };
    }

    await pool.query(
      `UPDATE ${legacyTable('user')} SET is_staff = 0, division_id = 0 WHERE uid = ?`,
      [uid]
    );
    return { uid, isStaff: false, divisionId: 0 };
  }

  /**
   * 设置/撤销客户主管（store_manager）。
   * grant：解析门店 → 校验同店主管不超过 2 人 → 同时确保该用户具备客户经理(is_staff)权限 → upsert store_manager。
   * revoke：将该用户名下所有 store_manager 记录置为失效。
   */
  async updateStoreManager(uid, action, { divisionId, storeName, appointedBy = 0 } = {}) {
    const pool = getPool();
    const storesService = new AdminStoresService();
    const now = Math.floor(Date.now() / 1000);

    const [[user]] = await pool.query(
      `SELECT uid, division_id, is_staff FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
      [uid]
    );
    if (!user) {
      const error = new Error('用户不存在');
      error.statusCode = 404;
      throw error;
    }

    if (action === 'revoke') {
      await pool.query(
        `UPDATE ${swTable('store_manager')} SET is_active = 0, updated_at = ? WHERE manager_uid = ? AND is_active = 1`,
        [now, uid]
      );
      return { uid, isManager: false };
    }

    // grant：解析门店（优先 storeName，其次入参 divisionId，最后用户当前 division_id）
    let resolvedDivisionId = Number(divisionId || 0);
    let resolvedStoreName = '';
    if (storeName) {
      const store = await storesService.resolveOrCreateByName(storeName);
      resolvedDivisionId = store.id;
      resolvedStoreName = store.name;
    } else if (resolvedDivisionId <= 0) {
      resolvedDivisionId = Number(user.division_id || 0);
    }
    if (resolvedDivisionId > 0 && !resolvedStoreName) {
      const [[storeRow]] = await pool.query(
        `SELECT name FROM ${legacyTable('system_store')} WHERE id = ? LIMIT 1`,
        [resolvedDivisionId]
      );
      resolvedStoreName = storeRow?.name ? String(storeRow.name).trim() : `门店#${resolvedDivisionId}`;
    }
    if (!resolvedDivisionId || resolvedDivisionId <= 0) {
      const error = new Error('设为客户主管需指定门店名称');
      error.statusCode = 400;
      throw error;
    }

    // 同一门店客户主管最多 2 名（不含当前用户已有的有效记录）
    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM ${swTable('store_manager')}
       WHERE division_id = ? AND is_active = 1 AND manager_uid <> ?`,
      [resolvedDivisionId, uid]
    );
    if (Number(countRow?.cnt || 0) >= 2) {
      const error = new Error(`「${resolvedStoreName}」客户主管已满（每店最多 2 名）`);
      error.statusCode = 400;
      throw error;
    }

    // 设为客户主管会自动开通客户经理权限，并对齐门店
    await pool.query(
      `UPDATE ${legacyTable('user')} SET is_staff = 1, division_id = ? WHERE uid = ?`,
      [resolvedDivisionId, uid]
    );

    // upsert store_manager（唯一键 division_id+manager_uid）
    await pool.query(
      `INSERT INTO ${swTable('store_manager')} (division_id, manager_uid, is_active, appointed_by, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)
       ON DUPLICATE KEY UPDATE is_active = 1, appointed_by = VALUES(appointed_by), updated_at = VALUES(updated_at)`,
      [resolvedDivisionId, uid, Number(appointedBy || 0), now, now]
    );

    return {
      uid,
      isManager: true,
      isStaff: true,
      divisionId: resolvedDivisionId,
      storeName: resolvedStoreName || undefined
    };
  }

  // 拉取全部在职客户经理及各自当前名下会员数（含 0 人的经理，用 LEFT JOIN）
  async listActiveManagersWithLoad() {
    const userTable = legacyTable('user');
    const [rows] = await getPool().query(
      `SELECT sp.uid, sp.nickname,
              COUNT(m.uid) AS member_count
       FROM ${userTable} sp
       LEFT JOIN ${userTable} m
         ON m.spread_uid = sp.uid AND COALESCE(m.is_del, 0) = 0
       WHERE sp.is_staff = 1 AND COALESCE(sp.is_del, 0) = 0
       GROUP BY sp.uid, sp.nickname
       ORDER BY member_count ASC, sp.uid ASC`
    );
    return (rows || []).map((row) => ({
      uid: Number(row.uid),
      nickname: row.nickname || '',
      currentCount: Number(row.member_count || 0)
    }));
  }

  // 补齐式均衡：把无归属会员分给当前名下人数最少的经理，分完后总数最多相差 1
  computeBalancedAllocation(managers, unownedUids) {
    // 排除"经理本人就是无归属会员"的情况，避免把自己分给自己
    const managerUidSet = new Set(managers.map((m) => m.uid));
    const assignable = unownedUids.filter((uid) => !managerUidSet.has(uid));

    // 用最小堆按 currentCount 取最少者；同分时按 uid 稳定
    const heap = managers.map((m) => ({ uid: m.uid, nickname: m.nickname, count: m.currentCount, assigned: [] }));
    const siftDown = (i) => {
      const n = heap.length;
      for (;;) {
        let smallest = i;
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        if (l < n && lessThan(heap[l], heap[smallest])) smallest = l;
        if (r < n && lessThan(heap[r], heap[smallest])) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    };
    function lessThan(a, b) {
      if (a.count !== b.count) return a.count < b.count;
      return a.uid < b.uid;
    }
    for (let i = (heap.length >> 1) - 1; i >= 0; i--) siftDown(i);

    // count 只增不减，每次给堆顶（最少者）加 1 后 siftDown 即可维持最小堆
    for (const memberUid of assignable) {
      const top = heap[0];
      top.assigned.push(memberUid);
      top.count += 1;
      siftDown(0);
    }

    const plan = heap
      .map((h) => ({
        uid: h.uid,
        nickname: h.nickname,
        currentCount: h.count - h.assigned.length,
        addCount: h.assigned.length,
        afterCount: h.count,
        memberUids: h.assigned
      }))
      .sort((a, b) => b.addCount - a.addCount || a.uid - b.uid);

    return { plan, assignableTotal: assignable.length };
  }

  async getUnownedMemberUids() {
    const [rows] = await getPool().query(
      `SELECT uid FROM ${legacyTable('user')}
       WHERE COALESCE(spread_uid, 0) = 0 AND COALESCE(is_del, 0) = 0
       ORDER BY uid ASC`
    );
    return (rows || []).map((r) => Number(r.uid));
  }

  // 预演：不落库，返回每位经理将 +多少、分配后总数
  async autoSpreadPreview() {
    const managers = await this.listActiveManagersWithLoad();
    if (!managers.length) {
      const error = new Error('暂无在职客户经理，无法分配');
      error.statusCode = 400;
      throw error;
    }
    const unownedUids = await this.getUnownedMemberUids();
    const { plan, assignableTotal } = this.computeBalancedAllocation(managers, unownedUids);
    return {
      unownedTotal: unownedUids.length,
      assignableTotal,
      managerCount: managers.length,
      plan: plan.map(({ memberUids, ...rest }) => rest)
    };
  }

  // 执行：按计划批量落库（带 spread_uid=0 守卫，绝不覆盖已有归属），返回每位经理实际分配数
  async autoSpreadAssign() {
    const managers = await this.listActiveManagersWithLoad();
    if (!managers.length) {
      const error = new Error('暂无在职客户经理，无法分配');
      error.statusCode = 400;
      throw error;
    }
    const unownedUids = await this.getUnownedMemberUids();
    if (!unownedUids.length) {
      const error = new Error('当前没有无归属会员');
      error.statusCode = 400;
      throw error;
    }
    const { plan } = this.computeBalancedAllocation(managers, unownedUids);

    const pool = getPool();
    const results = [];
    let assignedTotal = 0;
    for (const item of plan) {
      if (!item.memberUids.length) {
        results.push({ uid: item.uid, nickname: item.nickname, assigned: 0 });
        continue;
      }
      const placeholders = item.memberUids.map(() => '?').join(',');
      const [res] = await pool.query(
        `UPDATE ${legacyTable('user')} SET spread_uid = ?
         WHERE uid IN (${placeholders})
           AND COALESCE(spread_uid, 0) = 0
           AND COALESCE(is_del, 0) = 0`,
        [item.uid, ...item.memberUids]
      );
      const affected = res.affectedRows || 0;
      assignedTotal += affected;
      results.push({ uid: item.uid, nickname: item.nickname, assigned: affected });
    }

    return {
      unownedTotal: unownedUids.length,
      managerCount: managers.length,
      assignedTotal,
      results: results.sort((a, b) => b.assigned - a.assigned || a.uid - b.uid)
    };
  }
}

module.exports = { AdminMembersService, maskPhone };
