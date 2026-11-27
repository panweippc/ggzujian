/**
 * 统一角色权限中间件（公共实现）
 * 历史原因：多个路由文件各自内联了 adminOnly，判定口径基本一致但文案略有差异。
 * 本文件提供权威实现，供鉴权测试与新代码引用；旧路由保留原有内联实现以避免行为突变。
 */
export const ADMIN_ROLES = ['admin', '系统管理员', '总经理'];

export function isAdmin(req) {
  const role = req?.user?.role || req?.user?.roleName || '';
  const name = req?.user?.name || req?.user?.username || '';
  return ADMIN_ROLES.includes(role) || name === 'admin';
}

export function adminOnly(req, res, next) {
  return isAdmin(req)
    ? next()
    : res.status(403).json({ success: false, message: '无权限，仅管理员可操作' });
}

export default { isAdmin, adminOnly, ADMIN_ROLES };
