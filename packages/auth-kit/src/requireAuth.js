/**
 * 通用鉴权中间件工厂（Express）
 *
 * 设计变更（相对 qygl 原版）：
 *  1. 用户查询、角色归一化、密码指纹/会话版本校验全部通过 config 回调注入，
 *     不再写死 users 表 / emp_ 前缀 / req.app.locals.pool。
 *  2. 公开路径白名单可配置。
 *
 * 用法：
 *   const auth = createRequireAuth({
 *     verifyToken,
 *     findUserByUsername: async (username) => rows[0] || null,
 *     normalizeUsername: (u) => u.replace(/^emp_/, '').split('_')[0],
 *     publicPaths: [{ method:'POST', path:'/login' }, ...],
 *   });
 *   app.use('/api', auth.requireAuth);
 */
const DEFAULT_PUBLIC = [
  { method: 'POST', path: '/login' },
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/captcha' }
];

export function createRequireAuth(config = {}) {
  if (typeof config.verifyToken !== 'function') {
    throw new Error('createRequireAuth: 必须提供 verifyToken 函数');
  }
  const {
    verifyToken,
    findUserByUsername = null,   // async (username) => user|null，用于密码指纹/会话版本二次校验
    normalizeUsername = null,    // (decodedUsername) => realName
    publicPaths = DEFAULT_PUBLIC,
    messages = {}
  } = config;

  const M = {
    noToken: '未登录',
    pwdChanged: '密码已修改，请重新登录',
    otherDevice: '账号已在其他设备登录，请重新登录',
    expired: '登录已过期，请重新登录',
    ...messages
  };

  const isPublic = (method, path) => publicPaths.some(p => {
    if (p.method && p.method !== method) return false;
    if (p.prefix) return path === p.path || path.startsWith(p.path + '/');
    return path === p.path;
  });

  async function requireAuth(req, res, next) {
    if (req.method === 'OPTIONS') return next();
    if (isPublic(req.method, req.path)) return next();

    const headerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const token = headerToken || req.query?.token || '';
    if (!token) return res.status(401).json({ success: false, message: M.noToken });

    try {
      const decoded = verifyToken(token);
      const realName = normalizeUsername ? normalizeUsername(decoded.username || '') : (decoded.username || '');

      // 可选的密码指纹 / 会话版本校验（项目按需提供 findUserByUsername）
      if (findUserByUsername && decoded.pwd) {
        try {
          const user = await findUserByUsername(realName);
          if (user) {
            if (user.pwdFingerprint !== undefined && decoded.pwd !== undefined && user.pwdFingerprint !== decoded.pwd) {
              return res.status(401).json({ success: false, message: M.pwdChanged });
            }
            if (user.tokenVersion !== undefined && decoded.ver !== undefined && user.tokenVersion !== decoded.ver) {
              return res.status(401).json({ success: false, message: M.otherDevice });
            }
          }
        } catch (dbErr) {
          // 校验失败不阻断主流程（与原实现一致），仅记录
          if (config.onVerifyError) config.onVerifyError(dbErr);
        }
      }

      req.user = {
        ...decoded,
        name: realName,
        roleName: decoded.role || decoded.roleName || ''
      };
      next();
    } catch (e) {
      return res.status(401).json({ success: false, message: M.expired });
    }
  }

  return { requireAuth, isPublic };
}

export default { createRequireAuth };
