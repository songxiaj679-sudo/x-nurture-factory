module.exports = {
  apps: [
    {
      name: "x-admin-ui",
      script: "./src/admin.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      }
    },
    {
      name: "x-batch-engine",
      script: "./src/batch_engine.js",
      instances: 1,
      autorestart: true,
      watch: false,
      kill_timeout: 35000,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "x-shop",
      script: "./src/shop.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        SHOP_PORT: 3001,
        AUTOPILOT_JOBS_PER_TICK: "12",
        AUTOPILOT_JOB_CONCURRENCY: "4",
        AUTOPILOT_SCAN_LIMIT: "50",
        AUTOPILOT_SCAN_PAGES: "10"
      }
    },
    {
      name: "x-reply-engine",
      script: "./src/reply_promo_engine.js",
      instances: 1,
      autorestart: true,
      watch: false,
      kill_timeout: 35000,
      max_memory_restart: "768M",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
