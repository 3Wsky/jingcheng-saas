const { ok, fail } = require('../../shared/http');
const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

async function getSuperAdminUids() {
  try {
    const [[row]] = await getPool().query(
      `SELECT config_value FROM ${swTable('system_config')} WHERE config_key = 'super_admin_uids' LIMIT 1`
    );
    if (!row?.config_value) return [];
    return row.config_value.split(',').map(s => Number(s.trim())).filter(n => n > 0);
  } catch { return []; }
}

async function isSuperAdmin(uid) {
  if (!uid) return false;
  const uids = await getSuperAdminUids();
  return uids.includes(Number(uid));
}

function registerSuperuserRoutes(app) {
  app.get('/api/superadmin/check', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const isSuper = await isSuperAdmin(request.auth.uid);
    return ok({ isSuperAdmin: isSuper });
  });

  app.get('/api/superadmin/pending-approvals', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    if (!await isSuperAdmin(request.auth.uid)) return fail(reply, 403, '无超管权限');

    try {
      const pool = getPool();
      const [rows] = await pool.query(
        `SELECT r.id AS requestId, r.customer_uid, r.staff_uid, r.consumption_amount,
                r.matched_tier_code, r.matched_integral, r.matched_voucher_amount,
                r.receipt_no, r.status, r.created_at
         FROM ${swTable('approval_request')} r
         WHERE r.status = 'admin_review'
         ORDER BY r.created_at DESC
         LIMIT 50`
      );

      const uids = new Set();
      rows.forEach(r => { uids.add(Number(r.customer_uid)); uids.add(Number(r.staff_uid)); });
      const nameMap = {};
      if (uids.size > 0) {
        const [users] = await pool.query(
          `SELECT uid, nickname FROM ${legacyTable('user')} WHERE uid IN (?)`,
          [Array.from(uids)]
        );
        users.forEach(u => { nameMap[u.uid] = u.nickname || ''; });
      }

      return ok(rows.map(r => ({
        requestId: r.requestId,
        customerUid: r.customer_uid,
        customerName: nameMap[r.customer_uid] || '',
        clerkUid: r.staff_uid,
        clerkName: nameMap[r.staff_uid] || '',
        consumeAmount: Number(r.consumption_amount || 0),
        matchedTierCode: r.matched_tier_code,
        matchedIntegral: Number(r.matched_integral || 0),
        matchedVoucher: Number(r.matched_voucher_amount || 0),
        receiptNo: r.receipt_no || '',
        status: r.status,
        createdAt: Number(r.created_at || 0)
      })));
    } catch (error) {
      return fail(reply, 500, error.message || '获取待审列表失败');
    }
  });

  app.post('/api/superadmin/review', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    if (!await isSuperAdmin(request.auth.uid)) return fail(reply, 403, '无超管权限');

    const { requestId, action, reason } = request.body || {};
    if (!requestId || !['approve', 'reject'].includes(action)) {
      return fail(reply, 400, '参数错误');
    }

    try {
      const { ApprovalService } = require('../approval/approval.service');
      const service = new ApprovalService();
      const result = await service.reviewByAdmin(request.auth.uid, Number(requestId), action, reason || '');
      return ok(result, action === 'approve' ? '已通过' : '已驳回');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '审批操作失败');
    }
  });

  app.get('/api/superadmin/auto-pass-status', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    if (!await isSuperAdmin(request.auth.uid)) return fail(reply, 403, '无超管权限');

    try {
      const pool = getPool();
      const configs = {};
      const [rows] = await pool.query(
        `SELECT config_key, config_value FROM ${swTable('system_config')}
         WHERE config_key IN ('approval_auto_pass_consumption', 'integral_mall_skip_approval')`
      );
      rows.forEach(r => { configs[r.config_key] = r.config_value; });

      return ok({
        consumption: configs['approval_auto_pass_consumption'] === '1',
        integralMall: configs['integral_mall_skip_approval'] !== '0'
      });
    } catch (error) {
      return fail(reply, 500, error.message || '获取免审状态失败');
    }
  });

  app.post('/api/superadmin/auto-pass-toggle', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    if (!await isSuperAdmin(request.auth.uid)) return fail(reply, 403, '无超管权限');

    const { type, enabled } = request.body || {};
    if (!['consumption', 'integralMall'].includes(type)) return fail(reply, 400, '类型无效');

    try {
      const key = type === 'consumption' ? 'approval_auto_pass_consumption' : 'integral_mall_skip_approval';
      const val = enabled ? '1' : '0';
      await getPool().query(
        `INSERT INTO ${swTable('system_config')} (config_key, config_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
        [key, val]
      );
      return ok({ type, enabled: Boolean(enabled) }, enabled ? '免审已开启' : '免审已关闭');
    } catch (error) {
      return fail(reply, 500, error.message || '设置失败');
    }
  });

  app.post('/api/superadmin/change-spread', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    if (!await isSuperAdmin(request.auth.uid)) return fail(reply, 403, '无超管权限');

    const { memberUid, newSpreadUid } = request.body || {};
    if (!memberUid) return fail(reply, 400, '会员 UID 必填');

    try {
      const pool = getPool();
      const [[user]] = await pool.query(
        `SELECT uid, nickname, spread_uid FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del,0) = 0 LIMIT 1`,
        [memberUid]
      );
      if (!user) return fail(reply, 404, '会员不存在');

      const spreadUid = Number(newSpreadUid || 0);
      if (spreadUid > 0) {
        const [[staff]] = await pool.query(
          `SELECT uid, nickname FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del,0) = 0 LIMIT 1`,
          [spreadUid]
        );
        if (!staff) return fail(reply, 404, '目标客户经理不存在');
      }

      await pool.query(
        `UPDATE ${legacyTable('user')} SET spread_uid = ? WHERE uid = ?`,
        [spreadUid, memberUid]
      );

      return ok({
        memberUid,
        oldSpreadUid: Number(user.spread_uid || 0),
        newSpreadUid: spreadUid
      }, spreadUid ? '归属已修改' : '归属已解除');
    } catch (error) {
      return fail(reply, 500, error.message || '修改归属失败');
    }
  });
}

module.exports = { registerSuperuserRoutes };
