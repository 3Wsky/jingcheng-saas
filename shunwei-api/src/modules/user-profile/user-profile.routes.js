const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { isDatabaseConnectionError } = require('../../shared/mysql');
const { UserProfileRepository, toUserProfile } = require('./user-profile.repository');

const profileSchema = z.object({
  birthday: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).default(''),
  purchasedModel: z.string().trim().max(120).default('')
});

function registerUserProfileRoutes(app) {
  const repository = new UserProfileRepository();

  app.get('/api/user/profile-extra', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');

    try {
      const profile = await repository.getByUid(request.auth.uid);
      if (!profile) return fail(reply, 404, '用户不存在');
      return ok(toUserProfile(profile));
    } catch (error) {
      return failProfileError(reply, error);
    }
  });

  app.put('/api/user/profile-extra', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '请先登录');

    const parsed = profileSchema.safeParse(request.body || {});
    if (!parsed.success) return fail(reply, 400, '资料参数错误', parsed.error.flatten());

    try {
      const profile = await repository.updateByUid(request.auth.uid, parsed.data);
      return ok(toUserProfile(profile), '保存成功');
    } catch (error) {
      return failProfileError(reply, error);
    }
  });
}

function failProfileError(reply, error) {
  if (isDatabaseConnectionError(error)) {
    return fail(reply, 503, 'CRMEB 数据库未连接，请先启动 MySQL/CRMEB 数据库', {
      code: error.code,
      message: error.message
    });
  }

  return fail(reply, error.statusCode || 500, error.message || '资料服务异常');
}

module.exports = { registerUserProfileRoutes };
