/**
 * 数据库版本化迁移工具（零依赖，用 mysql2）
 * 用法：node scripts/migrate.mjs [sql文件...]
 * 不传参数则按固定顺序迁移所有 SQL；已执行过的文件记录在 schema_migrations 表，自动跳过。
 *
 * 示例：node scripts/migrate.mjs db.sql db-extend-system.sql db-extend-common.sql db-extend-enterprise.sql db-extend-platform.sql
 *
 * 前置：必须先配好 server/.env（至少 DB_NAME）；不想配置可跳过本脚本，
 *       直接用 mysql 命令导入 SQL，见 README「① 准备数据库」。
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import 'dotenv/config';
import { SQL_FILES } from './sql-files.mjs';

// 前置检查：脚本依赖 .env 里的数据库配置，缺失时给出明确指引而不是抛连接错误
if (!process.env.DB_NAME) {
  console.error('[前置检查失败] 未检测到 DB_NAME，无法连接数据库。');
  console.error('  请先执行：cp .env.example .env');
  console.error('  再在 .env 中填写 DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME。');
  console.error('  若不想配置 .env，可跳过本脚本，直接用 mysql 命令导入 SQL（见 README「① 准备数据库」）。');
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: +(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  multipleStatements: true,
});

const files = process.argv.slice(2).length ? process.argv.slice(2) : SQL_FILES;

async function main() {
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      appliedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  for (const file of files) {
    const fp = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
    if (!fs.existsSync(fp)) {
      console.log(`[skip] ${file} 不存在`);
      continue;
    }
    const sql = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const [[done]] = await pool.execute('SELECT checksum FROM schema_migrations WHERE filename=?', [file]);
    if (done && done.checksum === checksum) {
      console.log(`[skip] ${file} 已迁移（校验一致）`);
      continue;
    }
    try {
      await pool.query(sql);
      await pool.execute(
        `INSERT INTO schema_migrations (filename, checksum) VALUES (?,?)
         ON DUPLICATE KEY UPDATE checksum=VALUES(checksum), appliedAt=NOW()`,
        [file, checksum]
      );
      console.log(`[ok]   ${file} 迁移成功`);
    } catch (e) {
      console.error(`[fail] ${file}: ${e.message}`);
      process.exitCode = 1;
      break;
    }
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
