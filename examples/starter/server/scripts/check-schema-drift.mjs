#!/usr/bin/env node
/**
 * Schema 漂移检测：比对数据库实际表结构与 db-all.sql 声明，检出"库里有但脚本没有"或反之。
 * 帮助发现"手动改了库但没回写迁移脚本"的漂移，避免新环境重建时缺表缺列。
 *
 * 用法：
 *   node scripts/check-schema-drift.mjs                 # 连接 .env 指向的库做比对
 *   node scripts/check-schema-drift.mjs --sql-file x.sql # 指定基准 SQL（默认 db-all.sql）
 *   node scripts/check-schema-drift.mjs --dry-run        # 只解析 SQL，打印将比对的表清单，不连库
 *
 * 注意：只做"存在性"比对（表/列是否齐全），不比对类型/索引细节——那需要引入专业 diff 工具。
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d = '') => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] || '') : d; };
const DRY = argv.includes('--dry-run');
const SQL_FILE = arg('sql-file', path.join(SERVER, 'db-all.sql'));

/** 从 CREATE TABLE 解析 { table: Set(cols) } */
function parseSql(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = {};
  const re = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?"?([\w]+)`?"?\s*\(([\s\S]*?)\n\)\s*ENGINE/ig;
  for (const m of text.matchAll(re)) {
    const table = m[1];
    const cols = new Set();
    for (const line of m[2].split(/\r?\n/)) {
      const s = line.trim();
      if (!s || /^(PRIMARY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN|FULLTEXT)`?/i.test(s)) continue;
      const cm = s.match(/^[`"]?(\w+)[`"]?\s+[A-Za-z]/);
      if (cm) cols.add(cm[1].toLowerCase());
    }
    out[table] = cols;
  }
  return out;
}

async function main() {
  const expected = parseSql(SQL_FILE);
  console.log(`基准 SQL：${path.basename(SQL_FILE)}，解析到 ${Object.keys(expected).length} 张表`);
  if (DRY) {
    console.log('=== DRY RUN（不连库）===');
    console.log(Object.keys(expected).sort().join('\n'));
    return;
  }

  if (!process.env.DB_NAME) {
    console.error('[前置失败] 未配置 DB_NAME，无法连接数据库。请先 cp .env.example .env 并填写数据库配置。');
    process.exit(1);
  }
  process.env.DB_SKIP_COMPAT_CHECK = 'true';
  const { prepareDatabase } = await import('../services/db-compat-check.js');
  const { createDataSource } = await import('../services/datasource.js');
  const { dataSource, driver } = await prepareDatabase(createDataSource);

  let actual = {};
  try {
    if (driver === 'mysql') {
      const [rows] = await dataSource.execute(
        'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?',
        [process.env.DB_NAME]
      );
      for (const r of rows) { (actual[r.t] ||= new Set()).add(String(r.c).toLowerCase()); }
    } else {
      const [rows] = await dataSource.execute(
        "SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public'"
      );
      for (const r of rows) { (actual[r.t] ||= new Set()).add(String(r.c).toLowerCase()); }
    }
  } finally {
    await dataSource.end?.();
  }

  const errors = [];
  // 表缺失
  for (const t of Object.keys(expected)) {
    if (!actual[t]) errors.push(`缺表：${t}（SQL 声明但库中不存在）`);
  }
  // 列缺失（只检查 SQL 声明的表）
  for (const [t, cols] of Object.entries(expected)) {
    if (!actual[t]) continue;
    for (const c of cols) {
      if (!actual[t].has(c)) errors.push(`缺列：${t}.${c}（SQL 声明但库中不存在）`);
    }
  }
  // 库中多出的表（信息性）
  const extra = Object.keys(actual).filter((t) => !expected[t]);

  console.log(`\n=== 漂移检测（driver=${driver}）===`);
  if (extra.length) console.log(`ℹ 库中有 ${extra.length} 张表未在 SQL 中声明（可能是手工创建）：${extra.slice(0, 10).join(', ')}${extra.length > 10 ? '…' : ''}`);
  if (errors.length) {
    for (const e of errors.slice(0, 50)) console.log('  ✗ ' + e);
    if (errors.length > 50) console.log(`  … 还有 ${errors.length - 50} 项`);
    console.log(`\n✗ 检测到 ${errors.length} 处漂移，请回写迁移脚本或重建库。`);
    process.exit(1);
  }
  console.log('✓ 无漂移：库表结构与 SQL 声明一致。');
}

main().catch((e) => { console.error('[漂移检测失败]', e.message); process.exit(1); });
