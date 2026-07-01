const { ok, fail } = require('../../shared/http');
const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const { SnCatalogService } = require('./sn-catalog.service');
const { ApprovalCodeUsageService } = require('../approval/approval-code-usage.service');

const PRODUCT_TYPES = ['手机', '平板', '电脑', '智能穿戴'];

/**
 * 把审批收据串解析为结构化产品数组（供超管终审逐条核对）。
 * 收据形如：`[产品1] 手机/型号/¥价格/IMEI:xxx; [产品2] 智能穿戴/型号/¥价/SN:yyy`
 * 返回 [{ index, type, model, price, imei, sn, codeType, code }]。
 */
function parseReceiptProducts(receiptNo) {
  const s = String(receiptNo || '').trim();
  if (!s || s.indexOf('[产品') < 0) return [];
  const parts = s.split(/;\s*(?=\[产品)/);
  const items = [];
  parts.forEach((part) => {
    const m = part.match(/^\[产品(\d+)\]\s*(.*)$/);
    if (!m) return;
    const idx = Number(m[1]) || items.length + 1;
    const segments = String(m[2]).split('/');
    const item = { index: idx, type: '其他', model: '', price: '', imei: '', sn: '', codeType: '', code: '' };
    segments.forEach((segRaw) => {
      const seg = String(segRaw).trim();
      if (!seg) return;
      if (PRODUCT_TYPES.indexOf(seg) >= 0) {
        item.type = seg;
      } else if (seg.indexOf('¥') === 0 || seg.indexOf('￥') === 0) {
        item.price = seg;
      } else if (/^IMEI\s*\d?\s*[:：]/i.test(seg)) {
        item.imei = seg.replace(/^IMEI\s*\d?\s*[:：]\s*/i, '').trim();
        item.codeType = 'imei1';
        item.code = item.imei;
      } else if (/^SN\s*[:：]/i.test(seg)) {
        item.sn = seg.replace(/^SN\s*[:：]\s*/i, '').trim();
        item.codeType = 'sn';
        item.code = item.sn;
      } else {
        item.model = seg;
      }
    });
    items.push(item);
  });
  return items;
}

/**
 * 给一批审批单补全「产品结构化 + 每件码命中/已用状态 + 店长审批步骤」。
 * 只做只读增强，不改任何审批状态。返回 { productsByReq, managerStepByReq, usedByReq }。
 */
async function enrichApprovals(rows) {
  const catalog = new SnCatalogService();
  const codeUsage = new ApprovalCodeUsageService();
  const productsByReq = {};
  const managerStepByReq = {};

  const requestIds = rows.map((r) => Number(r.requestId ?? r.id)).filter(Boolean);

  // 1) 店长审批步骤（谁/何时/备注）
  if (requestIds.length) {
    try {
      const [steps] = await getPool().query(
        `SELECT s.request_id, s.step_role, s.action, s.comment, s.created_at, s.operator_uid,
                u.nickname AS operator_nickname
         FROM ${swTable('approval_step')} s
         LEFT JOIN ${legacyTable('user')} u ON u.uid = s.operator_uid
         WHERE s.request_id IN (?) AND s.step_role = 'manager'
         ORDER BY s.id ASC`,
        [requestIds]
      );
      for (const st of steps) {
        const rid = Number(st.request_id);
        // 保留最后一条 manager 步骤（通常就是初审通过那条）
        managerStepByReq[rid] = {
          action: st.action || '',
          comment: st.comment || '',
          operatorUid: Number(st.operator_uid || 0),
          operatorName: st.operator_nickname || '',
          at: Number(st.created_at || 0)
        };
      }
    } catch { /* 步骤缺失不影响主流程 */ }
  }

  // 2) 每单产品结构化 + 每件码命中/已用
  for (const r of rows) {
    const rid = Number(r.requestId ?? r.id);
    const receiptNo = r.receiptNo ?? r.receipt_no ?? '';
    const products = parseReceiptProducts(receiptNo);
    for (const p of products) {
      if (!p.code) { p.matched = null; p.used = null; continue; }
      try {
        const hit = p.codeType === 'imei1'
          ? await catalog.lookupByCode({ imei: p.code })
          : await catalog.lookupByCode({ sn: p.code });
        p.matched = !!(hit && hit.found);
        p.catalogModel = (hit && hit.model) || '';
      } catch { p.matched = null; }
      try {
        const u = p.codeType === 'imei1'
          ? await codeUsage.checkSingle({ imei: p.code })
          : await codeUsage.checkSingle({ sn: p.code });
        // 已被「其它单」用过才算重复（排除自己这单）
        p.used = !!(u && u.used && Number(u.requestId) !== rid);
        p.usedByRequestId = p.used ? Number(u.requestId) : 0;
      } catch { p.used = null; }
    }
    productsByReq[rid] = products;
  }

  return { productsByReq, managerStepByReq };
}

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
        `SELECT r.id AS requestId, r.request_no, r.customer_uid, r.staff_uid, r.division_id,
                r.consumption_amount, r.matched_tier_code, r.matched_integral, r.matched_voucher_amount,
                r.receipt_no, r.status, r.created_at
         FROM ${swTable('approval_request')} r
         WHERE r.status = 'admin_review'
         ORDER BY r.created_at DESC
         LIMIT 50`
      );

      // 收集会员/店员/客户经理(归属)相关 uid，一次查全（昵称+手机号+归属）
      const uids = new Set();
      rows.forEach((r) => { uids.add(Number(r.customer_uid)); uids.add(Number(r.staff_uid)); });
      const userMap = {};
      if (uids.size > 0) {
        const [users] = await pool.query(
          `SELECT uid, nickname, phone, spread_uid FROM ${legacyTable('user')} WHERE uid IN (?)`,
          [Array.from(uids)]
        );
        users.forEach((u) => {
          userMap[u.uid] = { nickname: u.nickname || '', phone: u.phone || '', spreadUid: Number(u.spread_uid || 0) };
        });
      }
      // 客户经理(会员归属人)昵称：补查一轮 spread_uid
      const spreadUids = new Set();
      rows.forEach((r) => {
        const su = userMap[r.customer_uid] && userMap[r.customer_uid].spreadUid;
        if (su) spreadUids.add(su);
      });
      const spreadNameMap = {};
      if (spreadUids.size > 0) {
        const [sps] = await pool.query(
          `SELECT uid, nickname FROM ${legacyTable('user')} WHERE uid IN (?)`,
          [Array.from(spreadUids)]
        );
        sps.forEach((u) => { spreadNameMap[u.uid] = u.nickname || ''; });
      }
      // 门店名：按 division_id 批量取
      const divisionIds = [...new Set(rows.map((r) => Number(r.division_id || 0)).filter(Boolean))];
      const storeNameMap = {};
      if (divisionIds.length) {
        try {
          const [stores] = await pool.query(
            `SELECT id, name FROM ${legacyTable('system_store')} WHERE id IN (?)`,
            [divisionIds]
          );
          stores.forEach((s) => { storeNameMap[Number(s.id)] = s.name || ''; });
        } catch { /* 门店表异常不阻断 */ }
      }

      const { productsByReq, managerStepByReq } = await enrichApprovals(rows);

      return ok(rows.map((r) => {
        const cust = userMap[r.customer_uid] || {};
        const clerk = userMap[r.staff_uid] || {};
        const divId = Number(r.division_id || 0);
        const spreadUid = Number(cust.spreadUid || 0);
        return {
          requestId: r.requestId,
          requestNo: r.request_no || '',
          customerUid: r.customer_uid,
          customerName: cust.nickname || '',
          customerPhone: cust.phone || '',
          clerkUid: r.staff_uid,
          clerkName: clerk.nickname || '',
          clerkPhone: clerk.phone || '',
          spreadUid,
          spreadName: spreadUid ? (spreadNameMap[spreadUid] || '') : '',
          divisionId: divId,
          storeName: divId ? (storeNameMap[divId] || ('门店#' + divId)) : '',
          consumeAmount: Number(r.consumption_amount || 0),
          matchedTierCode: r.matched_tier_code,
          matchedIntegral: Number(r.matched_integral || 0),
          matchedVoucher: Number(r.matched_voucher_amount || 0),
          receiptNo: r.receipt_no || '',
          products: productsByReq[Number(r.requestId)] || [],
          managerStep: managerStepByReq[Number(r.requestId)] || null,
          status: r.status,
          createdAt: Number(r.created_at || 0)
        };
      }));
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
      // 消费免审统一用功能键 consumption_auto_pass_on_code_match（tryAutoPassByCode 实际读取）；
      // 旧键 approval_auto_pass_consumption 仅向后兼容兜底。
      const [rows] = await pool.query(
        `SELECT config_key, config_value FROM ${swTable('system_config')}
         WHERE config_key IN ('consumption_auto_pass_on_code_match', 'approval_auto_pass_consumption', 'integral_mall_skip_approval')`
      );
      rows.forEach(r => { configs[r.config_key] = r.config_value; });
      const on = (v) => v === '1' || v === 'true';

      return ok({
        consumption: on(configs['consumption_auto_pass_on_code_match']) || on(configs['approval_auto_pass_consumption']),
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
      const val = enabled ? '1' : '0';
      const pool = getPool();
      if (type === 'consumption') {
        // 写功能键（tryAutoPassByCode 读取）+ 同步旧键，保证后台/小程序两端一致
        await pool.query(
          `INSERT INTO ${swTable('system_config')} (config_key, config_value) VALUES ('consumption_auto_pass_on_code_match', ?)
           ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
          [val]
        );
        await pool.query(
          `INSERT INTO ${swTable('system_config')} (config_key, config_value) VALUES ('approval_auto_pass_consumption', ?)
           ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
          [val]
        );
      } else {
        await pool.query(
          `INSERT INTO ${swTable('system_config')} (config_key, config_value) VALUES ('integral_mall_skip_approval', ?)
           ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
          [val]
        );
      }
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

module.exports = { registerSuperuserRoutes, parseReceiptProducts, enrichApprovals };
