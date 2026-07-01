/**
 * 全站「积分已发 / 现金券漏发」只读审计脚本（纯查询，绝不写库）
 *
 * 目的：一次性扫出**所有**满足"线下消费权益审批已通过、积分发了、但现金券没发(或少发)"
 *      的会员，避免只盯着 1858 这几个个案。
 *
 * 判定口径（只看 biz_type='consumption_grant' 且 status='approved' 的审批单）：
 *   对每一单，统计它实际产生的 approval_grant 现金券批次总额（source_id = 'APR{单号}'）。
 *   然后分三种情况归类：
 *     [类A·发放中断] 单里冻结的 matched_voucher_amount > 0，但实际 approval_grant 批次总额 < 冻结额
 *                    → 真·漏发/少发，属故障，需回填差额。
 *     [类B·配置为0] 单里冻结的 matched_voucher_amount = 0，但按"当前档位规则"重新匹配这笔消费额
 *                    本应有券（应发额>0）→ 提交时规则券额=0/未配，属配置漂移导致的漏发，
 *                    需先修规则、再对历史单按"当前规则应发额"回填。
 *     [正常] 冻结额>0 且实际已发 >= 冻结额；或 冻结额=0 且当前规则也判定无券。
 *
 * 注意：类A是"确定性漏发"（板上钉钉）；类B依赖"当前规则"作为应发口径，
 *      若你认为历史单应按历史规则，请以类B列出的单据人工确认应补金额。
 *
 * 用法（服务器 shunwei-api 目录，已配好生产 .env）：
 *   node scripts/audit-approval-voucher-gap.js              # 全量扫描
 *   node scripts/audit-approval-voucher-gap.js --limit 0    # 同上(0=不限)
 *   node scripts/audit-approval-voucher-gap.js --since 2026-01-01   # 仅审计该日期之后创建的单
 */
const { config } = require('../src/shared/config');

const SW = (name) => `sw_${name}`;

function fmtTime(sec) {
  if (!sec) return '-';
  const d = new Date(Number(sec) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function round2(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { since: 0 };
  const sinceIdx = args.indexOf('--since');
  if (sinceIdx >= 0 && args[sinceIdx + 1]) {
    const t = Date.parse(args[sinceIdx + 1] + 'T00:00:00');
    if (!Number.isNaN(t)) out.since = Math.floor(t / 1000);
  }
  return out;
}

/**
 * 复刻 approval.service.js 的 matchTierRule：
 * WHERE is_active=1 AND min_amount<=amount ORDER BY min_amount DESC LIMIT 1（不校验 max）。
 * 用当前规则给"应发券额"做基准。
 */
function matchRule(amount, rules) {
  const amt = Number(amount || 0);
  const candidates = rules
    .filter((r) => Number(r.is_active) === 1 && Number(r.min_amount) <= amt)
    .sort((a, b) => Number(b.min_amount) - Number(a.min_amount));
  return candidates[0] || null;
}

async function main() {
  const { since } = parseArgs();

  const mysqlCfg = config.legacy.mysql;
  const conn = await require('mysql2/promise').createConnection({
    host: mysqlCfg.host,
    port: mysqlCfg.port,
    user: mysqlCfg.user,
    password: mysqlCfg.password,
    database: mysqlCfg.database,
    charset: mysqlCfg.charset
  });
  const prefix = mysqlCfg.prefix;

  try {
    // 当前档位规则（做"应发券额"基准）
    const [rules] = await conn.query(
      `SELECT id, min_amount, max_amount, tier_code, voucher_amount, is_active
       FROM ${SW('tier_rule')}`
    );
    console.log('==================== 当前档位规则（应发券额基准）====================');
    if (!rules.length) console.log('⚠️ 档位规则表为空。');
    for (const r of rules.slice().sort((a, b) => Number(a.min_amount) - Number(b.min_amount))) {
      console.log(
        `#${r.id} | min¥${round2(r.min_amount)} max${r.max_amount == null ? '∞' : '¥' + round2(r.max_amount)} | ` +
        `${r.tier_code} | 券¥${round2(r.voucher_amount)} | ${Number(r.is_active) === 1 ? '启用' : '停用'}`
      );
    }

    // 全部已通过的消费权益审批单
    const whereSince = since ? 'AND r.created_at >= ?' : '';
    const params = since ? [since] : [];
    const [reqs] = await conn.query(
      `SELECT r.id, r.request_no, r.customer_uid, r.consumption_amount, r.matched_tier_code,
              r.matched_voucher_amount, r.matched_integral, r.created_at,
              u.nickname
       FROM ${SW('approval_request')} r
       LEFT JOIN ${prefix}user u ON u.uid = r.customer_uid
       WHERE r.biz_type = 'consumption_grant' AND r.status = 'approved' ${whereSince}
       ORDER BY r.id ASC`,
      params
    );

    console.log(`\n==================== 扫描 ${reqs.length} 张已通过的消费权益审批单 ====================`);
    if (!reqs.length) {
      console.log('（没有已通过的消费权益审批单）');
      return;
    }

    // 实际每单发放的 approval_grant 现金券总额：按 source_id='APR{id}' 汇总
    const [batchRows] = await conn.query(
      `SELECT source_id, SUM(total_amount) AS granted
       FROM ${SW('cash_voucher_batch')}
       WHERE source_type = 'approval_grant'
       GROUP BY source_id`
    );
    const grantedByApr = new Map();
    for (const b of batchRows) grantedByApr.set(String(b.source_id), round2(b.granted));

    const typeA = []; // 冻结>0 但实际发放<冻结（发放中断/少发）
    const typeB = []; // 冻结=0 但当前规则应发>0（配置漂移漏发）
    let normal = 0;

    for (const r of reqs) {
      const frozen = round2(r.matched_voucher_amount);
      const actual = grantedByApr.get(`APR${r.id}`) || 0;
      const ruleMatched = matchRule(r.consumption_amount, rules);
      const shouldByCurrentRule = ruleMatched ? round2(ruleMatched.voucher_amount) : 0;

      if (frozen > 0 && actual < frozen - 0.01) {
        typeA.push({ ...r, frozen, actual, gap: round2(frozen - actual) });
      } else if (frozen === 0 && shouldByCurrentRule > 0) {
        typeB.push({ ...r, frozen, actual, shouldByCurrentRule, ruleId: ruleMatched.id });
      } else {
        normal += 1;
      }
    }

    // ---- 类A ----
    console.log('\n\n========== 【类A·确定性漏发/少发】冻结应发券>0，但实际发放不足 ==========');
    if (!typeA.length) {
      console.log('✅ 无此类问题（凡是审批单记了应发券额的，都已按额发放）。');
    } else {
      console.log('uid(昵称) | 单# | 消费额 | 冻结应发券 | 实际已发 | 缺口 | 提交时间');
      let sumGap = 0;
      const uids = new Set();
      for (const x of typeA) {
        sumGap = round2(sumGap + x.gap);
        uids.add(x.customer_uid);
        console.log(
          `${x.customer_uid}(${x.nickname || '-'}) | #${x.id} | ¥${round2(x.consumption_amount)} | ` +
          `¥${x.frozen} | ¥${x.actual} | ¥${x.gap} | ${fmtTime(x.created_at)}`
        );
      }
      console.log(`\n小计：${typeA.length} 单 / ${uids.size} 人 / 应补现金券合计 ¥${sumGap}`);
      console.log('涉及 uid：' + [...uids].join(', '));
    }

    // ---- 类B ----
    console.log('\n\n========== 【类B·配置导致漏发】冻结券额=0，但按当前规则本应发券 ==========');
    if (!typeB.length) {
      console.log('✅ 无此类问题（所有冻结券额=0的单，按当前规则也确实无券）。');
    } else {
      console.log('uid(昵称) | 单# | 消费额 | 冻结应发券 | 当前规则应发 | 命中规则# | 提交时间');
      let sumShould = 0;
      const uids = new Set();
      for (const x of typeB) {
        sumShould = round2(sumShould + x.shouldByCurrentRule);
        uids.add(x.customer_uid);
        console.log(
          `${x.customer_uid}(${x.nickname || '-'}) | #${x.id} | ¥${round2(x.consumption_amount)} | ` +
          `¥0 | ¥${x.shouldByCurrentRule} | #${x.ruleId} | ${fmtTime(x.created_at)}`
        );
      }
      console.log(`\n小计：${typeB.length} 单 / ${uids.size} 人 / 按当前规则应补合计 ¥${sumShould}`);
      console.log('涉及 uid：' + [...uids].join(', '));
      console.log('（类B应补金额以"当前规则"为准；若历史规则不同，请人工核对应补额）');
    }

    // ---- 汇总 ----
    console.log('\n\n==================== 全站汇总 ====================');
    console.log(`已通过消费权益审批单：${reqs.length} 张`);
    console.log(`  · 正常（券已足额 / 本就无券）：${normal} 张`);
    console.log(`  · 类A 确定性漏发/少发：${typeA.length} 张`);
    console.log(`  · 类B 配置导致漏发（券额=0但应有券）：${typeB.length} 张`);
    if (typeA.length || typeB.length) {
      console.log('\n👉 把本输出发回，我据此写"幂等回填脚本"（支持 dry-run 预演），按单补发差额，绝不重复发。');
    } else {
      console.log('\n🎉 全站无"积分发了、现金券没发"的问题。');
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
