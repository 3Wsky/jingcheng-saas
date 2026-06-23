const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { requireAdmin, getAdminSession } = require('../admin/admin.auth');
const { AdminAuditService, getClientIp } = require('../admin/admin-audit.service');
const { WeworkService } = require('./wework.service');
const crypto = require('./wework-crypto');

// 从企微回调 XML 中提取标签值（企微 XML 结构固定，标签值多为 CDATA 或纯文本）
function pickTag(xml, tag) {
  if (!xml) return '';
  const re = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  return m ? (m[1] !== undefined ? m[1] : m[2] || '') : '';
}

const configSchema = z.object({
  enabled: z.boolean().optional(),
  corpId: z.string().trim().max(64).optional(),
  contactSecret: z.string().trim().max(128).optional(),
  agentId: z.string().trim().max(32).optional(),
  token: z.string().trim().max(64).optional(),
  encodingAesKey: z.string().trim().max(64).optional(),
  miniappAppId: z.string().trim().max(64).optional(),
  miniappPagePath: z.string().trim().max(128).optional(),
  welcomeText: z.string().trim().max(500).optional(),
  mappings: z.array(z.object({
    userid: z.string().trim().min(1).max(64),
    uid: z.coerce.number().int().positive(),
    name: z.string().trim().max(64).optional().default('')
  })).max(2000).optional()
});

function registerWeworkRoutes(app) {
  const audit = new AdminAuditService();

  // 企微回调以 text/xml 提交，注册原样字符串解析（幂等，重复注册会抛错则忽略）
  try {
    app.addContentTypeParser(['text/xml', 'application/xml'], { parseAs: 'string' }, (req, body, done) => done(null, body));
  } catch { /* already registered */ }

  // 回调：URL 验证（GET）
  app.get('/api/wework/callback', async (request, reply) => {
    const cfg = await WeworkService.readConfig();
    const { msg_signature: sig, timestamp, nonce, echostr } = request.query || {};
    if (!cfg.token || !cfg.encodingAesKey) {
      return reply.code(503).send('wework not configured');
    }
    if (!crypto.verifySignature(cfg.token, sig, timestamp, nonce, echostr)) {
      return reply.code(401).send('invalid signature');
    }
    try {
      const { message } = crypto.decrypt(cfg.encodingAesKey, echostr);
      return reply.type('text/plain').send(message);
    } catch (e) {
      return reply.code(400).send('decrypt failed');
    }
  });

  // 回调：接收事件（POST）
  app.post('/api/wework/callback', async (request, reply) => {
    const cfg = await WeworkService.readConfig();
    const { msg_signature: sig, timestamp, nonce } = request.query || {};
    if (!cfg.token || !cfg.encodingAesKey) {
      return reply.code(503).send('wework not configured');
    }
    const xmlBody = typeof request.body === 'string' ? request.body : '';
    const encrypt = pickTag(xmlBody, 'Encrypt');
    if (!encrypt || !crypto.verifySignature(cfg.token, sig, timestamp, nonce, encrypt)) {
      return reply.code(401).send('invalid signature');
    }

    let message = '';
    try {
      message = crypto.decrypt(cfg.encodingAesKey, encrypt).message;
    } catch {
      return reply.code(400).send('decrypt failed');
    }

    // 企微要求 5 秒内响应；耗时操作异步处理，先回 success
    reply.type('text/plain').send('success');

    try {
      const event = pickTag(message, 'Event');
      const changeType = pickTag(message, 'ChangeType');
      // 客户添加成员事件：add_external_contact
      if (event === 'change_external_contact' && changeType === 'add_external_contact') {
        const userId = pickTag(message, 'UserID'); // 被添加的企微成员（客户经理）
        const welcomeCode = pickTag(message, 'WelcomeCode');
        if (cfg.enabled && welcomeCode) {
          const spreadUid = WeworkService.resolveSpreadUid(cfg, userId);
          if (spreadUid > 0) {
            await WeworkService.sendWelcomeMsg(cfg, welcomeCode, spreadUid);
          }
          // 无映射则不发欢迎语（避免发了却带不上正确归属）
        }
      }
    } catch (e) {
      request.log?.error?.({ err: e }, 'wework welcome handle failed');
    }
    return reply;
  });

  // 管理后台：读取配置（脱敏）
  app.get('/api/admin/wework/config', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const cfg = await WeworkService.readConfig();
    return ok(WeworkService.maskConfig(cfg));
  });

  // 管理后台：保存配置（secret/aesKey 留空则保持原值）
  app.put('/api/admin/wework/config', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = configSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '参数错误', parsed.error.flatten());

    const current = await WeworkService.readConfig();
    const d = parsed.data;
    const next = {
      ...current,
      ...(d.enabled !== undefined ? { enabled: d.enabled } : {}),
      ...(d.corpId !== undefined ? { corpId: d.corpId } : {}),
      ...(d.agentId !== undefined ? { agentId: d.agentId } : {}),
      ...(d.token !== undefined ? { token: d.token } : {}),
      ...(d.miniappAppId !== undefined ? { miniappAppId: d.miniappAppId } : {}),
      ...(d.miniappPagePath !== undefined ? { miniappPagePath: d.miniappPagePath } : {}),
      ...(d.welcomeText !== undefined ? { welcomeText: d.welcomeText } : {}),
      ...(d.mappings !== undefined ? { mappings: d.mappings } : {})
    };
    // 敏感字段：仅当传入非空才覆盖，留空保持原值
    if (d.contactSecret) next.contactSecret = d.contactSecret;
    if (d.encodingAesKey) next.encodingAesKey = d.encodingAesKey;

    await WeworkService.writeConfig(next);
    await audit.write({
      adminUsername: getAdminSession(request)?.username || '',
      action: 'wework_config_update',
      targetType: 'config',
      targetId: 'wework',
      payload: { ...d, contactSecret: d.contactSecret ? '***' : undefined, encodingAesKey: d.encodingAesKey ? '***' : undefined },
      ip: getClientIp(request)
    });
    return ok(WeworkService.maskConfig(next), '企微配置已保存');
  });
}

module.exports = { registerWeworkRoutes };
