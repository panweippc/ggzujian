/**
 * 关键路径 2/3：鉴权（createRequireAuth 中间件工厂）
 * 直接构造 req/res 调用中间件，覆盖：OPTIONS 放行 / 白名单 / 无 token 401 /
 * 正常注入 req.user / 伪造 token 401 / 过期 token 401 / 改密拦截 / 换设备拦截 /
 * DB 校验失败不阻断（可配 onVerifyError）/ 自定义错误消息
 */
import { describe, it, expect, vi } from 'vitest';
import { createRequireAuth } from '@panweippc/auth-kit';
import { createSecurity, buildLoginPayload, hashPassword } from '@panweippc/auth-kit';

const security = createSecurity({ secret: 'auth-path-secret', expires: '1h' });

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function makeReq({ method = 'GET', path = '/api/anything', token, user } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return { method, path, headers, query: {}, user };
}

describe('鉴权路径 · 放行分支', () => {
  const auth = createRequireAuth({
    verifyToken: security.verifyToken,
    publicPaths: [
      { method: 'POST', path: '/login' },
      { method: 'GET', path: '/health' },
      { method: 'GET', path: '/public', prefix: true },
    ],
  });

  it('OPTIONS 预检直接放行', () => {
    const next = vi.fn();
    auth.requireAuth(makeReq({ method: 'OPTIONS', path: '/api/anything' }), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('白名单精确路径放行（无需 token）', () => {
    const next = vi.fn();
    auth.requireAuth(makeReq({ method: 'POST', path: '/login' }), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('白名单 prefix 路径放行子路径', () => {
    const next = vi.fn();
    auth.requireAuth(makeReq({ method: 'GET', path: '/public/nested/x' }), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('白名单 method 不匹配不放行', () => {
    const res = makeRes();
    const next = vi.fn();
    auth.requireAuth(makeReq({ method: 'GET', path: '/login' }), res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('鉴权路径 · token 校验', () => {
  const auth = createRequireAuth({ verifyToken: security.verifyToken });

  it('无 token → 401 未登录', () => {
    const res = makeRes();
    auth.requireAuth(makeReq(), res, vi.fn());
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toMatch(/未登录/);
  });

  it('合法 token → 注入 req.user（含 name/roleName 归一化）', () => {
    const token = security.signToken(buildLoginPayload({
      id: 1, username: 'admin', password: 'x', roleName: 'admin', tokenVersion: 0,
    }));
    const req = makeReq({ token });
    const res = makeRes();
    const next = vi.fn();
    auth.requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.username).toBe('admin');
    expect(req.user.roleName).toBe('admin');
    expect(req.user.name).toBe('admin');
  });

  it('伪造/篡改 token → 401 过期文案', () => {
    const res = makeRes();
    auth.requireAuth(makeReq({ token: 'not-a-jwt' }), res, vi.fn());
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toMatch(/过期|重新登录/);
  });

  it('从 query.token 取 token 也可通过（兼容）', () => {
    const token = security.signToken({ username: 'bob', role: 'user' });
    const req = makeReq();
    req.query.token = token;
    const next = vi.fn();
    auth.requireAuth(req, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('鉴权路径 · 二次校验（改密/换设备）', () => {
  const pwd = hashPassword('Test@2026pass', 8);
  const payload = buildLoginPayload({ id: 1, username: 'alice', password: pwd, role: 'user', tokenVersion: 1 });
  const token = security.signToken(payload);

  function withUser(user, messages = {}, onVerifyError) {
    return createRequireAuth({
      verifyToken: security.verifyToken,
      findUserByUsername: async () => user,
      normalizeUsername: (u) => u.replace(/^emp_/, ''),
      messages,
      onVerifyError,
    });
  }

  it('密码指纹不一致 → 401「密码已修改」', async () => {
    const auth = withUser({ pwdFingerprint: 'different', tokenVersion: 1 });
    const res = makeRes();
    const next = vi.fn();
    await auth.requireAuth(makeReq({ token }), res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toMatch(/密码已修改/);
    expect(next).not.toHaveBeenCalled();
  });

  it('会话版本不一致 → 401「其他设备」', async () => {
    const auth = withUser({ pwdFingerprint: payload.pwd, tokenVersion: 99 });
    const res = makeRes();
    await auth.requireAuth(makeReq({ token }), res, vi.fn());
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toMatch(/其他设备/);
  });

  it('指纹与版本都一致 → 放行', async () => {
    const auth = withUser({ pwdFingerprint: payload.pwd, tokenVersion: 1 });
    const next = vi.fn();
    await auth.requireAuth(makeReq({ token }), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('normalizeUsername 生效（emp_ 前缀归一）', async () => {
    const auth = withUser({ pwdFingerprint: payload.pwd, tokenVersion: 1 });
    const req = makeReq({ token: security.signToken({ ...payload, username: 'emp_alice' }) });
    const next = vi.fn();
    await auth.requireAuth(req, makeRes(), next);
    expect(req.user.name).toBe('alice');
  });

  it('DB 校验抛错不阻断主流程，且回调收到错误', async () => {
    const onVerifyError = vi.fn();
    const auth = createRequireAuth({
      verifyToken: security.verifyToken,
      findUserByUsername: async () => { throw new Error('db down'); },
      onVerifyError,
    });
    const next = vi.fn();
    await auth.requireAuth(makeReq({ token }), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(onVerifyError).toHaveBeenCalledTimes(1);
  });

  it('自定义消息生效', async () => {
    const auth = withUser({ pwdFingerprint: 'x', tokenVersion: 1 }, { pwdChanged: '自定义改密提示' });
    const res = makeRes();
    await auth.requireAuth(makeReq({ token }), res, vi.fn());
    expect(res.body.message).toBe('自定义改密提示');
  });
});
