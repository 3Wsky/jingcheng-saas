const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { requireAdmin, getAdminSession } = require('../admin/admin.auth');
const { AdminAuditService, getClientIp } = require('../admin/admin-audit.service');
const { IntegralService } = require('../integral/integral.service');
const { MembershipService } = require('../membership/membership.service');
const { getPool } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

const MAX_BATCH = 500;

const itemSchema = z.object({
  uid: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive().optional(),
  batchType: z.enum(['gift', 'adjust']).optional().default('gift'),
  tierCode: z.enum(['SW199', 'SW299', 'tier_199', 'tier_299']).optional(),
  remark: z.string().trim().max(200).optional().default('')
});

const batchSchema = z.object({
  action: z.enum(['integral', 'cash_voucher', 'membership']),
  items: z.array(itemSchema).min(1).max(MAX_BATCH)
});

async function grantCashVoucher(uid, amount, remark) {
  const now = Math.floor(Date.now() / 1000);
  const expireAt = now + 365 * 86400;
  const [result] = await getPool().query(
    `INSERT INTO ${swTable('cash_voucher_batch')}
     (uid, source_type, source_id, total_amount, remain_amount, expire_at, status, created_at, updated_at)
     VALUES (?, 'manual', ?, ?, ?, ?, 1, ?, ?)`,
    [uid, `BATCH${now}`, amount, amount, expireAt, now, now]
  );
  await getPool().query(
    `INSERT INTO ${swTable('cash_voucher_ledger')}
     (uid, direction, amount, batch_id, merchant_id, operator_uid, biz_id, remark, created_at)
     VALUES (?, 1, ?, ?, 0, 0, ?, ?, ?)`,
    [uid, amount, result.insertId, `BATCH${now}`, remark, now]
  );
  return { batchId: result.insertId };
}

function parseCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
  const items = [];
  for (let i = 1; i < lines.length && items.length < MAX_BATCH; i++) {
    const cols = lines[i].split(',').map((s) => s.trim());
    const row = Object.fromEntries(header.map((h, idx) => [h, cols[idx] || '']));
    if (!row.uid) continue;
    items.push({
      uid: Number(row.uid),
      action: row.action,
      amount: row.amount ? Number(row.amount) : undefined,
      tierCode: row.tier || undefined,
      remark: row.remark || ''
    });
  }
  return items;
}

function registerAdminBatchGrantRoutes(app) {
  const integralService = new IntegralService();
  const membershipService = new MembershipService();
  const audit = new AdminAuditService();

  app.get('/api/admin/members/batch-grant/template', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const csv = 'uid,action,amount,tier,remark\n10001,integral,1000,,示例\n';
    return reply.type('text/csv; charset=utf-8').send(csv);
  });

  app.post('/api/admin/members/batch-grant', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = batchSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const session = getAdminSession(request);
    const { action, items } = parsed.data;
    const results = [];
    let success = 0;
    let failed = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const row = i + 1;
      try {
        if (action === 'integral') {
          if (!item.amount) throw Object.assign(new Error('缺少 amount'), { statusCode: 400 });
          const r = await integralService.grantManual({
            uid: item.uid,
            amount: item.amount,
            batchType: item.batchType,
            remark: item.remark || '批量发放',
            adminRef: `BATCH${Date.now()}_${item.uid}`
          });
          results.push({ row, uid: item.uid, ok: true, batchId: r.batchId });
        } else if (action === 'cash_voucher') {
          if (!item.amount) throw Object.assign(new Error('缺少 amount'), { statusCode: 400 });
          const r = await grantCashVoucher(item.uid, item.amount, item.remark || '批量发券');
          results.push({ row, uid: item.uid, ok: true, batchId: r.batchId });
        } else {
          if (!item.tierCode) throw Object.assign(new Error('缺少 tierCode'), { statusCode: 400 });
          const r = await membershipService.adminGrant({
            uid: item.uid,
            tierCode: item.tierCode,
            refId: `BATCH${Date.now()}_${item.uid}`
          });
          results.push({ row, uid: item.uid, ok: true, duplicate: r.duplicate });
        }
        success += 1;
      } catch (error) {
        failed += 1;
        results.push({ row, uid: item.uid, ok: false, error: error.message || '失败' });
      }
    }

    await audit.write({
      adminUsername: session?.username || '',
      action: `batch_grant_${action}`,
      targetType: 'batch',
      targetId: String(items.length),
      payload: { action, total: items.length, success, failed },
      ip: getClientIp(request)
    });

    return ok({ total: items.length, success, failed, results });
  });

  app.post('/api/admin/members/batch-grant/csv', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const body = request.body || {};
    const csvText = body.csv || body.content || '';
    if (!csvText) return fail(reply, 400, '请提供 CSV 内容');

    const rows = parseCsv(csvText);
    if (!rows.length) return fail(reply, 400, 'CSV 无有效数据');

    const grouped = {};
    for (const row of rows) {
      const act = row.action;
      if (!['integral', 'cash_voucher', 'membership'].includes(act)) continue;
      if (!grouped[act]) grouped[act] = [];
      grouped[act].push(row);
    }

    const allResults = [];
    let totalSuccess = 0;
    let totalFailed = 0;
    for (const [action, items] of Object.entries(grouped)) {
      const fakeReq = { body: { action, items }, headers: request.headers, ip: request.ip };
      // inline batch processing
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          if (action === 'integral') {
            await integralService.grantManual({ uid: item.uid, amount: item.amount, remark: item.remark, adminRef: `CSV${Date.now()}` });
          } else if (action === 'cash_voucher') {
            await grantCashVoucher(item.uid, item.amount, item.remark);
          } else {
            await membershipService.adminGrant({ uid: item.uid, tierCode: item.tierCode, refId: `CSV${Date.now()}` });
          }
          totalSuccess += 1;
          allResults.push({ uid: item.uid, action, ok: true });
        } catch (error) {
          totalFailed += 1;
          allResults.push({ uid: item.uid, action, ok: false, error: error.message });
        }
      }
    }

    return ok({ total: rows.length, success: totalSuccess, failed: totalFailed, results: allResults });
  });
}

module.exports = { registerAdminBatchGrantRoutes };
