const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { StaffService } = require('./staff.service');

const bindSchema = z.object({
  staffUid: z.coerce.number().int().positive()
});

const membersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
  keyword: z.string().trim().max(40).optional().default('')
});

const ownCardSchema = z.object({
  displayName: z.string().trim().max(64).optional(),
  avatar: z.string().trim().max(512).optional(),
  jobTitle: z.string().trim().max(64).optional(),
  bio: z.string().trim().max(500).optional(),
  wechatQrcode: z.string().trim().max(512).optional(),
  isPublished: z.boolean().optional()
});

function registerStaffRoutes(app) {
  const service = new StaffService();

  app.get('/api/staff/members', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const parsed = membersQuerySchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    try {
      return ok(await service.listOwnedMembers(request.auth.uid, parsed.data));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '会员列表加载失败');
    }
  });

  app.get('/api/staff/stats', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      return ok(await service.getStats(request.auth.uid));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '统计加载失败');
    }
  });

  app.get('/api/staff/my-manager-card', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      const { getPool, legacyTable } = require('../../shared/mysql');
      const [[user]] = await getPool().query(
        `SELECT spread_uid FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1`,
        [request.auth.uid]
      );
      const spreadUid = Number(user?.spread_uid || 0);
      if (!spreadUid) {
        return ok({ bound: false, card: null, spreadUid: 0 });
      }

      try {
        const card = await service.getCard(spreadUid, { publicView: true });
        return ok({ bound: true, card, spreadUid });
      } catch (error) {
        return ok({ bound: true, card: null, spreadUid });
      }
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '获取客户经理名片失败');
    }
  });

  app.get('/api/staff/my-card', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    try {
      return ok(await service.getCard(request.auth.uid));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '获取名片失败');
    }
  });

  app.put('/api/staff/my-card', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const parsed = ownCardSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '名片参数错误', parsed.error.flatten());
    try {
      return ok(await service.updateOwnCard(request.auth.uid, parsed.data), '名片已保存');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '保存名片失败');
    }
  });

  app.get('/api/staff/:uid/card', async (request, reply) => {
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');
    try {
      return ok(await service.getCard(uid, { publicView: true }));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '名片不存在');
    }
  });

  app.post('/api/staff/bind-spread', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const parsed = bindSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    try {
      const result = await service.bindSpread(request.auth.uid, parsed.data.staffUid);
      return ok(result, result.bound ? '归属绑定成功' : '已有归属，未变更');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '绑定失败');
    }
  });
}

module.exports = { registerStaffRoutes };
