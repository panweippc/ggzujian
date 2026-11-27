/**
 * 跨驱动 SQL 备份导出（供 system.js 的备份端点复用）
 *   - mysql：information_schema + SHOW CREATE TABLE + conn.escape
 *   - postgres / 国产库 PG 模式：information_schema + 列类型重建 + pool.escape
 *
 * 只负责"导出 SQL 文本"，完整性清单/加密/异地复制由 services/backup-security.js 负责。
 */
import fs from 'node:fs';
import path from 'node:path';
import { PG_DRIVERS } from './pg-compat.js';

const writeEnd = (stream) => new Promise((resolve, reject) => {
  stream.on('error', reject);
  stream.end(resolve);
});

/** MySQL 备份导出 */
async function dumpMysql(pool, full, dbName) {
  const conn = await pool.getConnection();
  let tables = 0, rows = 0;
  try {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    await conn.query('SET SESSION group_concat_max_len = 1073741824');
    const [tr] = await conn.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME');
    tables = tr.length;
    const out = fs.createWriteStream(full, { encoding: 'utf8' });
    out.write(`-- starter 数据库备份 (MySQL)\n-- 数据库: ${dbName}\n-- 备份时间: ${new Date().toISOString()}\n-- 表数量: ${tables}\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n`);
    for (const t of tr.map((x) => x.TABLE_NAME)) {
      const [cr] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
      out.write(`DROP TABLE IF EXISTS \`${t}\`;\n${cr[0]['Create Table']};\n\n`);
      let offset = 0;
      while (true) {
        const [batch] = await conn.query(`SELECT * FROM \`${t}\` LIMIT 2000 OFFSET ${offset}`);
        if (!batch.length) break;
        rows += batch.length;
        for (const r of batch) {
          const keys = Object.keys(r);
          out.write(`INSERT INTO \`${t}\` (${keys.map((k) => `\`${k}\``).join(', ')}) VALUES (${keys.map((k) => conn.escape(r[k])).join(', ')});\n`);
        }
        offset += batch.length;
      }
      out.write('\n');
    }
    out.write('SET FOREIGN_KEY_CHECKS = 1;\n');
    await writeEnd(out);
    return { tables, rows };
  } finally { conn.release(); }
}

/** PostgreSQL（含人大金仓/openGauss/达梦 PG 模式）备份导出 */
async function dumpPostgres(pool, full, dbName) {
  let tables = 0, rows = 0;
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const [tr] = await pool.execute(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  tables = tr.length;
  const out = fs.createWriteStream(full, { encoding: 'utf8' });
  out.write(`-- starter 数据库备份 (PostgreSQL protocol)\n-- 数据库: ${dbName}\n-- 备份时间: ${new Date().toISOString()}\n-- 表数量: ${tables}\nSET client_encoding = 'UTF8';\n\n`);
  try {
    for (const t of tr.map((x) => x.table_name)) {
      const [cols] = await pool.execute(
        'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
        ['public', t]
      );
      const defs = cols.map((c) => `"${c.column_name}" ${c.data_type}`).join(', ');
      out.write(`DROP TABLE IF EXISTS "${t}";\nCREATE TABLE "${t}" (${defs});\n\n`);
      const [batch] = await pool.execute(`SELECT * FROM "${t}"`);
      rows += batch.length;
      for (const r of batch) {
        const keys = Object.keys(r);
        out.write(`INSERT INTO "${t}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((k) => pool.escape(r[k])).join(', ')});\n`);
      }
      out.write('\n');
    }
    await writeEnd(out);
    return { tables, rows };
  } catch (e) {
    out.destroy();
    throw e;
  }
}

/** 按驱动分发；未知驱动明确报错 */
export async function dumpDatabase(pool, full, driver = 'mysql', dbName = '') {
  const d = String(driver || 'mysql').toLowerCase();
  if (d === 'mysql') return dumpMysql(pool, full, dbName);
  if (PG_DRIVERS.includes(d)) return dumpPostgres(pool, full, dbName);
  throw new Error(`DB_DRIVER=${d} 暂无备份导出实现`);
}

export default dumpDatabase;
