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
      name:          'fairline-mark',
      script:        'npx',
      args:          'tsx src/vault-strategy.ts mark',
      cwd:           __dirname,
      interpreter:   'none',
      autorestart:   false,           // one-shot job (deadband-gated; usually no-op)
      cron_restart:  '24,54 * * * *', // re-mark vault NAV every 30 min (offset vs engine/mm)
      env:           {},
      error_file:    'logs/mark-err.log',
      out_file:      'logs/mark-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name:          'fairline-vault-engine',
      script:        'npx',
      args:          'tsx src/vault-engine.ts',
      cwd:           __dirname,
      interpreter:   'none',
      autorestart:   false,            // one-shot job
      // Offset from fairline-mm: all operator txs share one gas coin, so
      // same-minute crons race on it ("object locked" equivocation errors).
      cron_restart:  '2,12,22,32,42,52 * * * *',   // posture-gated deploy + mark every 10 min
      env:           { LIVE_MODE: 'true' },
      error_file:    'logs/vault-engine-err.log',
      out_file:      'logs/vault-engine-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name:          'fairline-mm',
      script:        'npx',
      args:          'tsx src/deepbook-mm.ts quote',
      cwd:           __dirname,
      interpreter:   'none',
      autorestart:   false,            // one-shot job
      cron_restart:  '6,16,26,36,46,56 * * * *',   // CLOB requote every 10 min (offset vs vault-engine)
      env:           {},
      error_file:    'logs/mm-err.log',
      out_file:      'logs/mm-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name:          'fairline-flywheel',
      script:        'npx',
      args:          'tsx src/rewards.ts daily 1',
      cwd:           __dirname,
      interpreter:   'none',
      autorestart:   false,           // one-shot job
      cron_restart:  '0 13 * * *',    // one flywheel turn daily (13:00 UTC)
      env:           {},
      error_file:    'logs/flywheel-err.log',
      out_file:      'logs/flywheel-out.log',
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
