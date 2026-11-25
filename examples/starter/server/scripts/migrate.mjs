/**
 * 数据库版本化迁移工具（零依赖，用 mysql2）
 * 用法：node scripts/migrate.mjs [sql文件...]
 * 不传参数则按固定顺序迁移所有 SQL；已执行过的文件记录在 schema_migrations 表，自动跳过。
 *
 * 示例：node scripts/migrate.mjs db.sql db-extend-common.sql db-extend-enterprise.sql
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import 'dotenv/config';

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: +(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  multipleStatements: true,
});

const DEFAULT_FILES = ['db.sql', 'db-extend-common.sql', 'db-extend-enterprise.sql'];
const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;

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
