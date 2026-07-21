const test = require('node:test');
const assert = require('node:assert/strict');

const { addHiddenMemberFilter, isExactUidSearch } = require('./admin-members.service');

test('only an explicit numeric UID search bypasses the hidden member filter', () => {
  assert.equal(isExactUidSearch('uid', '11'), true);
  assert.equal(isExactUidSearch('uid', '0011'), true);
  assert.equal(isExactUidSearch('all', '11'), false);
  assert.equal(isExactUidSearch('phone', '11'), false);
  assert.equal(isExactUidSearch('nickname', '11'), false);
  assert.equal(isExactUidSearch('uid', ''), false);
  assert.equal(isExactUidSearch('uid', '11a'), false);
});

test('default and non-UID searches exclude members in the hidden table', () => {
  for (const [searchType, keyword] of [['all', ''], ['all', '11'], ['phone', '11'], ['nickname', '张']]) {
    const conditions = [];
    addHiddenMemberFilter(conditions, searchType, keyword);
    assert.equal(conditions.length, 1);
    assert.match(conditions[0], /NOT EXISTS/);
    assert.match(conditions[0], /`sw_admin_hidden_member`/);
  }
});

test('an exact UID search does not add the hidden table exclusion', () => {
  const conditions = [];
  addHiddenMemberFilter(conditions, 'uid', '11');
  assert.deepEqual(conditions, []);
});

test('hidden member schema can be created through the database pool', async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return [[], []];
    }
  };

  const { ensureAdminHiddenMemberSchema } = require('./admin-members.service');
  await ensureAdminHiddenMemberSchema(pool);

  assert.equal(queries.length, 1);
  assert.match(queries[0], /CREATE TABLE IF NOT EXISTS `sw_admin_hidden_member`/);
  assert.match(queries[0], /PRIMARY KEY \(uid\)/);
});
