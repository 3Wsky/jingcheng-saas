#!/usr/bin/env node
/**
 * 写入微信小程序凭证到 data/wechat-mp-config.json（优先级高于 .env 和 CRMEB）
 * 用法：node scripts/write-wechat-mp-config.js <appId> <appSecret>
 */
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const appId = String(process.argv[2] || '').trim();
  const appSecret = String(process.argv[3] || '').trim();
  if (!/^wx[a-f0-9]{16}$/i.test(appId)) {
    console.error('AppID 格式无效，应为 wx + 16位字符');
    process.exit(1);
  }
  if (appSecret.length < 32) {
    console.error('AppSecret 长度无效');
    process.exit(1);
  }

  const root = path.resolve(__dirname, '..');
  const target = path.join(root, 'data', 'wechat-mp-config.json');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    JSON.stringify({ appId, appSecret, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
  console.log('已写入', target);
  console.log('AppID:', appId.slice(0, 6) + '***' + appId.slice(-4));
  console.log('请执行: pm2 reload shunwei-api --update-env');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
