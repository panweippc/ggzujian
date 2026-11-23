import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pwdFingerprint, hashPassword, verifyPassword, validatePassword, generateRandomPassword,
  createSecurity, createCaptcha, genCaptchaSvg, createAudit, createRequireAuth, buildLoginPayload
} from '../src/index.js';

test('密码指纹：改密前后不同', () => {
  assert.equal(pwdFingerprint('abcdefghijklmnop'), 'abcdefghijkl');
  assert.notEqual(pwdFingerprint('abcdefghijklmnop'), pwdFingerprint('ZZZZZZZZZZZZmnop'));
});

test('bcrypt 哈希与校验', () => {
  const h = hashPassword('Test@2026pass');
  assert.ok(h.startsWith('$2'));
  assert.equal(verifyPassword('Test@2026pass', h), true);
  assert.equal(verifyPassword('wrong', h), false);
  assert.equal(verifyPassword('plain', 'plain'), true); // 兼容存量明文
});

test('强密码校验：各规则', () => {
  assert.equal(validatePassword('short', 'u'), '密码长度至少10位');
  assert.equal(validatePassword('abcdefghij', 'u'), '密码必须包含大写字母');
  assert.equal(validatePassword('Abcdefghij', 'u'), '密码必须包含数字');
  assert.equal(validatePassword('Abcdefgh1', 'u'), '密码长度至少10位');
  assert.equal(validatePassword('Abcdefgh1!', 'abc'), '密码不能包含用户名');
  assert.equal(validatePassword('Abcdefgh1!', 'u'), null);
});

test('随机密码满足复杂度', () => {
  const p = generateRandomPassword(12);
  assert.equal(p.length, 12);
  assert.equal(validatePassword(p, 'nobody'), null);
});

test('buildLoginPayload 顶层导出可用（新项目文档/示例依赖此路径）', () => {
  const { buildLoginPayload: fromInstance } = createSecurity({ secret: 'k' });
  const user = { id: 1, username: 'admin', password: hashPassword('Test@2026pass'), roleName: '管理员', tokenVersion: 3 };
  const a = buildLoginPayload(user);
  const b = fromInstance(user);
  assert.deepEqual(a, b);
  assert.equal(a.username, 'admin');
  assert.equal(a.role, '管理员');
  assert.equal(a.ver, 3);
  assert.equal(a.pwd, pwdFingerprint(user.password));
});

test('JWT 签发/校验与无感轮换', () => {
  const s = createSecurity({ secret: 'current-secret', previousSecret: 'old-secret', expires: '1h' });
  const payload = s.buildLoginPayload({ id: 1, username: 'admin', password: hashPassword('x'), roleName: '管理员', tokenVersion: 2 });
  const token = s.signToken(payload);
  const decoded = s.verifyToken(token);
  assert.equal(decoded.username, 'admin');
  assert.equal(decoded.ver, 2);
  assert.equal(decoded.role, '管理员');
});

test('SVG 验证码内容可读（E2E 依赖 <text>）', () => {
  const svg = genCaptchaSvg('AB12');
  const code = [...svg.matchAll(/<text[^>]*>([^<])<\/text>/g)].map(m => m[1]).join('');
  assert.equal(code, 'AB12');
});

test('验证码一次性消费 + 错误/过期分支', () => {
  const cap = createCaptcha();
  const decode = (item) => {
    assert.ok(item.svg.startsWith('data:image/svg+xml;base64,'));
    const raw = Buffer.from(item.svg.split(',')[1], 'base64').toString('utf8');
    return [...raw.matchAll(/<text[^>]*>([^<])<\/text>/g)].map(m => m[1]).join('');
  };
  const wrongCase = cap.generate();
  assert.equal(cap.verify(wrongCase.token, 'WRONG'), 'wrong'); // 错误码（同时消费）
  const okCase = cap.generate();
  assert.equal(cap.verify(okCase.token, decode(okCase).toLowerCase()), 'ok'); // 正确（同时消费）
  assert.equal(cap.verify(okCase.token, 'XXXX'), 'expired'); // 一次性：第二次已消费
  assert.equal(cap.verify('nonexistent', 'XXXX'), 'expired');
});

test('审计日志：pool 注入 + 默认值写入', async () => {
  const calls = [];
  const pool = { execute: async (sql, values) => { calls.push({ sql, values }); return [{ affectedRows: 1 }]; } };
  const audit = createAudit();
  await audit.createOperationLog(pool, { userId: 7, username: '张三', action: 'login', module: 'auth', detail: 'ok', ipAddress: '1.2.3.4' });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].sql.includes('INSERT INTO `operation_logs`'));
  assert.equal(calls[0].values[1], '张三');
  assert.equal(calls[0].values[2], 'login');
  // 回归：列与值必须一一对齐（曾把 NOW() 错放第 1 槽导致整体错位）
  const cols = calls[0].sql.split('(')[1].split(')')[0].split(', ');
  assert.equal(cols[0], 'userId');
  assert.equal(cols[cols.length - 1], 'createdAt');
  assert.ok(calls[0].sql.trim().endsWith(', NOW())'), '最后一列 createdAt 必须用 NOW()');
  assert.equal(calls[0].values[0], 7, 'userId 应写入第 1 个值槽');
  assert.equal(calls[0].values[calls[0].values.length - 1], '1.2.3.4', 'ipAddress 应在倒数第 1 个值槽');
});

test('审计日志：自定义表名/列名映射', async () => {
  let captured;
  const pool = { execute: async (sql, values) => { captured = { sql, values }; return [{}]; } };
  const audit = createAudit({ table: 'sys_log', columns: { username: 'operator', createdAt: 'create_time' } });
  await audit.log(pool, { username: '李四', action: 'update', module: 'user' });
  assert.ok(captured.sql.includes('`sys_log`'));
  assert.ok(captured.sql.includes('operator'));
  assert.ok(captured.sql.includes('create_time'));
});

test('鉴权中间件：白名单放行 + 无 token 401 + 正常注入 req.user', async () => {
  const { createSecurity } = await import('../src/security.js');
  const s = createSecurity({ secret: 'k' });
  const { requireAuth } = createRequireAuth({
    verifyToken: s.verifyToken,
    publicPaths: [{ method: 'GET', path: '/captcha' }]
  });
  const mkRes = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

  // 白名单
  let nextCalled = false;
  const r1 = mkRes();
  await requireAuth({ method: 'GET', path: '/captcha', headers: {} }, r1, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  // 无 token
  const r2 = mkRes();
  await requireAuth({ method: 'GET', path: '/users', headers: {} }, r2, () => {});
  assert.equal(r2.code, 401);

  // 正常
  const token = s.signToken({ username: 'emp_张三_5', role: '系统管理员' });
  const req = { method: 'GET', path: '/users', headers: { authorization: 'Bearer ' + token } };
  const r3 = mkRes();
  let ok = false;
  await requireAuth(req, r3, () => { ok = true; });
  assert.equal(ok, true);
  assert.equal(req.user.username, 'emp_张三_5');
  assert.equal(req.user.roleName, '系统管理员');
});

test('鉴权中间件：README 示例的 pwdFingerprint 单独返回也能触发改密拦截', async () => {
  const { createSecurity } = await import('../src/security.js');
  const s = createSecurity({ secret: 'k' });
  // README 推荐用法：findUserByUsername 只返回 { pwdFingerprint, tokenVersion }（不含 password 字段）
  const { requireAuth } = createRequireAuth({
    verifyToken: s.verifyToken,
    findUserByUsername: async () => ({ pwdFingerprint: 'NEWFINGERPRINT___', tokenVersion: 0 })
  });
  const mkRes = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  // token 里携带旧指纹
  const token = s.signToken({ username: 'admin', pwd: 'OLDFINGERPRINT__', ver: 0 });
  const req = { method: 'GET', path: '/users', headers: { authorization: 'Bearer ' + token } };
  const r = mkRes();
  await requireAuth(req, r, () => {});
  assert.equal(r.code, 401);
  assert.equal(r.body.message, '密码已修改，请重新登录');
});
