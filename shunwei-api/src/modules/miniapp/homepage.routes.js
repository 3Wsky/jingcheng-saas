const fs = require('node:fs/promises');
const path = require('node:path');
const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { config } = require('../../shared/config');
const { toPublicUrl } = require('../../shared/url');
const { requireAdmin } = require('../admin/admin.auth');
const { AiImageService } = require('../ai-image/ai-image.service');
const { getPool, legacyTable } = require('../../shared/mysql');

const DATA_FILE = path.join(config.dataDir, 'homepage-config.json');
const TAB_PAGES = new Set([
  '/pages/index/index',
  '/pages/goods_cate/goods_cate',
  '/pages/order_addcart/order_addcart',
  '/pages/user/index'
]);

const bannerSchema = z.object({
  id: z.string().trim().max(80).optional().default(''),
  title: z.string().trim().max(40).optional().default(''),
  subtitle: z.string().trim().max(100).optional().default(''),
  buttonText: z.string().trim().max(20).optional().default(''),
  image: z.string().trim().max(2000).optional().default(''),
  targetType: z.enum(['none', 'page', 'tab']).optional().default('none'),
  targetPath: z.string().trim().max(500).optional().default(''),
  enabled: z.boolean().optional().default(true),
  sort: z.coerce.number().int().min(-9999).max(9999).optional().default(0)
});

const updateSchema = z.object({
  banners: z.array(bannerSchema).max(20),
  quickNav: z.array(z.unknown()).max(20).optional(),
  announcement: z.string().max(300).optional()
});

const generateSchema = z.object({
  prompt: z.string().trim().min(4).max(1600),
  aspectRatio: z.enum(['16:9', '3:2', '4:3', '1:1']).optional().default('16:9'),
  quality: z.enum(['low', 'medium', 'high', 'auto']).optional()
});

function normalizeTarget(type, targetPath) {
  const targetType = ['page', 'tab'].includes(type) ? type : 'none';
  const rawPath = String(targetPath || '').trim();
  if (targetType === 'none' || !rawPath) return { targetType: 'none', targetPath: '' };
  if (!rawPath.startsWith('/pages/') || /^(?:https?:)?\/\//i.test(rawPath)) {
    return { targetType: 'none', targetPath: '' };
  }
  const pathname = rawPath.split('?')[0];
  if (targetType === 'tab' && !TAB_PAGES.has(pathname)) {
    return { targetType: 'none', targetPath: '' };
  }
  return { targetType, targetPath: rawPath };
}

function normalizeConfig(value) {
  const usedIds = new Set();
  const banners = (Array.isArray(value?.banners) ? value.banners : []).slice(0, 20).map((item, index) => {
    const parsed = bannerSchema.safeParse(item || {});
    const source = parsed.success ? parsed.data : bannerSchema.parse({});
    let id = source.id || `banner-${index + 1}`;
    while (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    const target = normalizeTarget(source.targetType, source.targetPath);
    return {
      id,
      title: source.title,
      subtitle: source.subtitle,
      buttonText: source.buttonText,
      image: source.image,
      targetType: target.targetType,
      targetPath: target.targetPath,
      enabled: source.enabled,
      sort: source.sort
    };
  });
  return {
    banners,
    quickNav: Array.isArray(value?.quickNav) ? value.quickNav.slice(0, 20) : [],
    announcement: String(value?.announcement || '').slice(0, 300),
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

async function writeConfig(data) {
  const normalized = normalizeConfig(data);
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(normalized, null, 2), 'utf8');
  await fs.rename(tempFile, DATA_FILE);
  return normalized;
}

function publicConfig(current, request) {
  return {
    ...current,
    banners: current.banners
      .filter((item) => item.enabled)
      .sort((a, b) => b.sort - a.sort)
      .map((item) => ({ ...item, image: toPublicUrl(item.image, request) }))
  };
}

function buildBannerPrompt(input, aspectRatio) {
  return [
    `生成一张用于微信小程序会员商城首页的高端数码横幅，画面比例 ${aspectRatio}。`,
    input,
    '整体为奶油白、香槟金和暖橙配色，真实商业摄影质感，适合华为授权体验店与高级数码零售场景。',
    '主体商品集中在画面右侧，左侧约 42% 保持干净、低对比、可读性良好的留白区域，供小程序叠加标题和按钮。',
    '画面边缘保留安全距离，重要商品不要贴边，适配移动端横幅裁切。',
    '图片中严禁出现任何文字、字母、数字、价格、商标水印、二维码或按钮。'
  ].join('\n');
}

function registerHomepageRoutes(app) {
  const aiImage = new AiImageService();
  aiImage.reloadFromFile().catch(() => {});

  app.get('/api/homepage', async (request, reply) => {
    try {
      return ok(publicConfig(await readConfig(), request));
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
      return ok((rows || []).map((row) => ({
        id: Number(row.id),
        name: row.name || '',
        phone: row.phone || '',
        address: [row.address, row.detailed_address].filter(Boolean).join(' '),
        dayTime: row.day_time || '',
        latitude: Number(row.latitude || 0),
        longitude: Number(row.longitude || 0),
        image: row.image || ''
      })));
    } catch (error) {
      return fail(reply, 500, error.message || '门店列表加载失败');
    }
  });

  app.get('/api/admin/homepage', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      return ok(await readConfig());
    } catch (error) {
      return fail(reply, 500, error.message || '首页配置加载失败');
    }
  });

  app.put('/api/admin/homepage', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = updateSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '首页轮播图参数错误', parsed.error.flatten());
    try {
      const current = await readConfig();
      const saved = await writeConfig({
        ...current,
        ...parsed.data,
        updatedAt: Math.floor(Date.now() / 1000)
      });
      return ok(saved, '首页轮播图已保存并生效');
    } catch (error) {
      return fail(reply, 500, error.message || '首页轮播图保存失败');
    }
  });

  app.get('/api/admin/homepage/ai-image/status', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    await aiImage.reloadFromFile().catch(() => {});
    return ok({ configured: aiImage.isConfigured(), model: aiImage.model });
  });

  app.post('/api/admin/homepage/ai-image/generate', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = generateSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, 'AI 生图参数错误', parsed.error.flatten());
    await aiImage.reloadFromFile().catch(() => {});
    if (!aiImage.isConfigured()) {
      return fail(reply, 503, 'AI 生图服务未配置，请先在系统设置中配置 AI 生图 API');
    }
    try {
      const images = await aiImage.generate({
        prompt: buildBannerPrompt(parsed.data.prompt, parsed.data.aspectRatio),
        aspectRatio: parsed.data.aspectRatio,
        count: 1,
        quality: parsed.data.quality
      });
      return ok({
        url: toPublicUrl(images[0].url, request),
        aspectRatio: parsed.data.aspectRatio,
        model: aiImage.model
      }, '轮播图生成完成');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '轮播图生成失败');
    }
  });
}

module.exports = {
  registerHomepageRoutes,
  normalizeConfig,
  normalizeTarget,
  publicConfig,
  buildBannerPrompt
};
