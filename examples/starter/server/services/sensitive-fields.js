/**
 * 敏感字段注册表 + 行级加解密/脱敏
 *
 * 一张表的敏感列在此登记后，自动获得三种能力：
 *   1. encryptRow — 写库前字段级加密（配合 services/field-crypto.js）
 *   2. decryptRow — 读库后按密钥集合解密（兼容存量明文）
 *   3. maskRow    — 按字段策略脱敏（非全量数据范围时使用）
 * 同时导出 riskLevelOf 供「查询出口分级管控」判定导出风险等级。
 *
 * 新增敏感字段只需在 SENSITIVE_FIELDS 里加一行，无需改路由。
 */
import { isEncrypted } from './field-crypto.js';

/**
 * level: SECRET/HIGH → 高风险；PII → 中风险；INTERNAL → 低风险
 * mask:  phone / idcard / email / name / address / none / never
 */
export const SENSITIVE_FIELDS = {
  employees: {
    email: { level: 'PII', mask: 'email', label: '邮箱' },
    phone: { level: 'PII', mask: 'phone', label: '手机号' },
    idCard: { level: 'HIGH', mask: 'idcard', label: '身份证号' },
    address: { level: 'PII', mask: 'address', label: '联系地址' },
    emergencyContact: { level: 'PII', mask: 'name', label: '紧急联系人' },
    emergencyPhone: { level: 'PII', mask: 'phone', label: '紧急联系电话' },
    birthDate: { level: 'PII', mask: 'none', label: '出生日期' },
  },
  users: {
    password: { level: 'SECRET', mask: 'never', label: '密码哈希' },
  },
};

const LEVEL_RISK = { SECRET: 'high', HIGH: 'high', PII: 'medium', INTERNAL: 'low' };
export const RISK_RANK = { low: 0, medium: 1, high: 2 };

export function fieldsOf(table) {
  return SENSITIVE_FIELDS[table] || {};
}

/** 按字段清单判定导出风险：命中最高风险等级；未命中=low */
export function riskLevelOf(table, fieldNames = []) {
  const reg = fieldsOf(table);
  let risk = 'low';
  for (const f of fieldNames) {
    const level = reg[f]?.level;
    if (level && RISK_RANK[LEVEL_RISK[level]] > RISK_RANK[risk]) risk = LEVEL_RISK[level];
  }
  return risk;
}

/** 单值脱敏 */
export function maskValue(v, mask) {
  if (v === null || v === undefined || v === '') return v;
  const s = String(v);
  switch (mask) {
    case 'phone': return s.length >= 7 ? `${s.slice(0, 3)}****${s.slice(-4)}` : '***';
    case 'idcard': return s.length >= 8 ? `${s.slice(0, 3)}***********${s.slice(-4)}` : '***';
    case 'email': {
      const at = s.indexOf('@');
      if (at <= 0) return '***';
      const name = s.slice(0, at);
      return `${name.charAt(0)}***${s.slice(at)}`;
    }
    case 'name': return s.length > 1 ? `${s.charAt(0)}*` : '*';
    case 'address': return s.length > 6 ? `${s.slice(0, 6)}…` : s;
    case 'never': return '[已隐藏]';
    case 'none': default: return s;
  }
}

/** 写库前加密：只对注册表内的字符串字段生效，已加密值不重复加密 */
export function encryptRow(table, row, crypto) {
  const reg = fieldsOf(table);
  const out = { ...row };
  for (const [field, meta] of Object.entries(reg)) {
    if (meta.mask === 'never') continue; // 密码哈希本身已是单向摘要，不重复加密
    if (!(field in out) || out[field] === null || out[field] === undefined || out[field] === '') continue;
    if (isEncrypted(out[field])) continue;
    out[field] = crypto.encrypt(String(out[field]));
  }
  return out;
}

/** 读库后解密：解密失败返回 null（不把密文暴露给前端） */
export function decryptRow(table, row, crypto) {
  const reg = fieldsOf(table);
  const out = { ...row };
  for (const [field, meta] of Object.entries(reg)) {
    if (meta.mask === 'never') { delete out[field]; continue; } // 连哈希都不下发
    if (!(field in out) || !isEncrypted(out[field])) continue;
    out[field] = crypto.decrypt(out[field], null);
  }
  return out;
}

/** 按注册表脱敏（调用方决定是否对 admin 跳过） */
export function maskRow(table, row) {
  const reg = fieldsOf(table);
  const out = { ...row };
  for (const [field, meta] of Object.entries(reg)) {
    if (!(field in out)) continue;
    out[field] = maskValue(out[field], meta.mask);
  }
  return out;
}

/** 加密列的 SQL 片段（供迁移脚本 WHERE 判断明文存量） */
export function plainTextColumns(table) {
  return Object.entries(fieldsOf(table)).filter(([, m]) => m.mask !== 'never').map(([f]) => f);
}
