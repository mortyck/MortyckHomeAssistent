const path = require('path');

/**
 * MortyckHomeAssistent - PM2 Process Manager Configuration
 *
 * To run MortyckHomeAssistent as a background Windows service on boot:
 * 1. Install PM2 globally:
 *      npm install -g pm2
 * 2. Start all services using this config:
 *      pm2 start ecosystem.config.js
 * 3. Save the active process list:
 *      pm2 save
 * 4. Configure automatic startup on Windows boot:
 *      npm install -g pm2-windows-startup
 *      pm2-startup install
 */

const { IS_WINDOWS, getPythonExecutable, getGo2RtcBinary } = require('./scripts/platform_detect');

const go2rtcScript = getGo2RtcBinary(__dirname);
const pythonScript = getPythonExecutable(__dirname);

module.exports = {
  apps: [
    {
      name: 'mortyck-go2rtc',
      script: go2rtcScript,
      args: ['-config', path.resolve(__dirname, 'docker', 'go2rtc.yaml')],
      cwd: path.resolve(__dirname, 'docker'),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      time: true
    },
    {
      name: 'mortyck-blurams-bridge',
      script: pythonScript,
      args: [path.resolve(__dirname, 'scripts', 'blurams_bridge.py')],
      cwd: path.resolve(__dirname),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      time: true
    },
    {
      name: 'mortyck-backend',
      script: path.resolve(__dirname, 'backend', 'dist', 'index.js'),
      cwd: path.resolve(__dirname, 'backend'),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      env: {
        PORT: 4000,
        NODE_ENV: 'production',
        GO2RTC_API_URL: 'http://127.0.0.1:1984',
        DATA_DIR: path.resolve(__dirname, 'backend', 'data')
      },
      time: true
    },
    {
      name: 'mortyck-frontend',
      script: 'node_modules/vite/bin/vite.js',
      args: ['--host', '0.0.0.0', '--port', '3000'],
      cwd: path.resolve(__dirname, 'frontend'),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'development'
      },
      time: true
    }
  ]
};
