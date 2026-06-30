const test = require('node:test');
const assert = require('node:assert/strict');
const { SnCatalogService } = require('./sn-catalog.service');

test('normalizeImei 仅保留数字', () => {
  assert.equal(SnCatalogService.normalizeImei(' 35 1234-567890123 '), '351234567890123');
  assert.equal(SnCatalogService.normalizeImei('IMEI:123456789012345'), '123456789012345');
  assert.equal(SnCatalogService.normalizeImei(''), '');
});

test('normalizeSn 去空格转大写', () => {
  assert.equal(SnCatalogService.normalizeSn(' ab12 cd34 '), 'AB12CD34');
  assert.equal(SnCatalogService.normalizeSn('sn-Code_9'), 'SN-CODE_9');
});

test('extractCodes 从收据串提取 IMEI/IMEI1/IMEI2/SN', () => {
  const r1 = SnCatalogService.extractCodes('[产品1] 手机/iPhone15/¥5999/IMEI:351234567890123');
  assert.deepEqual(r1.imeis, ['351234567890123']);
  assert.deepEqual(r1.sns, []);

  const r2 = SnCatalogService.extractCodes('[产品1] 手机/型号/¥1/IMEI1:111111111111111 IMEI2:222222222222222');
  assert.deepEqual(r2.imeis.sort(), ['111111111111111', '222222222222222']);

  const r3 = SnCatalogService.extractCodes('[产品1] 智能穿戴/Watch/¥1999/SN:ABC123DEF456');
  assert.deepEqual(r3.imeis, []);
  assert.deepEqual(r3.sns, ['ABC123DEF456']);

  const r4 = SnCatalogService.extractCodes('[产品1] 手机/型号/¥1/IMEI:351234567890123/SN:ZX9001; [产品2] 智能穿戴/W/¥2/SN:abc999');
  assert.deepEqual(r4.imeis, ['351234567890123']);
  assert.deepEqual(r4.sns.sort(), ['ABC999', 'ZX9001']);
});

test('extractCodes 无码时返回空数组', () => {
  const r = SnCatalogService.extractCodes('[产品1] 手机/型号/¥1');
  assert.deepEqual(r.imeis, []);
  assert.deepEqual(r.sns, []);
});

test('buildMatchKey IMEI1 优先，缺失用 SN', () => {
  assert.equal(SnCatalogService.buildMatchKey('123456789012345', 'ABC123'), '123456789012345');
  assert.equal(SnCatalogService.buildMatchKey('', 'ABC123'), 'ABC123');
  assert.equal(SnCatalogService.buildMatchKey('123', ''), '123');
  assert.equal(SnCatalogService.buildMatchKey('', ''), '');
});

test('buildRows 以 IMEI1 为身份去重，SN 可空（手机不互相覆盖）', () => {
  const now = 100;
  // 两台手机：SN 都空、IMEI1 不同 → 都应保留（旧逻辑会因空 SN 互相覆盖只剩 1 台）
  const { rows, skipped } = SnCatalogService.buildRows([
    { snCode: '', imei1: '868863075048688', model: '畅享70X' },
    { snCode: '', imei1: '863797074668945', model: 'Pocket 2' }
  ], now);
  assert.equal(rows.length, 2);
  assert.equal(skipped, 0);
  // match_key（第 5 列, idx 4）应为各自 IMEI1
  assert.equal(rows[0][4], '868863075048688');
  assert.equal(rows[1][4], '863797074668945');
});

test('buildRows 同一 IMEI1 重复 → 后者覆盖、计入跳过', () => {
  const { rows, skipped } = SnCatalogService.buildRows([
    { imei1: '111111111111111', model: 'A' },
    { imei1: '111111111111111', model: 'B' }
  ], 1);
  assert.equal(rows.length, 1);
  assert.equal(skipped, 1);
  assert.equal(rows[0][6], 'B'); // model 在第 7 列(idx 6)，保留最新
});

test('buildRows IMEI1 与 SN 都空的行被跳过', () => {
  const { rows, skipped } = SnCatalogService.buildRows([
    { snCode: '', imei1: '', model: '脏数据' },
    { snCode: 'SN-OK-1', imei1: '', model: '手表' }
  ], 1);
  assert.equal(rows.length, 1);
  assert.equal(skipped, 1);
  assert.equal(rows[0][4], 'SN-OK-1'); // 无 IMEI1 时 match_key=SN(归一化大写)
});

test('buildRows 非手机：IMEI1 空、SN 为带字母串 → 用 SN 作身份键', () => {
  const { rows } = SnCatalogService.buildRows([
    { snCode: '4GHBB25922012717', imei1: '', model: '华为WATCH GT6' }
  ], 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][4], '4GHBB25922012717');
});
