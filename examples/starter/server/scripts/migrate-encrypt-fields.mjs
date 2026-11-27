/**
 * 存量明文数据 → 字段级密文迁移
 *
 *   node scripts/migrate-encrypt-fields.mjs --dry-run          # 只统计受影响行数
 *   node scripts/migrate-encrypt-fields.mjs                    # 执行明文加密
 *   node scripts/migrate-encrypt-fields.mjs --rotate           # 额外把旧密钥密文迁到新密钥
 *   node scripts/migrate-encrypt-fields.mjs --table=employees  # 指定表（默认 employees）
 *
 * 幂等：已是 enc:v1 的值默认跳过；--rotate 时会尝试用旧密钥解密并重加密。
 * 生产执行前务必先备份数据库（POST /api/backups），再跑 --dry-run 核对行数。
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createFieldCrypto, isEncrypted } from '../services/field-crypto.js';
import { plainTextColumns } from '../services/sensitive-fields.js';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const rotate = argv.includes('--rotate');
const tableArg = argv.find((a) => a.startsWith('--table='));
const table = tableArg ? tableArg.slice('--table='.length) : 'employees';

if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
  console.error('[拒绝执行] 非法表名：' + table);
  process.exit(1);
}

let fc;
try {
  fc = createFieldCrypto();
} catch (e) {
  console.error('[迁移中止] ' + e.message);
  process.exit(1);
}

const cols = plainTextColumns(table);
if (!cols.length) {
  console.log(`[迁移跳过] 表 ${table} 未注册敏感字段`);
  process.exit(0);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: +(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

let scanned = 0, changed = 0, errors = 0;
try {
  const [rows] = await pool.execute(`SELECT id, ${cols.join(', ')} FROM \`${table}\``);
  scanned = rows.length;
  for (const row of rows) {
    const updates = {};
    for (const col of cols) {
      const v = row[col];
      if (v === null || v === undefined || v === '') continue;
      if (!isEncrypted(v)) {
        updates[col] = fc.encrypt(String(v));
      } else if (rotate) {
        const next = fc.rotate(v);
        if (next !== v) updates[col] = next;
      }
    }
    const keys = Object.keys(updates);
    if (!keys.length) continue;
    if (!dryRun) {
      try {
        await pool.execute(
          `UPDATE \`${table}\` SET ${keys.map((k) => `\`${k}\`=?`).join(',')} WHERE id=?`,
          [...keys.map((k) => updates[k]), row.id]
        );
      } catch (e) {
        errors += 1;
        console.error(`[行 ${row.id} 更新失败] ${e.message}`);
        continue;
      }
    }
    changed += 1;
  }
  console.log(`[迁移${dryRun ? '预演' : '完成'}] 表=${table} 扫描=${scanned} 需变更=${changed} 失败=${errors}`);
  if (dryRun) console.log('（--dry-run 未写入数据库）');
} finally {
  await pool.end();
}
if (errors) process.exitCode = 1;
