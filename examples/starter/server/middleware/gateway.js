/**
 * 统一网关中间件（底座第 3 部分：API Gateway）
 * 集中处理：Trace ID / 全局限流 / 接口耗时统计 / 慢接口告警 / 审计上下文采集
 * 挂载位置：server.js 中 cors() 之后、路由之前（全局生效）
 */
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

const SLOW_MS = +(process.env.SLOW_REQUEST_MS || 800);
const KEEP_SLOW = 200;          // 内存保留最近 200 条慢请求
const KEEP_STATS = 300;         // 内存保留最近 300 条接口统计（滚动）

// 环形缓冲：接口耗时统计（重启清零，骨架够用；生产建议落库或接 Prometheus）
const recentRequests = [];
const slowRequests = [];

// 敏感字段：审计采集时打码，避免密码/token 落进操作日志
const SENSITIVE = /(password|passwd|pwd|token|secret|idcard|idCard|phone|mobile|email|captcha|authorization)/i;
function sanitize(value, depth = 0) {
  if (value == null || depth > 5) return value;
  if (typeof value === 'string') return value.length > 300 ? value.slice(0, 300) + '…' : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE.test(k)) { out[k] = '***'; continue; }
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}
const trunc = (obj) => {
  try {
    const s = JSON.stringify(sanitize(obj));
    return s.length > 4000 ? s.slice(0, 4000) + '…' : s;
  } catch { return ''; }
};

/**
 * ① Trace ID 中间件：请求头有 X-Request-Id 就透传（支持上游网关），没有就生成
 */
export function traceMiddleware(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.traceId = (typeof incoming === 'string' && incoming.trim()) ? incoming.trim().slice(0, 64) : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.traceId);
  next();
}

/**
 * ② 审计上下文采集：记录 req.body 与 res.json 响应体（脱敏），供操作日志落库
 */
export function auditContextMiddleware(req, res, next) {
  req._auditRequest = req.body && Object.keys(req.body || {}).length ? trunc(req.body) : '';
  const origJson = res.json.bind(res);
  res.json = (body) => {
    try { req._auditResponse = trunc(body); } catch { /* 忽略序列化异常 */ }
    return origJson(body);
  };
  next();
}

/**
 * ③ 耗时统计 + 慢接口告警
 * onSlow(ctx) 回调由 server.js 注入（接 createSecurityAlert 的 webhook）
 */
export function timingMiddleware(onSlow) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    req._startAt = start;
    res.on('finish', () => {
      const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
      req.durationMs = ms;
      // 回填审计日志的响应结果与准确耗时（路由写日志时响应尚未生成）
      // 注意：audit() 是 fire-and-forget，finish 时 INSERT 可能未完成，故按 traceId 延迟回填
      if (req.traceId && req.app?.locals?.pool) {
        const resp = req._auditResponse || null;
        const pool = req.app.locals.pool;
        const traceId = req.traceId;
        setTimeout(() => {
          pool.execute(
            'UPDATE operation_logs SET responseResult=?, durationMs=? WHERE traceId=?',
            [resp, ms, traceId]
          ).catch(() => {});
        }, 30);
      }
      const rec = {
        traceId: req.traceId,
        method: req.method,
        path: req.originalUrl?.split('?')[0] || req.path,
        status: res.statusCode,
        ms,
        ip: req.ip,
        at: new Date().toISOString(),
      };
      recentRequests.push(rec);
      if (recentRequests.length > KEEP_STATS) recentRequests.shift();
      if (ms >= SLOW_MS) {
        slowRequests.push(rec);
        if (slowRequests.length > KEEP_SLOW) slowRequests.shift();
        try { onSlow?.(rec); } catch { /* 告警失败不影响请求 */ }
      }
    });
    next();
  };
}

/**
 * ④ 全局限流 + 分级限流
 * 白名单：健康检查不设限流（监控探针需要稳定通过）
 */
const PUBLIC_PATHS = ['/api/health', '/api/captcha', '/api/ip-check'];
const jsonLimit = (req, res) => res.status(429).json({
  success: false,
  message: '请求过于频繁，请稍后再试',
  code: 'RATE_LIMITED',
  traceId: req.traceId || undefined,
});

export function createRateLimiters() {
  const skipHealth = (req) => PUBLIC_PATHS.some((p) => req.path === p || req.originalUrl?.split('?')[0] === p);

  // 全局：默认 300 次/分钟
  const globalLimit = rateLimit({
    windowMs: +(process.env.RATE_WINDOW_MS || 60_000),
    max: +(process.env.RATE_MAX || 300),
    standardHeaders: 'draft-7', legacyHeaders: false,
    skip: skipHealth, handler: jsonLimit,
  });

  // 登录：15 分钟 10 次（与已有账号锁定形成双层防护）
  const loginLimit = rateLimit({
    windowMs: 15 * 60_000,
    max: +(process.env.LOGIN_RATE_MAX || 10),
    standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (req, res) => res.status(429).json({
      success: false, message: '登录尝试过于频繁，请15分钟后再试', locked: true, traceId: req.traceId || undefined
    }),
  });

  // 写操作（POST/PUT/DELETE）：60 次/分钟，读操作走全局
  const writeLimit = rateLimit({
    windowMs: 60_000,
    max: +(process.env.WRITE_RATE_MAX || 60),
    standardHeaders: 'draft-7', legacyHeaders: false,
    skip: (req) => skipHealth(req) || !['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method),
    handler: jsonLimit,
  });

  return (req, res, next) => globalLimit(req, res, () => writeLimit(req, res, next));
}

/** 仅对登录接口单独加严（在 server.js 的 /api/login 路由上挂） */
export function createLoginLimiter() {
  return rateLimit({
    windowMs: 15 * 60_000,
    max: +(process.env.LOGIN_RATE_MAX || 10),
    standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (req, res) => res.status(429).json({
      success: false, message: '登录尝试过于频繁，请15分钟后再试', locked: true, traceId: req.traceId || undefined
    }),
  });
}

/** 供 /monitor 读取的网关统计 */
export function getGatewayStats() {
  const now = Date.now();
  const byPath = {};
  for (const r of recentRequests) {
    const k = `${r.method} ${r.path}`;
    if (!byPath[k]) byPath[k] = { path: k, count: 0, totalMs: 0, maxMs: 0, errors: 0 };
    const s = byPath[k];
    s.count += 1; s.totalMs += r.ms;
    s.maxMs = Math.max(s.maxMs, r.ms);
    if (r.status >= 400) s.errors += 1;
  }
  const summary = Object.values(byPath)
    .map((s) => ({ ...s, avgMs: Math.round(s.totalMs / s.count) }))
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, 20);
  return {
    slowThresholdMs: SLOW_MS,
    totalRequests: recentRequests.length,
    slowCount: slowRequests.length,
    topEndpoints: summary,
    recentSlow: slowRequests.slice(-20).reverse(),
    sampledAt: new Date(now).toISOString(),
  };
}
