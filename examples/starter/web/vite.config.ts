import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // admin-ui 通过 file: 软链到 packages/admin-ui，其组件内的 bare import
      // 会按源文件目录解析，找不到 web 的 node_modules。显式指向本项目的依赖。
      'element-plus': path.resolve(__dirname, 'node_modules/element-plus'),
      '@element-plus/icons-vue': path.resolve(__dirname, 'node_modules/@element-plus/icons-vue'),
      'vue': path.resolve(__dirname, 'node_modules/vue'),
      'axios': path.resolve(__dirname, 'node_modules/axios'),
      'pinia': path.resolve(__dirname, 'node_modules/pinia')
    },
    dedupe: ['vue', 'element-plus', '@element-plus/icons-vue', 'axios', 'pinia', 'echarts', 'xlsx', 'dompurify']
  },
  build: {
    rollupOptions: {
      output: {
        // 大体积第三方库独立成块，避免主包过大 + 并行加载
        manualChunks: {
          echarts: ['echarts'],
          xlsx: ['xlsx'],
          quill: ['@vueup/vue-quill', 'quill'],
        }
      }
    }
  },
  server: {
    port: 3008,
    proxy: { '/api': 'http://127.0.0.1:3011' },
    // file: 安装的 admin-ui 在本仓库内，需加入 fs 白名单
    fs: { allow: ['..', '../../../packages/admin-ui'] }
  },
  optimizeDeps: { exclude: ['@panweippc/admin-ui'] }
});
