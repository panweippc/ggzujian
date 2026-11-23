import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 3008,
    proxy: { '/api': 'http://127.0.0.1:3010' },
    // file: 安装的 admin-ui 在本仓库内，需加入 fs 白名单
    fs: { allow: ['..', '../../../packages/admin-ui'] }
  },
  optimizeDeps: { exclude: ['@panweippc/admin-ui'] }
});
