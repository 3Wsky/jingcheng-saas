const { getPool } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

class AdminAuditService {
  async write(params) {
    const {
      adminUsername = '',
      action,
      targetType = '',
      targetId = '',
      payload = null,
      resultStatus = 'success',
      resultMessage = '',
      ip = ''
    } = params;

    const now = Math.floor(Date.now() / 1000);
    try {
      await getPool().query(
        `INSERT INTO ${swTable('admin_audit_log')}
         (admin_username, action, target_type, target_id, payload_json, result_status, result_message, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          adminUsername,
          action,
          targetType,
          String(targetId),
          payload ? JSON.stringify(payload) : null,
          resultStatus,
          resultMessage,
          ip,
          now
        ]
      );
    } catch (error) {
      if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
    }
  }
}

function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return request.ip || '';
}

module.exports = { AdminAuditService, getClientIp };
