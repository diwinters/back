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
    {
      name: 'gominiapp-jetstream',
      script: 'packages/gateway/dist/jetstream-worker.js',
      instances: 1,  // Single instance - Jetstream handles its own reconnection
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/jetstream-error.log',
      out_file: 'logs/jetstream-out.log',
      log_file: 'logs/jetstream-combined.log',
      time: true,
      // Graceful shutdown
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 30000, // Longer timeout for Jetstream connection
      // Restart delay to prevent rapid reconnection loops
      restart_delay: 5000,
      // Don't restart too quickly on errors
      exp_backoff_restart_delay: 1000,
    },
  ],
}
