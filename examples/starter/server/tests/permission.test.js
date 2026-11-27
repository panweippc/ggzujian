/**
 * 关键路径 3/3：权限（adminOnly 角色判定）
 * 使用公共中间件 middleware/role.js（权威实现），覆盖：
 *   role=admin / 系统管理员 / 总经理 放行；name=admin 兜底放行；
 *   普通 user 403；无 user 403；roleName 字段兼容；role 与 roleName 优先级
 */
import { describe, it, expect, vi } from 'vitest';
import { isAdmin, adminOnly, ADMIN_ROLES } from '../middleware/role.js';

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe('权限路径 · 管理员角色放行', () => {
  it.each(ADMIN_ROLES)('role=%s 放行', (role) => {
    expect(isAdmin({ user: { role } })).toBe(true);
    const next = vi.fn();
    adminOnly({ user: { role } }, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('name=admin 兜底放行（无 role 字段）', () => {
    expect(isAdmin({ user: { name: 'admin' } })).toBe(true);
    const next = vi.fn();
    adminOnly({ user: { name: 'admin' } }, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('roleName=系统管理员 兼容放行', () => {
    const req = { user: { roleName: '系统管理员' } };
    expect(isAdmin(req)).toBe(true);
  });

  it('role 为空但 roleName=admin 放行', () => {
    expect(isAdmin({ user: { role: '', roleName: 'admin' } })).toBe(true);
  });
});

describe('权限路径 · 非管理员拒绝', () => {
  it.each([
    { user: { role: 'user' } },
    { user: { role: 'staff', name: 'zhangsan' } },
    { user: {} },
    {},
  ])('拒绝：%j', (req) => {
    expect(isAdmin(req)).toBe(false);
    const res = makeRes();
    const next = vi.fn();
    adminOnly(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, message: '无权限，仅管理员可操作' });
    expect(next).not.toHaveBeenCalled();
  });

  it('role 优先级高于 roleName：role=user 即使 roleName=admin 也拒绝', () => {
    const req = { user: { role: 'user', roleName: 'admin' } };
    expect(isAdmin(req)).toBe(false);
    const res = makeRes();
    adminOnly(req, res, vi.fn());
    expect(res.statusCode).toBe(403);
  });
});
