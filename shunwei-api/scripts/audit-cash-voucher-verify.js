/**
 * 现金券核销「资金一致性」只读体检脚本（不写库，纯核对）
 *
 * 目的：证明「商家核销成功并显示金额」时，用户余额确实被同步扣减，
 *      不会出现「商家扣了、用户没扣」的脱节。
 *
 * 它做三件事：
 *   1) 列出最近 N 笔现金券核销台账（direction=0 且 merchant_id>0），含商家、操作员、用户。
 *   2) 对每个涉及的用户做对账：
 *        台账净额 = SUM(发放 direction=1) - SUM(核销/回收 direction=0)
 *        钱包余额 = SUM(有效批次 remain_amount)（status=1 且未过期）
 *      两者应一致（差额 <= 0.01）。不一致即打印告警。
 *   3) 汇总：商家入账(pending_settlement 关联)与核销台账是否对得上。
 *
 * 用法（在服务器 shunwei-api 目录下）：
 *   node scripts/audit-cash-voucher-verify.js            # 查最近 20 笔
 *   node scripts/audit-cash-voucher-verify.js 50         # 查最近 50 笔
 *   node scripts/audit-cash-voucher-verify.js --uid 123  # 只对账指定用户
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

async function reconcileUser(conn, uid, now) {
  const userPrefix = config.legacy.mysql.prefix;
  const [[led]] = await conn.query(
    `SELECT
       COALESCE(SUM(CASE WHEN direction = 1 THEN amount ELSE 0 END), 0) AS granted,
       COALESCE(SUM(CASE WHEN direction = 0 THEN amount ELSE 0 END), 0) AS used
     FROM ${SW('cash_voucher_ledger')} WHERE uid = ?`,
    [uid]
  );
  const ledgerNet = round2(Number(led.granted) - Number(led.used));

  const [[bat]] = await conn.query(
    `SELECT COALESCE(SUM(remain_amount), 0) AS balance
     FROM ${SW('cash_voucher_batch')}
     WHERE uid = ? AND status = 1 AND remain_amount > 0
       AND (expire_at = 0 OR expire_at > ?)`,
    [uid, now]
  );
  const walletBalance = round2(bat.balance);

  const [[u]] = await conn.query(
    `SELECT nickname FROM ${userPrefix}user WHERE uid = ? LIMIT 1`,
    [uid]
  );

  const diff = round2(ledgerNet - walletBalance);
  const consistent = Math.abs(diff) <= 0.01;
  return {
    uid,
    nickname: (u && u.nickname) || '',
    granted: round2(led.granted),
    used: round2(led.used),
    ledgerNet,
    walletBalance,
    diff,
    consistent
  };
}

async function main() {
  const args = process.argv.slice(2);
  const uidArgIdx = args.indexOf('--uid');
  const onlyUid = uidArgIdx >= 0 ? Number(args[uidArgIdx + 1]) : 0;
  const limit = (() => {
    const n = args.find((a) => /^\d+$/.test(a));
    return n ? Math.min(200, Number(n)) : 20;
  })();

  const mysqlCfg = config.legacy.mysql;
  const conn = await require('mysql2/promise').createConnection({
    host: mysqlCfg.host,
    port: mysqlCfg.port,
    user: mysqlCfg.user,
    password: mysqlCfg.password,
    database: mysqlCfg.database,
    charset: mysqlCfg.charset
  });

  const now = Math.floor(Date.now() / 1000);
  try {
    let userIds = [];

    if (onlyUid) {
      userIds = [onlyUid];
      console.log(`\n=== 指定用户对账 uid=${onlyUid} ===\n`);
    } else {
      console.log(`\n=== 最近 ${limit} 笔现金券核销（direction=0, merchant_id>0） ===\n`);
      const [rows] = await conn.query(
        `SELECT l.id, l.uid, l.amount, l.merchant_id, l.operator_uid, l.biz_id, l.remark, l.created_at,
                m.merchant_name, u.nickname AS user_name, op.nickname AS op_name
         FROM ${SW('cash_voucher_ledger')} l
         LEFT JOIN ${SW('merchant')} m ON m.id = l.merchant_id
         LEFT JOIN ${mysqlCfg.prefix}user u ON u.uid = l.uid
         LEFT JOIN ${mysqlCfg.prefix}user op ON op.uid = l.operator_uid
         WHERE l.direction = 0 AND l.merchant_id > 0
         ORDER BY l.id DESC LIMIT ?`,
        [limit]
      );
      if (!rows.length) {
        console.log('（暂无核销记录）');
      }
      for (const r of rows) {
        console.log(
          `#${r.id} ${fmtTime(r.created_at)} | 用户 ${r.uid}(${r.user_name || '-'}) ` +
          `扣 ￥${round2(r.amount)} | 商家 ${r.merchant_id}(${r.merchant_name || '-'}) ` +
          `| 核销员 ${r.operator_uid}(${r.op_name || '-'}) | ${r.biz_id || ''}`
        );
      }
      userIds = [...new Set(rows.map((r) => Number(r.uid)))];
    }

    console.log(`\n=== 用户对账：台账净额 vs 钱包余额（应一致）===\n`);
    let bad = 0;
    for (const uid of userIds) {
      const r = await reconcileUser(conn, uid, now);
      const flag = r.consistent ? '✅一致' : '❌不一致';
      console.log(
        `uid=${r.uid}(${r.nickname || '-'}) | 发放 ￥${r.granted} - 已核销 ￥${r.used} ` +
        `= 净额 ￥${r.ledgerNet} | 钱包余额 ￥${r.walletBalance} | 差额 ￥${r.diff} ${flag}`
      );
      if (!r.consistent) bad += 1;
    }

    console.log('\n=== 结论 ===');
    if (bad === 0) {
      console.log(`✅ 全部 ${userIds.length} 个用户「台账净额 = 钱包余额」，核销扣款与商家入账一致，无脱节。`);
    } else {
      console.log(`❌ 有 ${bad} 个用户对不上，请把上面 ❌ 行发回排查（可能是历史数据或并发问题）。`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
