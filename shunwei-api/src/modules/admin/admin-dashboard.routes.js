const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { requireAdmin } = require('./admin.auth');
const { AdminDashboardService } = require('./admin-dashboard.service');
const { getPool } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

const rangeSchema = z.object({
  range: z.enum(['today', '7d', '30d']).optional().default('today')
});

const budgetSchema = z.object({
  budget: z.coerce.number().min(0).max(1000000000)
});

const PAUSE_MSG = '网络传输故障，请稍后再试';

async function isPaused(key) {
  try {
    const [[row]] = await getPool().query(
      `SELECT config_value FROM ${swTable('system_config')} WHERE config_key = ? LIMIT 1`, [key]
    );
    return row?.config_value === '1';
  } catch { return false; }
}

async function setPause(key, value) {
  const pool = getPool();
  const val = value ? '1' : '0';
  await pool.query(
    `INSERT INTO ${swTable('system_config')} (config_key, config_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    [key, val]
  );
}

function registerAdminDashboardRoutes(app) {
  const service = new AdminDashboardService();

  app.get('/api/admin/dashboard/summary', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = rangeSchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const data = await service.getSummary(parsed.data.range);
      data.pauseStatus = {
        grant: await isPaused('pause_grant'),
        verify: await isPaused('pause_verify')
      };
      return ok(data);
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '看板数据加载失败');
    }
  });

  app.post('/api/admin/dashboard/pause', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { type, enabled } = request.body || {};
    if (!['grant', 'verify'].includes(type)) return fail(reply, 400, '类型无效');
    try {
      const key = type === 'grant' ? 'pause_grant' : 'pause_verify';
      await setPause(key, Boolean(enabled));
      return ok({ type, enabled: Boolean(enabled) }, enabled ? '已暂停' : '已恢复');
    } catch (error) {
      return fail(reply, 500, error.message || '操作失败');
    }
  });

  // 现金池额度：后台读取完整数据（总预算/已用/剩余/进度）
  app.get('/api/admin/config/fund-pool', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      return ok(await service.getFundPool());
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '现金池数据读取失败');
    }
  });

  // 现金池额度：后台设置总预算
  app.put('/api/admin/config/fund-pool', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = budgetSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    try {
      const data = await service.setFundPoolBudget(parsed.data.budget);
      return ok(data, '现金池总预算已更新');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '现金池预算更新失败');
    }
  });

  app.addHook('preHandler', async (request, reply) => {
    const url = request.url || '';

    const grantPaths = ['/api/approval/submit', '/api/admin/batch-grant', '/api/integral-mall/exchange'];
    const isGrant = grantPaths.some(p => url.startsWith(p));
    if (isGrant && request.method !== 'GET') {
      if (await isPaused('pause_grant')) {
        return fail(reply, 503, PAUSE_MSG);
      }
    }

    const verifyPaths = ['/api/merchant/verify-voucher', '/api/integral-mall/verify-by-code', '/api/staff/integral-mall/verify'];
    const isVerify = verifyPaths.some(p => url.startsWith(p));
    if (isVerify && request.method !== 'GET') {
      if (await isPaused('pause_verify')) {
        return fail(reply, 503, PAUSE_MSG);
      }
    }
  });
}

module.exports = { registerAdminDashboardRoutes };
