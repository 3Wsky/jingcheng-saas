const fs = require('node:fs/promises');
const path = require('node:path');
const { ok, fail } = require('../../shared/http');
const { config } = require('../../shared/config');
const { requireAdmin } = require('../admin/admin.auth');

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
