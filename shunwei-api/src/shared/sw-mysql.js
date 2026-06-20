const { getPool } = require('./mysql');

/**
 * 顺为旁路表名（sw_ 前缀，非 CRMEB eb_ 前缀）
 */
function swTable(name) {
  return `\`sw_${name}\``;
}

module.exports = { swTable, getPool };
