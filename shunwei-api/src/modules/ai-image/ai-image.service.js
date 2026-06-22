const fs = require('node:fs/promises');
const path = require('node:path');
const { nanoid } = require('nanoid');
const { config } = require('../../shared/config');

const VALID_QUALITIES = new Set(['low', 'medium', 'high', 'auto']);
const EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp'
};
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
};

function fail(status, message) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

class AiImageService {
  constructor(channel = config.imageGen) {
    this.channel = channel || {};
  }

  isConfigured() {
    return Boolean(this.channel.baseUrl && this.channel.apiKey);
  }

  get model() {
    return this.channel.model || 'gpt-image-2';
  }

  resolveQuality(explicit) {
    const q = String(explicit || this.channel.quality || 'medium').toLowerCase();
    return VALID_QUALITIES.has(q) ? q : 'medium';
  }

  normalizeBaseUrl() {
    const raw = String(this.channel.baseUrl || '').replace(/\/+$/, '');
    return raw.endsWith('/v1') ? raw : `${raw}/v1`;
  }

  // gpt-image 严格三档尺寸；其它模型按比例近似映射
  getImageSize(aspectRatio = '1:1') {
    const isGptImage = String(this.model).toLowerCase().includes('gpt-image');
    if (isGptImage) {
      if (aspectRatio === '1:1') return '1024x1024';
      if (['3:2', '4:3', '16:9'].includes(aspectRatio)) return '1536x1024';
      return '1024x1536';
    }
    const map = {
      '1:1': '1024x1024',
      '3:2': '1536x1024',
      '4:3': '1408x1056',
      '16:9': '1792x1024',
      '2:3': '1024x1536',
      '3:4': '1056x1408',
      '9:16': '1024x1792'
    };
    return map[aspectRatio] || '1024x1536';
  }

  // 把一张输入图（dataURI / http(s) URL / 本地 /uploads 路径）读成 { buffer, mime }
  async loadImageInput(input) {
    const raw = String(input || '').trim();
    if (!raw) throw fail(400, '缺少参考图片');

    if (raw.startsWith('data:')) {
      const match = /^data:([^;]+);base64,(.+)$/s.exec(raw);
      if (!match) throw fail(400, '参考图片 dataURI 格式不正确');
      return { buffer: Buffer.from(match[2], 'base64'), mime: match[1] || 'image/png' };
    }

    if (/^https?:\/\//i.test(raw)) {
      const dl = await this.downloadBuffer(raw);
      if (!dl) throw fail(400, '参考图片下载失败');
      return dl;
    }

    // 本地静态资源：/uploads/... → data/uploads/...
    const relative = raw.replace(/^\/+/, '');
    const absPath = path.join(config.dataDir, relative);
    const uploadsRoot = path.join(config.dataDir, 'uploads');
    const resolved = path.resolve(absPath);
    if (!resolved.startsWith(path.resolve(uploadsRoot))) {
      throw fail(400, '参考图片路径不合法');
    }
    try {
      const buffer = await fs.readFile(resolved);
      const mime = MIME_BY_EXT[path.extname(resolved).toLowerCase()] || 'image/png';
      return { buffer, mime };
    } catch {
      throw fail(400, '参考图片不存在或无法读取');
    }
  }

  async downloadBuffer(url) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!resp.ok) return null;
      const mime = (resp.headers.get('content-type') || 'image/png').split(';')[0].trim();
      const buffer = Buffer.from(await resp.arrayBuffer());
      return { buffer, mime };
    } catch {
      return null;
    }
  }

  // 把生成结果（{url} | {b64_json}）落地到 data/uploads/ai/YYYY/MM 下，返回 { url, buffer, mime }
  async persistResult(item) {
    let buffer = null;
    let mime = 'image/png';
    if (item?.b64_json) {
      buffer = Buffer.from(item.b64_json, 'base64');
    } else if (item?.url) {
      if (String(item.url).startsWith('data:')) {
        const loaded = await this.loadImageInput(item.url);
        buffer = loaded.buffer;
        mime = loaded.mime;
      } else {
        const dl = await this.downloadBuffer(item.url);
        if (!dl) throw fail(502, 'AI 生成图片下载失败');
        buffer = dl.buffer;
        mime = dl.mime;
      }
    }
    if (!buffer || !buffer.length) throw fail(502, 'AI 未返回可用图片');

    const now = new Date();
    const subDir = `ai/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
    const targetDir = path.join(config.dataDir, 'uploads', subDir);
    await fs.mkdir(targetDir, { recursive: true });
    const filename = `${nanoid(14)}${EXT_BY_MIME[mime] || '.png'}`;
    await fs.writeFile(path.join(targetDir, filename), buffer);
    const url = `/uploads/${subDir}/${filename}`.replace(/\\/g, '/');
    return { url, buffer, mime };
  }

  async callApi(endpoint, { body, form }) {
    const url = `${this.normalizeBaseUrl()}${endpoint}`;
    const timeoutMs = Number(this.channel.timeoutMs || 300000);
    const headers = { Authorization: `Bearer ${this.channel.apiKey}` };
    let payload;
    if (form) {
      payload = form; // fetch 自动带 multipart boundary
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: payload,
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          const retriable = [408, 429, 500, 502, 503, 504].includes(resp.status);
          const err = fail(resp.status === 401 || resp.status === 403 ? 502 : (resp.status >= 500 ? 502 : resp.status),
            `AI 生图接口返回 ${resp.status}：${text.slice(0, 200)}`);
          if (retriable && attempt < 2) { lastErr = err; continue; }
          throw err;
        }
        return await resp.json();
      } catch (error) {
        lastErr = error;
        const retriable = error.name === 'TimeoutError' || /fetch failed|network|ECONN|ETIMEDOUT/i.test(error.message || '');
        if (retriable && attempt < 2) continue;
        throw error.statusCode ? error : fail(502, `AI 生图调用失败：${error.message || error}`);
      }
    }
    throw lastErr || fail(502, 'AI 生图调用失败');
  }

  // 文生图
  async generate({ prompt, aspectRatio = '1:1', count = 1, quality } = {}) {
    if (!this.isConfigured()) throw fail(503, 'AI 生图服务未配置（IMAGE_GEN_BASE_URL / IMAGE_GEN_API_KEY）');
    const size = this.getImageSize(aspectRatio);
    const body = {
      model: this.model,
      prompt: String(prompt || '').slice(0, 4000),
      n: Math.max(1, Math.min(4, Number(count) || 1)),
      size
    };
    const q = this.resolveQuality(quality);
    if (String(this.model).toLowerCase().includes('gpt-image')) body.quality = q;
    const data = await this.callApi('/images/generations', { body });
    return this.collectImages(data);
  }

  // 图生图（参考图）— 用于把门店实拍处理成干净电商图
  async edit({ prompt, image, aspectRatio = '1:1', count = 1, quality } = {}) {
    if (!this.isConfigured()) throw fail(503, 'AI 生图服务未配置（IMAGE_GEN_BASE_URL / IMAGE_GEN_API_KEY）');
    if (!image?.buffer?.length) throw fail(400, '缺少参考图片');
    const size = this.getImageSize(aspectRatio);
    const isGptImage = String(this.model).toLowerCase().includes('gpt-image');
    const q = this.resolveQuality(quality);
    const sizeHint = `\n\n（输出图片尺寸必须为 ${size}，严格保持该画布比例，不要套用参考图的原始比例。）`;

    const form = new FormData();
    form.append('model', this.model);
    form.append('prompt', `${String(prompt || '').slice(0, 4000)}${sizeHint}`);
    form.append('n', String(Math.max(1, Math.min(4, Number(count) || 1))));
    form.append('size', size);
    if (isGptImage) form.append('quality', q);
    const ext = EXT_BY_MIME[image.mime] || '.png';
    form.append('image', new Blob([image.buffer], { type: image.mime || 'image/png' }), `reference${ext}`);

    const data = await this.callApi('/images/edits', { form });
    return this.collectImages(data);
  }

  async collectImages(data) {
    const list = Array.isArray(data?.data) ? data.data : [];
    const results = [];
    for (const item of list) {
      const persisted = await this.persistResult(item);
      results.push(persisted);
    }
    if (!results.length) throw fail(502, 'AI 未返回可用图片结果');
    return results;
  }
}

module.exports = { AiImageService };
