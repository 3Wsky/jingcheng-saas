/**
 * 「消费审批 · 管理员终审自动审核（免审）」为什么没生效 —— 只读诊断脚本（纯查询，绝不写库）
 *
 * 背景：后台/小程序打开「消费免审」后，规则应为：
 *   店员提交 → 店长初审通过 → 收据里的 IMEI1/SN 在产品库【全部命中且都没被别的单用过】
 *   → 系统自动完成超管终审并发放（免人工终审）。
 * 若"打开了却没自动通过"，无非几种原因：①开关没真正写进库 ②产品库为空/没导入
 *   ③收据里根本没有 IMEI/SN 码 ④码没有全部命中 ⑤码被别的单用过 ⑥店长还没初审。
 * 本脚本【复用线上同一套逻辑】(ApprovalService / SnCatalogService) 逐单回放"自动终审判定"，
 * 把每一单卡在哪一步一次性打印清楚。
 *
 * 用法（在服务器 shunwei-api 目录下，需已配置生产 .env）：
 *   node scripts/diagnose-auto-approval.js            # 诊断最近 20 单 + 全局开关/产品库体检
 *   node scripts/diagnose-auto-approval.js 56 51 40   # 只诊断指定 requestId
 *   node scripts/diagnose-auto-approval.js --limit 50 # 诊断最近 50 单
 */
const { getPool } = require('../src/shared/mysql');
const { swTable } = require('../src/shared/sw-mysql');
const { ApprovalService } = require('../src/modules/approval/approval.service');
const { SnCatalogService } = require('../src/modules/admin/sn-catalog.service');
const { ApprovalCodeUsageService } = require('../src/modules/approval/approval-code-usage.service');

function fmtTime(sec) {
  if (!sec) return '-';
  const d = new Date(Number(sec) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function parseArgs(argv) {
  const ids = [];
  let limit = 20;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--limit') { limit = Math.max(1, Number(argv[i + 1]) || 20); i += 1; continue; }
    const n = Number(a);
    if (Number.isInteger(n) && n > 0) ids.push(n);
  }
  return { ids, limit };
}

/** ① 全局开关体检：三个相关配置键 + 实际生效判定（isAutoPassByCodeEnabled 读的是哪个键） */
async function printSwitch(pool, approvalService) {
  console.log('\n==================== ① 免审开关体检（system_config） ====================');
  const [rows] = await pool.query(
    `SELECT config_key, config_value, updated_at FROM ${swTable('system_config')}
     WHERE config_key IN (
       'consumption_auto_pass_on_code_match',
       'consumption_approval_auto_pass',
       'approval_auto_pass_consumption',
       'integral_mall_skip_approval'
     ) ORDER BY config_key`
  );
  const map = {};
  rows.forEach((r) => { map[r.config_key] = r; });
  const show = (key, note) => {
    const r = map[key];
    const v = r ? r.config_value : '(键不存在)';
    const on = v === '1' || v === 'true';
    const flag = r ? (on ? '✅开' : '⛔关') : '⚪未写';
    console.log(`  ${flag}  ${key} = ${v}${r ? '  更新于 ' + fmtTime(r.updated_at) : ''}   ${note}`);
  };
  show('consumption_auto_pass_on_code_match', '← 【这个才是审批流真正读取的功能键】');
  show('consumption_approval_auto_pass', '（后台旧键，仅兼容）');
  show('approval_auto_pass_consumption', '（小程序旧键，仅兼容）');
  show('integral_mall_skip_approval', '（积分商城免审，与消费无关）');

  // 用线上同一函数判定"到底生不生效"
  const enabled = await approvalService.isAutoPassByCodeEnabled();
  console.log(`\n  >> 线上实际判定 isAutoPassByCodeEnabled() = ${enabled ? '✅ true（自动终审已启用）' : '❌ false（自动终审关闭 → 全程人工，这就是"没生效"的根因之一）'}`);
  if (!enabled) {
    console.log('     修复：后台 审批设置 打开「消费审批免审」，或小程序超管页打开「消费免审」；');
    console.log('           两处最终都会把 consumption_auto_pass_on_code_match 写为 1。');
  }
  return enabled;
}

/** ② 产品库体检：为空则任何码都命中不了，自动终审永远不触发 */
async function printCatalog(pool) {
  console.log('\n==================== ② SN/IMEI 产品库体检（sw_sn_catalog） ====================');
  try {
    const [[row]] = await pool.query(`SELECT COUNT(*) AS c FROM ${swTable('sn_catalog')}`);
    const c = Number(row.c || 0);
    if (c === 0) {
      console.log('  ❌ 产品库为空！收据里的 IMEI/SN 无从命中 → 自动终审永远不会触发。');
      console.log('     修复：后台「产品库(SN目录)」导入管家婆 xls（IMEI1/SN + 型号 + 价格）。');
    } else {
      console.log(`  ✅ 产品库共 ${c} 条设备记录。`);
    }
    return c;
  } catch (e) {
    console.log(`  ⚠️ 读取产品库失败：${e.message}（表可能尚未建，首次调用服务会自动建）`);
    return -1;
  }
}

/** 取要诊断的审批单：指定 id 优先；否则取最近 limit 单（重点是 admin_review 与最近 approved） */
async function pickRequests(pool, ids, limit) {
  if (ids.length) {
    const [rows] = await pool.query(
      `SELECT * FROM ${swTable('approval_request')} WHERE id IN (?) ORDER BY id DESC`,
      [ids]
    );
    return rows;
  }
  const [rows] = await pool.query(
    `SELECT * FROM ${swTable('approval_request')}
     WHERE biz_type = 'consumption_grant'
     ORDER BY id DESC LIMIT ?`,
    [limit]
  );
  return rows;
}

/** 取某单的店长(manager)步骤，判断是否已初审通过 */
async function getManagerStep(pool, requestId) {
  const [rows] = await pool.query(
    `SELECT action, comment, operator_uid, created_at FROM ${swTable('approval_step')}
     WHERE request_id = ? AND step_role = 'manager' ORDER BY id DESC LIMIT 1`,
    [requestId]
  );
  return rows[0] || null;
}

/** 逐单回放"自动终审"判定，打印卡点 */
async function diagnoseRequest(pool, req, ctx) {
  const { catalog, codeUsage, switchOn, catalogCount } = ctx;
  const rid = Number(req.id);
  const statusZh = {
    manager_review: '待店长初审',
    admin_review: '待超管终审',
    approved: '已通过',
    rejected: '已驳回',
    revoked: '已撤销'
  }[req.status] || req.status;

  console.log(`\n########## 审批单 #${rid} (${req.request_no || '-'}) ##########`);
  console.log(`会员uid=${req.customer_uid} | 提交人uid=${req.staff_uid} | 消费¥${Number(req.consumption_amount || 0)} | 档位=${req.matched_tier_code || '-'} | 应发券¥${Number(req.matched_voucher_amount || 0)} | 状态=${statusZh} | 提交=${fmtTime(req.created_at)}`);
  console.log(`收据串: ${req.receipt_no || '(空)'}`);

  // 店长步骤
  const mgr = await getManagerStep(pool, rid);
  if (mgr) {
    console.log(`店长步骤: ${mgr.action === 'approve' ? '✅已初审通过' : mgr.action}  操作人uid=${mgr.operator_uid} 于 ${fmtTime(mgr.created_at)}`);
  } else {
    console.log('店长步骤: ⚠️ 无（尚未初审——自动终审是在"店长初审通过"那一刻触发的）');
  }

  // 码命中情况（复用线上 verifyCodes）
  let verify = null;
  try {
    verify = await catalog.verifyCodes({ receiptNo: req.receipt_no || '' });
  } catch (e) {
    console.log(`码核对: ⚠️ 异常 ${e.message}`);
  }
  if (verify) {
    console.log(`码核对: 收据含码=${verify.hasCode ? '是' : '否'} | 解析出${verify.totalCodes}个码 | 命中${verify.matchedCount}个 | 全部命中=${verify.allMatched ? '✅是' : '❌否'}${verify.hit ? ' | 首个命中型号=' + (verify.hit.model || '-') : ''}`);
  }

  // 是否被别的单用过（排除自己）
  let reused = false;
  try {
    const usage = await codeUsage.checkUsable(req.receipt_no || '', { excludeRequestId: rid });
    reused = !usage.usable;
    if (reused) {
      const c = usage.conflicts[0];
      console.log(`码占用: ❌ 有码被别的单用过（${(c && (c.raw || c.norm)) || '-'} 被单#${(c && c.requestId) || '?'}）→ 不自动通过`);
    } else {
      console.log('码占用: ✅ 无冲突（没有码被别的单用过）');
    }
  } catch (e) {
    console.log(`码占用: ⚠️ 台账异常 ${e.message}`);
  }

  // 综合裁决：这单"能不能"自动终审
  console.log('--- 裁决：为什么（没）自动终审 ---');
  const reasons = [];
  if (!switchOn) reasons.push('免审开关未开启（isAutoPassByCodeEnabled=false）');
  if (catalogCount === 0) reasons.push('产品库为空，任何码都命中不了');
  if (verify && !verify.hasCode) reasons.push('收据里没有 IMEI/SN 码（自动终审只认码，无码必转人工）');
  if (verify && verify.hasCode && !verify.allMatched) reasons.push(`码没有全部命中（${verify.matchedCount}/${verify.totalCodes}），按安全口径必须全命中才自动放行`);
  if (reused) reasons.push('有码已被别的单用过');
  if (!mgr || mgr.action !== 'approve') reasons.push('店长尚未初审通过（触发点在店长通过那一刻）');

  if (req.status === 'approved') {
    // 已通过：看是不是系统自动通过的
    const [adminSteps] = await pool.query(
      `SELECT operator_uid, comment, created_at FROM ${swTable('approval_step')}
       WHERE request_id = ? AND step_role = 'admin' AND action = 'approve' ORDER BY id DESC LIMIT 1`,
      [rid]
    );
    const a = adminSteps[0];
    if (a && /自动终审|按 ?IMEI\/SN|系统/.test(String(a.comment || ''))) {
      console.log(`  ✅ 本单已【系统自动终审】通过（${fmtTime(a.created_at)}）："${a.comment}"`);
    } else if (a) {
      console.log(`  🟦 本单已通过，但是【人工终审】（操作人uid=${a.operator_uid}${a.comment ? '，备注：' + a.comment : ''}）——不是自动的。`);
      if (reasons.length) console.log('     若期望自动通过却走了人工，可能当时：' + reasons.join('；'));
    } else {
      console.log('  🟦 本单已通过（无 admin 步骤记录，可能为历史数据）。');
    }
  } else if (req.status === 'admin_review') {
    if (reasons.length) {
      console.log('  ❌ 卡在待终审、未自动通过，原因：\n     - ' + reasons.join('\n     - '));
    } else {
      console.log('  ⚠️ 所有前置条件看起来都满足，却仍停在 admin_review —— 建议重点排查：店长通过时 tryAutoPassByCode 是否抛错被吞（看 PM2 日志），或开关是在店长通过之后才打开的（对存量单不追溯）。');
    }
  } else if (req.status === 'manager_review') {
    console.log('  ⏳ 还没到店长初审通过，自动终审尚未到触发时机。' + (reasons.filter((r) => !/店长/.test(r)).length ? ' 另注意：' + reasons.filter((r) => !/店长/.test(r)).join('；') : ''));
  } else {
    console.log(`  —— 状态=${statusZh}，不涉及自动终审。`);
  }
}

async function main() {
  const { ids, limit } = parseArgs(process.argv.slice(2));
  const pool = getPool();
  const approvalService = new ApprovalService();
  const catalog = new SnCatalogService();
  const codeUsage = new ApprovalCodeUsageService();

  try {
    const switchOn = await printSwitch(pool, approvalService);
    const catalogCount = await printCatalog(pool);

    console.log('\n==================== ③ 逐单回放自动终审判定 ====================');
    const requests = await pickRequests(pool, ids, limit);
    if (!requests.length) {
      console.log('（没有匹配的审批单）');
    } else {
      const ctx = { catalog, codeUsage, switchOn, catalogCount };
      for (const req of requests) {
        // eslint-disable-next-line no-await-in-loop
        await diagnoseRequest(pool, req, ctx);
      }
    }

    console.log('\n\n==================== 汇总口径 ====================');
    console.log('自动终审要「全部满足」才会触发：');
    console.log('  1) ①里 isAutoPassByCodeEnabled=true（开关真开）');
    console.log('  2) ②里 产品库非空');
    console.log('  3) 该单收据【有】IMEI/SN 码，且【全部命中】产品库');
    console.log('  4) 这些码【没有】被别的单用过');
    console.log('  5) 店长【已初审通过】（触发点就在这一刻）');
    console.log('任何一条不满足 → 自动降级为人工终审（停在 admin_review 等超管点）。');
    console.log('特别注意：开关是"店长通过那一刻"读取的，==对已经停在 admin_review 的存量单不会追溯自动通过==；');
    console.log('          想验证，请开好开关后，让店长【新审一单码全命中的】来看是否自动放行。');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
