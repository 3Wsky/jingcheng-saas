const path = require('node:path');
const { loadLocalEnv } = require('./env');

const rootDir = path.resolve(__dirname, '..', '..');
loadLocalEnv(rootDir);

const isProduction = process.env.NODE_ENV === 'production';

const config = {
  rootDir,
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  dataDir: path.resolve(rootDir, process.env.DATA_DIR || 'data'),
  // 公网基址：用于把 /uploads/... 等相对路径拼成绝对 URL（后台 <img> 与小程序 <image> 均需绝对地址）。
  // 默认即生产地址；末尾斜杠会被去除。仅当显式设为空字符串时，才退回请求头 X-Forwarded-* 兜底推导。
  publicBaseUrl: String(
    process.env.PUBLIC_BASE_URL === undefined ? 'https://ok.xjshunwei.cn/sw-api' : process.env.PUBLIC_BASE_URL
  ).replace(/\/+$/, ''),
  priceTag: {
    dataDir: path.resolve(rootDir, process.env.PRICE_TAG_DATA_DIR || '../digital-price-tag-generator/public/data')
  },
  imageGen: {
    baseUrl: process.env.IMAGE_GEN_BASE_URL || process.env.STUDIO_IMAGE_BASE_URL || '',
    apiKey: process.env.IMAGE_GEN_API_KEY || process.env.STUDIO_IMAGE_API_KEY || '',
    model: process.env.AI_IMAGE_MODEL || process.env.STUDIO_IMAGE_MODEL || 'gpt-image-2',
    quality: (process.env.AI_IMAGE_QUALITY || 'medium').toLowerCase(),
    timeoutMs: Number(process.env.AI_IMAGE_TIMEOUT_MS || 300000),
    get configured() {
      return Boolean(this.baseUrl && this.apiKey);
    }
  },
  legacy: {
    appKey: process.env.CRMEB_APP_KEY || 'app_key_69e81b63719a8',
    tokenLeewaySeconds: Number(process.env.CRMEB_TOKEN_LEEWAY_SECONDS || 60),
    mysql: {
      host: process.env.CRMEB_DB_HOST || '127.0.0.1',
      port: Number(process.env.CRMEB_DB_PORT || 3306),
      user: process.env.CRMEB_DB_USER || 'root',
      password: process.env.CRMEB_DB_PASSWORD || 'root',
      database: process.env.CRMEB_DB_NAME || 'crmeb',
      prefix: process.env.CRMEB_DB_PREFIX || 'eb_',
      charset: process.env.CRMEB_DB_CHARSET || 'utf8mb4',
      connectionLimit: Number(process.env.CRMEB_DB_CONNECTION_LIMIT || 10)
    }
  },
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'shunwei2026',
    sessionSecret: process.env.ADMIN_SESSION_SECRET || 'local-dev-shunwei-admin-secret',
    sessionMaxAgeSeconds: Number(process.env.ADMIN_SESSION_MAX_AGE || 60 * 60 * 8)
  },
  internal: {
    token: process.env.SHUNWEI_INTERNAL_TOKEN || 'local-dev-internal-token'
  }
};

validateConfig(config);

function validateConfig(currentConfig) {
  if (!isProduction) return;

  const required = [
    'CRMEB_APP_KEY',
    'CRMEB_DB_HOST',
    'CRMEB_DB_USER',
    'CRMEB_DB_PASSWORD',
    'CRMEB_DB_NAME',
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD',
    'ADMIN_SESSION_SECRET'
  ];

  const missing = required.filter((key) => !String(process.env[key] || '').trim());
  if (missing.length) {
    throw new Error(`Missing required production env vars: ${missing.join(', ')}`);
  }

  if (currentConfig.admin.sessionSecret.length < 24) {
    throw new Error('ADMIN_SESSION_SECRET must be at least 24 characters in production');
  }

  if (currentConfig.admin.password.length < 10) {
    throw new Error('ADMIN_PASSWORD must be at least 10 characters in production');
  }

  // SHUNWEI_INTERNAL_TOKEN 保护 /api/internal/membership/pay-callback 这类会直接发放会员+积分的
  // 服务间回调。不在此处 throw（避免线上若历史上确实未配置、一改就把启动打挂），
  // 但必须响亮地警告：默认值/未设置等于任何人都能猜到密钥，会被拿来白领会员权益。
  // claim-gift 目前已加真实订单校验兜底，这里仍应尽快在生产 .env 配置一个随机值并与 CRMEB 侧同步。
  if (!process.env.SHUNWEI_INTERNAL_TOKEN || currentConfig.internal.token === 'local-dev-internal-token') {
    // eslint-disable-next-line no-console
    console.warn(
      '[security][WARN] SHUNWEI_INTERNAL_TOKEN 未设置或仍为文档默认值 "local-dev-internal-token"。' +
      '请在生产 .env 设置一个随机长字符串，并同步更新 CRMEB 侧 .env 的同名变量，否则 /api/internal/* 回调鉴权形同虚设。'
    );
  }
}

module.exports = { config };
