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
  priceTag: {
    dataDir: path.resolve(rootDir, process.env.PRICE_TAG_DATA_DIR || '../digital-price-tag-generator/public/data')
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
      connectionLimit: Number(process.env.CRMEB_DB_CONNECTION_LIMIT || 5)
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
}

module.exports = { config };
