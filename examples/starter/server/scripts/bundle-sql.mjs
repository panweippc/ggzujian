/**
 * 生成一次性导入合集 db-all.sql
 * 用法：npm run sql:bundle（在 server 目录）
 *
 * 按 sql-files.mjs 里的依赖顺序原样拼接 5 个幂等 SQL，不做任何改写，
 * 避免引入语法差异；源文件变更后重新生成即可。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SQL_FILES, BUNDLE_FILE } from './sql-files.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.dirname(scriptDir);

const chunks = [
  '-- ============================================================',
  '-- db-all.sql — 一次性导入合集（自动生成，请勿手动修改）',
  '-- 生成命令：cd server && npm run sql:bundle',
  '-- 源文件与顺序：scripts/sql-files.mjs',
  '-- 导入命令：mysql -u root -p --default-character-set=utf8mb4 my_project < db-all.sql',
  '-- 5 个源文件均为幂等脚本，本合集可重复执行；',
  '-- 如需 checksum 版本管理/跳过已迁移文件，请改用 node scripts/migrate.mjs',
  '-- ============================================================',
  '',
  'SET NAMES utf8mb4;',
  '',
];

for (const file of SQL_FILES) {
  const fp = path.join(serverDir, file);
  if (!fs.existsSync(fp)) {
    console.error(`[fail] 源文件不存在：${file}`);
    process.exit(1);
  }
  const sql = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').replace(/\s+$/, '');
  chunks.push(`-- ============ 以下来自 ${file} ============`, sql, '');
}

const out = path.join(serverDir, BUNDLE_FILE);
fs.writeFileSync(out, chunks.join('\n'), 'utf8');
const lines = fs.readFileSync(out, 'utf8').split('\n').length;
console.log(`[ok] 已生成 ${BUNDLE_FILE}（${SQL_FILES.length} 个源文件，约 ${lines} 行，${(fs.statSync(out).size / 1024).toFixed(1)} KB）`);
