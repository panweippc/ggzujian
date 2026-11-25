/**
 * 数据标准化规范（底座第 6 部分：Metadata）
 * 以可执行代码落地，替代散落的 .md 约定：字段命名 / 编码规则 / 接口协议。
 * 业务代码可直接 import 常量与校验函数；check-standards.mjs 复用同一份定义做静态体检。
 */

// ============ 1. 字段命名规则 ============
export const FIELD_NAMING = {
  // 数据库列 & JSON 字段统一小驼峰（历史兼容列除外）
  case: 'camelCase',
  // 主键：单表主键 id；外键 <实体>Id，如 userId / roleId
  primaryKey: 'id',
  foreignKeySuffix: 'Id',
  // 时间字段：过去动作用 ...At（createdAt/updatedAt/deletedAt），日期用 ...Date
  timestampSuffix: 'At',
  dateSuffix: 'Date',
  // 布尔/状态：启用位用 status(0/1)；是非用 isXxx / hasXxx
  statusField: 'status',
  booleanPrefixes: ['is', 'has'],
  // 分页参数固定
  page: 'page',
  pageSize: 'pageSize',
  // 禁止的坏味道命名（历史遗留表可豁免）
  bannedPatterns: [/^[A-Z]/, /_/g, /-/],
};

// 约定俗成的字段名白名单（虽含下划线/大写但属历史公共协议或兼容列，允许）
export const FIELD_WHITELIST = new Set([
  'X-Request-Id', 'Authorization', 'token_version', 'X-Request-ID',
  'created_at', // users 表历史兼容列，公共包 auth-kit 依赖，新表一律用 createdAt
]);

/** 校验单个字段名是否符合命名规范，返回 { ok, reasons[] } */
export function checkFieldName(name) {
  const reasons = [];
  if (FIELD_WHITELIST.has(name)) return { ok: true, reasons };
  if (/^[A-Z]/.test(name)) reasons.push('首字母应小写（camelCase）');
  if (name.includes('_')) reasons.push('不应包含下划线，请用 camelCase');
  if (name.includes('-')) reasons.push('不应包含连字符');
  return { ok: reasons.length === 0, reasons };
}

// ============ 2. 编码规则 ============
export const CODE_RULES = {
  dictCategory: {
    pattern: /^[a-z][a-z0-9_]*$/,
    desc: '字典分类编码：小写字母开头，仅小写/数字/下划线，如 order_status',
    example: 'order_status',
  },
  configKey: {
    // 每段首字母小写，后续允许驼峰（如 ipWhitelistEnabled）
    pattern: /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9_-]*)+$/,
    desc: '配置键：点分隔命名空间，每段小写字母开头，如 site.name / security.ipWhitelistEnabled',
    example: 'security.ipWhitelistEnabled',
  },
  apiPath: {
    pattern: /^\/api\/[a-z][a-z0-9-]*(\/[a-z0-9-]+)*$/,
    desc: '接口路径：/api 前缀 + 小写连字符复数资源名，如 /api/base-data',
    example: '/api/base-data',
  },
  taskKey: {
    pattern: /^[a-z][a-z0-9_]*$/,
    desc: '任务标识：小写字母开头，仅小写/数字/下划线',
    example: 'daily_backup',
  },
};

/** 按规则名校验编码值 */
export function checkCode(ruleName, value) {
  const rule = CODE_RULES[ruleName];
  if (!rule) return { ok: false, reasons: [`未知规则 ${ruleName}`] };
  const passed = rule.pattern.test(String(value));
  return { ok: passed, reasons: passed ? [] : [rule.desc], desc: rule.desc };
}

// ============ 3. 接口协议 ============
export const API_PROTOCOL = {
  // 统一响应包络：{ success, data, message }
  envelope: { success: 'boolean', data: 'any', message: 'string?' },
  successCodes: { ok: 200, created: 201 },
  errorCodes: {
    400: '参数错误', 401: '未认证', 403: '无权限', 404: '资源不存在',
    409: '资源冲突（如编码重复）', 423: '账号锁定', 429: '请求过于频繁', 500: '服务端错误',
  },
  // 分页入参 / 出参约定
  pagination: { in: ['page', 'pageSize'], out: { total: 'number', data: 'array' } },
  // 请求追踪头
  traceHeader: 'X-Request-Id',
  // 认证头
  authHeader: 'Authorization',
  authScheme: 'Bearer',
};

/** 构造统一成功响应体（可选，业务可直接用） */
export function ok(data, message) {
  const body = { success: true, data };
  if (message) body.message = message;
  return body;
}
/** 构造统一失败响应体 */
export function fail(message, code = 400) {
  return { success: false, message, code };
}

export const STANDARDS = {
  version: '1.0.0',
  fieldNaming: FIELD_NAMING,
  codeRules: CODE_RULES,
  apiProtocol: API_PROTOCOL,
};

export default STANDARDS;
