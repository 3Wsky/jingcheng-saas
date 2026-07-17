const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('../../shared/config');
const { getPool, legacyTable } = require('../../shared/mysql');

const MP_API = 'https://api.weixin.qq.com';
const MAX_OCR_BYTES = 2 * 1024 * 1024;
const MINIAPP_CODE_PAGE_MAX_BYTES = 128;
const WECHAT_MP_CONFIG_FILE = path.join(config.dataDir, 'wechat-mp-config.json');

const APP_ID_KEYS = ['routine_appId', 'routine_app_id'];
const APP_SECRET_KEYS = ['routine_appsecret', 'routine_app_secret'];

let tokenCache = { token: '', expireAt: 0, appId: '' };
let fileConfigCache = { loadedAt: 0, data: null };

const WECHAT_OCR_ERRORS = {
  40001: '小程序 AppSecret 无效，请检查 AppSecret 配置',
  40013: '小程序 AppID 无效，请检查 AppID 是否与当前小程序一致',
  40125: '小程序 AppSecret 无效（40125）',
  40164: '服务器 IP 未加入微信公众平台白名单',
  41001: '缺少 access_token，请检查小程序凭证',
  41030: '目标页面尚未发布或页面路径不正确，请先发布包含该页面的小程序版本',
  40097: '小程序码参数无效，请检查页面路径',
  45009: '微信 OCR 今日调用次数已达上限（100次/天）',
  101002: '图片超过 2MB 或格式无法识别，请重新拍摄',
  101003: '微信 OCR 今日免费额度已用完（100次/天），可在微信服务平台购买',
  85015: '小程序 OCR 权限不足',
  '-1': '微信系统繁忙，请稍后重试'
};

function isValidWxAppId(appId) {
  return /^wx[a-f0-9]{16}$/i.test(String(appId || '').trim());
}

function isValidAppSecret(secret) {
  return String(secret || '').trim().length >= 32;
}

function maskAppId(appId) {
  const id = String(appId || '').trim();
  if (!id) return '';
  if (id.length <= 10) return `${id.slice(0, 4)}***`;
  return `${id.slice(0, 6)}***${id.slice(-4)}`;
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

async function readFileCredentials() {
  const now = Date.now();
  if (fileConfigCache.data && now - fileConfigCache.loadedAt < 5000) {
    return fileConfigCache.data;
  }
  try {
    const raw = await fs.readFile(WECHAT_MP_CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const appId = String(parsed.appId || parsed.appid || '').trim();
    const appSecret = String(parsed.appSecret || parsed.appsecret || parsed.secret || '').trim();
    const data = {
      appId: isValidWxAppId(appId) ? appId : '',
      appSecret: isValidAppSecret(appSecret) ? appSecret : '',
      source: 'file'
    };
    fileConfigCache = { loadedAt: now, data };
    return data;
  } catch {
    fileConfigCache = { loadedAt: now, data: { appId: '', appSecret: '', source: 'file' } };
    return fileConfigCache.data;
  }
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
  const fileCfg = await readFileCredentials();
  if (fileCfg.appId && fileCfg.appSecret) return fileCfg;

  const env = getEnvCredentials();
  if (env.appId && env.appSecret) return env;

  const crmeb = await readCrmebMiniappCredentials();
  if (crmeb.appId && crmeb.appSecret) return crmeb;

  return {
    appId: '',
    appSecret: '',
    source: '',
    debugKeysFound: crmeb.debugKeysFound || []
  };
}

async function getMiniappStatus() {
  const cred = await getMiniappCredentials();
  return {
    configured: Boolean(cred.appId && cred.appSecret),
    appIdPreview: maskAppId(cred.appId),
    source: cred.source || '',
    keysFound: cred.debugKeysFound || [],
    configFile: WECHAT_MP_CONFIG_FILE
  };
}

/** 探测 access_token 是否可用（不消耗 OCR 配额） */
async function probeAccessToken() {
  const cred = await getMiniappCredentials();
  if (!cred.appId || !cred.appSecret) {
    return { ok: false, error: '凭证未配置', appIdPreview: maskAppId(cred.appId), source: cred.source || '' };
  }
  try {
    await getAccessToken(true);
    return { ok: true, appIdPreview: maskAppId(cred.appId), source: cred.source || '' };
  } catch (err) {
    return {
      ok: false,
      error: err.message || '获取 access_token 失败',
      appIdPreview: maskAppId(cred.appId),
      source: cred.source || ''
    };
  }
}

async function isMiniappConfigured() {
  const cred = await getMiniappCredentials();
  return Boolean(cred.appId && cred.appSecret);
}

function mapWechatError(data, appId) {
  const code = data?.errcode;
  const hint = WECHAT_OCR_ERRORS[code] || WECHAT_OCR_ERRORS[String(code)];
  const idHint = appId ? `（AppID: ${maskAppId(appId)}）` : '';
  if (hint) return `${hint}${idHint}`;
  return `微信接口失败：${code || 'unknown'} ${data?.errmsg || ''}${idHint}`.trim();
}

async function getAccessToken(force = false) {
  const now = Math.floor(Date.now() / 1000);
  const cred = await getMiniappCredentials();
  const { appId, appSecret, source, debugKeysFound } = cred;

  if (!force && tokenCache.token && tokenCache.expireAt - 300 > now && tokenCache.appId === appId) {
    return tokenCache.token;
  }

  if (!appId || !appSecret) {
    const keysHint = debugKeysFound?.length ? `（CRMEB字段：${debugKeysFound.join(', ')}）` : '';
    const err = new Error(
      `微信小程序凭证未配置或格式无效${keysHint}。请写入 data/wechat-mp-config.json 或 .env 的 WECHAT_MP_APPID / WECHAT_MP_SECRET`
    );
    err.statusCode = 503;
    throw err;
  }

  const url = `${MP_API}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
  const data = await resp.json();
  if (!data.access_token) {
    const msg =
      mapWechatError(data, appId) || `获取 access_token 失败：${data.errcode || ''} ${data.errmsg || ''} [source:${source || 'unknown'}]`.trim();
    console.error('[wechat-mp] getAccessToken failed:', { errcode: data.errcode, errmsg: data.errmsg, source, appId: maskAppId(appId) });
    const err = new Error(msg);
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

async function getMiniappCode({ page, width = 430, envVersion = 'release' } = {}, retry = true) {
  const normalizedPage = String(page || '').trim().replace(/^\/+/, '');
  if (!normalizedPage || Buffer.byteLength(normalizedPage, 'utf8') > MINIAPP_CODE_PAGE_MAX_BYTES) {
    const err = new Error('小程序页面路径不能为空，且不能超过 128 字节');
    err.statusCode = 400;
    throw err;
  }
  if (!/^[A-Za-z0-9_\-/]+$/.test(normalizedPage)) {
    const err = new Error('小程序页面路径格式无效');
    err.statusCode = 400;
    throw err;
  }

  const token = await getAccessToken();
  const url = `${MP_API}/wxa/getwxacode?access_token=${encodeURIComponent(token)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: normalizedPage,
      width: Math.max(280, Math.min(1280, Number(width) || 430)),
      auto_color: false,
      line_color: { r: 0, g: 0, b: 0 },
      is_hyaline: false,
      env_version: ['release', 'trial', 'develop'].includes(envVersion) ? envVersion : 'release'
    }),
    signal: AbortSignal.timeout(20000)
  });

  const buffer = Buffer.from(await resp.arrayBuffer());
  const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
  if (resp.ok && contentType.startsWith('image/') && buffer.length) {
    return { buffer, mime: contentType.split(';')[0] || 'image/jpeg', page: normalizedPage };
  }

  let data = null;
  try { data = JSON.parse(buffer.toString('utf8')); } catch { /* 微信异常响应可能不是 JSON */ }
  if (retry && (data?.errcode === 40001 || data?.errcode === 42001)) {
    tokenCache = { token: '', expireAt: 0, appId: '' };
    return getMiniappCode({ page: normalizedPage, width, envVersion }, false);
  }

  const cred = await getMiniappCredentials();
  const err = new Error(mapWechatError(data || { errcode: resp.status, errmsg: buffer.toString('utf8').slice(0, 200) }, cred.appId));
  err.statusCode = 502;
  throw err;
}

async function printedTextOcr(buffer, mime = 'image/jpeg', retry = true) {
  if (!buffer || !buffer.length) {
    const err = new Error('图片为空');
    err.statusCode = 400;
    throw err;
  }
  if (buffer.length > MAX_OCR_BYTES) {
    const err = new Error('图片超过 2MB，请重新拍摄或选择更小的图片');
    err.statusCode = 400;
    throw err;
  }

  const token = await getAccessToken();
  const form = new FormData();
  const ext = mime.includes('png') ? 'png' : 'jpg';
  form.append('img', new Blob([buffer], { type: mime }), `scan.${ext}`);

  const url = `${MP_API}/cv/ocr/comm?access_token=${encodeURIComponent(token)}`;
  const resp = await fetch(url, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(20000)
  });
  const data = await resp.json();
  if (data.errcode && data.errcode !== 0) {
    const cred = await getMiniappCredentials();
    console.error('[wechat-mp] ocr/comm failed:', { errcode: data.errcode, errmsg: data.errmsg, appId: maskAppId(cred.appId) });
    if (retry && (data.errcode === 40001 || data.errcode === 42001)) {
      tokenCache = { token: '', expireAt: 0, appId: '' };
      return printedTextOcr(buffer, mime, false);
    }
    const err = new Error(mapWechatError(data, cred.appId));
    err.statusCode = 502;
    throw err;
  }
  return data;
}

module.exports = {
  getMiniappCredentials,
  getMiniappStatus,
  probeAccessToken,
  isMiniappConfigured,
  getAccessToken,
  getMiniappCode,
  printedTextOcr,
  MAX_OCR_BYTES,
  isValidWxAppId,
  WECHAT_MP_CONFIG_FILE
};
