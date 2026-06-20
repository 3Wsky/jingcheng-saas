const fs = require('node:fs/promises');
const path = require('node:path');
const { createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { nanoid } = require('nanoid');
const { ok, fail } = require('../../shared/http');
const { config } = require('../../shared/config');
const { requireAdmin } = require('./admin.auth');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']);
const MAX_BYTES = 5 * 1024 * 1024;

function extFromMime(mime) {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp'
  };
  return map[mime] || '.jpg';
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function registerAdminUploadRoutes(app) {
  app.post('/api/admin/upload/image', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    let data;
    try {
      data = await request.file({ limits: { fileSize: MAX_BYTES } });
    } catch (error) {
      if (String(error.message || '').includes('file too large')) {
        return fail(reply, 400, '图片不能超过 5MB');
      }
      return fail(reply, 400, '请选择要上传的图片');
    }

    if (!data) return fail(reply, 400, '请选择要上传的图片');

    const mime = String(data.mimetype || '').toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      return fail(reply, 400, '仅支持 jpg/png/gif/webp/bmp 图片');
    }

    const now = new Date();
    const subDir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
    const uploadRoot = path.join(config.dataDir, 'uploads');
    const targetDir = path.join(uploadRoot, subDir);
    await ensureDir(targetDir);

    const filename = `${nanoid(12)}${extFromMime(mime)}`;
    const absPath = path.join(targetDir, filename);
    await pipeline(data.file, createWriteStream(absPath));

    const url = `/uploads/${subDir}/${filename}`.replace(/\\/g, '/');
    return ok({ url, path: url }, '上传成功');
  });
}

module.exports = { registerAdminUploadRoutes };
