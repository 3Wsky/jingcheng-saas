const fs = require('node:fs/promises');
const path = require('node:path');
const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { config } = require('../../shared/config');
const { requireAdmin } = require('../admin/admin.auth');
const { StaffService } = require('../staff/staff.service');

const DATA_FILE = path.join(config.dataDir, 'coupon-landing-config.json');
const updateSchema = z.object({
  managerUids: z.array(z.coerce.number().int().positive()).max(100)
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

module.exports = { registerCouponLandingRoutes, normalizeConfig, selectNextCard };
