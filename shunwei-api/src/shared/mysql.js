const mysql = require('mysql2/promise');
const { config } = require('./config');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.legacy.mysql.host,
      port: config.legacy.mysql.port,
      user: config.legacy.mysql.user,
      password: config.legacy.mysql.password,
      database: config.legacy.mysql.database,
      charset: config.legacy.mysql.charset,
      waitForConnections: true,
      connectionLimit: config.legacy.mysql.connectionLimit,
      namedPlaceholders: true
    });
  }

  return pool;
}

function legacyTable(name) {
  return `\`${config.legacy.mysql.prefix}${name}\``;
}

function isDatabaseConnectionError(error) {
  return [
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ER_ACCESS_DENIED_ERROR',
    'ER_BAD_DB_ERROR'
  ].includes(error && error.code);
}

module.exports = { getPool, legacyTable, isDatabaseConnectionError };
