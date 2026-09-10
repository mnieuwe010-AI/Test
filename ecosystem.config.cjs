// pm2-configuratie. Starten met: pm2 start ecosystem.config.cjs
// (.cjs omdat package.json "type": "module" heeft — pm2 leest dit bestand zelf via CommonJS)
module.exports = {
  apps: [
    {
      name: "cmr-automation",
      script: "dist/index.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      watch: false,
      time: true,
      out_file: "./data/pm2-out.log",
      error_file: "./data/pm2-error.log",
    },
  ],
};
