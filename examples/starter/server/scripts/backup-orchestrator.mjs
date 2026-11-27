#!/usr/bin/env node
/**
 * 备份全链路编排：定时备份 → 完整性校验 → 加密封存 → 异地复制 → 过期清理 → 结果留痕。
 * 把原本要在系统管理页逐项手动点的动作串成一条命令，供 cron / pm2 定时调用。
 *
 * 用法：
 *   node scripts/backup-orchestrator.mjs                 # 执行一次完整备份
 *   node scripts/backup-orchestrator.mjs --dry-run       # 只打印计划，不连库
 *   node scripts/backup-orchestrator.mjs --verify-only <file.sql>  # 只校验已有备份
 *
 * 定时示例（pm2 cron / 系统 crontab）：
 *   0 2 * * * cd /path/server && node scripts/backup-orchestrator.mjs >> logs/backup-cron.log 2>&1
 *
 * 复用底座：services/db-backup.js（按驱动导出 SQL）+ services/backup-security.js
 *（SHA-256 manifest / AES-GCM 加密 / 异地复制 / 过期清理 / 三层校验）。
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(SERVER, 'backups', 'manual');
const LOG_FILE = path.join(SERVER, 'logs', 'backup-orchestrator.log');
const argv = process.argv.slice(2);
const has = (n) => argv.includes('--' + n);
const arg = (n, d = '') => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] || '') : d; };
const DRY = has('dry-run');
const VERIFY_ONLY = arg('verify-only');

function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch { /* 日志失败不影响备份主流程 */ }
}

async function main() {
  const { dumpDatabase } = await import('../services/db-backup.js');
  const { sealBackup, verifyBackup } = await import('../services/backup-security.js');

  // ---- 仅校验模式 ----
  if (VERIFY_ONLY) {
    const full = path.isAbsolute(VERIFY_ONLY) ? VERIFY_ONLY : path.join(BACKUP_DIR, path.basename(VERIFY_ONLY));
    const r = await verifyBackup(full);
    log(r.ok ? 'INFO' : 'ERROR', `校验 ${path.basename(full)}：${r.ok ? '通过' : r.reason}`);
    process.exit(r.ok ? 0 : 1);
  }

  const driver = process.env.DB_DRIVER || 'mysql';
  const dbName = process.env.DB_NAME || '';
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const filename = `${dbName || 'backup'}_${stamp}.sql`;
  const full = path.join(BACKUP_DIR, filename);

  if (DRY) {
    console.log('=== DRY RUN（不连库、不写库）===');
    console.log(`驱动=${driver} 库=${dbName}`);
    console.log(`1) dumpDatabase → ${path.relative(SERVER, full)}`);
    console.log(`2) verifyBackup（校验明文 SQL 干跑）`);
    console.log(`3) sealBackup（SHA-256 manifest${process.env.BACKUP_ENCRYPT !== 'false' ? ' + AES-GCM 加密' : ''}）`);
    console.log(`4) 异地复制：${process.env.BACKUP_REMOTE_DIR || '（未配置，跳过）'}`);
    console.log(`5) 过期清理：${process.env.BACKUP_RETENTION_DAYS || 0} 天`);
    return;
  }

  log('INFO', `开始备份：driver=${driver} db=${dbName} file=${filename}`);

  // ---- 1) 导出 SQL ----
  process.env.DB_SKIP_COMPAT_CHECK = 'true';
  const { prepareDatabase } = await import('../services/db-compat-check.js');
  const { createDataSource } = await import('../services/datasource.js');
  const { dataSource } = await prepareDatabase(createDataSource);
  let meta;
  try {
    meta = await dumpDatabase(dataSource.raw, full, driver, dbName);
  } finally {
    await dataSource.end?.();
  }
  log('INFO', `导出完成：${meta.tables} 张表 / ${meta.rows} 行`);

  // ---- 2) 明文 SQL 干跑校验（加密前先确认内容合法）----
  const { dryRunBackup } = await import('../services/backup-security.js');
  const pre = dryRunBackup(fs.readFileSync(full, 'utf8'));
  if (!pre.ok) {
    log('ERROR', `SQL 干跑未通过，中止封存：${pre.issues.join('；')}`);
    process.exit(1);
  }
  log('INFO', `SQL 干跑通过：${pre.tables} 表 / ${pre.rows} INSERT`);

  // ---- 3) 封存：manifest + 加密 + 异地复制 + 过期清理 ----
  const manifest = await sealBackup(full, { tables: meta.tables, rows: meta.rows, driver, dbName });
  log('INFO', `封存完成：encrypted=${manifest.encrypted} remote=${manifest.remoteCopy?.ok ?? false} pruned=${manifest.pruned ?? 0}`);

  // ---- 4) 封存后再做一次完整校验（含解密后哈希）----
  const post = await verifyBackup(full);
  if (!post.ok) {
    log('ERROR', `封存后校验失败：${post.reason}`);
    process.exit(1);
  }
  log('INFO', `✓ 备份链路完成并通过校验：${path.basename(full)}（${manifest.size} bytes）`);
}

main().catch((e) => {
  log('ERROR', `备份编排异常：${e.message}`);
  process.exit(1);
});
