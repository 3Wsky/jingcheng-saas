const { ok } = require('./http');

function registerHealthRoutes(app) {
  app.get('/health', async () => ok({
    service: 'shunwei-api',
    time: new Date().toISOString()
  }));
}

module.exports = { registerHealthRoutes };
