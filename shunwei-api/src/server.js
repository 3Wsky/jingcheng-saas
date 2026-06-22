const Fastify = require('fastify');
const cors = require('@fastify/cors');
const multipart = require('@fastify/multipart');
const fastifyStatic = require('@fastify/static');
const path = require('node:path');
const fs = require('node:fs/promises');
const { config } = require('./shared/config');
const { registerHealthRoutes } = require('./shared/health.routes');
const { registerAdminRoutes, registerAdminManagementRoutes } = require('./modules/admin/admin.routes');
const { registerAdminDashboardRoutes } = require('./modules/admin/admin-dashboard.routes');
const { registerAdminMembersRoutes } = require('./modules/admin/admin-members.routes');
const { registerAdminApprovalRoutes } = require('./modules/admin/admin-approval.routes');
const { registerStaffRoutes } = require('./modules/staff/staff.routes');
const { registerAdminStaffRoutes } = require('./modules/staff/admin-staff.routes');
const { registerAdminMerchantRoutes } = require('./modules/merchant/admin-merchant.routes');
const { registerAdminBatchGrantRoutes } = require('./modules/admin/admin-batch-grant.routes');
const { registerAdminAuditRoutes } = require('./modules/admin/admin-audit.routes');
const { registerAdminIntegralMallRoutes } = require('./modules/admin/admin-integral-mall.routes');
const { registerAdminAiGiftRoutes } = require('./modules/admin/admin-ai-gift.routes');
const { registerAdminCrmebProductRoutes } = require('./modules/admin/admin-crmeb-products.routes');
const { registerAdminUploadRoutes } = require('./modules/admin/admin-upload.routes');
const { registerAdminFinanceRoutes } = require('./modules/admin/admin-finance.routes');
const { registerAdminRecallRoutes } = require('./modules/admin/admin-recall.routes');
const { registerNewcomerLotteryRoutes } = require('./modules/newcomer-lottery/newcomer-lottery.routes');
const { registerProductRoutes } = require('./modules/products/products.routes');
const { registerUserProfileRoutes } = require('./modules/user-profile/user-profile.routes');
const { registerMembershipRoutes } = require('./modules/membership/membership.routes');
const { registerIntegralMallRoutes } = require('./modules/integral-mall/integral-mall.routes');
const { registerCashVoucherRoutes } = require('./modules/cash-voucher/cash-voucher.routes');
const { registerMerchantRoutes } = require('./modules/merchant/merchant.routes');
const { registerApprovalRoutes } = require('./modules/approval/approval.routes');
const { registerMiniappConfigRoutes } = require('./modules/miniapp/miniapp-config.routes');
const { parseLegacyToken } = require('./shared/legacy-token');

async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.logLevel
    }
  });

  await app.register(cors, {
    origin: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Authori-zation', 'Cb-lang'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  });

  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 }
  });

  await fs.mkdir(path.join(config.dataDir, 'uploads'), { recursive: true });

  await app.register(fastifyStatic, {
    root: path.join(config.dataDir, 'uploads'),
    prefix: '/uploads/',
    decorateReply: false
  });

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (request, body, done) => {
    done(null, body);
  });

  app.decorateRequest('auth', null);
  app.addHook('preHandler', async (request) => {
    const rawAuth = request.headers['authori-zation'] || request.headers.authorization || '';
    const token = String(rawAuth).replace(/^Bearer\s+/i, '').trim();
    const legacyAuth = parseLegacyToken(token);
    request.auth = {
      token,
      uid: legacyAuth ? legacyAuth.uid : null,
      legacyAuth
    };
  });

  registerHealthRoutes(app);
  registerAdminRoutes(app);
  registerAdminManagementRoutes(app);
  registerAdminDashboardRoutes(app);
  registerAdminMembersRoutes(app);
  registerAdminApprovalRoutes(app);
  registerStaffRoutes(app);
  registerAdminStaffRoutes(app);
  registerAdminMerchantRoutes(app);
  registerAdminBatchGrantRoutes(app);
  registerAdminAuditRoutes(app);
  registerAdminIntegralMallRoutes(app);
  registerAdminAiGiftRoutes(app);
  registerAdminCrmebProductRoutes(app);
  registerAdminUploadRoutes(app);
  registerAdminFinanceRoutes(app);
  registerAdminRecallRoutes(app);
  registerNewcomerLotteryRoutes(app);
  registerProductRoutes(app);
  registerUserProfileRoutes(app);
  registerMembershipRoutes(app);
  registerIntegralMallRoutes(app);
  registerCashVoucherRoutes(app);
  registerMerchantRoutes(app);
  registerApprovalRoutes(app);
  registerMiniappConfigRoutes(app);

  return app;
}

async function main() {
  const app = await buildServer();
  await app.listen({ port: config.port, host: config.host });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { buildServer };
