const { config } = require('../../shared/config');
const { AiImageService } = require('../ai-image/ai-image.service');
const { isMiniappConfigured, printedTextOcr } = require('../wechat/wechat-mp.service');

const VISION_PROMPT =
  '请识别这张图片中手机包装上的 SN（序列号）或 IMEI 号码。只返回 JSON 格式，不要其他说明文字。格式：{"sn": "识别到的SN码", "imei": "识别到的IMEI码", "brand": "品牌", "model": "型号"}。如果某个字段识别不到就填空字符串。';

let aiImageService = null;

function getVisionMode() {
  const mode = String(process.env.SN_VISION_MODE || 'auto').trim().toLowerCase();
  if (['auto', 'wechat', 'ai', 'wechat_first', 'ai_first', 'wechat_only', 'ai_only'].includes(mode)) {
    return mode;
  }
  return 'auto';
}

/** 逗号分隔；未配置则不走 AI 视觉（生图密钥 gpt-image-2 不能用于 chat/completions） */
function getVisionModels() {
  const raw = process.env.SN_VISION_MODELS || process.env.SN_VISION_MODEL || '';
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

async function getVisionChannel() {
  if (!aiImageService) {
    aiImageService = new AiImageService();
  }
  await aiImageService.reloadFromFile().catch(() => {});
  return aiImageService;
}

function isChannelConfigured(service) {
  return Boolean(service && service.isConfigured());
}

function isAiVisionEnabled(service) {
  return isChannelConfigured(service) && getVisionModels().length > 0;
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

function parseVisionContent(content, model) {
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
        source: 'ai',
        visionModel: model || ''
      };
    }
  } catch {
    /* fall through */
  }
  const fallback = parseSnImeiFromText(text);
  return { ...fallback, raw: text, source: 'ai', visionModel: model || '' };
}

function isModelUnsupportedError(message) {
  return /model.*not.*found|does not exist|unsupported|not support|invalid model|no such model|model_not_found/i.test(
    String(message || '')
  );
}

function isAiAuthError(message) {
  return /401|403|invalid_api_key|Incorrect API key|authentication/i.test(String(message || ''));
}

function friendlyError(message, fallback) {
  const raw = String(message || '');
  if (isAiAuthError(raw)) return 'AI 识别密钥无效，已尝试其他识别方式';
  if (isModelUnsupportedError(raw)) return '当前 AI 模型不支持图片识别，已尝试其他识别方式';
  if (raw.length > 120) return fallback || '识别失败，请手动输入 SN';
  return raw || fallback || '识别失败';
}

async function callVisionModel(channel, model, buffer, mime) {
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  const apiUrl = buildChatCompletionsUrl(channel.baseUrl);

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channel.apiKey}`
    },
    body: JSON.stringify({
      model,
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
    throw new Error(`AI 识别失败(${resp.status})[${model}]: ${text.slice(0, 200)}`);
  }

  const result = await resp.json();
  const content = result?.choices?.[0]?.message?.content || '';
  return parseVisionContent(content, model);
}

async function recogniseViaAi(buffer, mime) {
  const service = await getVisionChannel();
  if (!isAiVisionEnabled(service)) return null;

  const channel = service.channel;
  const models = getVisionModels();
  let lastError = null;

  for (const model of models) {
    try {
      const parsed = await callVisionModel(channel, model, buffer, mime);
      if (parsed && (parsed.sn || parsed.imei || models.length === 1)) {
        return parsed;
      }
      if (parsed) return parsed;
    } catch (err) {
      lastError = err;
      const msg = String(err.message || '');
      if (isModelUnsupportedError(msg)) continue;
      if (isAiAuthError(msg)) throw err;
      continue;
    }
  }

  if (lastError) throw lastError;
  return null;
}

async function recogniseViaWechatOcr(buffer, mime) {
  const ocr = await printedTextOcr(buffer, mime);
  const text = (ocr.items || []).map((item) => String(item.text || '')).join('\n');
  const parsed = parseSnImeiFromText(text);
  return { ...parsed, raw: text, source: 'wechat_ocr' };
}

async function getRecognitionCapabilities() {
  const service = await getVisionChannel();
  const models = getVisionModels();
  return {
    mode: getVisionMode(),
    aiChannelConfigured: isChannelConfigured(service),
    aiVision: isAiVisionEnabled(service),
    visionModels: models,
    wechatOcr: await isMiniappConfigured()
  };
}

function shouldPreferWechatFirst(mode) {
  return mode === 'auto' || mode === 'wechat' || mode === 'wechat_first' || mode === 'wechat_only';
}

function shouldUseAi(mode, caps) {
  if (mode === 'wechat_only' || mode === 'wechat') return false;
  if (mode === 'ai_only' || mode === 'ai' || mode === 'ai_first') return caps.aiVision;
  return caps.aiVision;
}

function shouldUseWechat(mode, caps) {
  if (mode === 'ai_only' || mode === 'ai') return false;
  return caps.wechatOcr;
}

async function recogniseSnFromImage({ buffer, mime = 'image/jpeg' }) {
  if (!buffer || !buffer.length) {
    const err = new Error('图片为空');
    err.statusCode = 400;
    throw err;
  }

  const caps = await getRecognitionCapabilities();
  const mode = caps.mode;
  const useAi = shouldUseAi(mode, caps);
  const useWechat = shouldUseWechat(mode, caps);

  if (!useAi && !useWechat) {
    const err = new Error(
      caps.aiChannelConfigured && !caps.visionModels.length
        ? '未配置 SN 视觉模型（SN_VISION_MODEL）；当前网关仅支持生图，请使用微信 OCR 或配置视觉模型'
        : '识别服务未配置（需微信小程序凭证或 SN_VISION_MODEL）'
    );
    err.statusCode = 503;
    throw err;
  }

  const preferWechatFirst = shouldPreferWechatFirst(mode);
  const steps = preferWechatFirst
    ? [
        useWechat ? 'wechat' : null,
        useAi ? 'ai' : null
      ]
    : [
        useAi ? 'ai' : null,
        useWechat ? 'wechat' : null
      ];

  let lastError = null;

  for (const step of steps.filter(Boolean)) {
    try {
      if (step === 'wechat') {
        return await recogniseViaWechatOcr(buffer, mime);
      }
      const aiResult = await recogniseViaAi(buffer, mime);
      if (aiResult && (aiResult.sn || aiResult.imei)) return aiResult;
      if (aiResult && steps.length === 1) return aiResult;
    } catch (err) {
      lastError = err;
    }
  }

  const err = new Error(friendlyError(lastError?.message, '识别失败，请手动输入 SN'));
  err.statusCode = 502;
  throw err;
}

module.exports = {
  getVisionChannel,
  isVisionConfigured: isAiVisionEnabled,
  getRecognitionCapabilities,
  getVisionModels,
  recogniseSnFromImage,
  parseVisionContent,
  parseSnImeiFromText
};
