const { ok, fail } = require('../../shared/http');
const { getPool } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const {
  getRecognitionCapabilities,
  recogniseSnFromImage
} = require('./sn-vision.service');
const { getMiniappStatus, probeAccessToken } = require('../wechat/wechat-mp.service');

// SN 码绑定记录表（admin-r7 迁移）。生产若未手动执行该迁移，
// 绑定/查询接口一调用就会 Table doesn't exist 报错。这里在运行时幂等建表，
// 让接口自愈（与 merchant.routes.js 的 ensureSettlementColumns 同思路），无需手动 SSH 跑 SQL。
let _snBindingTableEnsured = false;
async function ensureSnBindingTable() {
  if (_snBindingTableEnsured) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ${swTable('sn_binding')} (
      id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      sn_code    VARCHAR(64) NOT NULL COMMENT 'SN 序列号',
      imei       VARCHAR(32) NOT NULL DEFAULT '' COMMENT 'IMEI 号（如有）',
      brand      VARCHAR(32) NOT NULL DEFAULT '' COMMENT '品牌',
      model      VARCHAR(64) NOT NULL DEFAULT '' COMMENT '型号',
      order_id   VARCHAR(64) NOT NULL DEFAULT '' COMMENT '关联订单号',
      uid        INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '操作人 UID',
      source     ENUM('scan','manual') NOT NULL DEFAULT 'scan' COMMENT '来源：扫码识别/手动输入',
      created_at INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '创建时间戳',
      UNIQUE KEY uk_sn (sn_code),
      KEY idx_order (order_id),
      KEY idx_uid (uid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SN 码绑定记录'
  `);
  _snBindingTableEnsured = true;
}

function registerSnScanRoutes(app) {
  app.get('/api/staff/scan-sn/status', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');
    const caps = await getRecognitionCapabilities();
    const wechat = await getMiniappStatus();
    const tokenProbe = await probeAccessToken();
    return ok({
      configured: caps.aiVision || caps.wechatOcr,
      mode: caps.mode,
      aiVision: caps.aiVision,
      aiChannelConfigured: caps.aiChannelConfigured,
      visionModels: caps.visionModels,
      wechatOcr: caps.wechatOcr,
      wechatAppIdPreview: wechat.appIdPreview,
      wechatCredentialSource: wechat.source,
      wechatKeysFound: wechat.keysFound,
      wechatConfigFile: wechat.configFile,
      wechatTokenOk: tokenProbe.ok,
      wechatTokenError: tokenProbe.ok ? '' : tokenProbe.error
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
      console.error('[scan-sn] recognise failed:', err.message);
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
      await ensureSnBindingTable();
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
      await ensureSnBindingTable();
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
