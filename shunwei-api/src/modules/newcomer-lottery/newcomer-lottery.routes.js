const { z } = require('zod');
const { ok, fail } = require('../../shared/http');
const { NewcomerLotteryService } = require('./newcomer-lottery.service');

const taskParamsSchema = z.object({
  taskId: z.enum(['register', 'browse', 'profile'])
});

function registerNewcomerLotteryRoutes(app) {
  const service = new NewcomerLotteryService();

  app.get('/api/newcomer-lottery/state', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '\u8bf7\u5148\u767b\u5f55');
    return ok(await service.getState(request.auth.uid));
  });

  app.post('/api/newcomer-lottery/tasks/:taskId/claim', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '\u8bf7\u5148\u767b\u5f55');
    const parsed = taskParamsSchema.safeParse(request.params);
    if (!parsed.success) return fail(reply, 400, '任务参数错误', parsed.error.flatten());

    try {
      return ok(await service.claimTask(request.auth.uid, parsed.data.taskId), '领取成功');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '领取失败');
    }
  });

  app.post('/api/newcomer-lottery/draw', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '\u8bf7\u5148\u767b\u5f55');
    try {
      return ok(await service.draw(request.auth.uid), '抽奖成功');
    } catch (error) {
      return fail(reply, error.statusCode || 500, error.message || '抽奖失败');
    }
  });

  app.get('/api/newcomer-lottery/records', async (request, reply) => {
    if (!request.auth.uid) return fail(reply, 401, '\u8bf7\u5148\u767b\u5f55');
    return ok(await service.getRecords(request.auth.uid));
  });

  app.get('/api/newcomer-lottery/winner-feed', async (request, reply) => {
    return ok(await service.getWinnerFeed(20));
  });
}

module.exports = { registerNewcomerLotteryRoutes };
