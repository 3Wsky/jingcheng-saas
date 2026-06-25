const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { NewcomerLotteryRepository } = require('../newcomer-lottery/newcomer-lottery.repository');
const { NewcomerLotteryService } = require('../newcomer-lottery/newcomer-lottery.service');
const {
  clearAdminSessionCookie,
  requireAdmin,
  setAdminSessionCookie,
  verifyAdminCredentials
} = require('./admin.auth');
const { renderAdminLoginPage } = require('./admin.login.page');
const { renderAdminPage } = require('./admin.page');

const activitySchema = z.object({
  name: z.string().trim().min(1).max(40),
  status: z.enum(['enabled', 'disabled']),
  desc: z.string().trim().min(1).max(200),
  dailyLimit: z.coerce.number().int().min(0).max(999),
  guaranteeMisses: z.coerce.number().int().min(0).max(99),
  guaranteePrizeId: z.enum(['thanks', 'coupon', 'mystery', 'newcomer', 'heart', 'surprise', 'again'])
});

const taskSchema = z.object({
  id: z.enum(['register', 'browse', 'profile']),
  title: z.string().trim().min(1).max(40),
  desc: z.string().trim().min(1).max(100),
  action: z.string().trim().min(1).max(12),
  enabled: z.boolean(),
  rewardChances: z.coerce.number().int().min(1).max(10)
});

const prizeSchema = z.object({
  id: z.enum(['thanks', 'coupon', 'mystery', 'newcomer', 'heart', 'surprise', 'again']),
  name: z.string().trim().min(1).max(30),
  tag: z.string().trim().min(1).max(30),
  weight: z.coerce.number().int().min(0).max(9999),
  enabled: z.boolean(),
  stock: z.union([z.null(), z.coerce.number().int().min(0).max(999999)]),
  oncePerUser: z.boolean().optional().default(false)
});

const configSchema = z.object({
  activity: activitySchema,
  tasks: z.array(taskSchema).length(3),
  prizes: z.array(prizeSchema).length(7)
});

const recordParamsSchema = z.object({
  recordId: z.string().trim().min(1).max(64)
});

const fulfillmentSchema = z.object({
  status: z.enum(['pending', 'fulfilled', 'void']),
  note: z.string().trim().max(120).optional().default('')
});

const redeemSchema = z.object({
  code: z.string().trim().min(1).max(32),
  note: z.string().trim().max(120).optional().default('')
});

const loginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(120)
});

function registerAdminRoutes(app) {
  const repository = new NewcomerLotteryRepository();
  const service = new NewcomerLotteryService(repository);

  app.get('/admin/login', async (request, reply) => {
    return reply.type('text/html; charset=utf-8').send(renderAdminLoginPage());
  });

  app.post('/admin/login', async (request, reply) => {
    const body = parseFormBody(request.body);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success || !verifyAdminCredentials(parsed.data.username, parsed.data.password)) {
      return reply.type('text/html; charset=utf-8').code(401).send(renderAdminLoginPage('账号或密码错误'));
    }

    setAdminSessionCookie(reply, parsed.data.username);
    return reply.redirect('/admin');
  });

  app.post('/admin/logout', async (request, reply) => {
    clearAdminSessionCookie(reply);
    return reply.redirect('/admin/login');
  });

  app.get('/admin', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    return reply.type('text/html; charset=utf-8').send(renderAdminPage());
  });

  app.get('/admin/products', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    return reply.type('text/html; charset=utf-8').send(renderAdminPage('products'));
  });

  app.get('/api/admin/newcomer-lottery/overview', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    await service.ensureRedeemCodes();
    const state = await repository.readAll();
    const config = await service.getConfig();
    return ok(buildNewcomerLotteryOverview(state, config));
  });

  app.get('/api/admin/newcomer-lottery/config', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    return ok(await service.getConfig());
  });

  app.put('/api/admin/newcomer-lottery/config', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const parsed = configSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '配置参数错误', parsed.error.flatten());

    return ok(await service.updateConfig(parsed.data), '保存成功');
  });

  app.patch('/api/admin/newcomer-lottery/records/:recordId/fulfillment', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const parsedParams = recordParamsSchema.safeParse(request.params);
    if (!parsedParams.success) return fail(reply, 400, '记录参数错误', parsedParams.error.flatten());

    const parsedBody = fulfillmentSchema.safeParse(request.body || {});
    if (!parsedBody.success) return fail(reply, 400, '发放参数错误', parsedBody.error.flatten());

    try {
      return ok(
        await updateRecordFulfillment(repository, parsedParams.data.recordId, parsedBody.data),
        '发放状态已更新'
      );
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '发放状态更新失败');
    }
  });

  app.post('/api/admin/newcomer-lottery/redeem', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const parsed = redeemSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '兑换参数错误', parsed.error.flatten());

    try {
      const record = await service.redeemByCode(parsed.data.code, {
        note: parsed.data.note,
        operator: 'admin'
      });
      return ok(toAdminRecord(record.uid, record, record.updatedAt), '核销成功');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '核销失败');
    }
  });
}

function parseFormBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  const params = new URLSearchParams(String(body));
  return Object.fromEntries(params.entries());
}

async function updateRecordFulfillment(repository, recordId, input) {
  let updatedRecord = null;
  const updatedAt = new Date().toISOString();

  await repository.updateAll((state) => {
    const usersState = state && state.users && typeof state.users === 'object' ? state.users : {};

    for (const [uid, userState] of Object.entries(usersState)) {
      const records = Array.isArray(userState.records) ? userState.records : [];
      const index = records.findIndex((record) => record && record.id === recordId);
      if (index === -1) continue;

      const record = records[index];
      if (record.won === false) {
        const error = new Error('未中奖记录无需发放');
        error.statusCode = 400;
        throw error;
      }

      const fulfillment = {
        status: input.status,
        note: input.note || '',
        updatedAt
      };

      if (input.status === 'fulfilled') fulfillment.fulfilledAt = updatedAt;
      if (input.status === 'void') fulfillment.voidedAt = updatedAt;

      const nextRecord = {
        ...record,
        fulfillment,
        redeemStatus: input.status === 'fulfilled'
          ? 'redeemed'
          : input.status === 'void'
            ? 'void'
            : (record.redeemStatus === 'redeemed' ? 'redeemed' : 'pending')
      };
      if (input.status === 'fulfilled' && !nextRecord.redeemedAt) nextRecord.redeemedAt = updatedAt;
      records[index] = nextRecord;
      userState.records = records;
      userState.updatedAt = updatedAt;
      usersState[uid] = userState;
      updatedRecord = toAdminRecord(uid, nextRecord, userState.updatedAt);
      return state;
    }

    const error = new Error('开奖记录不存在');
    error.statusCode = 404;
    throw error;
  });

  return updatedRecord;
}

function buildNewcomerLotteryOverview(state, config) {
  const usersState = state && state.users && typeof state.users === 'object' ? state.users : {};
  const taskClaimMap = Object.fromEntries(config.tasks.map((task) => [task.id, 0]));
  const prizeDrawMap = Object.fromEntries(config.prizes.map((prize) => [prize.id, 0]));
  const probabilityMap = buildProbabilityMap(config.prizes);
  const users = [];
  const latestRecords = [];
  let totalChances = 0;
  let totalRecords = 0;
  let wonRecords = 0;

  for (const [uid, userState] of Object.entries(usersState)) {
    const user = normalizeUserState(userState);
    totalChances += user.chances;
    totalRecords += user.records.length;

    for (const taskId of user.doneTasks) {
      if (taskClaimMap[taskId] !== undefined) taskClaimMap[taskId] += 1;
    }

    for (const record of user.records) {
      if (record.won) wonRecords += 1;
      if (prizeDrawMap[record.prizeId] !== undefined) prizeDrawMap[record.prizeId] += 1;
      latestRecords.push(toAdminRecord(uid, record, user.updatedAt));
    }

    users.push({
      uid: maskUid(uid),
      chances: user.chances,
      doneTaskCount: user.doneTasks.length,
      taskCount: config.tasks.length,
      recordCount: user.records.length,
      updatedAt: user.updatedAt
    });
  }

  latestRecords.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  users.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return {
    updatedAt: new Date().toISOString(),
    totals: {
      userCount: users.length,
      totalChances,
      totalRecords,
      wonRecords
    },
    activity: config.activity,
    tasks: config.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      desc: task.desc,
      enabled: task.enabled,
      rewardChances: task.rewardChances,
      claimedCount: taskClaimMap[task.id] || 0
    })),
    prizes: config.prizes.map((prize) => ({
      id: prize.id,
      name: prize.name,
      tag: prize.tag,
      wheelIndex: prize.wheelIndex,
      weight: prize.weight,
      enabled: prize.enabled,
      stock: prize.stock,
      oncePerUser: prize.oncePerUser === true,
      probability: probabilityMap[prize.id] || 0,
      drawCount: prizeDrawMap[prize.id] || 0
    })),
    latestRecords: latestRecords.slice(0, 30),
    users: users.slice(0, 50)
  };
}

function toAdminRecord(uid, record, fallbackUpdatedAt) {
  return {
    uid: maskUid(uid),
    rawUid: uid,
    id: record.id || '',
    prizeId: record.prizeId || '',
    name: record.name || '',
    tag: record.tag || '',
    wheelIndex: Number.isFinite(Number(record.wheelIndex)) ? Number(record.wheelIndex) : 0,
    won: record.won !== false,
    fulfillment: normalizeFulfillment(record),
    redeemCode: record.redeemCode || '',
    redeemStatus: normalizeRedeemStatus(record),
    expiresAt: record.expiresAt || '',
    redeemedAt: record.redeemedAt || '',
    createdAt: record.createdAt || fallbackUpdatedAt
  };
}

function normalizeRedeemStatus(record) {
  if (record.won === false) return 'none';
  if (record.redeemStatus) return record.redeemStatus;
  const fulfillment = normalizeFulfillment(record);
  if (fulfillment.status === 'fulfilled') return 'redeemed';
  if (fulfillment.status === 'void') return 'void';
  if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) return 'expired';
  return 'pending';
}

function normalizeFulfillment(record) {
  if (record.won === false) {
    return {
      status: 'none',
      note: '',
      updatedAt: ''
    };
  }

  const fulfillment = record.fulfillment && typeof record.fulfillment === 'object' ? record.fulfillment : {};
  const status = ['pending', 'fulfilled', 'void'].includes(fulfillment.status) ? fulfillment.status : 'pending';
  return {
    status,
    note: fulfillment.note || '',
    updatedAt: fulfillment.updatedAt || '',
    fulfilledAt: fulfillment.fulfilledAt || '',
    voidedAt: fulfillment.voidedAt || ''
  };
}

function normalizeUserState(state) {
  return {
    chances: Number.isFinite(Number(state && state.chances)) ? Number(state.chances) : 0,
    doneTasks: Array.isArray(state && state.doneTasks) ? state.doneTasks : [],
    records: Array.isArray(state && state.records) ? state.records : [],
    updatedAt: state && state.updatedAt ? state.updatedAt : ''
  };
}

function buildProbabilityMap(prizes) {
  const activePrizes = prizes.filter((prize) => prize.enabled && prize.weight > 0 && (prize.stock === null || prize.stock > 0));
  const totalWeight = activePrizes.reduce((sum, prize) => sum + prize.weight, 0);
  if (!totalWeight) return {};

  return Object.fromEntries(
    prizes.map((prize) => {
      const available = prize.enabled && prize.weight > 0 && (prize.stock === null || prize.stock > 0);
      return [prize.id, available ? Number((prize.weight / totalWeight * 100).toFixed(2)) : 0];
    })
  );
}

function maskUid(uid) {
  const value = String(uid || '');
  if (value.length <= 14) return value || 'unknown';
  return `${value.slice(0, 10)}...${value.slice(-4)}`;
}

function registerAdminManagementRoutes(app) {
  const { getPool } = require('../../shared/mysql');
  const { swTable } = require('../../shared/sw-mysql');

  const grantVoucherSchema = z.object({
    uid: z.coerce.number().int().positive(),
    amount: z.coerce.number().positive(),
    remark: z.string().trim().max(200).optional().default('超管手动发放')
  });

  const createMerchantSchema = z.object({
    merchantName: z.string().trim().min(1).max(128),
    category: z.string().trim().max(64).optional().default(''),
    contactName: z.string().trim().max(64).optional().default(''),
    contactPhone: z.string().trim().max(20).optional().default(''),
    loginUid: z.coerce.number().int().nonnegative().optional().default(0),
    canVerify: z.boolean().optional().default(true),
    storeAddress: z.string().trim().max(255).optional().default(''),
    province: z.string().trim().max(32).optional().default(''),
    city: z.string().trim().max(32).optional().default(''),
    district: z.string().trim().max(32).optional().default(''),
    latitude: z.coerce.number().optional().default(0),
    longitude: z.coerce.number().optional().default(0),
    storeImages: z.array(z.string()).optional().default([]),
    businessHours: z.string().trim().max(128).optional().default('')
  });

  const verifyModeSchema = z.object({
    mode: z.enum(['any', 'hundred'])
  });

  app.post('/api/admin/cash-voucher/grant', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = grantVoucherSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const now = Math.floor(Date.now() / 1000);
    const expireAt = now + 365 * 86400;
    const [result] = await getPool().query(
      `INSERT INTO ${swTable('cash_voucher_batch')}
       (uid, source_type, source_id, total_amount, remain_amount, expire_at, status, created_at, updated_at)
       VALUES (?, 'manual', ?, ?, ?, ?, 1, ?, ?)`,
      [parsed.data.uid, `ADMIN${now}`, parsed.data.amount, parsed.data.amount, expireAt, now, now]
    );

    await getPool().query(
      `INSERT INTO ${swTable('cash_voucher_ledger')}
       (uid, direction, amount, batch_id, merchant_id, operator_uid, biz_id, remark, created_at)
       VALUES (?, 1, ?, ?, 0, 0, ?, ?, ?)`,
      [parsed.data.uid, parsed.data.amount, result.insertId, `ADMIN${now}`, parsed.data.remark, now]
    );

    return ok({ batchId: result.insertId, uid: parsed.data.uid, amount: parsed.data.amount }, '发放成功');
  });

  app.post('/api/admin/merchant/create', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = createMerchantSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const now = Math.floor(Date.now() / 1000);
    const d = parsed.data;
    const [result] = await getPool().query(
      `INSERT INTO ${swTable('merchant')}
       (merchant_name, category, contact_name, contact_phone, login_uid, can_verify, is_active,
        store_address, province, city, district, latitude, longitude, store_images, business_hours,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.merchantName, d.category, d.contactName, d.contactPhone, d.loginUid,
       d.canVerify ? 1 : 0,
       d.storeAddress, d.province, d.city, d.district, d.latitude, d.longitude,
       JSON.stringify(d.storeImages.filter(Boolean)), d.businessHours,
       now, now]
    );

    return ok({ merchantId: result.insertId, merchantName: d.merchantName }, '商家创建成功');
  });

  app.put('/api/admin/cash-voucher/verify-mode', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = verifyModeSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const now = Math.floor(Date.now() / 1000);
    await getPool().query(
      `INSERT INTO ${swTable('system_config')} (config_key, config_value, updated_at)
       VALUES ('cash_voucher_verify_mode', ?, ?)
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = VALUES(updated_at)`,
      [parsed.data.mode, now]
    );

    return ok({ mode: parsed.data.mode }, '核销模式已更新');
  });

  const { ApprovalService } = require('../approval/approval.service');
  const approvalReviewSchema = z.object({
    requestId: z.coerce.number().int().positive(),
    action: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(200).optional().default('')
  });

  function mapApprovalTodo(t) {
    return {
      todoId: t.id,
      requestId: t.request_id,
      customerUid: t.customer_uid,
      customerNickname: t.customer_nickname || '',
      consumeAmount: Number(t.consumption_amount ?? t.consume_amount ?? 0),
      matchedTierCode: t.matched_tier_code,
      matchedVoucher: Number(t.matched_voucher_amount || 0),
      matchedIntegral: Number(t.matched_integral || 0),
      reqStatus: t.req_status,
      clerkUid: t.staff_uid ?? t.clerk_uid,
      clerkNickname: t.staff_nickname || '',
      createdAt: Number(t.req_created_at)
    };
  }

  app.get('/api/admin/approval/todos', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const service = new ApprovalService();
      const todos = await service.getAdminTodos();
      return ok(todos.map(mapApprovalTodo));
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '审批列表加载失败');
    }
  });

  app.get('/api/admin/account/info', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { getAdminSession } = require('./admin.auth');
    const session = getAdminSession(request);
    const { config } = require('../../shared/config');
    return ok({
      username: session?.username || config.admin.username,
      loginAt: session?.issuedAt ? new Date(session.issuedAt).toISOString() : null,
      expiresAt: session?.expiresAt ? new Date(session.expiresAt).toISOString() : null,
      sessionMaxAge: config.admin.sessionMaxAgeSeconds
    });
  });

  const changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(64)
  });

  app.put('/api/admin/account/password', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = changePasswordSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const { config } = require('../../shared/config');
    const { verifyAdminCredentials } = require('./admin.auth');
    if (!verifyAdminCredentials(config.admin.username, parsed.data.currentPassword)) {
      return fail(reply, 403, '当前密码错误');
    }

    config.admin.password = parsed.data.newPassword;

    const fs = require('node:fs');
    const path = require('node:path');
    const envPath = path.resolve(config.rootDir, '.env');
    try {
      let envContent = fs.readFileSync(envPath, 'utf8');
      if (/^ADMIN_PASSWORD=.*/m.test(envContent)) {
        envContent = envContent.replace(/^ADMIN_PASSWORD=.*/m, `ADMIN_PASSWORD=${parsed.data.newPassword}`);
      } else {
        envContent += `\nADMIN_PASSWORD=${parsed.data.newPassword}\n`;
      }
      fs.writeFileSync(envPath, envContent, 'utf8');
    } catch {
      // .env write optional; in-memory change still takes effect until restart
    }

    return ok(null, '密码已修改（当前进程立即生效）');
  });

  app.post('/api/admin/approval/review', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = approvalReviewSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    try {
      const service = new ApprovalService();
      const adminUid = await service.resolveDefaultAdminUid();
      const result = await service.reviewByAdmin(
        adminUid, parsed.data.requestId, parsed.data.action, parsed.data.reason
      );
      return ok(result, parsed.data.action === 'approve' ? '终审通过，权益已发放' : '已驳回');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '审批操作失败');
    }
  });
}

module.exports = { registerAdminRoutes, registerAdminManagementRoutes, buildNewcomerLotteryOverview };
