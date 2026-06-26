const fs = require('node:fs/promises');
const path = require('node:path');
const { ok, fail } = require('../../shared/http');
const { config } = require('../../shared/config');
const { requireAdmin } = require('../admin/admin.auth');
const { getPool, legacyTable } = require('../../shared/mysql');

const DATA_FILE = path.join(config.dataDir, 'homepage-config.json');

async function readConfig() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  } catch {
    return { banners: [], quickNav: [], announcement: '' };
  }
}

async function writeConfig(data) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function registerHomepageRoutes(app) {
  app.get('/api/homepage', async (_request, reply) => {
    try {
      const cfg = await readConfig();
      return ok(cfg);
    } catch (error) {
      return fail(reply, 500, error.message || '首页配置加载失败');
    }
  });

  app.get('/api/stores', async (_request, reply) => {
    try {
      const table = legacyTable('system_store');
      const [rows] = await getPool().query(
        `SELECT id, name, phone, address, detailed_address, day_time,
                latitude, longitude, image
         FROM ${table}
         WHERE COALESCE(is_del, 0) = 0 AND COALESCE(is_show, 1) = 1
         ORDER BY id ASC
         LIMIT 100`
      );
      return ok((rows || []).map(r => ({
        id: Number(r.id),
        name: r.name || '',
        phone: r.phone || '',
        address: [r.address, r.detailed_address].filter(Boolean).join(' '),
        dayTime: r.day_time || '',
        latitude: Number(r.latitude || 0),
        longitude: Number(r.longitude || 0),
        image: r.image || ''
      })));
    } catch (error) {
      return fail(reply, 500, error.message || '门店列表加载失败');
    }
  });

  app.get('/api/admin/homepage', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    try {
      return ok(await readConfig());
    } catch (error) {
      return fail(reply, 500, error.message || '首页配置加载失败');
    }
  });

  app.put('/api/admin/homepage', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    try {
      const body = request.body || {};
      const current = await readConfig();
      if (body.banners !== undefined) current.banners = body.banners;
      if (body.quickNav !== undefined) current.quickNav = body.quickNav;
      if (body.announcement !== undefined) current.announcement = body.announcement;
      await writeConfig(current);
      return ok(current, '首页配置已更新');
    } catch (error) {
      return fail(reply, 500, error.message || '首页配置保存失败');
    }
  });
}

module.exports = { registerHomepageRoutes };
