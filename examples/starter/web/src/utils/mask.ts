/**
 * 敏感信息脱敏工具（纯前端展示层，零依赖）
 * 手机号/身份证/邮箱/姓名/银行卡/通用 IP。新项目直接复制到 utils 用。
 */

/** 手机号：13800001234 → 138****1234 */
export const maskPhone = (v?: string | number) => {
  const s = String(v ?? '');
  return /^1\d{10}$/.test(s) ? s.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : s;
};

/** 身份证：保留前 6 后 4 —— 110101199001011234 → 110101********1234 */
export const maskIdCard = (v?: string) => {
  const s = String(v ?? '');
  if (s.length === 18) return s.replace(/^(\d{6})\d{8}(\d{4})$/, '$1********$2');
  if (s.length === 15) return s.replace(/^(\d{6})\d{6}(\d{3})$/, '$1******$2');
  return s;
};

/** 邮箱：zhangsan@example.com → z***@example.com */
export const maskEmail = (v?: string) => {
  const s = String(v ?? '');
  const at = s.indexOf('@');
  if (at <= 0) return s;
  const name = s.slice(0, at), domain = s.slice(at);
  const head = name.charAt(0);
  const tail = name.length > 2 ? name.charAt(name.length - 1) : '';
  return `${head}${'*'.repeat(Math.max(1, name.length - 2))}${tail}${domain}`;
};

/** 姓名：张三 → 张*；欧阳娜娜 → 欧阳** */
export const maskName = (v?: string) => {
  const s = String(v ?? '');
  if (!s) return s;
  if (s.length === 1) return s;
  if (s.length === 2) return `${s.charAt(0)}*`;
  return s.charAt(0) + '*'.repeat(s.length - 2) + s.charAt(s.length - 1);
};

/** 银行卡：保留后 4 位 */
export const maskBankCard = (v?: string | number) => {
  const s = String(v ?? '').replace(/\s/g, '');
  if (s.length < 8) return s;
  return '**** **** **** ' + s.slice(-4);
};

/** IP：192.168.1.100 → 192.168.*.* */
export const maskIp = (v?: string) => {
  const s = String(v ?? '');
  const parts = s.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.*.*` : s;
};

/** 通用：保留前 n 后 m，中间打码 */
export const mask = (v: string, keepStart = 2, keepEnd = 2, ch = '*') => {
  const s = String(v ?? '');
  if (s.length <= keepStart + keepEnd) return s;
  return s.slice(0, keepStart) + ch.repeat(s.length - keepStart - keepEnd) + s.slice(-keepEnd);
};

// ============ 脱敏策略（配置化）+ 导出水印 ============

export interface MaskPolicy {
  maskIp: boolean;
  maskUsername: boolean;
  watermark: boolean;
  watermarkText: string;
}
export const DEFAULT_MASK_POLICY: MaskPolicy = {
  maskIp: true, maskUsername: false, watermark: true, watermarkText: '内部资料 · 请勿外传'
};
const POLICY_KEY = 'export-mask-policy';
export function getMaskPolicy(): MaskPolicy {
  try { return { ...DEFAULT_MASK_POLICY, ...JSON.parse(localStorage.getItem(POLICY_KEY) || '{}') }; }
  catch { return { ...DEFAULT_MASK_POLICY }; }
}
export function saveMaskPolicy(p: MaskPolicy) { localStorage.setItem(POLICY_KEY, JSON.stringify(p)); }

/** 按策略对一行数据脱敏 */
export function applyMaskPolicy<T extends Record<string, any>>(row: T, policy = getMaskPolicy()): T {
  const out = { ...row };
  if (policy.maskIp) {
    if ('ipAddress' in out) out.ipAddress = maskIp(out.ipAddress);
    if ('ip' in out) out.ip = maskIp(out.ip);
  }
  if (policy.maskUsername && 'username' in out) out.username = maskName(out.username);
  return out;
}

/** 生成导出水印文本（用于 Excel 表头注释或文件名后缀） */
export function watermarkLabel(policy = getMaskPolicy()): string {
  return policy.watermark ? `[${policy.watermarkText}]` : '';
}
