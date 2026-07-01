const test = require('node:test');
const assert = require('node:assert/strict');
const { parseReceiptProducts } = require('./admin-superuser.routes');

test('parseReceiptProducts 单个手机：类型/型号/价格/IMEI1', () => {
  const items = parseReceiptProducts('[产品1] 手机/畅享70X 256曜金黑/¥1999/IMEI:868863075048688');
  assert.equal(items.length, 1);
  assert.equal(items[0].type, '手机');
  assert.equal(items[0].model, '畅享70X 256曜金黑');
  assert.equal(items[0].price, '¥1999');
  assert.equal(items[0].imei, '868863075048688');
  assert.equal(items[0].codeType, 'imei1');
  assert.equal(items[0].code, '868863075048688');
});

test('parseReceiptProducts 多产品：手机(IMEI) + 智能穿戴(SN)', () => {
  const items = parseReceiptProducts(
    '[产品1] 手机/Mate60/¥6999/IMEI:111; [产品2] 智能穿戴/WATCH GT6/¥1488/SN:5DTBB26425103472'
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].imei, '111');
  assert.equal(items[1].type, '智能穿戴');
  assert.equal(items[1].sn, '5DTBB26425103472');
  assert.equal(items[1].codeType, 'sn');
});

test('parseReceiptProducts 全角￥价格 + 电脑 SN', () => {
  const items = parseReceiptProducts('[产品1] 电脑/matebook E/￥5999/SN:QCFYQ22320Y00799');
  assert.equal(items[0].type, '电脑');
  assert.equal(items[0].price, '￥5999');
  assert.equal(items[0].sn, 'QCFYQ22320Y00799');
});

test('parseReceiptProducts 无产品段返回空数组', () => {
  assert.deepEqual(parseReceiptProducts(''), []);
  assert.deepEqual(parseReceiptProducts(null), []);
  assert.deepEqual(parseReceiptProducts('随手写的备注没有产品段'), []);
});
