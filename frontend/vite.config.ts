import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://127.0.0.1:4000',
        ws: true
      },
      '/websockify': {
        target: 'ws://127.0.0.1:4000',
        ws: true,
        changeOrigin: true
      },
      '/novnc': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true
      },
      '/go2rtc': {
        target: 'http://127.0.0.1:1984',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/go2rtc/, '')
      }
    }
  }
});

