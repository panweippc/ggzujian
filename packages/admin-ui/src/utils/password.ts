/**
 * 前端密码强度校验（与 @panweippc/auth-kit 后端 validatePassword 规则一致）
 * 纯函数，无依赖，可在任意 Vue 项目使用。
 */
const WEAK_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1',
  'qwerty', 'qwerty123', 'abc123', 'abc12345', 'admin', 'admin123',
  'letmein', 'welcome', 'iloveyou', 'monkey', 'dragon', '11111111',
  '00000000', 'a123456789', '1qaz2wsx', 'qwertyuiop', 'password123'
]);

export interface PasswordRuleOptions {
  minLength?: number;
  requireUpper?: boolean;
  requireLower?: boolean;
  requireDigit?: boolean;
  requireSpecial?: boolean;
  forbidUsername?: boolean;
}

/** @returns {string|null} 错误信息；null 表示通过 */
export function validatePassword(pwd: string, username?: string, opts: PasswordRuleOptions = {}): string | null {
  const {
    minLength = 10,
    requireUpper = true, requireLower = true, requireDigit = true, requireSpecial = true,
    forbidUsername = true
  } = opts;
  const s = String(pwd || '');
  if (s.length < minLength) return `密码长度至少${minLength}位`;
  if (requireLower && !/[a-z]/.test(s)) return '密码必须包含小写字母';
  if (requireUpper && !/[A-Z]/.test(s)) return '密码必须包含大写字母';
  if (requireDigit && !/\d/.test(s)) return '密码必须包含数字';
  if (requireSpecial && !/[^A-Za-z0-9]/.test(s)) return '密码必须包含特殊字符（如 !@#$%^&*）';
  if (WEAK_PASSWORDS.has(s.toLowerCase())) return '密码过于常见，请使用更复杂的密码';
  if (username && forbidUsername && s.toLowerCase().includes(String(username).toLowerCase())) return '密码不能包含用户名';
  return null;
}

/** 常驻提示文案（供输入框下方展示） */
export function passwordRuleHint(opts: PasswordRuleOptions = {}): string {
  const minLength = opts.minLength ?? 10;
  const parts = [`至少${minLength}位`];
  if (opts.requireLower !== false) parts.push('小写字母');
  if (opts.requireUpper !== false) parts.push('大写字母');
  if (opts.requireDigit !== false) parts.push('数字');
  if (opts.requireSpecial !== false) parts.push('特殊字符');
  if (opts.forbidUsername !== false) parts.push('不含用户名');
  return parts.join(' + ');
}

export default { validatePassword, passwordRuleHint };
