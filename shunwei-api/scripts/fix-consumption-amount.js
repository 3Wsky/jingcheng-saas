/**
 * 修复历史审批单的「消费金额」：
 * 早期小程序提交未带真实消费金额，后端回退成档位下限(min_amount)，
 * 导致后台「现金审核」消费金额全部显示成 1000/3000 等档位边界值。
 *
 * 本脚本从 receipt_no 文本中解析当时填写的产品价格(￥xxx 之和)，回填到 consumption_amount。
 *
 * 用法：
 *   node scripts/fix-consumption-amount.js          # 试运行（只打印将要修改的记录，不写库）
 *   node scripts/fix-consumption-amount.js --run     # 实际执行回填
 */
const { config } = require('../src/shared/config');

/** 从 receipt_no 文本里解析所有 ￥金额并求和；解析不到返回 0 */
function parsePriceSum(receiptNo) {
  if (!receiptNo) return 0;
  const matches = String(receiptNo).match(/[¥￥]\s*([0-9]+(?:\.[0-9]+)?)/g) || [];
  let sum = 0;
  for (const m of matches) {
    const v = parseFloat(m.replace(/[¥￥\s]/g, ''));
    if (!isNaN(v)) sum += v;
  }
  return Math.round(sum * 100) / 100;
}

async function main() {
  const apply = process.argv.includes('--run');
  const mysqlCfg = config.legacy.mysql;
  const conn = await require('mysql2/promise').createConnection({
    host: mysqlCfg.host,
    port: mysqlCfg.port,
    user: mysqlCfg.user,
    password: mysqlCfg.password,
    database: mysqlCfg.database,
    charset: mysqlCfg.charset,
  });

  try {
    const [rows] = await conn.query(
      `SELECT id, request_no, consumption_amount, matched_tier_code, receipt_no
       FROM sw_approval_request
       WHERE biz_type = 'consumption_grant'
       ORDER BY id ASC`
    );
    console.log(`共扫描 consumption_grant 审批单: ${rows.length} 条\n`);

    const toFix = [];
    const unparsable = [];
    for (const row of rows) {
      const parsed = parsePriceSum(row.receipt_no);
      const current = Number(row.consumption_amount || 0);
      if (parsed > 0 && Math.abs(parsed - current) >= 0.01) {
        toFix.push({ id: row.id, requestNo: row.request_no, from: current, to: parsed, receiptNo: row.receipt_no });
      } else if (parsed <= 0) {
        unparsable.push({ id: row.id, requestNo: row.request_no, current, receiptNo: row.receipt_no });
      }
    }

    console.log(`可回填(解析到产品价格且与现值不同): ${toFix.length} 条`);
    toFix.forEach((r) => {
      console.log(`  #${r.id} ${r.requestNo}: ${r.from} -> ${r.to}   [${r.receiptNo}]`);
    });

    if (unparsable.length) {
      console.log(`\n无法解析价格(receipt_no 无 ￥金额, 多为旧数据/被截断): ${unparsable.length} 条`);
      unparsable.slice(0, 50).forEach((r) => {
        console.log(`  #${r.id} ${r.requestNo}: 现值 ${r.current}   [${r.receiptNo}]`);
      });
      if (unparsable.length > 50) console.log(`  ...其余 ${unparsable.length - 50} 条省略`);
    }

    if (!apply) {
      console.log('\n[试运行] 未写库。确认无误后加 --run 实际执行。');
      return;
    }

    let updated = 0;
    for (const r of toFix) {
      const [res] = await conn.query(
        `UPDATE sw_approval_request SET consumption_amount = ?, updated_at = ? WHERE id = ?`,
        [r.to, Math.floor(Date.now() / 1000), r.id]
      );
      if (res.affectedRows) updated += 1;
    }
    console.log(`\n[已执行] 回填完成: 更新 ${updated} 条记录。`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
