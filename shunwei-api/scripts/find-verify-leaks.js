/**
 * 「核销漏单」体检脚本（只读，不写库）
 *
 * 目标：揪出历史上可能发生的「商家入账了、但用户没扣减/没台账」的脱节。
 *
 * 原理（两条交叉核对）：
 *   A) 商家维度：商家累计入账(pending_settlement + 已结算 settled_total + 提现 settlement)
 *      理论上应 == 该商家在台账里的核销总额(cash_voucher_ledger direction=0, merchant_id=该商家)。
 *      若「商家入账 > 台账核销额」→ 说明有钱进了商家、却没对应用户扣减台账 = 漏单嫌疑。
 *   B) 用户维度：每个用户 台账净额(发放-核销) 是否 == 钱包余额(有效批次 remain_amount)。
 *      不一致 = 该用户扣减与余额脱节。
 *
 * 用法（服务器 shunwei-api 目录）：
 *   node scripts/find-verify-leaks.js
 */
const { config } = require('../src/shared/config');
const SW = (name) => `sw_${name}`;
const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;

async function main() {
  const m = config.legacy.mysql;
  const conn = await require('mysql2/promise').createConnection({
    host: m.host, port: m.port, user: m.user, password: m.password,
    database: m.database, charset: m.charset
  });

  try {
    // ---------- A) 商家维度：入账 vs 台账核销额 ----------
    console.log('=== A) 商家入账 vs 台账核销额（找“商家多收/用户漏扣”）===\n');
    const [merchants] = await conn.query(
      `SELECT id, merchant_name, pending_settlement, settled_total FROM ${SW('merchant')}`
    );

    let merchantBad = 0;
    for (const mc of merchants) {
      const [[led]] = await conn.query(
        `SELECT COALESCE(SUM(amount),0) AS verified
         FROM ${SW('cash_voucher_ledger')}
         WHERE direction = 0 AND merchant_id = ?`,
        [mc.id]
      );
      // 已发起的提现（不论状态）也是商家“拿到/在途”的钱，需计入商家侧累计
      let withdrawn = 0;
      try {
        const [[wd]] = await conn.query(
          `SELECT COALESCE(SUM(amount),0) AS total FROM ${SW('merchant_settlement')} WHERE merchant_id = ?`,
          [mc.id]
        );
        withdrawn = round2(wd.total);
      } catch { /* 表可能不存在 */ }

      const ledgerVerified = round2(led.verified);
      // 商家侧累计入账 = 当前待结算 + 历史已结算 + 已申请提现（pending_settlement 在提现时已被扣，故加回 withdrawn）
      const merchantCredited = round2(Number(mc.pending_settlement || 0) + Number(mc.settled_total || 0) + withdrawn);
      const diff = round2(merchantCredited - ledgerVerified);

      // 允许 1 分钱舍入误差
      if (Math.abs(diff) > 0.01) {
        merchantBad += 1;
        console.log(
          `❌ 商家#${mc.id}(${mc.merchant_name || '-'})：入账 ￥${merchantCredited} ` +
          `(待结算${round2(mc.pending_settlement)}+已结算${round2(mc.settled_total)}+提现${withdrawn}) ` +
          `vs 台账核销 ￥${ledgerVerified} | 差额 ￥${diff} ` +
          `${diff > 0 ? '← 商家多收，疑似用户漏扣' : '← 台账多于入账，疑似回收/调整'}`
        );
      }
    }
    if (!merchantBad) console.log('✅ 全部商家「入账 = 台账核销额」，未发现商家多收/用户漏扣。');

    // ---------- B) 用户维度：台账净额 vs 钱包余额 ----------
    console.log('\n=== B) 用户台账净额 vs 钱包余额（找“扣减与余额脱节”）===\n');
    const now = Math.floor(Date.now() / 1000);
    // 只扫有过现金券流水的用户，范围可控
    const [uids] = await conn.query(
      `SELECT DISTINCT uid FROM ${SW('cash_voucher_ledger')}`
    );

    let userBad = 0;
    for (const row of uids) {
      const uid = Number(row.uid);
      const [[led]] = await conn.query(
        `SELECT
           COALESCE(SUM(CASE WHEN direction=1 THEN amount ELSE 0 END),0) AS granted,
           COALESCE(SUM(CASE WHEN direction=0 THEN amount ELSE 0 END),0) AS used
         FROM ${SW('cash_voucher_ledger')} WHERE uid = ?`, [uid]
      );
      const ledgerNet = round2(Number(led.granted) - Number(led.used));
      const [[bat]] = await conn.query(
        `SELECT COALESCE(SUM(remain_amount),0) AS bal
         FROM ${SW('cash_voucher_batch')}
         WHERE uid = ? AND status = 1 AND remain_amount > 0 AND (expire_at = 0 OR expire_at > ?)`,
        [uid, now]
      );
      const walletBalance = round2(bat.bal);
      const diff = round2(ledgerNet - walletBalance);
      if (Math.abs(diff) > 0.01) {
        userBad += 1;
        const [[u]] = await conn.query(`SELECT nickname FROM ${m.prefix}user WHERE uid = ? LIMIT 1`, [uid]);
        console.log(
          `❌ 用户#${uid}(${(u && u.nickname) || '-'})：台账净额 ￥${ledgerNet} ` +
          `vs 钱包余额 ￥${walletBalance} | 差额 ￥${diff}`
        );
      }
    }
    if (!userBad) console.log(`✅ 全部 ${uids.length} 个用户「台账净额 = 钱包余额」，扣减与余额一致。`);

    console.log('\n=== 总结 ===');
    if (!merchantBad && !userBad) {
      console.log('✅✅ 未发现任何漏单/脱节。历史核销资金完全一致。');
    } else {
      console.log(`⚠️ 商家异常 ${merchantBad} 个，用户异常 ${userBad} 个。把上面 ❌ 行发回，我逐笔排查。`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
