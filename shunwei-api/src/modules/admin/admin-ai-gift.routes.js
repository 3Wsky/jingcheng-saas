const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { requireAdmin, getAdminSession } = require('./admin.auth');
const { AdminAuditService, getClientIp } = require('./admin-audit.service');
const { AiImageService } = require('../ai-image/ai-image.service');

// 门店礼品 AI 采集：上传实拍 → gpt-image-2 生成干净电商主图 + 竖版详情图。
// 提示词统一强调「保持照片中真实商品的造型/颜色/型号/品牌标识不变」，仅净化背景与优化打光，
// 避免模型凭空改造商品；并禁止任何文字/水印（gpt-image 中文字易乱码）。
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

function registerAdminAiGiftRoutes(app) {
  const audit = new AdminAuditService();
  const aiImage = new AiImageService();

  app.get('/api/admin/integral-mall/ai-gift/status', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return ok({
      configured: aiImage.isConfigured(),
      model: aiImage.model
    });
  });

  app.post('/api/admin/integral-mall/ai-gift/generate', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = generateSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, 'AI 生成参数错误', parsed.error.flatten());

    if (!aiImage.isConfigured()) {
      return fail(reply, 503, 'AI 生图服务未配置，请在后端 .env 设置 IMAGE_GEN_BASE_URL / IMAGE_GEN_API_KEY 后重试');
    }

    const { photo, productName, storePrice, multiplier, detailCount, quality } = parsed.data;

    try {
      const reference = await aiImage.loadImageInput(photo);

      // 1) 干净电商主图（图生图，1:1）
      const mainResults = await aiImage.edit({
        prompt: MAIN_PROMPT(productName),
        image: reference,
        aspectRatio: '1:1',
        count: 1,
        quality
      });
      const main = mainResults[0];

      // 2) 详情长图（竖版 2:3）— 以刚生成的干净主图为参考，保证一致性
      const detailRef = { buffer: main.buffer, mime: main.mime };
      const detailImages = [];
      for (let i = 0; i < detailCount; i += 1) {
        const prompt = DETAIL_PROMPTS[i % DETAIL_PROMPTS.length];
        const res = await aiImage.edit({
          prompt,
          image: detailRef,
          aspectRatio: '2:3',
          count: 1,
          quality
        });
        detailImages.push(res[0].url);
      }

      const suggestedIntegral = computeSuggestedIntegral(storePrice, multiplier);
      const description = buildDescriptionHtml(detailImages);

      const session = getAdminSession(request);
      await audit.write({
        adminUsername: session?.username || '',
        action: 'integral_mall_ai_gift_generate',
        targetType: 'product',
        targetId: 0,
        payload: { productName, storePrice, multiplier, detailCount, mainImage: main.url, detailCount: detailImages.length },
        ip: getClientIp(request)
      }).catch(() => {});

      return ok({
        mainImage: main.url,
        sliderImages: [main.url, ...detailImages],
        detailImages,
        description,
        storePrice,
        multiplier,
        marketPrice: storePrice,
        suggestedIntegral,
        model: aiImage.model
      }, 'AI 生成完成');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || 'AI 生成失败');
    }
  });
}

module.exports = { registerAdminAiGiftRoutes };
