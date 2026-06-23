const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('../../shared/config');

// 企业微信「客户联系」自动欢迎语服务
// 配置存 data/wework-config.json，可由管理后台在线填写（不写死、不改 .env）
const WEWORK_CONFIG_FILE = path.join(config.dataDir, 'wework-config.json');
const QYAPI = 'https://qyapi.weixin.qq.com/cgi-bin';

function defaultConfig() {
  return {
    enabled: false,
    corpId: '',
    contactSecret: '',
    agentId: '',
    token: '',
    encodingAesKey: '',
    miniappAppId: '',
    miniappPagePath: 'pages/index/index',
    welcomeText: '您好，欢迎成为我的专属客户，点击下方小程序领取会员权益～',
    // 成员↔客户经理 UID 映射：[{ userid: '企微成员userid', uid: CRMEB客户经理UID, name: '备注' }]
    mappings: []
  };
}

let _tokenCache = { token: '', expireAt: 0 };

class WeworkService {
  static async readConfig() {
    try {
      const raw = await fs.readFile(WEWORK_CONFIG_FILE, 'utf8');
      return { ...defaultConfig(), ...JSON.parse(raw) };
    } catch {
      return defaultConfig();
    }
  }

  static async writeConfig(cfg) {
    await fs.mkdir(path.dirname(WEWORK_CONFIG_FILE), { recursive: true });
    await fs.writeFile(WEWORK_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    // 配置变更后清掉 token 缓存，避免用旧 secret 的 token
    _tokenCache = { token: '', expireAt: 0 };
  }

  /** 解析被添加成员 userid → 客户经理 CRMEB UID（手动映射表） */
  static resolveSpreadUid(cfg, userId) {
    if (!userId) return 0;
    const list = Array.isArray(cfg.mappings) ? cfg.mappings : [];
    const hit = list.find((m) => String(m.userid).trim() === String(userId).trim());
    const uid = hit ? Number(hit.uid) : 0;
    return Number.isFinite(uid) && uid > 0 ? Math.floor(uid) : 0;
  }

  /** 获取 access_token（带 2h 缓存，提前 5 分钟过期刷新） */
  static async getAccessToken(cfg) {
    const now = Math.floor(Date.now() / 1000);
    if (_tokenCache.token && _tokenCache.expireAt - 300 > now) {
      return _tokenCache.token;
    }
    if (!cfg.corpId || !cfg.contactSecret) {
      throw new Error('企微未配置 corpId / 客户联系 Secret');
    }
    const url = `${QYAPI}/gettoken?corpid=${encodeURIComponent(cfg.corpId)}&corpsecret=${encodeURIComponent(cfg.contactSecret)}`;
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();
    if (data.errcode !== 0 || !data.access_token) {
      throw new Error(`获取企微 access_token 失败：${data.errcode} ${data.errmsg || ''}`);
    }
    _tokenCache = { token: data.access_token, expireAt: now + Number(data.expires_in || 7200) };
    return _tokenCache.token;
  }

  /**
   * 收到 add_external_contact 事件后，发送欢迎语（带小程序卡片，path 带 spread=该客户经理UID）
   * @param cfg 配置
   * @param welcomeCode 企微回调里的 WelcomeCode（20 秒内有效）
   * @param spreadUid 客户经理 CRMEB UID
   */
  static async sendWelcomeMsg(cfg, welcomeCode, spreadUid) {
    if (!welcomeCode) throw new Error('缺少 welcome_code');
    if (!cfg.miniappAppId) throw new Error('企微未配置小程序 appid');
    const token = await this.getAccessToken(cfg);
    const pagePath = `${cfg.miniappPagePath || 'pages/index/index'}?spread=${spreadUid}`;
    const body = {
      welcome_code: welcomeCode,
      text: { content: cfg.welcomeText || '欢迎～' },
      attachments: [
        {
          msgtype: 'miniprogram',
          miniprogram: {
            title: cfg.welcomeText ? cfg.welcomeText.slice(0, 30) : '专属会员权益',
            pic_media_id: cfg.miniappPicMediaId || '',
            appid: cfg.miniappAppId,
            page: pagePath
          }
        }
      ]
    };
    // 无封面图时移除 pic_media_id 字段（企微要求该字段不能为空字符串）
    if (!body.attachments[0].miniprogram.pic_media_id) {
      delete body.attachments[0].miniprogram.pic_media_id;
    }
    const url = `${QYAPI}/externalcontact/send_welcome_msg?access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.errcode !== 0) {
      throw new Error(`发送欢迎语失败：${data.errcode} ${data.errmsg || ''}`);
    }
    return { ok: true };
  }

  /** 脱敏配置（给前端读取用，secret/aeskey 只回显是否已配置） */
  static maskConfig(cfg) {
    return {
      enabled: !!cfg.enabled,
      corpId: cfg.corpId || '',
      agentId: cfg.agentId || '',
      token: cfg.token || '',
      miniappAppId: cfg.miniappAppId || '',
      miniappPagePath: cfg.miniappPagePath || 'pages/index/index',
      welcomeText: cfg.welcomeText || '',
      hasContactSecret: !!cfg.contactSecret,
      hasEncodingAesKey: !!cfg.encodingAesKey,
      mappings: Array.isArray(cfg.mappings) ? cfg.mappings : []
    };
  }
}

module.exports = { WeworkService, defaultConfig };
