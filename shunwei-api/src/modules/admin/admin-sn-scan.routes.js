const fs = require('node:fs/promises');
const path = require('node:path');
const { ok, fail } = require('../../shared/http');
const { config } = require('../../shared/config');
const { getPool } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

function registerSnScanRoutes(app) {
  app.post('/api/staff/scan-sn', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');

    const ch = config.imageGen;
    if (!ch.baseUrl || !ch.apiKey) {
      return fail(reply, 503, 'AI 视觉服务未配置');
    }

    let imageBase64, imageMime;
    try {
      const data = await request.file();
      if (!data) return fail(reply, 400, '请上传图片');
      const buf = await data.toBuffer();
      if (!buf || !buf.length) return fail(reply, 400, '图片为空');
      imageMime = data.mimetype || 'image/jpeg';
      imageBase64 = buf.toString('base64');
    } catch (err) {
      return fail(reply, 400, '图片上传失败: ' + (err.message || ''));
    }

    const dataUrl = `data:${imageMime};base64,${imageBase64}`;
    const baseUrl = String(ch.baseUrl).replace(/\/+$/, '');
    const apiUrl = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;

    try {
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ch.apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: '请识别这张图片中手机包装上的 SN（序列号）或 IMEI 号码。只返回 JSON 格式，不要其他说明文字。格式：{"sn": "识别到的SN码", "imei": "识别到的IMEI码", "brand": "品牌", "model": "型号"}。如果某个字段识别不到就填空字符串。'
              },
              {
                type: 'image_url',
                image_url: { url: dataUrl, detail: 'high' }
              }
            ]
          }]
        }),
        signal: AbortSignal.timeout(30000)
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        return fail(reply, 502, `AI 识别失败(${resp.status}): ${text.slice(0, 200)}`);
      }

      const result = await resp.json();
      const content = result?.choices?.[0]?.message?.content || '';

      let parsed;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { sn: '', imei: '', brand: '', model: '' };
      } catch {
        parsed = { sn: content.replace(/[^A-Za-z0-9]/g, '').slice(0, 30), imei: '', brand: '', model: '' };
      }

      return ok({
        sn: String(parsed.sn || '').trim(),
        imei: String(parsed.imei || '').trim(),
        brand: String(parsed.brand || '').trim(),
        model: String(parsed.model || '').trim(),
        raw: content
      });
    } catch (err) {
      if (err.name === 'TimeoutError') return fail(reply, 504, '识别超时，请重试');
      return fail(reply, 502, 'AI 识别失败: ' + (err.message || ''));
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
