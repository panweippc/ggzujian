/**
 * 认证安全工具（纯函数，无业务耦合）
 *
 * 设计变更（相对 qygl 原版）：
 *  1. JWT 密钥不再在模块加载时读死 process.env，改为 createSecurity(config) 工厂注入，
 *     便于多项目复用、测试与密钥轮换。保留 defaultSecurity() 兼容从环境变量读取。
 *  2. 其余密码学逻辑（密码指纹、bcrypt、强密码校验、随机密码）保持不变。
 */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

/** 从密码哈希提取"版本指纹"（前 12 位），改密后旧 token 失效 */
export const pwdFingerprint = (pwd) => String(pwd || '').slice(0, 12);

export const isHashed = (p) => typeof p === 'string' && /^\$2[aby]\$/.test(p);
export const hashPassword = (plain, rounds = 10) => bcrypt.hashSync(String(plain), rounds);
export const verifyPassword = (plain, stored) => {
  if (!stored) return false;
  if (isHashed(stored)) return bcrypt.compareSync(String(plain), stored);
  return String(stored) === String(plain);
};

const WEAK_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1',
  'qwerty', 'qwerty123', 'abc123', 'abc12345', 'admin', 'admin123',
  'letmein', 'welcome', 'iloveyou', 'monkey', 'dragon', '11111111',
  '00000000', 'a123456789', '1qaz2wsx', 'qwertyuiop', 'password123'
]);

/**
 * 强密码复杂度校验。
 * @returns {string|null} 错误信息；null 表示通过
 */
export function validatePassword(pwd, username, opts = {}) {
  const {
    minLength = 10,
    requireUpper = true, requireLower = true, requireDigit = true, requireSpecial = true,
    forbidUsername = true, weakList = WEAK_PASSWORDS
  } = opts;
  const s = String(pwd || '');
  if (s.length < minLength) return `密码长度至少${minLength}位`;
  if (requireLower && !/[a-z]/.test(s)) return '密码必须包含小写字母';
  if (requireUpper && !/[A-Z]/.test(s)) return '密码必须包含大写字母';
  if (requireDigit && !/\d/.test(s)) return '密码必须包含数字';
  if (requireSpecial && !/[^A-Za-z0-9]/.test(s)) return '密码必须包含特殊字符（如 !@#$%^&*）';
  if (weakList.has(s.toLowerCase())) return '密码过于常见，请使用更复杂的密码';
  if (username && forbidUsername && s.toLowerCase().includes(String(username).toLowerCase())) return '密码不能包含用户名';
  return null;
}

/** 生成符合强密码要求的随机密码（含大小写/数字/特殊字符） */
export function generateRandomPassword(length = 12) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digit = '23456789';
  const special = '!@#$%^&*';
  const parts = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digit[crypto.randomInt(digit.length)],
    special[crypto.randomInt(special.length)]
  ];
  const all = upper + lower + digit + special;
  for (let i = parts.length; i < length; i++) parts.push(all[crypto.randomInt(all.length)]);
  for (let i = parts.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }
  return parts.join('');
}

/**
 * 创建 JWT 工具实例（依赖注入密钥）。
 * @param {object} config
 * @param {string} config.secret 当前 JWT 密钥（必填）
 * @param {string} [config.previousSecret] 上一把密钥，用于无感轮换
 * @param {string} [config.expires='12h'] 有效期
 * @param {boolean} [config.allowWeakSecret=false] 生产环境是否允许弱/缺失密钥（强烈不建议）
 */
export function createSecurity(config = {}) {
  let secret = config.secret ?? process.env.JWT_SECRET;
  const previousSecret = config.previousSecret ?? process.env.JWT_SECRET_PREVIOUS ?? null;
  const expires = config.expires ?? process.env.JWT_EXPIRES ?? '12h';

  if (!secret) {
    if (process.env.NODE_ENV === 'production' && !config.allowWeakSecret) {
      throw new Error('安全配置错误：生产环境必须提供 JWT secret');
    }
    secret = crypto.randomBytes(64).toString('hex');
  }

  /** 签发 token；payload 由调用方决定，工具不假设用户表结构 */
  const signToken = (payload, options = {}) => jwt.sign(payload, secret, { expiresIn: expires, ...options });

  /** 校验 token（支持密钥无感轮换） */
  const verifyToken = (token) => {
    try {
      return jwt.verify(token, secret);
    } catch (err) {
      if (previousSecret) {
        try { return jwt.verify(token, previousSecret); } catch (_) { /* 落到下方抛出原错 */ }
      }
      throw err;
    }
  };

  /**
   * 构造标准登录 payload（qygl/wygl 通用字段）。
   * 业务可选择使用或自行构造。
   */
  const buildLoginPayload = (user) => ({
    id: user.id,
    username: user.username,
    role: user.roleName || user.role || '',
    pwd: pwdFingerprint(user.password),
    ver: user.tokenVersion || 0
  });

  return { signToken, verifyToken, buildLoginPayload, secret, expires };
}

/** 兼容旧用法的默认实例（从环境变量读取） */
export function defaultSecurity(config = {}) {
  return createSecurity({ allowWeakSecret: false, ...config });
}

export default {
  pwdFingerprint, isHashed, hashPassword, verifyPassword,
  validatePassword, generateRandomPassword, createSecurity, defaultSecurity
};
