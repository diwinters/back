module.exports = {
  apps: [
    {
      name: 'gominiapp-gateway',
      script: 'packages/gateway/dist/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      error_file: 'logs/gateway-error.log',
      out_file: 'logs/gateway-out.log',
      log_file: 'logs/gateway-combined.log',
      time: true,
      merge_logs: true,
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
    },
  ],
}
