module.exports = {
  apps: [
    {
      name:         'fairline-watcher',
      script:       'npx',
      args:         'tsx src/watcher.ts',
      cwd:          __dirname,
      interpreter:  'none',
      autorestart:  true,
      watch:        false,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        LIVE_MODE: 'false',   // change to 'true' for live execution
      },
      error_file:   'logs/watcher-err.log',
      out_file:     'logs/watcher-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name:         'fairline-dashboard',
      script:       'npx',
      args:         'tsx src/dashboard.ts',
      cwd:          __dirname,
      interpreter:  'none',
      autorestart:  true,
      watch:        false,
      env: {
        DASHBOARD_PORT: '3002',
      },
      error_file:   'logs/dashboard-err.log',
      out_file:     'logs/dashboard-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
