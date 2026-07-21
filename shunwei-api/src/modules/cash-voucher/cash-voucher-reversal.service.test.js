const test = require('node:test');
const assert = require('node:assert/strict');
const { CashVoucherReversalService } = require('./cash-voucher-reversal.service');

function createConnection({ ledgerRows, batches = [], merchant = null }) {
  const calls = [];
  let commits = 0;
  let rollbacks = 0;

  return {
    calls,
    get commits() { return commits; },
    get rollbacks() { return rollbacks; },
    async beginTransaction() { calls.push({ sql: 'BEGIN', params: [] }); },
    async commit() { commits += 1; calls.push({ sql: 'COMMIT', params: [] }); },
    async rollback() { rollbacks += 1; calls.push({ sql: 'ROLLBACK', params: [] }); },
    release() { calls.push({ sql: 'RELEASE', params: [] }); },
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('cash_voucher_ledger') && sql.includes('FROM') && sql.includes('FOR UPDATE')) return [ledgerRows];
      if (sql.includes('cash_voucher_batch') && sql.includes('FROM') && sql.includes('FOR UPDATE')) return [batches];
      if (sql.includes('merchant') && sql.includes('FROM') && sql.includes('FOR UPDATE')) return [[merchant]];
      if (/^\s*UPDATE/i.test(sql) && sql.includes('cash_voucher_ledger')) return [{ affectedRows: ledgerRows.length }];
      if (/^\s*UPDATE/i.test(sql) && sql.includes('merchant')) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1, insertId: 1 }];
    }
  };
}

function createPool(connection) {
  return {
    async query() { return [{ affectedRows: 1 }]; },
    async getConnection() { return connection; }
  };
}

test('reverse restores every consumed batch and reduces merchant pending settlement atomically', async () => {
  const connection = createConnection({
    ledgerRows: [
      { id: 10, uid: 88, amount: '40.00', batch_id: 1, merchant_id: 9, operator_uid: 7, reversed_at: 0 },
      { id: 11, uid: 88, amount: '560.00', batch_id: 2, merchant_id: 9, operator_uid: 7, reversed_at: 0 }
    ],
    batches: [
      { id: 1, uid: 88, total_amount: '100.00', remain_amount: '0.00', expire_at: 0 },
      { id: 2, uid: 88, total_amount: '1000.00', remain_amount: '240.00', expire_at: 0 }
    ],
    merchant: { id: 9, merchant_name: '测试商家', pending_settlement: '800.00' }
  });
  const service = new CashVoucherReversalService(createPool(connection));

  const result = await service.reverse({ bizId: 'CV001', reason: '金额录入错误', adminUsername: 'admin' });

  assert.equal(connection.commits, 1);
  assert.equal(connection.rollbacks, 0);
  assert.equal(result.amount, 600);
  assert.equal(result.pendingBefore, 800);
  assert.equal(result.pendingAfter, 200);
  assert.equal(result.restoredBatchCount, 2);

  const batchUpdates = connection.calls.filter((call) => /^\s*UPDATE/i.test(call.sql) && call.sql.includes('cash_voucher_batch'));
  assert.deepEqual(batchUpdates.map((call) => call.params.slice(0, 2)), [[40, 1], [800, 1]]);
  const merchantUpdate = connection.calls.find((call) => /^\s*UPDATE/i.test(call.sql) && call.sql.includes('merchant') && !call.sql.includes('cash_voucher_ledger'));
  assert.deepEqual(merchantUpdate.params, [200, result.reversedAt, 9, 600]);
  const ledgerUpdate = connection.calls.find((call) => /^\s*UPDATE/i.test(call.sql) && call.sql.includes('cash_voucher_ledger'));
  assert.deepEqual(ledgerUpdate.params.slice(1), ['admin', '金额录入错误', 'CV001', 9]);
});

test('reverse rolls back without mutations when the verification was already reversed', async () => {
  const connection = createConnection({
    ledgerRows: [
      { id: 10, uid: 88, amount: '60.00', batch_id: 1, merchant_id: 9, operator_uid: 7, reversed_at: 123 }
    ]
  });
  const service = new CashVoucherReversalService(createPool(connection));

  await assert.rejects(
    service.reverse({ bizId: 'CV002', reason: '重复操作', adminUsername: 'admin' }),
    (error) => error.statusCode === 409 && /已经撤回/.test(error.message)
  );

  assert.equal(connection.commits, 0);
  assert.equal(connection.rollbacks, 1);
  assert.equal(connection.calls.some((call) => /^\s*UPDATE/i.test(call.sql) && call.sql.includes('cash_voucher_batch')), false);
});

test('reverse rolls back before restoring vouchers when pending settlement is insufficient', async () => {
  const connection = createConnection({
    ledgerRows: [
      { id: 10, uid: 88, amount: '600.00', batch_id: 1, merchant_id: 9, operator_uid: 7, reversed_at: 0 }
    ],
    batches: [
      { id: 1, uid: 88, total_amount: '1000.00', remain_amount: '100.00', expire_at: 0 }
    ],
    merchant: { id: 9, merchant_name: '测试商家', pending_settlement: '60.00' }
  });
  const service = new CashVoucherReversalService(createPool(connection));

  await assert.rejects(
    service.reverse({ bizId: 'CV003', reason: '金额录入错误', adminUsername: 'admin' }),
    (error) => error.statusCode === 409 && /已进入结算流程/.test(error.message)
  );

  assert.equal(connection.commits, 0);
  assert.equal(connection.rollbacks, 1);
  assert.equal(connection.calls.some((call) => /^\s*UPDATE/i.test(call.sql) && call.sql.includes('cash_voucher_batch')), false);
  assert.equal(connection.calls.some((call) => /^\s*UPDATE/i.test(call.sql) && call.sql.includes('merchant') && !call.sql.includes('cash_voucher_ledger')), false);
});
