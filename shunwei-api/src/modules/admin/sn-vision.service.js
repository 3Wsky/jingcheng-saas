const { config } = require('../../shared/config');
const { AiImageService } = require('../ai-image/ai-image.service');

const VISION_MODEL = process.env.SN_VISION_MODEL || 'gpt-4o-mini';
const VISION_PROMPT =
  '请识别这张图片中手机包装上的 SN（序列号）或 IMEI 号码。只返回 JSON 格式，不要其他说明文字。格式：{"sn": "识别到的SN码", "imei": "识别到的IMEI码", "brand": "品牌", "model": "型号"}。如果某个字段识别不到就填空字符串。';

let aiImageService = null;

async function getVisionChannel() {
  if (!aiImageService) {
    aiImageService = new AiImageService();
  }
  await aiImageService.reloadFromFile().catch(() => {});
  return aiImageService;
}

function isVisionConfigured(service) {
  return Boolean(service && service.isConfigured());
}

function buildChatCompletionsUrl(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

function parseVisionContent(content) {
  const text = String(content || '');
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        sn: String(parsed.sn || '').trim(),
        imei: String(parsed.imei || '').trim(),
        brand: String(parsed.brand || '').trim(),
        model: String(parsed.model || '').trim(),
        raw: text
      };
    }
  } catch {
    /* fall through */
  }
  return {
    sn: text.replace(/[^A-Za-z0-9]/g, '').slice(0, 30),
    imei: '',
    brand: '',
    model: '',
    raw: text
  };
}

async function recogniseSnFromImage({ buffer, mime = 'image/jpeg' }) {
  const service = await getVisionChannel();
  if (!isVisionConfigured(service)) {
    const err = new Error('AI 视觉服务未配置');
    err.statusCode = 503;
    throw err;
  }

  const channel = service.channel;
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  const apiUrl = buildChatCompletionsUrl(channel.baseUrl);

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channel.apiKey}`
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(Number(config.imageGen.timeoutMs || 30000))
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`AI 识别失败(${resp.status}): ${text.slice(0, 200)}`);
    err.statusCode = 502;
    throw err;
  }

  const result = await resp.json();
  const content = result?.choices?.[0]?.message?.content || '';
  return parseVisionContent(content);
}

module.exports = {
  getVisionChannel,
  isVisionConfigured,
  recogniseSnFromImage,
  parseVisionContent
};
