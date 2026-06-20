const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

function maskPhone(phone) {
  const value = String(phone || '');
  if (value.length < 7) return value;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

class StaffService {
  async list(params) {
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize || 20)));
    const keyword = String(params.keyword || '').trim();
    const divisionId = params.divisionId ? Number(params.divisionId) : null;

    const conditions = ['u.is_staff = 1', 'COALESCE(u.is_del, 0) = 0'];
    const values = [];

    if (keyword) {
      if (/^\d+$/.test(keyword)) {
        conditions.push('(u.uid = ? OR u.phone LIKE ?)');
        values.push(Number(keyword), `%${keyword}%`);
      } else {
        conditions.push('(u.nickname LIKE ? OR u.phone LIKE ?)');
        values.push(`%${keyword}%`, `%${keyword}%`);
      }
    }
    if (divisionId) {
      conditions.push('u.division_id = ?');
      values.push(divisionId);
    }

    const where = conditions.join(' AND ');
    const [[countRow]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM ${legacyTable('user')} u WHERE ${where}`,
      values
    );
    const offset = (page - 1) * pageSize;

    const [rows] = await getPool().query(
      `SELECT u.uid, u.nickname, u.phone, u.avatar, u.division_id,
              EXISTS(SELECT 1 FROM ${swTable('store_manager')} sm
                     WHERE sm.manager_uid = u.uid AND sm.is_active = 1) AS is_manager
       FROM ${legacyTable('user')} u
       WHERE ${where}
       ORDER BY u.uid DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );

    const list = [];
    for (const row of rows) {
      list.push(await this.enrichStaffRow(row));
    }

    return { total: Number(countRow?.total || 0), page, pageSize, list };
  }

  async enrichStaffRow(row) {
    const uid = row.uid;
    const [[memberRow]] = await getPool().query(
      `SELECT COUNT(*) AS cnt FROM ${legacyTable('user')}
       WHERE spread_uid = ? AND COALESCE(is_del, 0) = 0`,
      [uid]
    );

    let pendingApproval = 0;
    let approvedCount = 0;
    try {
      const [[pending]] = await getPool().query(
        `SELECT COUNT(*) AS cnt FROM ${swTable('approval_request')}
         WHERE staff_uid = ? AND status IN ('manager_review', 'admin_review')`,
        [uid]
      );
      const [[approved]] = await getPool().query(
        `SELECT COUNT(*) AS cnt FROM ${swTable('approval_request')}
         WHERE staff_uid = ? AND status = 'approved'`,
        [uid]
      );
      pendingApproval = Number(pending?.cnt || 0);
      approvedCount = Number(approved?.cnt || 0);
    } catch { /* ignore */ }

    let cardConfigured = false;
    try {
      const [[card]] = await getPool().query(
        `SELECT id FROM ${swTable('staff_card')}
         WHERE staff_uid = ? AND (display_name != '' OR store_address != '') LIMIT 1`,
        [uid]
      );
      cardConfigured = Boolean(card);
    } catch { /* table may not exist */ }

    return {
      uid,
      nickname: row.nickname || '',
      phone: maskPhone(row.phone),
      divisionId: Number(row.division_id || 0),
      divisionName: await this.resolveDivisionName(row.division_id),
      isManager: Number(row.is_manager) === 1,
      memberCount: Number(memberRow?.cnt || 0),
      pendingApproval,
      approvedCount,
      cardConfigured
    };
  }

  async resolveDivisionName(divisionId) {
    const id = Number(divisionId || 0);
    if (!id) return '';
    try {
      const [[store]] = await getPool().query(
        `SELECT name FROM ${legacyTable('system_store')} WHERE id = ? LIMIT 1`,
        [id]
      );
      if (store?.name) return store.name;
    } catch { /* ignore */ }
    return `门店#${id}`;
  }

  async isManager(uid) {
    try {
      const [[row]] = await getPool().query(
        `SELECT 1 AS v FROM ${swTable('store_manager')}
         WHERE manager_uid = ? AND is_active = 1 LIMIT 1`,
        [uid]
      );
      return Boolean(row);
    } catch {
      return false;
    }
  }

  async assertStaffOrManager(uid) {
    const [[user]] = await getPool().query(
      `SELECT uid, is_staff FROM ${legacyTable('user')}
       WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
      [uid]
    );
    if (!user) {
      const error = new Error('用户不存在');
      error.statusCode = 404;
      throw error;
    }
    const isStaff = Number(user.is_staff) === 1;
    const isManager = await this.isManager(uid);
    if (!isStaff && !isManager) {
      const error = new Error('无会员管理权限');
      error.statusCode = 403;
      throw error;
    }
    return { isStaff, isManager };
  }

  async getStats(staffUid) {
    const access = await this.assertStaffOrManager(staffUid);

    const [members] = await getPool().query(
      `SELECT u.uid, u.nickname, u.phone, u.add_time AS registerAt,
              m.tier_code, m.expire_at
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
       WHERE u.spread_uid = ? AND COALESCE(u.is_del, 0) = 0
       ORDER BY u.add_time DESC LIMIT 100`,
      [staffUid]
    );

    let approvals = [];
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    try {
      const [rows] = await getPool().query(
        `SELECT id AS requestId, customer_uid AS customerUid, consumption_amount AS consumptionAmount,
                status, created_at AS createdAt
         FROM ${swTable('approval_request')} WHERE staff_uid = ?
         ORDER BY id DESC LIMIT 50`,
        [staffUid]
      );
      approvals = rows;
      for (const r of rows) {
        if (['manager_review', 'admin_review'].includes(r.status)) pending += 1;
        else if (r.status === 'approved') approved += 1;
        else if (r.status === 'rejected') rejected += 1;
      }
    } catch { /* ignore */ }

    return {
      uid: staffUid,
      memberCount: members.length,
      members: members.map((m) => ({
        uid: m.uid,
        nickname: m.nickname || '',
        phone: maskPhone(m.phone),
        registerAt: Number(m.registerAt || 0)
      })),
      approvalStats: { pending, approved, rejected },
      approvals
    };
  }

  async getCard(staffUid, { publicView = false } = {}) {
    await this.assertStaff(staffUid);

    const [[user]] = await getPool().query(
      `SELECT uid, nickname, phone, avatar FROM ${legacyTable('user')} WHERE uid = ? LIMIT 1`,
      [staffUid]
    );

    let card = null;
    try {
      const [[row]] = await getPool().query(
        `SELECT * FROM ${swTable('staff_card')} WHERE staff_uid = ? LIMIT 1`,
        [staffUid]
      );
      card = row || null;
    } catch { /* ignore */ }

    if (publicView && card && Number(card.is_published) !== 1) {
      const error = new Error('名片未发布');
      error.statusCode = 404;
      throw error;
    }

    const configured = Boolean(card && (card.display_name || card.store_address));
    return {
      staffUid,
      displayName: card?.display_name || user?.nickname || '',
      avatar: card?.avatar || user?.avatar || '',
      jobTitle: card?.job_title || '',
      bio: card?.bio || '',
      storeName: card?.store_name || '',
      storeAddress: card?.store_address || '',
      storePhone: card?.store_phone || '',
      businessHours: card?.business_hours || '',
      latitude: Number(card?.latitude || 0),
      longitude: Number(card?.longitude || 0),
      wechatQrcode: card?.wechat_qrcode || '',
      isPublished: card ? Number(card.is_published) === 1 : false,
      configured,
      contactPhone: publicView ? maskPhone(user?.phone) : (user?.phone || '')
    };
  }

  async upsertCard(staffUid, input) {
    await this.assertStaff(staffUid);
    const now = Math.floor(Date.now() / 1000);

    const payload = [
      input.displayName || '',
      input.avatar || '',
      input.jobTitle || '',
      input.bio || '',
      input.storeName || '',
      input.storeAddress || '',
      input.storePhone || '',
      input.businessHours || '',
      Number(input.latitude || 0),
      Number(input.longitude || 0),
      input.wechatQrcode || '',
      input.isPublished === false ? 0 : 1,
      now,
      staffUid
    ];

    try {
      const [[existing]] = await getPool().query(
        `SELECT id FROM ${swTable('staff_card')} WHERE staff_uid = ? LIMIT 1`,
        [staffUid]
      );
      if (existing) {
        await getPool().query(
          `UPDATE ${swTable('staff_card')}
           SET display_name=?, avatar=?, job_title=?, bio=?, store_name=?, store_address=?,
               store_phone=?, business_hours=?, latitude=?, longitude=?, wechat_qrcode=?,
               is_published=?, updated_at=?
           WHERE staff_uid=?`,
          payload
        );
      } else {
        await getPool().query(
          `INSERT INTO ${swTable('staff_card')}
           (display_name, avatar, job_title, bio, store_name, store_address, store_phone,
            business_hours, latitude, longitude, wechat_qrcode, is_published, created_at, updated_at, staff_uid)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...payload.slice(0, 12), now, now, staffUid]
        );
      }
    } catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE') {
        const err = new Error('请先执行 admin-r2 DDL 创建 sw_staff_card 表');
        err.statusCode = 503;
        throw err;
      }
      throw error;
    }

    return this.getCard(staffUid);
  }

  async bindSpread(customerUid, staffUid) {
    await this.assertStaff(staffUid);
    const [[customer]] = await getPool().query(
      `SELECT uid, spread_uid FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
      [customerUid]
    );
    if (!customer) {
      const error = new Error('用户不存在');
      error.statusCode = 404;
      throw error;
    }
    if (Number(customer.spread_uid || 0) > 0) {
      return { uid: customerUid, spreadUid: Number(customer.spread_uid), bound: false, reason: 'already_bound' };
    }
    await getPool().query(
      `UPDATE ${legacyTable('user')} SET spread_uid = ? WHERE uid = ?`,
      [staffUid, customerUid]
    );
    return { uid: customerUid, spreadUid: staffUid, bound: true };
  }

  async assertStaff(uid) {
    const [[user]] = await getPool().query(
      `SELECT uid, is_staff FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
      [uid]
    );
    if (!user || Number(user.is_staff) !== 1) {
      const error = new Error('店员不存在');
      error.statusCode = 404;
      throw error;
    }
  }
}

module.exports = { StaffService };
