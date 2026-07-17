const { z } = require('zod');
const { nanoid } = require('nanoid');
const { ok, fail } = require('../../shared/http');
const { requireAdmin, getAdminSession } = require('./admin.auth');
const { AdminAuditService, getClientIp } = require('./admin-audit.service');
const { AiImageService } = require('../ai-image/ai-image.service');

const MAIN_PROMPT = (name) =>
  `这是一张门店实拍的商品照片${name ? `（商品名称：${name}）` : ''}。`
  + '请严格基于照片中的真实商品，生成一张专业电商主图：纯白色背景，商品居中、完整、约占画面 80%，'
  + '柔和均匀的棚拍打光，去除杂乱背景、桌面、手部、阴影与反光。'
  + '必须完整保持该商品真实的造型、颜色、材质、纹理、品牌标识与型号特征，不要凭空增删或改变商品的任何部件与配色。'
  + '画面干净、写实、高清，正方形构图，不要出现任何文字、水印、logo 贴纸、价格标签或装饰边框。';

const DETAIL_PROMPTS = [
  '请严格基于这张商品图，生成一张竖版商品细节展示长图：突出商品的材质、做工与质感细节特写，浅色简洁背景，柔和打光，写实高清。完整保持商品真实的外观、颜色、型号与品牌标识不变，不要出现任何文字、水印或价格标签。',
  '请严格基于这张商品图，生成一张竖版商品场景展示长图：把商品自然地放入简洁高级的生活/使用场景中，体现真实使用效果，写实高清。完整保持商品真实的外观、颜色与型号不变，不要出现任何文字、水印或价格标签。',
  '请严格基于这张商品图，生成一张竖版商品正面展示长图：纯净浅灰渐变背景，商品居中突出、质感细腻，写实高清。完整保持商品真实外观与配色不变，不要出现任何文字、水印或价格标签。',
  '请严格基于这张商品图，生成一张竖版商品多角度细节长图：展示商品侧面与背部的质感与细节，简洁背景，写实高清。完整保持商品真实外观不变，不要出现任何文字、水印或价格标签。'
];

const generateSchema = z.object({
  photo: z.string().trim().min(1).max(12_000_000),
  productName: z.string().trim().max(120).optional().default(''),
  storePrice: z.coerce.number().min(0).max(9_999_999).optional().default(0),
  multiplier: z.coerce.number().min(0).max(10_000).optional().default(10),
  detailCount: z.coerce.number().int().min(0).max(4).optional().default(2),
  quality: z.enum(['low', 'medium', 'high', 'auto']).optional()
});

function buildDescriptionHtml(detailImages) {
  if (!detailImages.length) return '';
  const blocks = detailImages
    .map((url) => `<p style="text-align:center;margin:0 0 8px"><img src="${url}" style="max-width:100%;display:block;margin:0 auto" /></p>`)
    .join('\n');
  return `<div class="ai-gift-detail">\n${blocks}\n</div>`;
}

function computeSuggestedIntegral(storePrice, multiplier) {
  const price = Number(storePrice || 0);
  if (price <= 0) return 0;
  const m = Number(multiplier || 0) > 0 ? Number(multiplier) : 10;
  return Math.max(1000, Math.round(price * m));
}

// status: pending → generating_main → generating_detail → done / failed
const tasks = new Map();
const TASK_TTL_MS = 30 * 60 * 1000;
const MAX_TASKS = 200;

function pruneExpiredTasks() {
  const now = Date.now();
  for (const [id, t] of tasks) {
    if (now - t.createdAt > TASK_TTL_MS) tasks.delete(id);
  }
  if (tasks.size > MAX_TASKS) {
    const sorted = [...tasks.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (let i = 0; i < sorted.length - MAX_TASKS; i++) tasks.delete(sorted[i][0]);
  }
}

const aiConfigSchema = z.object({
  baseUrl: z.string().trim().max(500).optional().default(''),
  apiKey: z.string().trim().max(500).optional().default(''),
  model: z.string().trim().max(100).optional().default('gpt-image-2'),
  quality: z.enum(['low', 'medium', 'high', 'auto']).optional().default('medium')
});

function registerAdminAiGiftRoutes(app) {
  const audit = new AdminAuditService();
  const aiImage = new AiImageService();
  aiImage.reloadFromFile().catch(() => {});

  app.get('/api/admin/integral-mall/ai-gift/status', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    await aiImage.reloadFromFile().catch(() => {});
    return ok({
      configured: aiImage.isConfigured(),
      model: aiImage.model
    });
  });

  app.get('/api/admin/config/ai-image', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const saved = await AiImageService.readConfig();
    return ok({
      baseUrl: saved?.baseUrl || '',
      apiKey: saved?.apiKey ? '****' + String(saved.apiKey).slice(-6) : '',
      apiKeySet: Boolean(saved?.apiKey),
      model: saved?.model || aiImage.model,
      quality: saved?.quality || 'medium',
      envConfigured: Boolean(aiImage.envChannel.baseUrl && aiImage.envChannel.apiKey),
      effectiveConfigured: aiImage.isConfigured()
    });
  });

  app.put('/api/admin/config/ai-image', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = aiConfigSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '画家设计配置参数错误', parsed.error.flatten());

    const existing = await AiImageService.readConfig();
    const cfg = {
      baseUrl: parsed.data.baseUrl || '',
      apiKey: parsed.data.apiKey || existing?.apiKey || '',
      model: parsed.data.model || 'gpt-image-2',
      quality: parsed.data.quality || 'medium',
      updatedAt: new Date().toISOString()
    };
    await AiImageService.writeConfig(cfg);
    await aiImage.reloadFromFile();

    const session = getAdminSession(request);
    await audit.write({
      adminUsername: session?.username || '',
      action: 'ai_image_config_update',
      targetType: 'config',
      targetId: 0,
      payload: { baseUrl: cfg.baseUrl, model: cfg.model, quality: cfg.quality },
      ip: getClientIp(request)
    }).catch(() => {});

    return ok({
      configured: aiImage.isConfigured(),
      model: aiImage.model
    }, '画家设计配置已保存');
  });

  // 提交异步设计任务，立即返回 taskId
  app.post('/api/admin/integral-mall/ai-gift/generate', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = generateSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '画家设计参数错误', parsed.error.flatten());

    await aiImage.reloadFromFile().catch(() => {});
    if (!aiImage.isConfigured()) {
      return fail(reply, 503, '画家设计服务未配置，请在系统设置页配置图片接口');
    }

    pruneExpiredTasks();

    const { photo, productName, storePrice, multiplier, detailCount, quality } = parsed.data;
    const taskId = `aig-${nanoid(12)}`;
    const task = {
      taskId,
      status: 'pending',
      progress: '排队中',
      step: 0,
      totalSteps: 1 + detailCount,
      createdAt: Date.now(),
      result: null,
      error: null
    };
    tasks.set(taskId, task);

    const session = getAdminSession(request);
    const clientIp = getClientIp(request);

    // 后台异步执行，不阻塞 HTTP 响应
    (async () => {
      try {
        task.status = 'generating_main';
        task.progress = '画家正在设计主图（1/' + task.totalSteps + '）…';

        const reference = await aiImage.loadImageInput(photo);

        const mainResults = await aiImage.edit({
          prompt: MAIN_PROMPT(productName),
          image: reference,
          aspectRatio: '1:1',
          count: 1,
          quality
        });
        const main = mainResults[0];
        task.step = 1;

        const detailRef = { buffer: main.buffer, mime: main.mime };
        const detailImages = [];
        for (let i = 0; i < detailCount; i += 1) {
          task.status = 'generating_detail';
          task.progress = `画家正在设计详情图（${i + 2}/${task.totalSteps}）…`;
          const prompt = DETAIL_PROMPTS[i % DETAIL_PROMPTS.length];
          const res = await aiImage.edit({
            prompt,
            image: detailRef,
            aspectRatio: '2:3',
            count: 1,
            quality
          });
          detailImages.push(res[0].url);
          task.step = i + 2;
        }

        const suggestedIntegral = computeSuggestedIntegral(storePrice, multiplier);
        const description = buildDescriptionHtml(detailImages);

        task.status = 'done';
        task.progress = '画家设计完成';
        task.result = {
          mainImage: main.url,
          sliderImages: [main.url, ...detailImages],
          detailImages,
          description,
          storePrice,
          multiplier,
          marketPrice: storePrice,
          suggestedIntegral,
          model: aiImage.model
        };

        await audit.write({
          adminUsername: session?.username || '',
          action: 'integral_mall_ai_gift_generate',
          targetType: 'product',
          targetId: 0,
          payload: { productName, storePrice, multiplier, detailCount, mainImage: main.url, detailImagesCount: detailImages.length },
          ip: clientIp
        }).catch(() => {});
      } catch (error) {
        task.status = 'failed';
        task.progress = '画家设计失败';
        task.error = error.message || '画家设计失败';
      }
    })();

    return ok({ taskId, totalSteps: task.totalSteps }, '任务已提交，请轮询状态');
  });

  // 轮询任务状态
  app.get('/api/admin/integral-mall/ai-gift/task/:taskId', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { taskId } = request.params;
    const task = tasks.get(taskId);
    if (!task) return fail(reply, 404, '任务不存在或已过期');

    const resp = {
      taskId: task.taskId,
      status: task.status,
      progress: task.progress,
      step: task.step,
      totalSteps: task.totalSteps
    };

    if (task.status === 'done') {
      resp.result = task.result;
      tasks.delete(taskId);
    } else if (task.status === 'failed') {
      resp.error = task.error;
      tasks.delete(taskId);
    }

    return ok(resp);
  });
}

module.exports = { registerAdminAiGiftRoutes };
