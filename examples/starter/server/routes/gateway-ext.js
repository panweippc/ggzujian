/**
 * 网关运维扩展（②档）
 *   GET  /metrics                       Prometheus 文本指标（网关统计）
 *   GET  /api/api-docs.json             自动生成的接口文档（扫描 express router stacks）
 *   GET  /api/maintenance               查询维护模式状态
 *   PUT  /api/maintenance               切换维护模式（配置入库，热生效）
 */
import express from 'express';
import os from 'node:os';
import { getGatewayStats } from '../middleware/gateway.js';
import { getRuntimeConfig, setRuntimeConfig, refreshRuntimeConfig } from '../services/runtime-config.js';
import { writeAudit } from '../middleware/audit.js';

const router = express.Router();
const poolOf = (req) => req.app.locals.pool;
const adminOnly = (req, res, next) => {
  const role = req.user?.role || req.user?.roleName || '';
  const name = req.user?.name || req.user?.username || '';
  return (['admin', '系统管理员', '总经理'].includes(role) || name === 'admin')
    ? next() : res.status(403).json({ success: false, message: '无权限，仅管理员可操作' });
};

/**
 * Prometheus 指标（文本格式 exposition 0.0.4）
 * 覆盖四类，全部零外部依赖：
 *   1) 网关业务指标（采样窗口滚动统计）
 *   2) Node.js 进程指标（内存/CPU/句柄/事件循环延迟）
 *   3) 宿主机指标（负载/内存/CPU 核数）
 *   4) 构建信息（用于 Grafana 按实例区分）
 */
const labelValue = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

// 事件循环延迟：每次采样用 setImmediate 测一次调度滞后（毫秒）
function sampleEventLoopLag() {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    setImmediate(() => resolve(Number(process.hrtime.bigint() - t0) / 1e6));
  });
}

router.get('/metrics', async (req, res) => {
  try {
    const stats = getGatewayStats();
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const load = os.loadavg();
    const lagMs = await sampleEventLoopLag();
    const L = [];
    const gauge = (name, help, value, labels = '') => {
      L.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
      L.push(`${name}${labels} ${value}`);
    };

    // ---- 1) 网关业务指标 ----
    L.push('# HELP gateway_requests_total 采样窗口内请求总数', '# TYPE gateway_requests_total gauge', `gateway_requests_total ${stats.totalRequests}`);
    L.push('# HELP gateway_slow_requests 慢请求数', '# TYPE gateway_slow_requests gauge', `gateway_slow_requests ${stats.slowCount}`);
    L.push('# HELP gateway_slow_threshold_ms 慢请求判定阈值（毫秒）', '# TYPE gateway_slow_threshold_ms gauge', `gateway_slow_threshold_ms ${stats.slowThresholdMs}`);
    L.push('# HELP gateway_endpoint_avg_ms 接口平均耗时（毫秒）', '# TYPE gateway_endpoint_avg_ms gauge',
      ...stats.topEndpoints.map((e) => `gateway_endpoint_avg_ms{path="${labelValue(e.path)}"} ${e.avgMs}`));
    L.push('# HELP gateway_endpoint_max_ms 接口最大耗时（毫秒）', '# TYPE gateway_endpoint_max_ms gauge',
      ...stats.topEndpoints.map((e) => `gateway_endpoint_max_ms{path="${labelValue(e.path)}"} ${e.maxMs}`));
    L.push('# HELP gateway_endpoint_errors 接口错误数', '# TYPE gateway_endpoint_errors gauge',
      ...stats.topEndpoints.map((e) => `gateway_endpoint_errors{path="${labelValue(e.path)}"} ${e.errors}`));
    L.push('# HELP gateway_endpoint_requests 接口请求数', '# TYPE gateway_endpoint_requests gauge',
      ...stats.topEndpoints.map((e) => `gateway_endpoint_requests{path="${labelValue(e.path)}"} ${e.count}`));

    // ---- 2) Node.js 进程指标 ----
    gauge('process_uptime_seconds', '进程运行时长（秒）', Math.round(process.uptime()));
    gauge('process_pid', '进程 PID', process.pid);
    gauge('process_mem_heap_used_bytes', 'V8 堆已用字节', mem.heapUsed);
    gauge('process_mem_heap_total_bytes', 'V8 堆总字节', mem.heapTotal);
    gauge('process_mem_rss_bytes', '常驻内存字节', mem.rss);
    gauge('process_mem_external_bytes', '外部内存字节', mem.external || 0);
    gauge('process_mem_array_buffers_bytes', 'ArrayBuffer 字节', mem.arrayBuffers || 0);
    L.push('# HELP process_cpu_user_seconds 进程用户态 CPU 时间（秒）', '# TYPE process_cpu_user_seconds counter', `process_cpu_user_seconds ${(cpu.user / 1e6).toFixed(3)}`);
    L.push('# HELP process_cpu_system_seconds 进程内核态 CPU 时间（秒）', '# TYPE process_cpu_system_seconds counter', `process_cpu_system_seconds ${(cpu.system / 1e6).toFixed(3)}`);
    gauge('process_eventloop_lag_ms', '事件循环调度延迟（毫秒）', lagMs.toFixed(3));
    gauge('process_active_handles', '活跃句柄数', typeof process._getActiveHandles === 'function' ? process._getActiveHandles().length : 0);

    // ---- 3) 宿主机指标 ----
    gauge('os_load1', '系统 1 分钟平均负载', load[0].toFixed(3));
    gauge('os_load5', '系统 5 分钟平均负载', load[1].toFixed(3));
    gauge('os_load15', '系统 15 分钟平均负载', load[2].toFixed(3));
    gauge('os_totalmem_bytes', '系统总内存字节', os.totalmem());
    gauge('os_freemem_bytes', '系统空闲内存字节', os.freemem());
    gauge('os_cpu_count', 'CPU 逻辑核数', os.cpus().length);

    // ---- 4) 构建/实例信息 ----
    gauge('starter_build_info', 'starter 实例信息（值恒为 1）', 1,
      `{version="1.0.0",node="${labelValue(process.version)}",platform="${labelValue(process.platform)}",arch="${labelValue(process.arch)}",instance="${labelValue(os.hostname())}"}`);

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(L.join('\n') + '\n');
  } catch (e) {
    res.status(500).type('text/plain').send(`# metrics error: ${e.message}\n`);
  }
});

/** 从 app._router 扫描注册的接口，生成简易文档 */
function scanRoutes(app) {
  const out = [];
  const walk = (stack, prefix = '') => {
    for (const layer of stack || []) {
      if (layer.route) {
        const path = prefix + (layer.route.path || '');
        for (const m of Object.keys(layer.route.methods || {})) {
          if (m === '_all') continue;
          out.push({ method: m.toUpperCase(), path });
        }
      } else if (layer.handle?.stack && layer.regexp) {
        // 提取挂载前缀（如 /api）
        const match = layer.regexp?.toString?.().match(/^\^\\?(.*?)(?:\/\?|$)/);
        const seg = match ? match[1].replace(/\\\//g, '/').replace(/^\//, '') : '';
        walk(layer.handle.stack, prefix + (seg ? '/' + seg : ''));
      }
    }
  };
  try { walk(app._router?.stack); } catch { /* 忽略 */ }
  // 去重 + 只保留 /api 下的
  const seen = new Set();
  return out.filter((r) => {
    const k = `${r.method} ${r.path}`;
    if (seen.has(k) || !r.path.startsWith('/api')) return false;
    seen.add(k); return true;
  }).sort((a, b) => a.path.localeCompare(b.path));
}

router.get('/api/api-docs.json', (req, res) => {
  const routes = scanRoutes(req.app);
  res.json({
    success: true,
    data: {
      openapi: '3.0.0',
      info: { title: 'starter API', version: '1.0.0', description: '自动扫描生成的接口清单' },
      generatedAt: new Date().toISOString(),
      total: routes.length,
      paths: routes.reduce((acc, r) => {
        (acc[r.path] ||= {})[r.method.toLowerCase()] = { responses: { 200: { description: 'OK' } } };
        return acc;
      }, {}),
    },
  });
});

/** 维护模式状态 */
router.get('/api/maintenance', async (req, res) => {
  try {
    const v = await getRuntimeConfig(poolOf(req), 'runtime.maintenance.enabled', 'false');
    res.json({ success: true, data: { enabled: String(v).toLowerCase() === 'true' } });
  } catch { res.json({ success: true, data: { enabled: false } }); }
});

/** 切换维护模式（仅管理员） */
router.put('/api/maintenance', adminOnly, async (req, res) => {
  const enabled = !!req.body?.enabled;
  try {
    await setRuntimeConfig(poolOf(req), 'runtime.maintenance.enabled', String(enabled), req.user?.name || '');
    refreshRuntimeConfig('runtime.maintenance.enabled');
    await writeAudit(poolOf(req), req, {
      action: 'maintenance_toggle', module: 'gateway', targetName: String(enabled),
      detail: `${enabled ? '开启' : '关闭'}维护模式`, afterValue: { enabled },
    });
    res.json({ success: true, data: { enabled } });
  } catch (e) { res.status(500).json({ success: false, message: '切换失败' }); }
});

export { scanRoutes };
export default router;
