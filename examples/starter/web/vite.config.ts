import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';

// 读取后端写出的运行时端口文件（server/.runtime-port.json）。
// 用 router 在每次请求时动态读取，确保后端自动顺延端口后前端无需重启即可跟随。
function readBackendPort(): number {
  try {
    const fp = path.resolve(__dirname, '../server/.runtime-port.json');
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (Number.isInteger(data.port) && data.port > 0 && data.port < 65536) return data.port;
  } catch { /* 后端未启动或文件不存在，走下面的兜底 */ }
  return Number(process.env.VITE_API_PORT) || 3011;
}

// 从起始端口开始探测第一个空闲端口，避免与同机其他前端实例冲突。
function findAvailablePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => resolve(findAvailablePort(start + 1)));
    probe.listen(start, '127.0.0.1', () => {
      const addr = probe.address();
      const port = typeof addr === 'object' && addr ? addr.port : start;
      probe.close(() => resolve(port));
    });
  });
}

// 端口可通过 PORT / VITE_PORT 环境变量覆盖，默认 3008；被占用则自动顺延。
const WEB_START_PORT = Number(process.env.PORT) || Number(process.env.VITE_PORT) || 3008;

export default defineConfig(async () => {
  const webPort = await findAvailablePort(WEB_START_PORT);
  if (webPort !== WEB_START_PORT) {
    console.warn(`[port] 前端端口 ${WEB_START_PORT} 已被占用，已自动顺延到 ${webPort}`);
  }
  return {
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
      port: webPort,
      strictPort: false,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3011',
          changeOrigin: true,
          // 每次请求动态读取后端实际端口，后端顺延后前端无需重启
          router: () => `http://127.0.0.1:${readBackendPort()}`,
        },
      },
      // file: 安装的 admin-ui 在本仓库内，需加入 fs 白名单
      fs: { allow: ['..', '../../../packages/admin-ui'] }
    },
    optimizeDeps: { exclude: ['@panweippc/admin-ui'] }
  };
});
