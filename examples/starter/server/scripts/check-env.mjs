#!/usr/bin/env node
/**
 * 环境变量完整性校验：把"代码读了但 .env.example 没声明"的隐患变成提交期门禁。
 *
 * 检查项：
 *   1) ERROR 源码 process.env.XXX 引用了但 .env.example 未声明（新项目接入者无从得知要配）
 *   2) WARN  .env.example 声明了但源码无直接引用（可能是占位/文档项，人工确认）
 *   3) ERROR 实际 .env（若存在）中必填密钥为占位值/弱值（生产误用风险）
 *   4) WARN  疑似拼写错误（引用了形近但未声明的 key）
 *
 * 用法：node scripts/check-env.mjs [--json] [--strict]
 *   --strict：把 WARN 也视为失败（退出码 1）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '..');
const EXAMPLE = path.join(SERVER, '.env.example');
const ENV_FILE = path.join(SERVER, '.env');
const AS_JSON = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');

const errors = [], warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);
// Node/运行时内置变量，不需要在 .env.example 声明
const BUILTIN = new Set(['NODE_ENV']);

/** 收集源码里的 process.env.XXX 引用（含所在文件） */
function collectRefs(dir, refs = new Map()) {
  if (!fs.existsSync(dir)) return refs;
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', 'dist', 'backups', 'logs'].includes(name)) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) { collectRefs(full, refs); continue; }
    if (!/\.(js|mjs|ts)$/.test(name)) continue;
    if (full === fileURLToPath(import.meta.url)) continue; // 跳过本脚本自身（含示例字符串）
    const text = fs.readFileSync(full, 'utf8');
    for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      if (!refs.has(m[1])) refs.set(m[1], new Set());
      refs.get(m[1]).add(path.relative(SERVER, full).replace(/\\/g, '/'));
    }
  }
  return refs;
}

/** 从 .env.example 提取声明的 key 及其行内注释 */
function parseExample(file) {
  const out = new Map();
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const raw = m[2].replace(/\s+#.*$/, '').trim();
    out.set(m[1], { value: raw, hasComment: /#/.test(m[2]) });
  }
  return out;
}

/** 编辑距离（用于拼写提示，限制在合理长度） */
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

function main() {
  const refs = collectRefs(SERVER);
  const declared = parseExample(EXAMPLE);

  // 1) 代码引用但未声明
  for (const [key, files] of refs) {
    if (declared.has(key) || BUILTIN.has(key)) continue;
    // 拼写提示
    const near = [...declared.keys()].map((d) => [d, editDistance(key, d)]).sort((a, b) => a[1] - b[1])[0];
    const hint = near && near[1] <= 2 ? `（是否想写 ${near[0]}？）` : '';
    err(`源码引用了未声明的环境变量 ${key} ${hint}：${[...files].slice(0, 3).join(', ')}`);
  }

  // 2) 声明但未引用（信息性）
  for (const key of declared.keys()) {
    if (!refs.has(key)) warn(`.env.example 声明了 ${key}，但源码无 process.env 直接引用（占位/文档项？）`);
  }

  // 3) 实际 .env 弱值检查（仅对安全敏感项）
  if (fs.existsSync(ENV_FILE)) {
    const actual = parseExample(ENV_FILE);
    const SECRET_KEYS = ['JWT_SECRET', 'SIGN_SECRET', 'DATA_ENCRYPT_KEY', 'BACKUP_ENCRYPT_KEY', 'SECRETS_MASTER_KEY', 'SMS_API_KEY', 'SMTP_PASS'];
    const WEAK = /^(请替换|change\s*me|your[_-]?|xxx+|test|123456|admin123|password|secret)$/i;
    for (const key of SECRET_KEYS) {
      const val = actual.get(key)?.value;
      if (!val) continue; // 允许留空（走回退逻辑）
      if (val.length < 8 || WEAK.test(val) || /^(.)\1+$/.test(val)) {
        err(`.env 中的 ${key} 疑似弱值（长度 ${val.length}），生产环境请换成强随机串`);
      }
    }
  }
}

main();
const failed = errors.length || (STRICT && warns.length);
if (AS_JSON) {
  console.log(JSON.stringify({ ok: !failed, errors, warns }, null, 2));
} else {
  console.log('=== 环境变量完整性校验 ===');
  for (const w of warns) console.log('  ⚠ WARN  ' + w);
  for (const e of errors) console.log('  ✗ ERROR ' + e);
  if (!failed) console.log(`✓ 全部通过（${errors.length} errors / ${warns.length} warns）`);
}
process.exit(failed ? 1 : 0);
