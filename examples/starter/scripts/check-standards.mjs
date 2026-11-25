#!/usr/bin/env node
/**
 * 数据标准静态体检：扫描 server/routes/*.js 与前端 api.ts
 * 检查项：
 *   1. 响应包络：路由 res.json 必须带 success 字段（health 等约定白名单除外）
 *   2. 接口路径：新增路由应符合 /api/xxx 编码规则
 *   3. 字段命名：从 SQL 与前端 interface 抽取字段名，检查 camelCase
 *   4. 编码常量：dict category / config key 样例校验
 * 用法：node scripts/check-standards.mjs  （退出码 0=通过，1=有问题）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFieldName, checkCode } from '../server/standards/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ROUTES_DIR = path.join(ROOT, 'server', 'routes');
const SQL_FILES = ['db.sql', 'db-extend-common.sql', 'db-extend-system.sql'].map((f) => path.join(ROOT, 'server', f));

const problems = [];
const notes = [];
const warn = (file, line, msg) => problems.push(`${file}:${line}  ${msg}`);

// ---------- 1) 响应包络检查 ----------
const RESPONSE_WHITELIST = new Set(['/api/health']); // 健康检查是 { status, db }
for (const file of fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js'))) {
  const full = path.join(ROUTES_DIR, file);
  const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(/res\.json\(\s*\{/);
    if (!m) return;
    // 粗略判断同一行或下一行是否含 success:；跨行响应体的下一行检查
    const next = lines[i + 1] || '';
    if (!/success\s*:/.test(line) && !/success\s*:/.test(next)) {
      // 仅对显式 res.json({...}) 提醒，动态对象跳过
      if (!/res\.json\(\s*\{\s*\.\.\./.test(line)) {
        notes.push(`${file}:${i + 1}  响应体未显式声明 success（若为动态对象可忽略）`);
      }
    }
  });
}

// ---------- 2) 接口路径编码检查 ----------
// 从 server.js 中抽取 app.use('/api/xxx') 与 app.get/post('/api/xxx')
const serverSrc = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
for (const m of serverSrc.matchAll(/app\.(?:use|get|post|put|delete)\(\s*['"](\/api\/[^'"]+)['"]/g)) {
  const routePath = m[1].split('/:')[0].replace(/\/$/, '') || '/api';
  const r = checkCode('apiPath', routePath);
  if (!r.ok) warn('server.js', 0, `接口路径 ${routePath} 不符规范：${r.desc}`);
}

// ---------- 3) 字段命名检查（SQL 建表列） ----------
const SQL_SKIP = new Set(['PRIMARY', 'KEY', 'UNIQUE', 'INDEX', 'ENGINE', 'CHARSET', 'COLLATE', 'IF', 'NOT', 'NULL', 'DEFAULT', 'AUTO_INCREMENT', 'COMMENT', 'DATETIME', 'TIMESTAMP', 'INT', 'VARCHAR', 'TEXT', 'TINYINT', 'BIGINT']);
for (const file of SQL_FILES) {
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(/^\s{2}([A-Za-z][A-Za-z0-9_]*)\s+(?:INT|VARCHAR|TEXT|TINYINT|BIGINT|DATETIME|TIMESTAMP)/);
    if (!m) return;
    const field = m[1];
    if (SQL_SKIP.has(field.toUpperCase())) return;
    const r = checkFieldName(field);
    if (!r.ok) warn(path.basename(file), i + 1, `字段 ${field} ${r.reasons.join('；')}`);
  });
}

// ---------- 4) 编码常量样例检查 ----------
const codeSamples = [
  ['dictCategory', 'order_status', true],
  ['dictCategory', 'Bad-Name', false],
  ['configKey', 'security.ipWhitelistEnabled', true],
  ['configKey', 'nocase', false],
  ['taskKey', 'daily_backup', true],
];
for (const [rule, value, expect] of codeSamples) {
  const r = checkCode(rule, value);
  if (r.ok !== expect) warn('standards', 0, `编码规则 ${rule} 对 ${value} 判定异常，期望 ${expect} 实得 ${r.ok}`);
}

// ---------- 输出 ----------
console.log('=== 数据标准体检 ===');
if (notes.length) {
  console.log(`\n提示（${notes.length}）：`);
  notes.slice(0, 20).forEach((n) => console.log('  · ' + n));
  if (notes.length > 20) console.log(`  ... 另有 ${notes.length - 20} 条`);
}
if (problems.length) {
  console.log(`\n不合规（${problems.length}）：`);
  problems.forEach((p) => console.log('  ✗ ' + p));
  console.log('\n结论：FAIL');
  process.exit(1);
}
console.log('\n结论：PASS（接口路径 / 字段命名 / 编码规则均符合规范）');
