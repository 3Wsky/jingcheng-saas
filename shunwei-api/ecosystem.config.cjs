module.exports = {
  apps: [
    {
      name: 'shunwei-api',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        PORT: 8787,
        HOST: '0.0.0.0'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8787,
        HOST: '127.0.0.1',
        LOG_LEVEL: 'info'
      },
      max_memory_restart: '300M',
      time: true
    }
  ]
};
