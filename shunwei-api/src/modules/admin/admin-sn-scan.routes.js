const { ok, fail } = require('../../shared/http');
const { getPool } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const {
  getRecognitionCapabilities,
  recogniseSnFromImage
} = require('./sn-vision.service');
const { getMiniappStatus } = require('../wechat/wechat-mp.service');

function registerSnScanRoutes(app) {
  app.get('/api/staff/scan-sn/status', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const caps = await getRecognitionCapabilities();
    const wechat = await getMiniappStatus();
    return ok({
      configured: caps.aiVision || caps.wechatOcr,
      mode: caps.mode,
      aiVision: caps.aiVision,
      aiChannelConfigured: caps.aiChannelConfigured,
      visionModels: caps.visionModels,
      wechatOcr: caps.wechatOcr,
      wechatAppIdPreview: wechat.appIdPreview,
      wechatCredentialSource: wechat.source
    });
  });

  app.post('/api/staff/scan-sn', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');

    let imageBuffer;
    let imageMime;
    try {
      const data = await request.file();
      if (!data) return fail(reply, 400, '请上传图片');
      imageBuffer = await data.toBuffer();
      if (!imageBuffer || !imageBuffer.length) return fail(reply, 400, '图片为空');
      imageMime = data.mimetype || 'image/jpeg';
    } catch (err) {
      return fail(reply, 400, '图片上传失败: ' + (err.message || ''));
    }

    try {
      const parsed = await recogniseSnFromImage({ buffer: imageBuffer, mime: imageMime });
      return ok(parsed);
    } catch (err) {
      if (err.statusCode === 503) return fail(reply, 503, err.message);
      if (err.name === 'TimeoutError') return fail(reply, 504, '识别超时，请重试');
      return fail(reply, err.statusCode || 502, err.message || '识别失败');
    }
  });

  app.post('/api/staff/sn-binding', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const body = request.body || {};
    const snCode = String(body.snCode || '').trim();
    const orderId = String(body.orderId || '').trim();

    if (!snCode) return fail(reply, 400, '请提供 SN 码');

    try {
      const now = Math.floor(Date.now() / 1000);
      await getPool().query(
        `INSERT INTO ${swTable('sn_binding')} (sn_code, imei, brand, model, order_id, uid, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE order_id = VALUES(order_id), uid = VALUES(uid)`,
        [
          snCode,
          String(body.imei || '').trim(),
          String(body.brand || '').trim(),
          String(body.model || '').trim(),
          orderId,
          request.auth.uid,
          body.source || 'scan',
          now
        ]
      );
      return ok({ snCode, orderId, boundAt: now }, 'SN 码绑定成功');
    } catch (err) {
      return fail(reply, 500, '绑定失败: ' + (err.message || ''));
    }
  });

  app.get('/api/staff/sn-bindings', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const page = Math.max(1, Number(request.query.page || 1));
    const limit = Math.min(50, Math.max(1, Number(request.query.limit || 20)));
    const offset = (page - 1) * limit;

    try {
      const [rows] = await getPool().query(
        `SELECT id, sn_code, imei, brand, model, order_id, uid, source, created_at
         FROM ${swTable('sn_binding')}
         WHERE uid = ?
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [request.auth.uid, limit, offset]
      );
      return ok({ list: rows, page, limit });
    } catch (err) {
      return fail(reply, 500, '查询失败: ' + (err.message || ''));
    }
  });
}

module.exports = { registerSnScanRoutes };
