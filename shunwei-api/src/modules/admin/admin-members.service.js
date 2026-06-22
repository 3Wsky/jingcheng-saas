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
  return tags;
}

function tagMatches(row, tagFilter) {
  if (!tagFilter.length) return true;
  const tags = buildTags(row);
  return tagFilter.every((t) => tags.includes(t));
}

class AdminMembersService {
  async list(params) {
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize || 20)));
    const keyword = String(params.keyword || '').trim();
    const searchType = String(params.searchType || 'all');
    const tagFilter = String(params.tag || '').split(',').map((s) => s.trim()).filter(Boolean);
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
    const filtered = tagFilter.length ? allRows.filter((row) => tagMatches(row, tagFilter)) : allRows;
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

    const tags = buildTags({
      tier_code: tierRow?.tier_code,
      is_staff: user.is_staff,
      is_manager: 0,
      is_merchant: merchantRow ? 1 : 0
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
}

module.exports = { AdminMembersService, maskPhone };
