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
const { ensureAdminHiddenMemberSchema } = require('./modules/admin/admin-members.service');
const { registerAdminApprovalRoutes } = require('./modules/admin/admin-approval.routes');
const { registerStaffRoutes } = require('./modules/staff/staff.routes');
const { registerAdminStaffRoutes } = require('./modules/staff/admin-staff.routes');
const { registerAdminMerchantRoutes } = require('./modules/merchant/admin-merchant.routes');
const { registerAdminBatchGrantRoutes } = require('./modules/admin/admin-batch-grant.routes');
const { registerAdminAuditRoutes } = require('./modules/admin/admin-audit.routes');
const { registerAdminIntegralMallRoutes } = require('./modules/admin/admin-integral-mall.routes');
const { runStartupBackfillSafe } = require('./modules/admin/integral-image-backfill');
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
const { ensureCashVoucherReversalSchema } = require('./modules/cash-voucher/cash-voucher-reversal.service');
const { registerMerchantRoutes } = require('./modules/merchant/merchant.routes');
const { registerApprovalRoutes } = require('./modules/approval/approval.routes');
const { registerMiniappConfigRoutes } = require('./modules/miniapp/miniapp-config.routes');
const { registerContentRoutes } = require('./modules/miniapp/content.routes');
const { registerHomepageRoutes } = require('./modules/miniapp/homepage.routes');
const { registerCouponLandingRoutes } = require('./modules/miniapp/coupon-landing.routes');
const { registerWeworkRoutes } = require('./modules/wework/wework.routes');
const { registerSnScanRoutes } = require('./modules/admin/admin-sn-scan.routes');
const { registerSnCatalogRoutes } = require('./modules/admin/sn-catalog.routes');
const { registerSuperuserRoutes } = require('./modules/admin/admin-superuser.routes');
const { parseLegacyToken } = require('./shared/legacy-token');

async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.logLevel
    }
  });

  // CORS 白名单：
  // 部署拓扑决定了「浏览器跨域」几乎不存在——后台(/fzlsaas)与 API(/sw-api) 同域(ok.xjshunwei.cn)、
  // VITE_API_BASE=/sw-api 即同源请求；小程序 WebView 走 Bearer token，请求要么无 Origin、要么是 servicewechat.com。
  // 因此生产默认即收窄为白名单（PUBLIC_BASE_URL 推导的站点源 + 微信），无需运维改服务器 .env：
  //   - 显式设 CORS_ORIGINS=https://a.com,https://b.com → 完全以它为准（运维可覆盖）
  //   - 未设 + 生产 → 用内置默认白名单（站点自身源 + 微信 servicewechat.com）
  //   - 未设 + 开发 → 反射全部来源（本地联调方便）
  // 三种情况都放行「无 Origin」（小程序 / 同源 / 服务端调用），确保不误伤。
  const explicitOrigins = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let siteOrigin = '';
  try {
    if (config.publicBaseUrl) siteOrigin = new URL(config.publicBaseUrl).origin;
  } catch { /* PUBLIC_BASE_URL 非法则忽略，不影响启动 */ }

  const defaultProdOrigins = [siteOrigin, 'https://servicewechat.com'].filter(Boolean);
  const corsAllowList = explicitOrigins.length
    ? explicitOrigins
    : (config.env === 'production' ? defaultProdOrigins : []);

  const corsOrigin = corsAllowList.length
    ? (origin, cb) => {
        // 无 Origin（小程序/同源/服务端调用）或命中白名单 → 放行；否则拒绝
        if (!origin || corsAllowList.includes(origin)) return cb(null, true);
        return cb(null, false);
      }
    : true;
  app.log.info(
    { corsMode: corsAllowList.length ? 'allowlist' : 'reflect', corsAllowList },
    '[cors] initialized'
  );
  await app.register(cors, {
    origin: corsOrigin,
    allowedHeaders: ['Content-Type', 'Authorization', 'Authori-zation', 'Cb-lang'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  });

  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 }
  });

  await fs.mkdir(path.join(config.dataDir, 'uploads'), { recursive: true });

  const uploadsRoot = path.join(config.dataDir, 'uploads');

  await app.register(fastifyStatic, {
    root: uploadsRoot,
    prefix: '/uploads/',
    decorateReply: false
  });

  // Nginx 对 .png/.jpg 等扩展名有 `location ~*` 正则规则，会截获所有带这些后缀的请求，
  // 不论路径前缀——/sw-api/uploads/xxx.png 和 /sw-api/api/uploads/xxx.png 均被拦截。
  // 因此提供 /api/file?p=uploads/... 路由：URL 路径不含文件后缀，Nginx 不会拦截。
  // 用 readFile（buffer）而非 createReadStream 发送，以设置 Content-Length；
  // 微信小程序 <image> 对 chunked 传输的图片可能不兼容。
  app.get('/api/file', async (request, reply) => {
    const p = String(request.query.p || '').trim();
    if (!p) return reply.code(400).send({ statusCode: 400, error: 'Missing p parameter' });

    const normalized = p.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized.startsWith('uploads/') || normalized.includes('..')) {
      return reply.code(400).send({ statusCode: 400, error: 'Invalid path' });
    }

    const filePath = path.join(config.dataDir, normalized);
    let buf;
    try {
      buf = await fs.readFile(filePath);
    } catch {
      return reply.code(404).send({ statusCode: 404, error: 'File not found' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png', '.gif': 'image/gif',
      '.webp': 'image/webp', '.bmp': 'image/bmp'
    };
    reply.type(mimeTypes[ext] || 'application/octet-stream');
    reply.header('Content-Length', buf.length);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(buf);
  });

  app.get('/api/image-proxy', async (request, reply) => {
    const raw = String(request.query.u || '').trim();
    if (!raw) return reply.code(400).send({ statusCode: 400, error: 'Missing u parameter' });

    let target;
    try {
      target = new URL(raw);
    } catch {
      return reply.code(400).send({ statusCode: 400, error: 'Invalid URL' });
    }

    const host = target.hostname.toLowerCase();
    const allowedImageHost = host === 'res.vmallres.com' || host.endsWith('.vmallres.com')
      || host === 'consumer.huawei.com' || host.endsWith('.consumer.huawei.com');
    if (target.protocol !== 'https:' || !allowedImageHost) {
      return reply.code(400).send({ statusCode: 400, error: 'Unsupported image host' });
    }

    let response;
    try {
      response = await fetch(target.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0 fzlsaas-image-proxy' },
        signal: AbortSignal.timeout(12000)
      });
    } catch {
      return reply.code(502).send({ statusCode: 502, error: 'Image fetch failed' });
    }

    if (!response.ok) {
      return reply.code(response.status).send({ statusCode: response.status, error: 'Image fetch failed' });
    }

    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) {
      return reply.code(415).send({ statusCode: 415, error: 'Not an image' });
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 8 * 1024 * 1024) {
      return reply.code(413).send({ statusCode: 413, error: 'Image too large' });
    }

    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) {
      return reply.code(413).send({ statusCode: 413, error: 'Image too large' });
    }

    reply.type(contentType);
    reply.header('Content-Length', buf.length);
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(buf);
  });

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (request, body, done) => {
    done(null, body);
  });

  // 基础安全响应头（全局，风险极低）：
  // - nosniff 防浏览器按内容嗅探而无视上传接口声明的 Content-Type（配合图片上传的 MIME 白名单）
  // - X-Frame-Options 防 /admin 登录页等被第三方站点 iframe 嵌套做点击劫持
  // - Referrer-Policy 减少跨站跳转时 URL 信息泄露
  // 不加 CSP：/admin 页面大量内联 <script>，盲上严格 CSP 极易在未充分回归下打挂后台，留作后续专项处理。
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
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
  registerContentRoutes(app);
  registerHomepageRoutes(app);
  registerCouponLandingRoutes(app);
  registerWeworkRoutes(app);
  registerSnScanRoutes(app);
  registerSnCatalogRoutes(app);
  registerSuperuserRoutes(app);

  return app;
}

async function main() {
  await ensureCashVoucherReversalSchema();
  await ensureAdminHiddenMemberSchema();
  const app = await buildServer();
  await app.listen({ port: config.port, host: config.host });
  console.log(`[shunwei-api] listening on ${config.host}:${config.port}`);
  // 启动后一次性自愈存量积分商品图片裸路径（非阻塞、吞错，不影响服务可用性）。
  runStartupBackfillSafe(app.log);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[shunwei-api] Fatal startup error:', error);
    process.exit(1);
  });
}

module.exports = { buildServer };
