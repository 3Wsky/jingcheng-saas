const { getPool } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const { ok, fail } = require('../../shared/http');
const { requireAdmin } = require('./admin.auth');

function registerAdminAuditRoutes(app) {
  app.get('/api/admin/audit-logs', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const page = Math.max(1, Number(request.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;

    const conditions = ['1=1'];
    const values = {};

    if (request.query.action) {
      conditions.push('action LIKE :action');
      values.action = `${request.query.action}%`;
    }
    if (request.query.adminUsername) {
      conditions.push('admin_username = :adminUsername');
      values.adminUsername = request.query.adminUsername;
    }
    if (request.query.targetType) {
      conditions.push('target_type = :targetType');
      values.targetType = request.query.targetType;
    }
    if (request.query.dateFrom) {
      conditions.push('created_at >= :dateFrom');
      values.dateFrom = Math.floor(new Date(`${request.query.dateFrom}T00:00:00`).getTime() / 1000);
    }
    if (request.query.dateTo) {
      conditions.push('created_at <= :dateTo');
      values.dateTo = Math.floor(new Date(`${request.query.dateTo}T23:59:59`).getTime() / 1000);
    }

    const where = conditions.join(' AND ');

    try {
      const [[countRow]] = await getPool().query(
        `SELECT COUNT(*) AS total FROM ${swTable('admin_audit_log')} WHERE ${where}`,
        values
      );
      const [rows] = await getPool().query(
        `SELECT id, admin_username, action, target_type, target_id, result_status,
                result_message, ip_address, created_at, payload_json
         FROM ${swTable('admin_audit_log')} WHERE ${where}
         ORDER BY id DESC LIMIT :limit OFFSET :offset`,
        { ...values, limit: pageSize, offset }
      );

      return ok({
        total: Number(countRow?.total || 0),
        page,
        pageSize,
        list: rows.map((r) => ({
          id: r.id,
          adminUsername: r.admin_username,
          action: r.action,
          targetType: r.target_type,
          targetId: r.target_id,
          resultStatus: r.result_status,
          resultMessage: r.result_message || '',
          ipAddress: r.ip_address || '',
          createdAt: Number(r.created_at),
          payloadPreview: r.payload_json ? String(r.payload_json).slice(0, 200) : ''
        }))
      });
    } catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE') {
        return ok({ total: 0, page, pageSize, list: [], hint: '请先执行 admin-r1 DDL' });
      }
      return fail(reply, 500, error.message || '审计日志加载失败');
    }
  });
}

module.exports = { registerAdminAuditRoutes };
