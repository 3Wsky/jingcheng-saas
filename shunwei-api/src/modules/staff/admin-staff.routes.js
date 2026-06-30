const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { requireAdmin, getAdminSession } = require('../admin/admin.auth');
const { AdminAuditService, getClientIp } = require('../admin/admin-audit.service');
const { StaffService } = require('./staff.service');
const { AdminStoresService } = require('../admin/admin-stores.service');

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  keyword: z.string().trim().max(64).optional().default(''),
  divisionId: z.coerce.number().int().optional(),
  storeName: z.string().trim().max(80).optional()
});

const cardSchema = z.object({
  displayName: z.string().trim().max(64).optional().default(''),
  avatar: z.string().trim().max(512).optional().default(''),
  jobTitle: z.string().trim().max(64).optional().default(''),
  bio: z.string().trim().max(500).optional().default(''),
  storeName: z.string().trim().max(128).optional().default(''),
  storeAddress: z.string().trim().max(255).optional().default(''),
  storePhone: z.string().trim().max(20).optional().default(''),
  businessHours: z.string().trim().max(128).optional().default(''),
  latitude: z.coerce.number().optional().default(0),
  longitude: z.coerce.number().optional().default(0),
  wechatQrcode: z.string().trim().max(512).optional().default(''),
  isPublished: z.boolean().optional().default(true)
});

const batchGrantSchema = z.object({
  storeName: z.string().trim().min(1).max(80).optional().default('米古里')
});

const updateStoreSchema = z.object({
  storeName: z.string().trim().min(1).max(80)
});

const storeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  keyword: z.string().trim().max(80).optional().default('')
});

const storeUpsertSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(20).optional().default(''),
  address: z.string().trim().max(255).optional().default(''),
  detailedAddress: z.string().trim().max(255).optional().default(''),
  dayTime: z.string().trim().max(128).optional().default(''),
  isShow: z.boolean().optional().default(true)
});

const storeTransferSchema = z.object({
  targetStoreName: z.string().trim().min(1).max(80),
  uids: z.array(z.coerce.number().int().positive()).optional()
});

function registerAdminStaffRoutes(app) {
  const service = new StaffService();
  const storesService = new AdminStoresService();
  const audit = new AdminAuditService();

  app.get('/api/admin/stores/options', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const list = await storesService.listOptions();
      return ok({ list });
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '门店列表加载失败');
    }
  });

  app.get('/api/admin/stores', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = storeListQuerySchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    try {
      return ok(await storesService.list(parsed.data));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '门店列表加载失败');
    }
  });

  app.post('/api/admin/stores', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = storeUpsertSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    const session = getAdminSession(request);
    try {
      const data = await storesService.create(parsed.data);
      await audit.write({
        adminUsername: session?.username || '',
        action: 'store_create',
        targetType: 'store',
        targetId: data.id,
        payload: parsed.data,
        ip: getClientIp(request)
      });
      return ok(data, '门店已创建');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '门店创建失败');
    }
  });

  app.put('/api/admin/stores/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number(request.params.id);
    if (!id) return fail(reply, 400, '门店 ID 无效');
    const parsed = storeUpsertSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    const session = getAdminSession(request);
    try {
      const data = await storesService.update(id, parsed.data);
      await audit.write({
        adminUsername: session?.username || '',
        action: 'store_update',
        targetType: 'store',
        targetId: id,
        payload: parsed.data,
        ip: getClientIp(request)
      });
      return ok(data, '门店已更新');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '门店更新失败');
    }
  });

  app.delete('/api/admin/stores/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number(request.params.id);
    if (!id) return fail(reply, 400, '门店 ID 无效');
    const session = getAdminSession(request);
    try {
      const data = await storesService.remove(id);
      await audit.write({
        adminUsername: session?.username || '',
        action: 'store_delete',
        targetType: 'store',
        targetId: id,
        payload: { name: data.name },
        ip: getClientIp(request)
      });
      return ok(data, '门店已删除');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '门店删除失败');
    }
  });

  app.get('/api/admin/stores/:id/staff', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number(request.params.id);
    if (!id) return fail(reply, 400, '门店 ID 无效');
    try {
      return ok(await storesService.listStaff(id));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '门店客户经理加载失败');
    }
  });

  app.post('/api/admin/stores/:id/transfer', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number(request.params.id);
    if (!id) return fail(reply, 400, '门店 ID 无效');
    const parsed = storeTransferSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    const session = getAdminSession(request);
    try {
      const data = await storesService.transferStaff(id, parsed.data.targetStoreName, parsed.data.uids);
      await audit.write({
        adminUsername: session?.username || '',
        action: 'store_staff_transfer',
        targetType: 'store',
        targetId: id,
        payload: { ...parsed.data, moved: data.moved, toDivisionId: data.toDivisionId },
        ip: getClientIp(request)
      });
      return ok(data, `已转移 ${data.moved} 名客户经理`);
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '转移失败');
    }
  });

  app.get('/api/admin/staff/batch-grant/preview', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      return ok(await service.previewBatchGrantFromSpread());
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '批量开通预览失败');
    }
  });

  app.post('/api/admin/staff/batch-grant-from-spread', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = batchGrantSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    const session = getAdminSession(request);
    try {
      const data = await service.batchGrantFromSpread(parsed.data);
      await audit.write({
        adminUsername: session?.username || '',
        action: 'staff_batch_grant_from_spread',
        targetType: 'staff',
        targetId: 0,
        payload: { ...parsed.data, granted: data.granted, failed: data.failed },
        ip: getClientIp(request)
      });
      return ok(data, `已批量开通 ${data.granted} 名店员`);
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '批量开通失败');
    }
  });

  app.put('/api/admin/staff/:uid/store', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');
    const parsed = updateStoreSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    const session = getAdminSession(request);
    try {
      const data = await service.updateStaffStore(uid, parsed.data.storeName);
      await audit.write({
        adminUsername: session?.username || '',
        action: 'staff_store_update',
        targetType: 'staff',
        targetId: uid,
        payload: parsed.data,
        ip: getClientIp(request)
      });
      return ok(data, '门店已更新');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '门店更新失败');
    }
  });

  app.get('/api/admin/staff/list', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = listQuerySchema.safeParse(request.query || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    try {
      return ok(await service.list(parsed.data));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '店员列表加载失败');
    }
  });

  app.get('/api/admin/staff/:uid/stats', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');
    try {
      return ok(await service.getStats(uid));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '店员统计加载失败');
    }
  });

  app.get('/api/admin/staff/:uid/card', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');
    try {
      return ok(await service.getCard(uid));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '名片加载失败');
    }
  });

  app.put('/api/admin/staff/:uid/card', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'uid 无效');
    const parsed = cardSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());
    const session = getAdminSession(request);
    try {
      const data = await service.upsertCard(uid, parsed.data);
      await audit.write({
        adminUsername: session?.username || '',
        action: 'staff_card_update',
        targetType: 'staff',
        targetId: uid,
        payload: parsed.data,
        ip: getClientIp(request)
      });
      return ok(data, '名片已保存');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '名片保存失败');
    }
  });

  app.post('/api/admin/staff/:uid/dismiss', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const uid = Number(request.params.uid);
    if (!uid) return fail(reply, 400, 'UID 无效');

    try {
      const { getPool, legacyTable } = require('../../shared/mysql');
      const { swTable } = require('../../shared/sw-mysql');
      const pool = getPool();

      const [[user]] = await pool.query(
        `SELECT uid, nickname, is_staff, division_id FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del,0) = 0 LIMIT 1`,
        [uid]
      );
      if (!user) return fail(reply, 404, '用户不存在');
      if (!Number(user.is_staff)) return fail(reply, 400, '该用户不是客户经理');

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        await conn.query(
          `UPDATE ${legacyTable('user')} SET is_staff = 0 WHERE uid = ?`, [uid]
        );

        try {
          await conn.query(
            `UPDATE ${swTable('store_manager')} SET is_active = 0 WHERE manager_uid = ?`, [uid]
          );
        } catch { /* table may not exist */ }

        const [result] = await conn.query(
          `UPDATE ${legacyTable('user')} SET spread_uid = 0 WHERE spread_uid = ? AND COALESCE(is_del,0) = 0`,
          [uid]
        );
        const unboundCount = result.affectedRows || 0;

        await conn.commit();

        const session = getAdminSession(request);
        await audit.write({
          adminUsername: session?.username || '',
          action: 'staff_dismiss',
          targetType: 'staff',
          targetId: uid,
          payload: { nickname: user.nickname, unboundMembers: unboundCount },
          ip: getClientIp(request)
        });

        return ok({
          uid,
          nickname: user.nickname || '',
          unboundMembers: unboundCount
        }, `已离职，解除 ${unboundCount} 名会员的归属关系`);
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '离职操作失败');
    }
  });
}

module.exports = { registerAdminStaffRoutes };
