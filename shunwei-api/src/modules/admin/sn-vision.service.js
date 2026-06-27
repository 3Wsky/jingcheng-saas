const { config } = require('../../shared/config');
const { AiImageService } = require('../ai-image/ai-image.service');
const { isMiniappConfigured, printedTextOcr } = require('../wechat/wechat-mp.service');

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

function parseSnImeiFromText(text) {
  const raw = String(text || '').replace(/\s+/g, ' ');
  let sn = '';
  let imei = '';

  const imeiLabel = raw.match(/IMEI[^0-9A-Za-z]{0,6}(\d{15})/i);
  const imeiBare = raw.match(/\b(\d{15})\b/);
  if (imeiLabel) imei = imeiLabel[1];
  else if (imeiBare) imei = imeiBare[1];

  const snPatterns = [
    /S\/N[^0-9A-Za-z]{0,6}([A-Z0-9]{8,20})/i,
    /\bSN[^0-9A-Za-z]{0,4}([A-Z0-9]{8,20})/i,
    /序列号[^0-9A-Za-z]{0,6}([A-Z0-9]{8,20})/i,
    /Serial[^0-9A-Za-z]{0,6}([A-Z0-9]{8,20})/i
  ];
  for (const pattern of snPatterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      sn = match[1].toUpperCase();
      break;
    }
  }

  if (!sn) {
    const candidates = raw.match(/\b([A-Z0-9]{10,12})\b/g) || [];
    for (const candidate of candidates) {
      if (candidate !== imei && !/^\d+$/.test(candidate)) {
        sn = candidate;
        break;
      }
    }
  }

  return { sn, imei, brand: '', model: '' };
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
        raw: text,
        source: 'ai'
      };
    }
  } catch {
    /* fall through */
  }
  const fallback = parseSnImeiFromText(text);
  return { ...fallback, raw: text, source: 'ai' };
}

async function recogniseViaAi(buffer, mime) {
  const service = await getVisionChannel();
  if (!isVisionConfigured(service)) return null;

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
    signal: AbortSignal.timeout(Math.min(Number(config.imageGen.timeoutMs || 30000), 45000))
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`AI 识别失败(${resp.status}): ${text.slice(0, 200)}`);
  }

  const result = await resp.json();
  const content = result?.choices?.[0]?.message?.content || '';
  return parseVisionContent(content);
}

async function recogniseViaWechatOcr(buffer, mime) {
  const ocr = await printedTextOcr(buffer, mime);
  const text = (ocr.items || []).map((item) => String(item.text || '')).join('\n');
  const parsed = parseSnImeiFromText(text);
  return { ...parsed, raw: text, source: 'wechat_ocr' };
}

async function getRecognitionCapabilities() {
  const service = await getVisionChannel();
  return {
    aiVision: isVisionConfigured(service),
    wechatOcr: await isMiniappConfigured()
  };
}

function isAiAuthError(message) {
  return /401|403|invalid_api_key|Incorrect API key|authentication/i.test(String(message || ''));
}

function friendlyError(message, fallback) {
  const raw = String(message || '');
  if (isAiAuthError(raw)) return 'AI 识别密钥无效，已尝试其他识别方式';
  if (raw.length > 120) return fallback || '识别失败，请手动输入 SN';
  return raw || fallback || '识别失败';
}

async function recogniseSnFromImage({ buffer, mime = 'image/jpeg' }) {
  if (!buffer || !buffer.length) {
    const err = new Error('图片为空');
    err.statusCode = 400;
    throw err;
  }

  const caps = await getRecognitionCapabilities();
  if (!caps.aiVision && !caps.wechatOcr) {
    const err = new Error('识别服务未配置（需配置 IMAGE_GEN_API_KEY 或微信小程序凭证）');
    err.statusCode = 503;
    throw err;
  }

  let aiError = null;

  if (caps.aiVision) {
    try {
      const aiResult = await recogniseViaAi(buffer, mime);
      if (aiResult && (aiResult.sn || aiResult.imei)) return aiResult;
      if (aiResult && !caps.wechatOcr) return aiResult;
    } catch (err) {
      aiError = err;
      if (!caps.wechatOcr) {
        const msg = friendlyError(err.message, 'AI 识别失败');
        throw Object.assign(new Error(msg), { statusCode: 502 });
      }
    }
  }

  if (caps.wechatOcr) {
    try {
      return await recogniseViaWechatOcr(buffer, mime);
    } catch (ocrErr) {
      const msg = friendlyError(aiError?.message || ocrErr.message, '识别失败，请手动输入 SN');
      throw Object.assign(new Error(msg), { statusCode: 502 });
    }
  }

  const err = new Error(friendlyError(aiError?.message, '识别失败，请手动输入 SN'));
  err.statusCode = 502;
  throw err;
}

module.exports = {
  getVisionChannel,
  isVisionConfigured,
  getRecognitionCapabilities,
  recogniseSnFromImage,
  parseVisionContent,
  parseSnImeiFromText
};
