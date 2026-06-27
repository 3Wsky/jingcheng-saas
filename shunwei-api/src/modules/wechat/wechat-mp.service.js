const { config } = require('../../shared/config');
const { getPool, legacyTable } = require('../../shared/mysql');

const MP_API = 'https://api.weixin.qq.com';
let tokenCache = { token: '', expireAt: 0 };

async function readCrmebMiniappCredentials() {
  try {
    const table = legacyTable('system_config');
    const [rows] = await getPool().query(
      `SELECT menu_name, value FROM ${table}
       WHERE menu_name IN (
         'routine_appId', 'routine_appsecret',
         'wechat_appid', 'wechat_appsecret',
         'routine_app_id', 'routine_app_secret'
       ) OR menu_name LIKE '%routine%app%' OR menu_name LIKE '%wechat%app%'`
    );
    const map = Object.fromEntries(
      rows.map((row) => [String(row.menu_name || '').trim(), String(row.value || '').trim()])
    );

    const findValue = (...keys) => {
      for (const key of keys) {
        if (map[key]) return map[key];
      }
      const lowerEntries = Object.entries(map);
      for (const key of keys) {
        const lk = key.toLowerCase();
        const hit = lowerEntries.find(([k]) => k.toLowerCase() === lk);
        if (hit && hit[1]) return hit[1];
      }
      return '';
    };

    return {
      appId: findValue('routine_appId', 'routine_app_id', 'wechat_appid'),
      appSecret: findValue('routine_appsecret', 'routine_app_secret', 'wechat_appsecret')
    };
  } catch {
    return { appId: '', appSecret: '' };
  }
}

function getEnvCredentials() {
  return {
    appId: String(process.env.WECHAT_MP_APPID || process.env.WECHAT_APPID || '').trim(),
    appSecret: String(process.env.WECHAT_MP_SECRET || process.env.WECHAT_APPSECRET || '').trim()
  };
}

async function getMiniappCredentials() {
  const env = getEnvCredentials();
  if (env.appId && env.appSecret) return env;
  const crmeb = await readCrmebMiniappCredentials();
  if (crmeb.appId && crmeb.appSecret) return crmeb;
  return { appId: '', appSecret: '' };
}

async function isMiniappConfigured() {
  const cred = await getMiniappCredentials();
  return Boolean(cred.appId && cred.appSecret);
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.expireAt - 300 > now) {
    return tokenCache.token;
  }

  const { appId, appSecret } = await getMiniappCredentials();
  if (!appId || !appSecret) {
    const err = new Error('微信小程序凭证未配置');
    err.statusCode = 503;
    throw err;
  }

  const url = `${MP_API}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
  const data = await resp.json();
  if (!data.access_token) {
    const err = new Error(`获取微信 access_token 失败：${data.errcode || ''} ${data.errmsg || ''}`.trim());
    err.statusCode = 502;
    throw err;
  }

  tokenCache = {
    token: data.access_token,
    expireAt: now + Number(data.expires_in || 7200)
  };
  return tokenCache.token;
}

async function printedTextOcr(buffer, mime = 'image/jpeg') {
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
    const err = new Error(`微信 OCR 失败：${data.errcode} ${data.errmsg || ''}`.trim());
    err.statusCode = 502;
    throw err;
  }
  return data;
}

module.exports = {
  getMiniappCredentials,
  isMiniappConfigured,
  getAccessToken,
  printedTextOcr
};
