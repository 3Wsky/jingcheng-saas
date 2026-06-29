#!/usr/bin/env node
/**
 * 诊断微信小程序 access_token（不消耗 OCR 配额）
 * 用法: node scripts/diagnose-wechat-token.js
 *
 * 注意：刻意不以 "test" 开头命名，避免被 `node --test` 当作单元测试
 * 自动执行（无凭证时会 exit 1，曾导致 CI 部署被阻断）。
 */
require('../src/shared/env');
const { getMiniappStatus, probeAccessToken } = require('../src/modules/wechat/wechat-mp.service');

(async () => {
  const status = await getMiniappStatus();
  console.log('=== 凭证状态 ===');
  console.log(JSON.stringify(status, null, 2));

  console.log('\n=== Token 探测 ===');
  const probe = await probeAccessToken();
  console.log(JSON.stringify(probe, null, 2));

  process.exit(probe.ok ? 0 : 1);
})().catch((err) => {
  console.error('诊断失败:', err.message);
  process.exit(1);
});
