const fs = require('node:fs/promises');
const path = require('node:path');
const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { config } = require('../../shared/config');
const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const { requireAdmin } = require('../admin/admin.auth');
const { StaffService } = require('../staff/staff.service');

const DATA_FILE = path.join(config.dataDir, 'coupon-landing-config.json');
const updateSchema = z.object({
  managerUids: z.array(z.coerce.number().int().positive()).max(100)
});
const liveFeedSchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional().default(10)
});

let rotationQueue = Promise.resolve();

function normalizeConfig(value) {
  const managerUids = Array.isArray(value?.managerUids)
    ? [...new Set(value.managerUids.map(Number).filter((uid) => Number.isInteger(uid) && uid > 0))]
    : [];
  return {
    managerUids,
    cursor: Math.max(0, Number(value?.cursor || 0)),
    updatedAt: Number(value?.updatedAt || 0)
  };
}

async function readConfig() {
  try {
    return normalizeConfig(JSON.parse(await fs.readFile(DATA_FILE, 'utf8')));
  } catch {
    return normalizeConfig({});
  }
}

async function writeConfig(value) {
  const data = normalizeConfig(value);
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tempFile, DATA_FILE);
  return data;
}

function withRotationLock(task) {
  const run = rotationQueue.then(task, task);
  rotationQueue = run.catch(() => {});
  return run;
}

function toLiveNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function cleanLiveText(value, fallback = '') {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120) || fallback;
}

function isPhoneLikeNickname(value) {
  const nickname = String(value || '').trim().replace(/[\s-]/g, '');
  return /^1[3-9]\d{9}$/.test(nickname) || /^1[3-9]\d\*{4}\d{4}$/.test(nickname);
}

function extractApprovalProductModel(receiptNo) {
  const match = String(receiptNo || '').match(/\[产品\d+\]\s*([^;]+)/);
  if (!match) return '购机产品';
  const fields = match[1].split('/').map((value) => value.trim()).filter(Boolean);
  return cleanLiveText(fields[1] || fields[0], '购机产品');
}

function mapApprovalLiveFeed(row) {
  return {
    id: `approval-${row.id}`,
    type: 'approval',
    customerNickname: cleanLiveText(row.customer_nickname, '微信用户'),
    productModel: extractApprovalProductModel(row.receipt_no),
    voucherAmount: toLiveNumber(row.matched_voucher_amount),
    points: toLiveNumber(row.matched_integral),
    occurredAt: Number(row.updated_at || row.created_at || 0)
  };
}

function mapIntegralLiveFeed(row) {
  return {
    id: `integral-${row.id || row.order_id}`,
    type: 'integral',
    customerNickname: cleanLiveText(row.customer_nickname, '微信用户'),
    productName: cleanLiveText(row.store_name, '积分好礼'),
    voucherAmount: 0,
    points: toLiveNumber(row.total_price),
    occurredAt: Number(row.add_time || 0)
  };
}

async function getCouponLandingLiveFeed(limit) {
  const pool = getPool();
  const [approvalResult, integralResult] = await Promise.all([
    pool.query(
      `SELECT r.id, r.receipt_no, r.matched_voucher_amount, r.matched_integral, r.updated_at, r.created_at,
              u.nickname AS customer_nickname
       FROM ${swTable('approval_request')} r
       LEFT JOIN ${legacyTable('user')} u ON u.uid = r.customer_uid
       WHERE r.status = 'approved'
         AND u.nickname IS NOT NULL
         AND TRIM(u.nickname) <> ''
         AND TRIM(u.nickname) NOT REGEXP '^1[3-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]$'
         AND TRIM(u.nickname) NOT REGEXP '^1[3-9][0-9][*][*][*][*][0-9][0-9][0-9][0-9]$'
       ORDER BY COALESCE(NULLIF(r.updated_at, 0), r.created_at) DESC
       LIMIT ?`,
      [limit]
    ),
    pool.query(
      `SELECT o.id, o.order_id, o.store_name, o.total_price, o.add_time, u.nickname AS customer_nickname
       FROM ${legacyTable('store_integral_order')} o
       LEFT JOIN ${legacyTable('user')} u ON u.uid = o.uid
       WHERE COALESCE(o.is_del, 0) = 0
         AND u.nickname IS NOT NULL
         AND TRIM(u.nickname) <> ''
         AND TRIM(u.nickname) NOT REGEXP '^1[3-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]$'
         AND TRIM(u.nickname) NOT REGEXP '^1[3-9][0-9][*][*][*][*][0-9][0-9][0-9][0-9]$'
       ORDER BY o.add_time DESC
       LIMIT ?`,
      [limit]
    )
  ]);
  const approvals = (approvalResult[0] || [])
    .filter((row) => !isPhoneLikeNickname(row.customer_nickname))
    .slice(0, limit)
    .map(mapApprovalLiveFeed);
  const integralOrders = (integralResult[0] || [])
    .filter((row) => !isPhoneLikeNickname(row.customer_nickname))
    .slice(0, limit)
    .map(mapIntegralLiveFeed);
  return {
    list: [...approvals, ...integralOrders]
      .sort((left, right) => right.occurredAt - left.occurredAt)
      .slice(0, limit * 2)
  };
}

async function selectNextCard(current, getCard) {
  const total = current.managerUids.length;
  if (!total) {
    return { cursor: 0, payload: { configured: false, card: null, staffUid: 0 } };
  }

  const start = current.cursor % total;
  for (let offset = 0; offset < total; offset += 1) {
    const index = (start + offset) % total;
    const staffUid = current.managerUids[index];
    try {
      const card = await getCard(staffUid);
      return {
        cursor: (index + 1) % total,
        payload: { configured: true, card, staffUid, position: index + 1, total }
      };
    } catch {
      // Continue to the next configured manager.
    }
  }
  return {
    cursor: (start + 1) % total,
    payload: { configured: true, card: null, staffUid: 0, total }
  };
}

function registerCouponLandingRoutes(app) {
  const staffService = new StaffService();

  app.get('/api/landing/coupon/manager-card', async (_request, reply) => {
    try {
      const result = await withRotationLock(async () => {
        const current = await readConfig();
        const selected = await selectNextCard(
          current,
          (staffUid) => staffService.getCard(staffUid, { publicView: true })
        );
        if (!current.managerUids.length) return selected.payload;
        current.cursor = selected.cursor;
        await writeConfig(current);
        return selected.payload;
      });
      return ok(result);
    } catch (error) {
      return fail(reply, 500, error.message || '广告页客户经理名片加载失败');
    }
  });

  app.get('/api/landing/coupon/live-feed', async (request, reply) => {
    const parsed = liveFeedSchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    try {
      return ok(await getCouponLandingLiveFeed(parsed.data.limit));
    } catch (error) {
      return fail(reply, 500, error.message || '活动动态加载失败');
    }
  });

  app.get('/api/admin/landing/coupon', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const current = await readConfig();
      return ok({ managerUids: current.managerUids, cursor: current.cursor, updatedAt: current.updatedAt });
    } catch (error) {
      return fail(reply, 500, error.message || '广告页配置加载失败');
    }
  });

  app.put('/api/admin/landing/coupon', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = updateSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    try {
      const saved = await withRotationLock(() => writeConfig({
        managerUids: parsed.data.managerUids,
        cursor: 0,
        updatedAt: Math.floor(Date.now() / 1000)
      }));
      return ok(saved, '广告页客户经理轮询配置已保存');
    } catch (error) {
      return fail(reply, 500, error.message || '广告页配置保存失败');
    }
  });
}

module.exports = {
  registerCouponLandingRoutes,
  normalizeConfig,
  selectNextCard,
  extractApprovalProductModel,
  isPhoneLikeNickname,
  mapApprovalLiveFeed,
  mapIntegralLiveFeed
};
