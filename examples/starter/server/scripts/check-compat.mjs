/**
 * SQL 静态兼容扫描（CI 门禁）
 *
 * 扫描 server 下所有业务 JS / SQL 源文件，找出 MySQL 专有语法：
 *   - 可由 pg-compat 自动改写的（ON DUPLICATE / INSERT IGNORE / GROUP_CONCAT）：只提示，不阻断
 *   - 无法安全改写的（SHOW / STRAIGHT_JOIN / REPLACE INTO / LIMIT ?,? 等）：阻断
 *   - ON DUPLICATE 涉及的表必须在 dialects.js 的 UPSERT_KEYS 登记：阻断
 *
 * 这样把"真正使用时才报错"提前到 CI 阶段。
 *
 * 用法：node scripts/check-compat.mjs [--driver postgres] [--strict]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPSERT_KEYS, ALL_DRIVERS } from '../services/dialects.js';
import { transformSql } from '../services/pg-compat.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');
const args = process.argv.slice(2);
const driverArg = args.indexOf('--driver');
const targetDriver = driverArg >= 0 ? args[driverArg + 1] : 'postgres';
const strict = args.includes('--strict');

if (!ALL_DRIVERS.includes(targetDriver)) {
  console.error(`[check-compat] 未知驱动 ${targetDriver}，支持：${ALL_DRIVERS.join(', ')}`);
  process.exit(2);
}

/**
 * 扫描范围：只扫"业务 SQL 源"——路由、中间件、运行时服务。
 * 排除：测试、兼容层自身/工具脚本（它们包含的就是语法规则本身，会自误报）、
 *       db-backup.js（备份按驱动分发，MySQL 分支天然是 MySQL 语法）。
 */
const scanDirs = ['routes', 'middleware'];
const scanServiceFiles = [
  'runtime-config.js', 'audit-chain.js', 'cron.js', 'excel.js', 'signature.js',
  'sse-bus.js', 'file-preview.js', 'field-crypto.js', 'sensitive-fields.js',
  'data-export-guard.js', 'backup-security.js',
];
const scanScripts = ['migrate.mjs'];

const files = [];
for (const dir of scanDirs) {
  const full = path.join(serverDir, dir);
  if (fs.existsSync(full)) files.push(...collectFiles(full, ['.js']));
}
for (const name of scanServiceFiles) {
  const full = path.join(serverDir, 'services', name);
  if (fs.existsSync(full)) files.push(full);
}
for (const name of scanScripts) {
  const full = path.join(serverDir, 'scripts', name);
  if (fs.existsSync(full)) files.push(full);
}

/** 递归收集待扫描文件 */
function collectFiles(dir, exts, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) collectFiles(full, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const rewriteable = [
  { re: /ON\s+DUPLICATE\s+KEY\s+UPDATE/gi, name: 'ON DUPLICATE KEY UPDATE' },
  { re: /INSERT\s+IGNORE/gi, name: 'INSERT IGNORE' },
  { re: /GROUP_CONCAT\s*\(/gi, name: 'GROUP_CONCAT' },
];
const blocking = [
  { re: /\bSHOW\s+(?:CREATE\s+TABLE|TABLES|DATABASES|COLUMNS|VARIABLES)\b/gi, name: 'SHOW …' },
  { re: /\bSTRAIGHT_JOIN\b/gi, name: 'STRAIGHT_JOIN' },
  { re: /\bSQL_CALC_FOUND_ROWS\b/gi, name: 'SQL_CALC_FOUND_ROWS' },
  { re: /\bREPLACE\s+INTO\b/gi, name: 'REPLACE INTO' },
  { re: /\bLIMIT\s+\?\s*,\s*\?/gi, name: 'LIMIT ?,? (应改为 LIMIT ? OFFSET ?)' },
  { re: /\bAUTO_INCREMENT\b/gi, name: 'AUTO_INCREMENT（源 SQL 未转方言）' },
  { re: /\bENGINE\s*=\s*InnoDB\b/gi, name: 'ENGINE=InnoDB（源 SQL 未转方言）' },
  { re: /\bDATETIME\b/gi, name: 'DATETIME（源 SQL 未转方言）' },
];

const rewritableHits = new Map();
const blockingHits = [];
const unregisteredTables = new Set();

for (const file of files) {
  const rel = path.relative(serverDir, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  // 生成的方言 DDL 做了完整转换，不再按 MySQL 源语法检查
  const isGeneratedDdl = rel.startsWith('sql/dialect/');

  for (const { re, name } of rewriteable) {
    if (isGeneratedDdl) continue;
    const count = [...text.matchAll(re)].length;
    if (count) rewritableHits.set(name, (rewritableHits.get(name) || 0) + count);
  }

  // ON DUPLICATE 表登记检查（扫描 INSERT INTO <table> … ON DUPLICATE）
  if (!isGeneratedDdl) {
    for (const m of text.matchAll(/INSERT\s+INTO\s+[`"]?(\w+)[`"]?[\s\S]{0,400}?ON\s+DUPLICATE\s+KEY\s+UPDATE/gi)) {
      const table = m[1].toLowerCase();
      if (!UPSERT_KEYS[table]) unregisteredTables.add(`${table} (${rel})`);
    }
  }

  // migrate.mjs 是 MySQL 专用迁移脚本（其 DDL 由生成器转方言），豁免 DDL 级关键字
  const isMysqlOnlyScript = rel.startsWith('scripts/migrate');
  for (const { re, name } of blocking) {
    if (isGeneratedDdl) continue;
    if (isMysqlOnlyScript && /ENGINE=|DATETIME|AUTO_INCREMENT/.test(name)) continue;
    const lines = text.split('\n');
    lines.forEach((line, idx) => {
      if (re.test(line)) {
        re.test.lastIndex = 0;
        blockingHits.push(`${rel}:${idx + 1}  ${name}`);
      }
      re.lastIndex = 0;
    });
  }

  // 用真实转换器验证：对每条疑似 MySQL SQL 片段做转换，捕获异常
  if (!isGeneratedDdl && targetDriver !== 'mysql') {
    const sqlFragments = extractSqlStrings(text);
    for (const frag of sqlFragments) {
      try { transformSql(frag, [], targetDriver); }
      catch (e) {
        if (/无法自动改写表|不支持 MySQL 专有语法/.test(e.message)) {
          blockingHits.push(`${rel}  转换失败：${e.message}`);
        }
      }
    }
  }
}

/** 粗抽 SQL 字符串（单/双引号/模板串中含 SQL 关键字的片段） */
function extractSqlStrings(text) {
  const out = [];
  const re = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  for (const m of text.matchAll(re)) {
    const s = m[2];
    if (/\b(SELECT|INSERT|UPDATE|DELETE|SHOW|REPLACE)\b/i.test(s) && s.length < 2000) out.push(s);
  }
  return out;
}

console.log(`[check-compat] 目标方言=${targetDriver}  扫描文件=${files.length}`);
if (rewritableHits.size) {
  console.log('[提示] 以下语法可由兼容层自动改写（无需业务改动）：');
  for (const [name, count] of rewritableHits) console.log(`  - ${name}: ${count} 处`);
}
if (unregisteredTables.size) {
  console.error('[阻断] 以下表使用了 ON DUPLICATE KEY UPDATE 但未在 UPSERT_KEYS 登记：');
  for (const t of unregisteredTables) console.error(`  - ${t}`);
}
if (blockingHits.length) {
  console.error(`[阻断] 发现 ${blockingHits.length} 处无法安全改写的 MySQL 专有语法：`);
  for (const h of blockingHits.slice(0, 60)) console.error(`  - ${h}`);
  if (blockingHits.length > 60) console.error(`  … 另有 ${blockingHits.length - 60} 处`);
}
const failed = blockingHits.length > 0 || unregisteredTables.size > 0 || (strict && rewritableHits.size > 0);
if (failed) {
  console.error('[check-compat] 未通过：存在无法自动兼容的语法');
  process.exit(1);
}
console.log('[check-compat] 通过：所有 MySQL 专有语法均可自动改写或已转方言');
