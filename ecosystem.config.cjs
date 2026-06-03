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
        LIVE_MODE: 'true',
      },
      error_file:   'logs/watcher-err.log',
      out_file:     'logs/watcher-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name:          'fairline-summary',
      script:        'npx',
      args:          'tsx src/daily-summary.ts',
      cwd:           __dirname,
      interpreter:   'none',
      autorestart:   false,        // one-shot job
      cron_restart:  '0 * * * *',  // re-run every hour on the hour
      env:           {},
      error_file:    'logs/summary-err.log',
      out_file:      'logs/summary-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name:          'fairline-snapshot',
      script:        'npx',
      args:          'tsx src/accrual-snapshot.ts',
      cwd:           __dirname,
      interpreter:   'none',
      autorestart:   false,           // one-shot job
      cron_restart:  '*/15 * * * *',  // snapshot every 15 minutes
      env:           {},
      error_file:    'logs/snapshot-err.log',
      out_file:      'logs/snapshot-out.log',
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
