const { config } = require('../../shared/config');
const { getPool, legacyTable } = require('../../shared/mysql');

const MP_API = 'https://api.weixin.qq.com';
const MAX_OCR_BYTES = 2 * 1024 * 1024;

/** 仅小程序凭证 — 不用 wechat_appid（多为公众号，会导致 40013 invalid appid） */
const APP_ID_KEYS = ['routine_appId', 'routine_app_id'];
const APP_SECRET_KEYS = ['routine_appsecret', 'routine_app_secret'];

let tokenCache = { token: '', expireAt: 0, appId: '' };

const WECHAT_OCR_ERRORS = {
  40001: '小程序 AppSecret 无效，请检查 CRMEB 后台「小程序 AppSecret」或 WECHAT_MP_SECRET',
  40013: '小程序 AppID 无效，请检查 CRMEB 后台「小程序 AppID」(routine_appId)，不要用公众号 AppID',
  40125: '小程序 AppSecret 无效（40125）',
  41001: '缺少 access_token，请检查小程序凭证',
  45009: '微信 OCR 今日调用次数已达上限（100次/天）',
  85014: '小程序未开通 OCR 能力，请在微信公众平台开通',
  85015: '小程序 OCR 权限不足',
  '-1': '微信系统繁忙，请稍后重试'
};

function isValidWxAppId(appId) {
  return /^wx[a-f0-9]{16}$/i.test(String(appId || '').trim());
}

function isValidAppSecret(secret) {
  const value = String(secret || '').trim();
  return value.length >= 32;
}

function pickByKeys(map, keys) {
  for (const key of keys) {
    if (map[key]) return map[key];
  }
  const entries = Object.entries(map);
  for (const key of keys) {
    const lk = key.toLowerCase();
    const hit = entries.find(([k]) => k.toLowerCase() === lk);
    if (hit && hit[1]) return hit[1];
  }
  return '';
}

async function readCrmebMiniappCredentials() {
  try {
    const table = legacyTable('system_config');
    const [rows] = await getPool().query(
      `SELECT parameter, menu_name, value FROM ${table}
       WHERE parameter IN (?, ?, ?, ?)
          OR menu_name IN (?, ?, ?, ?)`,
      [...APP_ID_KEYS, ...APP_SECRET_KEYS, ...APP_ID_KEYS, ...APP_SECRET_KEYS]
    );

    const map = {};
    for (const row of rows) {
      const keys = [row.parameter, row.menu_name]
        .map((item) => String(item || '').trim())
        .filter(Boolean);
      const value = String(row.value || '').trim();
      if (!value) continue;
      for (const key of keys) {
        map[key] = value;
      }
    }

    const appId = pickByKeys(map, APP_ID_KEYS);
    const appSecret = pickByKeys(map, APP_SECRET_KEYS);

    return {
      appId: isValidWxAppId(appId) ? appId : '',
      appSecret: isValidAppSecret(appSecret) ? appSecret : '',
      source: 'crmeb',
      debugKeysFound: Object.keys(map)
    };
  } catch {
    return { appId: '', appSecret: '', source: 'crmeb', debugKeysFound: [] };
  }
}

function getEnvCredentials() {
  const appId = String(process.env.WECHAT_MP_APPID || process.env.WECHAT_APPID || '').trim();
  const appSecret = String(process.env.WECHAT_MP_SECRET || process.env.WECHAT_APPSECRET || '').trim();
  return {
    appId: isValidWxAppId(appId) ? appId : '',
    appSecret: isValidAppSecret(appSecret) ? appSecret : '',
    source: isValidWxAppId(appId) ? 'env' : ''
  };
}

async function getMiniappCredentials() {
  const env = getEnvCredentials();
  if (env.appId && env.appSecret) return env;
  const crmeb = await readCrmebMiniappCredentials();
  if (crmeb.appId && crmeb.appSecret) return crmeb;
  return { appId: '', appSecret: '', source: '', debugKeysFound: crmeb.debugKeysFound || [] };
}

async function getMiniappStatus() {
  const cred = await getMiniappCredentials();
  return {
    configured: Boolean(cred.appId && cred.appSecret),
    appIdPreview: cred.appId ? `${cred.appId.slice(0, 6)}***${cred.appId.slice(-4)}` : '',
    source: cred.source || '',
    keysFound: cred.debugKeysFound || []
  };
}

async function isMiniappConfigured() {
  const cred = await getMiniappCredentials();
  return Boolean(cred.appId && cred.appSecret);
}

function mapWechatError(data) {
  const code = data?.errcode;
  const hint = WECHAT_OCR_ERRORS[code] || WECHAT_OCR_ERRORS[String(code)];
  if (hint) return hint;
  return `微信 OCR 失败：${code || 'unknown'} ${data?.errmsg || ''}`.trim();
}

async function getAccessToken(force = false) {
  const now = Math.floor(Date.now() / 1000);
  const { appId, appSecret, debugKeysFound } = await getMiniappCredentials();

  if (!force && tokenCache.token && tokenCache.expireAt - 300 > now && tokenCache.appId === appId) {
    return tokenCache.token;
  }

  if (!appId || !appSecret) {
    const keysHint = debugKeysFound?.length ? `（库中找到字段：${debugKeysFound.join(', ')}）` : '';
    const err = new Error(
      `微信小程序凭证未配置或格式无效${keysHint}。请在 CRMEB 后台配置 routine_appId / routine_appsecret，或在服务器 .env 设置 WECHAT_MP_APPID / WECHAT_MP_SECRET`
    );
    err.statusCode = 503;
    throw err;
  }

  const url = `${MP_API}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
  const data = await resp.json();
  if (!data.access_token) {
    const err = new Error(mapWechatError(data) || `获取微信 access_token 失败：${data.errcode || ''} ${data.errmsg || ''}`.trim());
    err.statusCode = 502;
    throw err;
  }

  tokenCache = {
    token: data.access_token,
    expireAt: now + Number(data.expires_in || 7200),
    appId
  };
  return tokenCache.token;
}

async function printedTextOcr(buffer, mime = 'image/jpeg') {
  if (!buffer || !buffer.length) {
    const err = new Error('图片为空');
    err.statusCode = 400;
    throw err;
  }
  if (buffer.length > MAX_OCR_BYTES) {
    const err = new Error('图片超过 2MB，微信 OCR 无法处理，请重新拍摄或选择更小的图片');
    err.statusCode = 400;
    throw err;
  }

  const token = await getAccessToken();
  const form = new FormData();
  const ext = mime.includes('png') ? 'png' : 'jpg';
  form.append('img', new Blob([buffer], { type: mime }), `scan.${ext}`);

  const url = `${MP_API}/cv/ocr/commocr?access_token=${encodeURIComponent(token)}`;
  const resp = await fetch(url, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(20000)
  });
  const data = await resp.json();
  if (data.errcode && data.errcode !== 0) {
    if (data.errcode === 40001 || data.errcode === 42001) {
      tokenCache = { token: '', expireAt: 0, appId: '' };
    }
    const err = new Error(mapWechatError(data));
    err.statusCode = 502;
    throw err;
  }
  return data;
}

module.exports = {
  getMiniappCredentials,
  getMiniappStatus,
  isMiniappConfigured,
  getAccessToken,
  printedTextOcr,
  MAX_OCR_BYTES,
  isValidWxAppId
};
