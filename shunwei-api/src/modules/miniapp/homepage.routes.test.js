const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeConfig,
  normalizeTarget,
  publicConfig,
  buildBannerPrompt
} = require('./homepage.routes');

test('homepage config normalizes duplicate ids and unsafe targets', () => {
  const result = normalizeConfig({
    banners: [
      { id: 'same', title: 'A', targetType: 'page', targetPath: '/pages/jingcheng/integral/mall' },
      { id: 'same', title: 'B', targetType: 'page', targetPath: 'https://example.com' },
      { id: 'tab', title: 'C', targetType: 'tab', targetPath: '/pages/jingcheng/showcase/list' }
    ]
  });
  assert.equal(result.banners[0].id, 'same');
  assert.notEqual(result.banners[1].id, 'same');
  assert.equal(result.banners[1].targetType, 'none');
  assert.equal(result.banners[2].targetType, 'none');
});

test('homepage public config filters disabled banners and applies sort', () => {
  const current = normalizeConfig({
    banners: [
      { id: 'low', title: 'Low', enabled: true, sort: 1 },
      { id: 'hidden', title: 'Hidden', enabled: false, sort: 99 },
      { id: 'high', title: 'High', enabled: true, sort: 8 }
    ]
  });
  const result = publicConfig(current);
  assert.deepEqual(result.banners.map((item) => item.id), ['high', 'low']);
});

test('homepage target accepts registered tab pages with query stripped for validation', () => {
  assert.deepEqual(
    normalizeTarget('tab', '/pages/user/index?from=banner'),
    { targetType: 'tab', targetPath: '/pages/user/index?from=banner' }
  );
});

test('banner prompt reserves copy space and prohibits generated text', () => {
  const prompt = buildBannerPrompt('展示耳机和平板', '16:9');
  assert.match(prompt, /左侧约 42%/);
  assert.match(prompt, /严禁出现任何文字/);
  assert.match(prompt, /16:9/);
});
