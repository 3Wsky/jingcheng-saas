/**
 * 会员「积分/现金券发放」差异只读诊断脚本（纯查询，绝不写库）
 *
 * 背景：部分线下消费权益会员（如 1839/1840）积分+现金券都到账，
 *      另一部分（如 1841/1843/1855/1858）只有积分、没有现金券。
 *      本脚本用于一次性查清"为什么有的发了、有的没发"。
 *
 * 它对每个 uid 打印：
 *   1) 审批单(sw_approval_request)：消费金额 / 匹配档位 / 匹配现金券额 / 匹配积分 / 状态 / 时间
 *      —— matched_voucher_amount 是审批"当时"冻结下来的券额，=0 就永远不发券
 *   2) 实际现金券批次(sw_cash_voucher_batch)：来源(approval_grant/manual) / 总额 / 余额 / 状态
 *  2b) 现金券流水(sw_cash_voucher_ledger)：direction=1发放 / 0核销——【核销就是"消费记录"】
 *      含核销商户、操作人、时间；这解释"余额为0却看不到消费记录"（旧版没打这张表）
 *   3) 积分赠送流水(sw_integral_batch，若表存在)
 *   4) 逐单裁决：券发了没 / 是否已核销消费光 / 原因
 *
 * 另外全局打印一次：
 *   A) 当前档位规则表 sw_tier_rule（现在每档送多少券）
 *   B) 档位规则的后台变更审计（谁在什么时候把券额改成了几，用于判断"配置漂移"）
 *
 * 用法（在服务器 shunwei-api 目录下，需已配置生产 .env）：
 *   node scripts/diagnose-member-voucher.js 1858 1855 1841 1843 1840 1839
 *   node scripts/diagnose-member-voucher.js 1858            # 单个
 *   （不传 uid 时只打印 A/B 两张全局表）
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

async function tableExists(conn, dbName, tableName) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.tables
     WHERE table_schema = ? AND table_name = ?`,
    [dbName, tableName]
  );
  return Number(row.c) > 0;
}

async function printTierRules(conn) {
  console.log('\n==================== A. 当前档位规则表 sw_tier_rule ====================');
  const [rows] = await conn.query(
    `SELECT id, min_amount, max_amount, tier_code, voucher_amount, gift_integral, is_active, updated_at
     FROM ${SW('tier_rule')} ORDER BY min_amount ASC`
  );
  if (!rows.length) {
    console.log('⚠️ 档位规则表为空！那所有审批都匹配不到规则（正常应有 4 条默认档）。');
    return;
  }
  console.log('规则ID | 消费区间(min<=金额, max仅展示) | 档位 | 赠现金券 | 赠积分 | 状态 | 最后更新');
  for (const r of rows) {
    const range = `¥${round2(r.min_amount)} — ${r.max_amount == null ? '无上限' : '¥' + round2(r.max_amount)}`;
    const flag = Number(r.voucher_amount) > 0 ? '' : '  ⬅️ 券额=0，此档不发券！';
    console.log(
      `#${r.id} | ${range} | ${r.tier_code} | ¥${round2(r.voucher_amount)} | ${Number(r.gift_integral).toLocaleString()} | ` +
      `${Number(r.is_active) === 1 ? '启用' : '停用'} | ${fmtTime(r.updated_at)}${flag}`
    );
  }
  console.log(
    '\n注意：匹配逻辑是 `min_amount <= 消费额 ORDER BY min_amount DESC LIMIT 1`（不校验 max_amount），' +
    '取"下限不超过消费额里最大的那条"。若最高一条券额=0，会导致大额消费反而不发券。'
  );
}

async function printTierRuleAudit(conn, dbName) {
  console.log('\n==================== B. 档位规则后台变更审计（判断配置漂移）====================');
  if (!(await tableExists(conn, dbName, SW('admin_audit_log')))) {
    console.log('（无 sw_admin_audit_log 表，跳过）');
    return;
  }
  const [rows] = await conn.query(
    `SELECT id, admin_username, action, target_id, payload_json, created_at
     FROM ${SW('admin_audit_log')}
     WHERE action IN ('tier_rule_create', 'tier_rule_update', 'tier_rule_delete')
     ORDER BY id ASC`
  );
  if (!rows.length) {
    console.log('（无档位规则变更记录 → 规则应为迁移写入的默认值，未被后台改过）');
    return;
  }
  for (const r of rows) {
    let voucher = '?';
    let tier = '?';
    try {
      const p = JSON.parse(r.payload_json || '{}');
      voucher = p.voucherAmount ?? p.voucher_amount ?? '?';
      tier = p.tierCode ?? p.tier_code ?? '?';
    } catch { /* ignore */ }
    console.log(
      `${fmtTime(r.created_at)} | ${r.action} 规则#${r.target_id} | 档位=${tier} 券额→¥${voucher} | 操作人 ${r.admin_username || '-'}`
    );
  }
  console.log('\n☝️ 若看到某次 update 把某档「券额」改成了 0，则该时间点之后提交的审批单都不再发券。');
}

async function diagnoseUid(conn, dbName, uid, prefix) {
  console.log(`\n\n########## 会员 uid=${uid} ##########`);

  const [[u]] = await conn.query(
    `SELECT uid, nickname, phone, integral, is_money_level, overdue_time, spread_uid
     FROM ${prefix}user WHERE uid = ? LIMIT 1`,
    [uid]
  );
  if (!u) {
    console.log('⚠️ 该 uid 在 eb_user 不存在。');
    return;
  }
  console.log(
    `昵称=${u.nickname || '-'} | 手机=${u.phone || '-'} | 当前积分=${Number(u.integral).toLocaleString()} | ` +
    `付费会员标记 is_money_level=${u.is_money_level} | 到期=${fmtTime(u.overdue_time)} | 归属客户经理uid=${u.spread_uid || 0}`
  );

  // 0) 会员开通记录（source_channel 是判断"怎么来的"的关键）
  console.log('\n--- ⓪ 会员开通记录 sw_user_membership（来源渠道！）---');
  const [memberships] = await conn.query(
    `SELECT id, tier_code, source_channel, source_ref, granted_integral,
            start_at, expire_at, status, created_at
     FROM ${SW('user_membership')}
     WHERE uid = ? ORDER BY id ASC`,
    [uid]
  );
  if (!memberships.length) {
    console.log('（无 sw_user_membership 记录 → 未通过本系统开通过会员；若小程序仍显示会员，可能仅靠 CRMEB eb_user.is_money_level 标志）');
  }
  for (const m of memberships) {
    const chLabel = {
      legacy_import: '历史回填(老会员迁移，本就不含现金券)',
      offline_approval: '线下消费权益审批(这条才送券)',
      wechat_purchase: '微信买卡(设计上只送积分不送券)',
      admin_grant: '后台开卡(设计上只送积分不送券)'
    }[m.source_channel] || m.source_channel;
    console.log(
      `会员#${m.id} | ${fmtTime(m.created_at)} | 档位=${m.tier_code} | 来源=${m.source_channel}【${chLabel}】 | ` +
      `单号=${m.source_ref} | 记录赠积分=${Number(m.granted_integral).toLocaleString()} | ` +
      `到期=${fmtTime(m.expire_at)} | ${Number(m.status) === 1 ? '有效' : '失效'}`
    );
  }

  // 1) 审批单
  console.log('\n--- ① 审批单 sw_approval_request（消费权益申请）---');
  const [reqs] = await conn.query(
    `SELECT id, request_no, consumption_amount, matched_tier_code, matched_voucher_amount,
            matched_integral, status, receipt_no, created_at, updated_at
     FROM ${SW('approval_request')}
     WHERE customer_uid = ? ORDER BY id ASC`,
    [uid]
  );
  if (!reqs.length) {
    console.log('（无任何审批单 → 该会员不是走"线下消费权益审批"来的，可能是直接开卡/后台开卡，那本就不发券）');
  }
  for (const r of reqs) {
    const voucherFlag = Number(r.matched_voucher_amount) > 0
      ? `应发券 ¥${round2(r.matched_voucher_amount)}`
      : '⬅️ 券额=0，此单不会发券';
    console.log(
      `单#${r.id}(${r.request_no}) | ${fmtTime(r.created_at)} | 消费¥${round2(r.consumption_amount)} | ` +
      `档位=${r.matched_tier_code || '-'} | ${voucherFlag} | 应发积分=${Number(r.matched_integral).toLocaleString()} | ` +
      `状态=${r.status}`
    );
  }

  // 2) 实际现金券批次
  console.log('\n--- ② 实际现金券批次 sw_cash_voucher_batch ---');
  const [batches] = await conn.query(
    `SELECT id, source_type, source_id, total_amount, remain_amount, status, created_at
     FROM ${SW('cash_voucher_batch')}
     WHERE uid = ? ORDER BY id ASC`,
    [uid]
  );
  if (!batches.length) {
    console.log('（无任何现金券批次 → 钱包余额为 0，这就是"没有现金券"的直接原因）');
  }
  for (const b of batches) {
    const st = Number(b.status) === 1 ? '有效' : Number(b.status) === 0 ? '耗尽' : '过期';
    const usedFlag = Number(b.remain_amount) < Number(b.total_amount)
      ? `  ⬅️ 已核销¥${round2(Number(b.total_amount) - Number(b.remain_amount))}`
      : '';
    console.log(
      `批次#${b.id} | ${fmtTime(b.created_at)} | 来源=${b.source_type}(${b.source_id}) | ` +
      `总额¥${round2(b.total_amount)} 余额¥${round2(b.remain_amount)} | ${st}${usedFlag}`
    );
  }

  // 2.5) 现金券【核销/使用流水】—— 这就是"消费记录"！余额=0 却看不到消费，就是因为之前没打印这张表
  console.log('\n--- ②b 现金券流水 sw_cash_voucher_ledger（direction=1发放 / 0核销，核销即"消费记录"）---');
  const hasMerchant = await tableExists(conn, dbName, SW('merchant'));
  const [ledgers] = await conn.query(
    hasMerchant
      ? `SELECT l.id, l.direction, l.amount, l.batch_id, l.merchant_id, l.operator_uid,
                l.biz_id, l.remark, l.created_at, m.merchant_name
         FROM ${SW('cash_voucher_ledger')} l
         LEFT JOIN ${SW('merchant')} m ON m.id = l.merchant_id
         WHERE l.uid = ? ORDER BY l.id ASC`
      : `SELECT l.id, l.direction, l.amount, l.batch_id, l.merchant_id, l.operator_uid,
                l.biz_id, l.remark, l.created_at, NULL AS merchant_name
         FROM ${SW('cash_voucher_ledger')} l
         WHERE l.uid = ? ORDER BY l.id ASC`,
    [uid]
  );
  if (!ledgers.length) {
    console.log('（无任何现金券流水）');
  }
  let usedSum = 0;
  let grantSum = 0;
  for (const l of ledgers) {
    const isUse = Number(l.direction) === 0;
    if (isUse) usedSum = round2(usedSum + Number(l.amount));
    else grantSum = round2(grantSum + Number(l.amount));
    const dirLabel = isUse ? '🟥核销(消费)' : '🟩发放';
    const who = isUse
      ? `商户=${l.merchant_name || ('#' + l.merchant_id)} | 操作人uid=${l.operator_uid}`
      : '（系统发放）';
    console.log(
      `#${l.id} | ${fmtTime(l.created_at)} | ${dirLabel} ¥${round2(l.amount)} | 批次#${l.batch_id} | ${who} | 单号=${l.biz_id} | ${l.remark || ''}`
    );
  }
  if (ledgers.length) {
    console.log(`  └─ 汇总：累计发放¥${grantSum} / 累计核销(消费)¥${usedSum} / 当前应余¥${round2(grantSum - usedSum)}`);
  }

  // 3) 积分赠送流水（表名兼容）
  console.log('\n--- ③ 积分赠送流水 ---');
  let integralTable = '';
  for (const cand of [SW('integral_batch'), SW('integral_ledger')]) {
    if (await tableExists(conn, dbName, cand)) { integralTable = cand; break; }
  }
  if (!integralTable) {
    console.log('（未找到积分流水表，跳过；不影响券的判断）');
  } else {
    const [ints] = await conn.query(
      `SELECT * FROM ${integralTable} WHERE uid = ? ORDER BY id DESC LIMIT 10`,
      [uid]
    );
    if (!ints.length) console.log('（无积分赠送流水）');
    for (const it of ints) {
      const amount = it.amount ?? it.change_amount ?? it.integral ?? '?';
      const remark = it.remark ?? it.source_type ?? '';
      console.log(`#${it.id} | ${fmtTime(it.created_at)} | 积分 ${amount} | ${remark}`);
    }
  }

  // 4) 逐单裁决
  console.log('\n--- ④ 裁决 ---');
  const approved = reqs.filter((r) => r.status === 'approved');
  const grantBatches = batches.filter((b) => b.source_type === 'approval_grant');
  const isLegacy = memberships.some((m) => m.source_channel === 'legacy_import');
  const totalRemain = round2(batches.reduce((s, b) => s + Number(b.remain_amount || 0), 0));
  if (!reqs.length && isLegacy) {
    console.log('结论：🟦 该会员是「历史回填(legacy_import)」——即本系统上线前就在 CRMEB 买过199/299的老会员。');
    console.log('     回填只迁移了「历史积分」和「会员档位」，==现金券是新功能、老会员本就没有==；');
    console.log('     也因此他没有"消费审批单"和"核销记录"。这不是漏发，是历史边界。');
    console.log('     → 是否给老会员补发¥100券，属产品决策；要补我可写按 legacy 会员批量补发的脚本。');
  } else if (!reqs.length) {
    console.log('结论：无审批单，也非 legacy 回填。若他确实有积分/199会员，需看⓪的来源渠道判断（微信买卡/后台开卡按设计只发积分不发券）。');
  } else if (approved.length && approved.every((r) => Number(r.matched_voucher_amount) === 0)) {
    console.log('结论：❌ 已通过的审批单「匹配券额=0」→ 审批当时命中的档位规则券额就是 0（或那时规则没配券额），所以只发了积分没发券。');
    console.log('     → 属"配置/数据"问题：需 (1) 把档位规则券额改对；(2) 对这些历史单回填补发现金券。');
  } else if (approved.some((r) => Number(r.matched_voucher_amount) > 0) && grantBatches.length === 0) {
    console.log('结论：⚠️ 审批单记了应发券额 > 0，但没有对应的 approval_grant 现金券批次 → 疑似发放中断/异常，需重点排查这几单。');
  } else if (grantBatches.length && usedSum > 0 && totalRemain <= 0.001) {
    console.log(`结论：✅ 券已按审批足额发放，且【已被核销消费光】——累计核销¥${usedSum}，当前余额¥0。`);
    console.log('     ==这不是漏发，就是"消费记录"==：核销明细见上面 ②b 现金券流水里 direction=0(🟥核销) 的行（含商户/操作人/时间）。');
    console.log('     之所以你之前"看不到消费记录"，是因为旧版脚本只打了批次表(②)没打流水表(②b)。');
  } else if (grantBatches.length && usedSum > 0) {
    console.log(`结论：✅ 券已发放，且【部分已核销消费】——累计核销¥${usedSum}，当前仍余¥${totalRemain}。核销明细见 ②b(🟥核销行)。`);
  } else if (grantBatches.length) {
    console.log(`结论：✅ 有 approval_grant 现金券批次，券已按审批发放，且【从未核销】，当前余额¥${totalRemain}（钱包应能看到这笔券）。`);
  } else {
    console.log('结论：审批单存在但未到"approved"，尚未走到发放环节（看①里的状态）。');
  }
}

async function main() {
  const uids = process.argv.slice(2).map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0);

  const mysqlCfg = config.legacy.mysql;
  const conn = await require('mysql2/promise').createConnection({
    host: mysqlCfg.host,
    port: mysqlCfg.port,
    user: mysqlCfg.user,
    password: mysqlCfg.password,
    database: mysqlCfg.database,
    charset: mysqlCfg.charset
  });
  const dbName = mysqlCfg.database;
  const prefix = mysqlCfg.prefix;

  try {
    await printTierRules(conn);
    await printTierRuleAudit(conn, dbName);

    if (!uids.length) {
      console.log('\n（未传入 uid，仅打印全局档位规则与变更审计。如需逐人诊断：node scripts/diagnose-member-voucher.js 1858 1855 ...）');
      return;
    }

    for (const uid of uids) {
      await diagnoseUid(conn, dbName, uid, prefix);
    }

    console.log('\n\n==================== 汇总提示 ====================');
    console.log('把以上完整输出发回，即可确认：');
    console.log('  · "有券"的人（如1839/1840）批次余额>0、②b 流水里无🟥核销 → 券还在；');
    console.log('  · "没券"的人（如1841/1843/1855/1858）看 ②b 流水：若有🟥核销行 → 券是被消费光的（含商户/时间），==这就是"消费记录"，不是漏发==；');
    console.log('  · 若 ②b 没有任何🟥核销行、余额却为0 → 才是真异常，需排查。');
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
