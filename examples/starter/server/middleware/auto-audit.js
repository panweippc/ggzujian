/**
 * 网关级自动审计中间件（方案 A：全留痕）
 * 挂载位置：auditContextMiddleware 之后、requireAuth 之前。
 *
 * 原理：在 res 'finish' 时统一落库——
 *   ① 写操作（POST/PUT/PATCH/DELETE）默认全记；GET 需 AUDIT_READS=true 才记（避免日志爆炸）
 *   ② 路由已显式调用 writeAudit() 的请求（req._auditWritten）跳过，避免重复记两条
 *   ③ 请求/响应参数脱敏复用 auditContextMiddleware 采集的 _auditRequest/_auditResponse
 *   ④ TraceID / 耗时 / IP / 操作人全自动采集，无需路由埋点
 *   ⑤ 任何审计异常都被吞掉，绝不影响业务响应
 *
 * 环境变量：
 *   AUTO_AUDIT_ENABLED=false  关闭自动审计（默认开启）
 *   AUDIT_READS=true          连 GET 查询也记录（默认关闭）
 */
import { writeAudit } from './audit.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// 高频/无业务意义路径：永不自动记录（否则探针会把日志表冲垮）
const EXCLUDE = [
  /^\/api\/health$/,
  /^\/api\/captcha$/,
  /^\/api\/weather$/,
  /^\/api\/ip-check$/,
  /^\/api\/monitor$/,
  /^\/uploads\//,
];

// 路径首段 → 模块名（未命中则原样使用首段）
const MODULE_MAP = {
  login: 'auth', logout: 'auth', 'change-password': 'auth', totp: 'security',
  users: 'user', profile: 'user', roles: 'system', menus: 'system',
  departments: 'system', backups: 'system', employees: 'employee',
  'dict-items': 'dict', 'dict-categories': 'dict', configs: 'config',
  'config-history': 'config', tasks: 'task', sessions: 'session',
  'ip-whitelist': 'security', 'base-data': 'base_data',
  files: 'file', messages: 'message', logs: 'audit',
};

const ACTION_BY_METHOD = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete', GET: 'read' };

function inferModule(pathname) {
  const seg = pathname.replace(/^\/api\//, '').split('/')[0] || '';
  return MODULE_MAP[seg] || seg || 'api';
}

function inferAction(method, pathname) {
  if (pathname === '/api/login') return 'login';
  if (pathname === '/api/logout') return 'logout';
  if (/\/change-password$/.test(pathname)) return 'change_password';
  if (/\/rollback$/.test(pathname)) return 'rollback';
  if (/\/(enable|disable)$/.test(pathname)) return 'toggle';
  return ACTION_BY_METHOD[method] || method.toLowerCase();
}

/** 取操作人：优先登录用户，其次请求体里的 username，最后匿名 */
function operatorOf(req) {
  return req?.user?.name || req?.user?.username || req?.user?.userName ||
    req?.body?.username || '匿名';
}

export function autoAuditMiddleware() {
  const enabled = String(process.env.AUTO_AUDIT_ENABLED || 'true').toLowerCase() !== 'false';
  const auditReads = String(process.env.AUDIT_READS || '').toLowerCase() === 'true';

  return (req, res, next) => {
    if (enabled) {
      res.on('finish', () => {
        try {
          const pathname = (req.originalUrl || req.path || '').split('?')[0];
          const method = req.method;
          // 只记写操作；GET 需显式开启
          if (!WRITE_METHODS.has(method) && !(auditReads && method === 'GET')) return;
          if (EXCLUDE.some((re) => re.test(pathname))) return;
          // 路由已手动审计 → 跳过，避免重复落库
          if (req._auditWritten) return;

          const pool = req.app?.locals?.pool;
          if (!pool) return;

          const action = inferAction(method, pathname);
          const module = inferModule(pathname);
          const detail = `[auto] ${method} ${pathname} → ${res.statusCode}`;
          const durationMs = req.durationMs || 0;

          // 走统一 writeAudit，自动获得哈希链与降级能力；finish 阶段设置 _auditWritten 无副作用
          writeAudit(pool, req, {
            userId: String(req.user?.id || ''),
            username: operatorOf(req),
            action, module, detail, durationMs,
            ipAddress: req.ip || '',
          }).catch(() => { /* 审计失败绝不影响业务响应 */ });
        } catch { /* 同上 */ }
      });
    }
    next();
  };
}
