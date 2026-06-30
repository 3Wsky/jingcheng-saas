const test = require('node:test');
const assert = require('node:assert/strict');
const { ApprovalCodeUsageService } = require('./approval-code-usage.service');

test('parseCodes 从收据串解析 IMEI/SN 并归一化去重', () => {
  const codes = ApprovalCodeUsageService.parseCodes(
    '[产品1] 手机/Mate80/¥6999/IMEI:868863075048688; [产品2] 智能穿戴/WATCH/¥1999/SN:4ghbb25922012717'
  );
  // 一个 imei1 + 一个 sn（SN 归一化为大写）
  const imei = codes.find((c) => c.type === 'imei1');
  const sn = codes.find((c) => c.type === 'sn');
  assert.equal(imei.norm, '868863075048688');
  assert.equal(sn.norm, '4GHBB25922012717');
  assert.equal(codes.length, 2);
});

test('parseCodes 去重：同一码出现多次只算一条', () => {
  const codes = ApprovalCodeUsageService.parseCodes(
    'IMEI:111111111111111; IMEI:111111111111111'
  );
  assert.equal(codes.length, 1);
  assert.equal(codes[0].norm, '111111111111111');
});

test('parseCodes 无码返回空数组', () => {
  assert.deepEqual(ApprovalCodeUsageService.parseCodes('[产品1] 手机/型号/¥1'), []);
  assert.deepEqual(ApprovalCodeUsageService.parseCodes(''), []);
  assert.deepEqual(ApprovalCodeUsageService.parseCodes(null), []);
});

test('parseCodes IMEI 带空格/横线也能归一化', () => {
  const codes = ApprovalCodeUsageService.parseCodes('IMEI: 35 1234-567890123');
  assert.equal(codes.length, 1);
  assert.equal(codes[0].norm, '351234567890123');
  assert.equal(codes[0].type, 'imei1');
});
