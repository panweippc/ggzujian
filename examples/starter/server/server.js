/**
 * 新项目后端接线示例 —— 展示 @panweippc/auth-kit 全部能力
 * 复制后只需改：.env 填自己的值、findUserByUsername 按自己的表写、业务路由往下加
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import {
  createSecurity, createCaptcha, createRequireAuth,
  createAudit, createSecurityAlert,
  verifyPassword, validatePassword, pwdFingerprint, buildLoginPayload,
  hashPassword
} from '@panweippc/auth-kit';
import systemRouter from './routes/system.js';
import commonRouter from './routes/common.js';
import fileRouter from './routes/files.js';
import messageRouter from './routes/messages.js';
import baseDataRouter from './routes/base-data.js';
import recycleRouter, { purgeExpired } from './routes/recycle.js';
import auditExtRouter from './routes/audit-ext.js';
import gatewayExtRouter from './routes/gateway-ext.js';
import enterpriseRouter from './routes/enterprise.js';
import platformRouter from './routes/platform.js';
import platformOpsRouter from './routes/platform-ops.js';
import {
  traceMiddleware, auditContextMiddleware, timingMiddleware, createRateLimiters, createLoginLimiter,
  maintenanceMiddleware, versionHeaderMiddleware,
} from './middleware/gateway.js';
import { idempotencyMiddleware } from './middleware/idempotency.js';
import { writeAudit } from './middleware/audit.js';
import { autoAuditMiddleware } from './middleware/auto-audit.js';
import { createDataSource } from './services/datasource.js';

// 统一数据接入层：业务通过 dataSource.query/execute/transaction 访问数据，屏蔽底层驱动差异。
// app.locals.pool 指向原生连接池，保持已有路由（req.app.locals.pool.execute）零改动兼容。
const dataSource = createDataSource();
const pool = dataSource.raw;
console.log(`[datasource] driver=${dataSource.driver}${dataSource.__placeholder ? ' (预留适配器，尚未接入真实驱动)' : ''}`);

// ① JWT
const { signToken, verifyToken } = createSecurity({
  secret: process.env.JWT_SECRET,
  previousSecret: process.env.JWT_SECRET_PREVIOUS,
  expires: process.env.JWT_EXPIRES || '12h'
});
// ② 验证码
const captcha = createCaptcha({ ttl: 5 * 60 * 1000 });
// ③ 操作日志（列名与默认一致，无需 columns；不同则传 columns 映射）
const audit = createAudit({ table: 'operation_logs' });
// ④ 安全告警（logDir 必须显式传）
const alert = createSecurityAlert({
  logDir: path.join(process.cwd(), 'logs'),
  webhookUrl: process.env.ALERT_WEBHOOK_URL
});
// ⑤ 鉴权中间件
const { requireAuth } = createRequireAuth({
  verifyToken,
  publicPaths: [
    { method: 'POST', path: '/login' },
    { method: 'GET', path: '/captcha' },
    { method: 'GET', path: '/health' },
    { method: 'GET', path: '/weather' }
  ],
  findUserByUsername: async (username) => {
    const [rows] = await pool.execute('SELECT password, token_version FROM users WHERE username = ?', [username]);
    const u = rows[0];
    if (!u) return null;
    return { pwdFingerprint: pwdFingerprint(u.password), tokenVersion: u.token_version || 0 };
  }
});

const app = express();
// 供路由模块共享数据库连接池（qygl 约定：req.app.locals.pool）
app.locals.pool = pool;
app.locals.alert = alert; // 供网关慢接口告警 / 消息中心复用
// ⭐ 统一网关（底座第3部分）：CORS → TraceID → 限流 → 计时 → 审计上下文 → body 解析
// 暴露 X-Request-Id 给前端，便于全链路检索
app.use(cors({ exposedHeaders: ['X-Request-Id', 'Retry-After', 'X-API-Version'] }));
app.use(traceMiddleware);
app.use(versionHeaderMiddleware());
app.use(maintenanceMiddleware());
app.use(createRateLimiters());
app.use(timingMiddleware((rec) => {
  // 慢接口告警：走现有安全告警通道（有 webhook 就推，没有只落日志文件）
  alert.writeSecurityAlert({
    level: 'WARN', type: 'slow_request',
    detail: `${rec.method} ${rec.path} 耗时 ${rec.ms}ms (阈值 ${process.env.SLOW_REQUEST_MS || 800}ms)`,
    ip: rec.ip, traceId: rec.traceId,
  });
}));
app.use(express.json({ limit: '10mb' }));
app.use(idempotencyMiddleware());
app.use(auditContextMiddleware);
// ⭐ 全留痕（方案A）：网关层自动记录所有写操作，路由无需手动埋点。
// 放在 auditContextMiddleware 之后以确保能采集请求/响应；显式 writeAudit 的请求会自动去重。
app.use(autoAuditMiddleware());
// 静态托管上传的文件（头像 + 统一文件服务）
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// —— 公开接口 ——
app.get('/api/captcha', (req, res) => {
  const { token, svg } = captcha.generate();
  res.json({ success: true, data: { token, svg } });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', db: 'up' }));

// 天气代理：登录页直连国外 API 常被墙，改由服务端转发（Node 18+ 原生 fetch）
app.get('/api/weather', async (req, res) => {
  const lat = process.env.WEATHER_LAT || '40.8424';
  const lon = process.env.WEATHER_LON || '111.7490';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=Asia%2FShanghai`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) throw new Error('upstream ' + resp.status);
    const json = await resp.json();
    const cur = json?.current;
    if (!cur) throw new Error('no current');
    res.json({ success: true, data: { temp: Math.round(cur.temperature_2m), code: cur.weather_code } });
  } catch (e) {
    res.json({ success: false, message: 'weather unavailable', data: null });
  }
});

// ===== 登录失败锁定（内存计数，防暴力破解）=====
// 生产环境建议换成 Redis；骨架用内存演示，重启清零。
const LOGIN_MAX_FAILS = +(process.env.LOGIN_MAX_FAILS || 5);
const LOGIN_LOCK_MS = +(process.env.LOGIN_LOCK_MS || 15 * 60 * 1000);
const loginFails = new Map(); // key: username|ip → { count, firstAt, lockedUntil }
const failKey = (u, ip) => `${u}|${ip}`;
const cleanFails = () => { const now = Date.now(); for (const [k, v] of loginFails) if (v.lockedUntil && v.lockedUntil < now && now - v.firstAt > LOGIN_LOCK_MS * 2) loginFails.delete(k); };
setInterval(cleanFails, 60_000).unref?.();

app.post('/api/login', createLoginLimiter(), async (req, res) => {
  const { username, password, captcha: code, captchaToken } = req.body;
  const c = captcha.verify(captchaToken, code);
  if (c === 'expired') return res.status(401).json({ success: false, message: '验证码已过期' });
  if (c === 'wrong') return res.status(401).json({ success: false, message: '验证码错误' });

  // 锁定检查
  const key = failKey(username, req.ip);
  const st = loginFails.get(key);
  if (st?.lockedUntil && Date.now() < st.lockedUntil) {
    const mins = Math.ceil((st.lockedUntil - Date.now()) / 60000);
    alert.writeSecurityAlert({ level: 'HIGH', type: 'login_locked', username, ip: req.ip });
    return res.status(423).json({ success: false, locked: true, retryAfterMin: mins, message: `账号已锁定，请 ${mins} 分钟后重试` });
  }

  const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password)) {
    const rec = loginFails.get(key) || { count: 0, firstAt: Date.now(), lockedUntil: 0 };
    rec.count += 1;
    if (rec.count >= LOGIN_MAX_FAILS) {
      rec.lockedUntil = Date.now() + LOGIN_LOCK_MS;
      alert.writeSecurityAlert({ level: 'HIGH', type: 'login_brute_force', username, ip: req.ip, detail: `连续 ${rec.count} 次登录失败，账号已锁定 ${LOGIN_LOCK_MS / 60000} 分钟` });
    } else {
      alert.writeSecurityAlert({ level: 'WARN', type: 'login_fail', username, ip: req.ip });
    }
    loginFails.set(key, rec);
    const left = Math.max(0, LOGIN_MAX_FAILS - rec.count);
    return res.status(401).json({ success: false, message: '账号或密码错误', remaining: left, locked: left === 0 });
  }
  loginFails.delete(key); // 登录成功清除失败记录
  const token = signToken(buildLoginPayload({
    id: user.id, username: user.username, password: user.password,
    roleName: user.role, tokenVersion: user.token_version || 0
  }));
  await writeAudit(pool, req, {
    userId: user.id, username: user.username, action: 'login', module: 'auth', ipAddress: req.ip,
  }).catch(() => {});
  res.json({ success: true, data: { token, username: user.username, role: user.role } });
});

// 示例：新增用户时校验密码强度（前后端规则一致）
app.post('/api/users', requireAuth, async (req, res) => {
  const { username, password, role } = req.body;
  const err = validatePassword(password, username);
  if (err) return res.status(400).json({ success: false, message: err });
  await pool.execute(
    'INSERT INTO users(username, password, role, token_version) VALUES(?,?,?,0)',
    [username, hashPassword(password), role || 'user']
  );
  await writeAudit(pool, req, { action: 'create_user', module: 'user', targetName: username });
  res.json({ success: true, message: '创建成功' });
});

// IP 白名单校验（登录页可公开访问；未启用白名单时放行）
app.get('/api/ip-check', async (req, res) => {
  try {
    const [[cfg]] = await pool.execute("SELECT configValue FROM app_configs WHERE configKey='security.ipWhitelistEnabled'");
    const enabled = String(cfg?.configValue || '').includes('true') || cfg?.configValue === '1';
    if (!enabled) return res.json({ success: true, allowed: true });
    const clientIp = (req.ip || '').replace('::ffff:', '');
    const [rows] = await pool.execute('SELECT ip FROM ip_whitelist');
    const inCidr = (ip, cidr) => {
      if (!cidr.includes('/')) return ip === cidr;
      const [base, bits] = cidr.split('/');
      const toLong = (s) => s.split('.').reduce((a, n) => (a << 8) + (parseInt(n, 10) || 0), 0) >>> 0;
      const mask = (0xffffffff << (32 - parseInt(bits, 10))) >>> 0;
      return (toLong(ip) & mask) === (toLong(base) & mask);
    };
    res.json({ success: true, allowed: rows.some((r) => inCidr(clientIp, r.ip)), ip: clientIp });
  } catch { res.json({ success: true, allowed: true }); }
});

// —— 挂载鉴权：之后的接口都需要 token ——
app.use('/api', requireAuth);

// 系统管理接口（用户/角色/菜单/部门/备份/个人中心）—— 从 qygl 迁移
app.use('/api', systemRouter);

// 公共组件接口（字典/配置/定时任务/会话/IP白名单/监控/TOTP）
app.use('/api', commonRouter);

// 公共基础数据（组织机构 / 行政区划 / 行业分类）
app.use('/api', baseDataRouter);

// 统一文件服务（本地存储 + 对象存储预留适配层）与统一消息通道（B档预留）
app.use('/api', fileRouter);
app.use('/api', messageRouter);

// 全局回收站（软删快照 / 恢复 / 彻底清除 / 过期自动清理）
app.use('/api', recycleRouter);

// 审计延伸（哈希链校验 / 归档 / 增强查询 / 统计）
app.use('/api', auditExtRouter);

// 网关运维（Prometheus /metrics 公开；API文档 / 维护模式在 /api 下）
app.use(gatewayExtRouter);

// 业务底座补全（字典多语言 / 消息回执 / 分片上传 / 任务历史 / 数据权限规则）
app.use('/api', enterpriseRouter);

// 平台化能力（工作流/表单/报表/多租户/合规/集成）与 稳定性/可观测/AI
app.use('/api', platformRouter);
app.use('/api', platformOpsRouter);
// 回收站过期自动清除：每小时扫描一次，删除超过保留期的快照及其物理文件
setInterval(() => {
  purgeExpired(pool).then((n) => {
    if (n > 0) console.log(`[recycle] 自动清除 ${n} 条过期记录`);
  }).catch(() => {});
}, 60 * 60 * 1000).unref?.();

// 头像读取是公开静态资源，个人中心 <el-avatar> 直接加载，无需 token
// （上传接口在 systemRouter 内，受 requireAuth 保护）

app.get('/api/users', async (req, res) => {
  const [rows] = await pool.execute('SELECT id, username, role FROM users');
  res.json({ success: true, data: rows });
});

app.get('/api/logs', async (req, res) => {
  const { module, action, traceId, page = 1, pageSize = 30 } = req.query;
  const clauses = [], params = [];
  if (module) { clauses.push('module = ?'); params.push(module); }
  if (action) { clauses.push('action = ?'); params.push(action); }
  if (traceId) { clauses.push('traceId = ?'); params.push(String(traceId).slice(0, 64)); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const offset = (Number(page) - 1) * Number(pageSize);
  const [[{ total }]] = await pool.execute(`SELECT COUNT(*) total FROM operation_logs ${where}`, params);
  const [rows] = await pool.execute(`SELECT * FROM operation_logs ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`, [...params, +pageSize, offset]);
  res.json({ success: true, data: rows, total });
});

app.listen(3011, () => console.log('starter server listening on http://localhost:3011'));
