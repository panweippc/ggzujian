#!/usr/bin/env node
/**
 * 等保 2.0 三级合规自查（零依赖）：对照关键控制点扫描配置位与代码，输出自查报告。
 *
 * ⚠️ 边界声明：本脚本是**自查（预检）**，不是等级保护测评。
 *   正式定级备案与测评结论必须由具备资质的测评机构出具；脚本只覆盖可自动核验的技术项，
 *   管理制度、物理安全、人员安全等管理类要求不在代码层检测范围。
 *
 * 覆盖的等保三级技术控制点（GB/T 22239-2019 三级）：
 *   - 身份鉴别：双因素、口令复杂度、登录失败锁定、会话超时
 *   - 访问控制：RBAC 角色权限、最小权限、默认账户、匿名访问
 *   - 安全审计：审计覆盖、审计记录防篡改、日志留存周期、审计导出
 *   - 数据完整性/保密性：传输加密、存储加密、字段级加密、备份加密
 *   - 入侵防范：限流、IP 白名单、恶意代码/输入校验、错误信息脱敏
 *   - 剩余信息保护：敏感数据脱敏、日志敏感字段打码
 *   - 备份恢复：定期备份、备份校验、异地留存
 *
 * 用法：
 *   node scripts/check-compliance.mjs               # 文本报告（默认：仅 missing 失败，manual 提示）
 *   node scripts/check-compliance.mjs --json        # JSON（CI/存档）
 *   node scripts/check-compliance.mjs --level 二级   # 按二级基线（默认三级）
 *   node scripts/check-compliance.mjs --strict      # manual 也视为未通过
 *
 * 结果分级：✓ pass（自动核验通过）/ ✗ missing（自动核验缺失，失败）/ ⚠ manual（需人工确认）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '..');
const ROOT = path.resolve(SERVER, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] || d) : d; };
const AS_JSON = argv.includes('--json');
const STRICT = argv.includes('--strict');
const LEVEL = arg('level', '三级');

const ENV_EXAMPLE = fs.existsSync(path.join(SERVER, '.env.example')) ? fs.readFileSync(path.join(SERVER, '.env.example'), 'utf8') : '';
// 汇总源码（server + web）用于代码标记检测
let SRC = '';
const collectSrc = (dir, depth = 0) => {
  if (depth > 12 || !fs.existsSync(dir)) return;
  for (const n of fs.readdirSync(dir)) {
    if (['node_modules', 'dist', 'backups', 'logs', '.git', 'coverage'].includes(n)) continue;
    const f = path.join(dir, n);
    if (fs.statSync(f).isDirectory()) { collectSrc(f, depth + 1); continue; }
    if (/\.(js|mjs|ts|vue)$/.test(n)) SRC += fs.readFileSync(f, 'utf8') + '\n';
  }
};
collectSrc(SERVER);
collectSrc(path.join(ROOT, 'web', 'src'));
collectSrc(path.join(ROOT, 'scripts'));
collectSrc(path.join(ROOT, 'ci'));

const results = [];
/** pass: 自动核验通过；missing: 自动核验缺失；manual: 需人工 */
const add = (domain, name, status, evidence) => {
  // 证据含"需确认/人工"说明自动检测只给出线索、无法确认是否真正生效，
  // 统一降级为 manual，避免 ✓ 与"需确认"并存的语义矛盾。
  const st = status === 'pass' && /需确认|人工/.test(evidence) ? 'manual' : status;
  results.push({ domain, name, status: st, evidence });
};
const hasEnv = (k) => new RegExp('^\\s*' + k + '\\s*=', 'm').test(ENV_EXAMPLE);
const has = (re) => re.test(SRC);

// ========== 身份鉴别 ==========
add('身份鉴别', '双因素认证(TOTP)', has(/totp\/(bind|enable|verify)|totpSecret/i) ? 'pass' : 'missing', 'TOTP 绑定/校验端点');
if (hasEnv('LOGIN_MAX_FAILS') && hasEnv('LOGIN_LOCK_MS')) add('身份鉴别', '登录失败锁定', 'pass', 'LOGIN_MAX_FAILS + LOGIN_LOCK_MS');
else add('身份鉴别', '登录失败锁定', 'missing', '缺少失败次数/锁定时长配置');
add('身份鉴别', '口令复杂度策略', has(/password.*(complex|strength|强度|复杂度|minlength|至少)/i) ? 'pass' : 'manual', '需确认注册/改密处是否校验口令复杂度');
add('身份鉴别', '会话超时自动退出', hasEnv('SESSION_TIMEOUT') || has(/session.*timeout|idleTimeout|会话超时/i) ? 'pass' : 'manual', '需确认前端会话超时与 token 过期策略');
add('身份鉴别', '多因素强制开启', 'manual', '等保三级要求"两种或两种以上组合鉴别"，需确认是否强制启用 TOTP');

// ========== 访问控制 ==========
add('访问控制', 'RBAC 角色权限', has(/role_permissions|adminOnly|permission/i) ? 'pass' : 'missing', '角色-权限-菜单授权');
add('访问控制', '数据权限(行级/列级)', has(/dataScope|maskEmployeeRow|data_scope_rules/i) ? 'pass' : 'missing', '数据范围隔离');
add('访问控制', '默认账户口令策略', hasEnv('ADMIN_INIT_PASSWORD') ? 'pass' : 'missing', 'ADMIN_INIT_PASSWORD 初始化配置');
add('访问控制', '匿名访问最小化', has(/whitelist|白名单|publicPaths|EXEMPT/i) ? 'manual' : 'pass', '需人工核对公开端点清单是否最小');

// ========== 安全审计 ==========
add('安全审计', '审计日志覆盖', has(/auto.?audit|writeAudit|网关自动审计/i) ? 'pass' : 'missing', '网关自动审计中间件');
add('安全审计', '审计记录防篡改', has(/audit.?chain|prevHash|hashChain|哈希链/i) ? 'pass' : 'missing', '审计哈希链');
add('安全审计', '审计日志留存≥180天', hasEnv('AUDIT_RETENTION_DAYS') || has(/retention.*180|留存.*180/i) ? 'pass' : 'manual', '三级要求审计记录留存不少于180天，需确认实际留存策略');
add('安全审计', '审计记录可导出', has(/audit.*export|export.*audit/i) ? 'pass' : 'missing', '审计导出端点');
add('安全审计', '敏感操作二次认证', has(/verifyAdminPassword|二次.*密码|confirm.*password/i) ? 'pass' : 'manual', '需确认删除/恢复等敏感操作是否二次认证');

// ========== 数据完整性与保密性 ==========
add('数据完整性', '传输层加密(HTTPS/TLS)', has(/https|HSTS|Strict-Transport-Security/i) ? 'pass' : 'manual', '需确认生产反代是否强制 HTTPS');
add('数据保密性', '存储字段级加密', hasEnv('DATA_ENCRYPT_KEY') && has(/field-crypto|AES-256-GCM/i) ? 'pass' : 'missing', 'DATA_ENCRYPT_KEY + AES-GCM');
add('数据保密性', '备份加密', hasEnv('BACKUP_ENCRYPT_KEY') && has(/sealBackup|AES-GCM/i) ? 'pass' : 'missing', 'BACKUP_ENCRYPT_KEY + 加密落盘');
add('数据保密性', '密钥独立管理', hasEnv('SIGN_SECRET') && hasEnv('SECRETS_MASTER_KEY') ? 'pass' : 'manual', '需确认各密钥独立且定期轮换');

// ========== 入侵防范 ==========
add('入侵防范', '接口限流', hasEnv('RATE_MAX') && has(/express-rate-limit|rateLimit/i) ? 'pass' : 'missing', '全局+登录+写操作限流');
add('入侵防范', 'IP 白名单/黑名单', has(/ip_whitelist|白名单|ipWhitelist/i) ? 'pass' : 'manual', '需确认是否启用访问地址限制');
add('入侵防范', '输入校验与注入防护', has(/parameterized|pool\.execute\(|sql\.escape|validate\(/i) ? 'pass' : 'manual', '需确认所有 SQL 均参数化、输入有校验');
add('入侵防范', '错误信息脱敏', has(/errHandler|错误.*脱敏|errorHandler|生产.*堆栈/i) ? 'manual' : 'manual', '需确认生产环境不返回堆栈/内部错误');

// ========== 剩余信息保护 ==========
add('剩余信息保护', '敏感数据展示脱敏', has(/mask|脱敏|desensit/i) ? 'pass' : 'missing', '手机号/身份证/银行卡脱敏');
add('剩余信息保护', '日志敏感字段打码', has(/打码|mask.*(body|request|response)|敏感字段已打码/i) ? 'pass' : 'manual', '需确认审计日志请求/响应体已打码');

// ========== 备份恢复 ==========
add('备份恢复', '定期备份机制', has(/scheduled_tasks|cron|backup-orchestrator/i) ? 'pass' : 'missing', '定时备份任务/编排脚本');
add('备份恢复', '备份完整性校验', has(/verifyBackup|manifest|SHA-256/i) ? 'pass' : 'missing', '备份 manifest + 校验');
add('备份恢复', '异地备份', hasEnv('BACKUP_REMOTE_DIR') ? 'pass' : 'manual', '需确认是否配置异地留存');

// ========== 管理类（人工） ==========
for (const item of ['安全管理制度', '人员安全管理', '系统建设管理', '系统运维管理', '物理环境安全', '定级备案与测评']) {
  add('管理要求', item, 'manual', '管理类要求不在代码层检测，需人工准备材料');
}

function main() {
  // 二级基线：剔除三级专属项（双因素强制、数据权限、审计180天、字段加密等）
  const list = LEVEL === '二级'
    ? results.filter((r) => !/多因素强制|数据权限|审计日志留存|字段级加密|异地备份/.test(r.name))
    : results;
  const pass = list.filter((r) => r.status === 'pass').length;
  const missing = list.filter((r) => r.status === 'missing').length;
  const manual = list.filter((r) => r.status === 'manual').length;
  const failed = missing > 0 || (STRICT && manual > 0);

  if (AS_JSON) {
    console.log(JSON.stringify({ level: LEVEL, ok: !failed, summary: { pass, missing, manual, total: list.length }, results: list, disclaimer: '自查预检，非等级保护测评结论' }, null, 2));
  } else {
    console.log(`=== 等保 ${LEVEL} 合规自查（预检，非测评）===`);
    console.log(`自动通过 ${pass} / 缺失 ${missing} / 需人工 ${manual} / 合计 ${list.length}`);
    let last = '';
    for (const r of list) {
      if (r.domain !== last) { console.log(`\n[${r.domain}]`); last = r.domain; }
      const mark = r.status === 'pass' ? '✓' : r.status === 'missing' ? '✗' : '⚠';
      console.log(`  ${mark} ${r.name} — ${r.evidence}`);
    }
    console.log('\n⚠️ 本结果为技术项自查，不构成等保测评结论；正式测评须由有资质机构出具。');
  }
  process.exitCode = failed ? 1 : 0;
}

main();
