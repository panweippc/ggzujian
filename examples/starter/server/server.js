/**
 * 新项目后端接线示例 —— 展示 @panweippc/auth-kit 全部能力
 * 复制后只需改：.env 填自己的值、findUserByUsername 按自己的表写、业务路由往下加
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import path from 'node:path';
import {
  createSecurity, createCaptcha, createRequireAuth,
  createAudit, createSecurityAlert,
  verifyPassword, validatePassword, pwdFingerprint, buildLoginPayload,
  hashPassword
} from '@panweippc/auth-kit';

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: +(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

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
    { method: 'GET', path: '/health' }
  ],
  findUserByUsername: async (username) => {
    const [rows] = await pool.execute('SELECT password, token_version FROM users WHERE username = ?', [username]);
    const u = rows[0];
    if (!u) return null;
    return { pwdFingerprint: pwdFingerprint(u.password), tokenVersion: u.token_version || 0 };
  }
});

const app = express();
app.use(cors());
app.use(express.json());

// —— 公开接口 ——
app.get('/api/captcha', (req, res) => {
  const { token, svg } = captcha.generate();
  res.json({ success: true, data: { token, svg } });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', db: 'up' }));

app.post('/api/login', async (req, res) => {
  const { username, password, captcha: code, captchaToken } = req.body;
  const c = captcha.verify(captchaToken, code);
  if (c === 'expired') return res.status(401).json({ success: false, message: '验证码已过期' });
  if (c === 'wrong') return res.status(401).json({ success: false, message: '验证码错误' });

  const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password)) {
    alert.writeSecurityAlert({ level: 'WARN', type: 'login_fail', username, ip: req.ip });
    return res.status(401).json({ success: false, message: '账号或密码错误' });
  }
  const token = signToken(buildLoginPayload({
    id: user.id, username: user.username, password: user.password,
    roleName: user.role, tokenVersion: user.token_version || 0
  }));
  await audit.createOperationLog(pool, { userId: user.id, username: user.username, action: 'login', module: 'auth', ipAddress: req.ip });
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
  await audit.createOperationLog(pool, { username: req.user.name, action: 'create_user', module: 'user', targetName: username });
  res.json({ success: true, message: '创建成功' });
});

// —— 挂载鉴权：之后的接口都需要 token ——
app.use('/api', requireAuth);

app.get('/api/users', async (req, res) => {
  const [rows] = await pool.execute('SELECT id, username, role FROM users');
  res.json({ success: true, data: rows });
});

app.get('/api/logs', async (req, res) => {
  const { module, action, page = 1, pageSize = 30 } = req.query;
  const clauses = [], params = [];
  if (module) { clauses.push('module = ?'); params.push(module); }
  if (action) { clauses.push('action = ?'); params.push(action); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const offset = (Number(page) - 1) * Number(pageSize);
  const [[{ total }]] = await pool.execute(`SELECT COUNT(*) total FROM operation_logs ${where}`, params);
  const [rows] = await pool.execute(`SELECT * FROM operation_logs ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`, [...params, +pageSize, offset]);
  res.json({ success: true, data: rows, total });
});

app.listen(3010, () => console.log('starter server listening on http://localhost:3010'));
