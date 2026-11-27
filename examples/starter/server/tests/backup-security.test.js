/**
 * 数据安全 C1：备份完整性校验 / 加密 / 透明解密 / SQL 干跑
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  sealBackup, verifyBackup, openBackup, closeBackup, readManifest, computeHash, dryRunBackup,
} from '../services/backup-security.js';

const SQL = `-- starter 数据库备份
DROP TABLE IF EXISTS \`products\`;
CREATE TABLE \`products\` (\`id\` int NOT NULL, \`name\` varchar(64));
INSERT INTO \`products\` (\`id\`, \`name\`) VALUES (1, '甲');
INSERT INTO \`products\` (\`id\`, \`name\`) VALUES (2, '乙');
`;

let dir, file;
const savedEnv = {};
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-backup-test-'));
  file = path.join(dir, 'test_backup.sql');
  fs.writeFileSync(file, SQL, 'utf8');
  for (const k of ['BACKUP_ENCRYPT_KEY', 'BACKUP_ENCRYPT', 'BACKUP_REMOTE_DIR', 'BACKUP_RETENTION_DAYS', 'SECRETS_MASTER_KEY']) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

describe('备份清单与完整性', () => {
  it('computeHash 稳定且内容变化后改变', async () => {
    const a = await computeHash(file);
    expect(a).toBe(await computeHash(file));
    fs.appendFileSync(file, '\n-- changed\n');
    expect(a).not.toBe(await computeHash(file));
  });

  it('sealBackup 生成 manifest，verifyBackup 通过', async () => {
    const m = await sealBackup(file, { tables: 1, rows: 2 });
    expect(m.encrypted).toBe(false);
    expect(m.tables).toBe(1);
    expect((await readManifest(file)).sha256).toBe(m.sha256);
    const v = await verifyBackup(file);
    expect(v.ok).toBe(true);
    expect(v.dryRun.tables).toBe(1);
    expect(v.dryRun.rows).toBe(2);
  });

  it('篡改落盘文件后校验失败', async () => {
    await sealBackup(file);
    fs.appendFileSync(file, '\nINSERT INTO products VALUES (999, "hacked");\n');
    const v = await verifyBackup(file);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/校验和不匹配/);
  });

  it('缺少 manifest 时明确失败（不静默放行）', async () => {
    const v = await verifyBackup(file);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/缺少/);
  });
});

describe('加密备份', () => {
  it('加密落盘不泄露明文，verify 与 open/close 往返正常', async () => {
    process.env.BACKUP_ENCRYPT_KEY = 'unit-test-backup-key';
    const m = await sealBackup(file, { tables: 1, rows: 2 });
    expect(m.encrypted).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).not.toContain('CREATE TABLE');
    expect((await verifyBackup(file)).ok).toBe(true);

    const opened = await openBackup(file);
    expect(fs.readFileSync(opened.path, 'utf8')).toContain('CREATE TABLE');
    closeBackup(opened);
    expect(fs.existsSync(opened.temp)).toBe(false);
  });

  it('加密备份缺密钥时校验拒绝', async () => {
    process.env.BACKUP_ENCRYPT_KEY = 'unit-test-backup-key';
    await sealBackup(file);
    delete process.env.BACKUP_ENCRYPT_KEY;
    const v = await verifyBackup(file);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/未配置解密密钥/);
  });

  it('BACKUP_ENCRYPT=false 时保留明文', async () => {
    process.env.BACKUP_ENCRYPT_KEY = 'unit-test-backup-key';
    process.env.BACKUP_ENCRYPT = 'false';
    const m = await sealBackup(file);
    expect(m.encrypted).toBe(false);
  });
});

describe('SQL 干跑', () => {
  it('统计表/INSERT 数', () => {
    const r = dryRunBackup(SQL);
    expect(r.ok).toBe(true);
    expect(r.tables).toBe(1);
    expect(r.rows).toBe(2);
  });

  it('识别 DROP DATABASE / 无 WHERE DELETE 等高危语句', () => {
    const r = dryRunBackup('DROP DATABASE prod;\nDELETE FROM users;');
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });
});
