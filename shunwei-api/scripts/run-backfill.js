const { config } = require('../src/shared/config');
const fs = require('fs');
const path = require('path');

async function main() {
  const runBackfill = process.argv.includes('--run');
  const mysqlCfg = config.legacy.mysql;
  const conn = await require('mysql2/promise').createConnection({
    host: mysqlCfg.host,
    port: mysqlCfg.port,
    user: mysqlCfg.user,
    password: mysqlCfg.password,
    database: mysqlCfg.database,
    charset: mysqlCfg.charset,
    multipleStatements: true,
  });

  try {
    const db = mysqlCfg.database;

    const [tables] = await conn.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema=? AND table_name LIKE 'sw_%'`,
      [db]
    );
    console.log('sw_* tables:', tables.map((r) => r.TABLE_NAME || r.table_name).join(', ') || '(none)');

    const [[users]] = await conn.query('SELECT COUNT(*) AS c FROM eb_user WHERE COALESCE(is_del,0)=0');
    console.log('active users:', users.c);

    if (!runBackfill) {
      try {
        const [[batches]] = await conn.query('SELECT COUNT(*) AS c FROM sw_integral_batch');
        const [[legacyB]] = await conn.query(
          "SELECT COUNT(*) AS c FROM sw_integral_batch WHERE source_type='legacy_import'"
        );
        const [[memberships]] = await conn.query('SELECT COUNT(*) AS c FROM sw_user_membership');
        const [[legacyM]] = await conn.query(
          "SELECT COUNT(*) AS c FROM sw_user_membership WHERE source_channel='legacy_import'"
        );
        console.log('sw_integral_batch total:', batches.c, 'legacy:', legacyB.c);
        console.log('sw_user_membership total:', memberships.c, 'legacy:', legacyM.c);
      } catch (e) {
        console.log('backfill tables missing:', e.message);
      }
      return;
    }

    const sqlPath = path.join(__dirname, '../migrations/backfill/001_legacy_member_backfill.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('Running backfill...');
    const [results] = await conn.query(sql);
    const stats = Array.isArray(results) ? results.filter((r) => r && r.metric) : [];
    console.log('Stats:', JSON.stringify(stats, null, 2));

    const [mismatch] = await conn.query(`
      SELECT COUNT(*) AS cnt FROM eb_user u
      WHERE COALESCE(u.is_del,0)=0 AND u.integral>0
      AND u.integral <> COALESCE((
        SELECT SUM(b.remain_amount) FROM sw_integral_batch b WHERE b.uid=u.uid AND b.status=1
      ),0)
    `);
    console.log('integral mismatch users:', mismatch[0].cnt);
    console.log('Done.');
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
