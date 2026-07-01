/**
 * 「收据码为什么在产品库命中不了」深度探针 —— 只读，绝不写库
 *
 * 背景：diagnose-auto-approval 显示开关已开、产品库有 1937 条、店长已审、码没被占用，
 *      但绝大多数单子的收据 IMEI/SN「命中 0 个」。本探针对最近这些【未命中】的码逐个刨根：
 *   对每个收据码，尝试 4 种方式在 sw_sn_catalog 里找它，判定到底属于哪种情况：
 *     A) sn_norm 精确命中     —— 本该命中（若线上没命中说明归一化口径有别）
 *     B) imei1_norm 精确命中  —— 码其实是以 IMEI 存的，但收据标成了 SN（列错位/标签错）
 *     C) 仅 LIKE 模糊命中(raw)—— 库里有这台，但存的字符串和收据不完全一致（空格/大小写/多余字符）
 *     D) 四路全不中          —— 这台设备根本不在产品库（覆盖缺失/型号没导这批）
 *
 * 用法（服务器 shunwei-api 目录，已配置生产 .env）：
 *   node scripts/probe-code-mismatch.js            # 最近 25 单里的所有码
 *   node scripts/probe-code-mismatch.js 56 54 52   # 指定 requestId
 */
const { getPool } = require('../src/shared/mysql');
const { swTable } = require('../src/shared/sw-mysql');
const { SnCatalogService } = require('../src/modules/admin/sn-catalog.service');
const { ApprovalCodeUsageService } = require('../src/modules/approval/approval-code-usage.service');

function parseArgs(argv) {
  const ids = [];
  let limit = 25;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--limit') { limit = Math.max(1, Number(argv[i + 1]) || 25); i += 1; continue; }
    const n = Number(argv[i]);
    if (Number.isInteger(n) && n > 0) ids.push(n);
  }
  return { ids, limit };
}

async function fetchRequests(pool, ids, limit) {
  if (ids.length) {
    const [rows] = await pool.query(
      `SELECT id, request_no, receipt_no, status FROM ${swTable('approval_request')} WHERE id IN (?) ORDER BY id DESC`,
      [ids]
    );
    return rows;
  }
  const [rows] = await pool.query(
    `SELECT id, request_no, receipt_no, status FROM ${swTable('approval_request')}
     WHERE biz_type = 'consumption_grant' ORDER BY id DESC LIMIT ?`,
    [limit]
  );
  return rows;
}

/** 4 路探测一个码在库里的处境 */
async function probeCode(pool, code, type) {
  const raw = String(code || '').trim();
  const snNorm = SnCatalogService.normalizeSn(raw);
  const imeiNorm = SnCatalogService.normalizeImei(raw);

  // A) sn_norm 精确
  const [[bySn]] = await pool.query(
    `SELECT model, sn_code, imei1 FROM ${swTable('sn_catalog')} WHERE sn_norm = ? LIMIT 1`,
    [snNorm]
  );
  // B) imei1_norm 精确
  const [[byImei]] = imeiNorm
    ? await pool.query(`SELECT model, sn_code, imei1 FROM ${swTable('sn_catalog')} WHERE imei1_norm = ? LIMIT 1`, [imeiNorm])
    : [[null]];
  // C) LIKE 模糊（去掉两端各留核心，找"包含"的行）——只在精确都没中时才查，避免噪声
  let byLike = null;
  if (!bySn && !byImei && raw.length >= 6) {
    const core = raw.replace(/\s+/g, '');
    const [rows] = await pool.query(
      `SELECT model, sn_code, imei1 FROM ${swTable('sn_catalog')}
       WHERE REPLACE(sn_code,' ','') LIKE ? OR REPLACE(imei1,' ','') LIKE ? LIMIT 1`,
      [`%${core}%`, `%${core}%`]
    );
    byLike = rows[0] || null;
  }

  let verdict; let detail = '';
  if (bySn) { verdict = 'A·sn精确命中'; detail = `→ 型号「${bySn.model}」（线上却判未命中，需查归一化口径）`; }
  else if (byImei) { verdict = 'B·实为IMEI(收据标成SN)'; detail = `→ 该码以 IMEI 存在库中：型号「${byImei.model}」(imei1=${byImei.imei1})`; }
  else if (byLike) { verdict = 'C·仅模糊命中'; detail = `→ 库里疑似同机：型号「${byLike.model}」(sn=${byLike.sn_code || '-'} imei1=${byLike.imei1 || '-'})，但字符串和收据不完全一致`; }
  else { verdict = 'D·根本不在库'; detail = '→ 这台设备产品库里查无（覆盖缺失）'; }

  return { raw, type, snNorm, imeiNorm, verdict, detail, hasSn: !!bySn, hasImei: !!byImei };
}

async function main() {
  const { ids, limit } = parseArgs(process.argv.slice(2));
  const pool = getPool();
  const tally = { A: 0, B: 0, C: 0, D: 0 };
  let codeTotal = 0;

  try {
    console.log('==================== 收据码 vs 产品库 深度探针 ====================');
    const requests = await fetchRequests(pool, ids, limit);
    for (const r of requests) {
      const codes = ApprovalCodeUsageService.parseCodes(r.receipt_no || '');
      if (!codes.length) continue;
      console.log(`\n#${r.id} (${r.request_no || '-'}) [${r.status}]  收据: ${r.receipt_no}`);
      for (const c of codes) {
        // eslint-disable-next-line no-await-in-loop
        const p = await probeCode(pool, c.raw, c.type);
        codeTotal += 1;
        tally[p.verdict[0]] += 1;
        console.log(`   码 ${p.raw} (收据标为${p.type === 'imei1' ? 'IMEI' : 'SN'})  归一SN=${p.snNorm} 归一IMEI=${p.imeiNorm || '-'}`);
        console.log(`     ${p.verdict}  ${p.detail}`);
      }
    }

    console.log('\n\n==================== 汇总（这批码的处境分布） ====================');
    console.log(`  共探测 ${codeTotal} 个码：`);
    console.log(`  A·sn精确命中        : ${tally.A}  ${tally.A ? '(这些线上却判未命中→归一化口径可疑)' : ''}`);
    console.log(`  B·实为IMEI标成SN    : ${tally.B}  ${tally.B ? '(★收据把IMEI填进了SN，lookup只查sn_norm故漏→可修代码兼容)' : ''}`);
    console.log(`  C·仅模糊命中        : ${tally.C}  ${tally.C ? '(★库里有这台但字符串不一致：空格/大小写/多余字符)' : ''}`);
    console.log(`  D·根本不在库        : ${tally.D}  ${tally.D ? '(产品库没导这批设备→数据覆盖问题，需补导)' : ''}`);
    console.log('\n判读：');
    console.log('  · 若 B 多  → 收据码规范/识别把 IMEI 当成了 SN；可让 lookup 对 SN 也回退查 imei1（代码侧修）。');
    console.log('  · 若 C 多  → 归一化没覆盖某些字符；对齐清洗规则即可。');
    console.log('  · 若 D 多  → 就是产品库没这批货，得把管家婆最新设备表导全（数据侧）。');
    console.log('  · 若 A 有  → 线上判未命中但库里精确有，属归一化/大小写口径 bug，需重点修。');
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
