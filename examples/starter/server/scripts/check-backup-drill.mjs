#!/usr/bin/env node
/**
 * 备份可恢复性演练（零依赖，不连生产库）：校验 manifest 完整性、加密可解密性与异地留存。
 *
 * 检查项：
 *   1) 扫描 .manifest.json，校验落盘文件 SHA-256 与 manifest 一致
 *   2) 加密备份：有密钥时执行"解密 + 明文哈希复算"演练（不写盘、不连库）
 *   3) 异地留存：manifest.remoteCopy 是否存在
 *   4) 无备份时明确标 manual，不静默通过
 *
 * 用法：node scripts/check-backup-drill.mjs [--json] [--strict] [--dir <path>]
 * 说明：本脚本验证"备份文件可用"，不等价于真实数据库恢复演练；后者需要目标实例。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SERVER, parseArgs, readOr, finish } from './_check-utils.mjs';

const args = parseArgs();
const findings = [];
const add = (level, message, file = '') => findings.push({ level, message, file });

const backupDir = args.val('dir', path.join(SERVER, 'backups'));
const manifests = fs.existsSync(backupDir)
  ? fs.readdirSync(backupDir).filter((f) => f.endsWith('.manifest.json')).map((f) => path.join(backupDir, f))
  : [];
const envText = readOr(path.join(SERVER, '.env'));
const em = envText.match(/^BACKUP_ENCRYPT_KEY\s*=\s*(.*)$/m);
const secret = process.env.BACKUP_ENCRYPT_KEY || (em ? em[1].split('#')[0].trim() : '');
const remoteDir = process.env.BACKUP_REMOTE_DIR || (envText.match(/^BACKUP_REMOTE_DIR\s*=\s*(.*)$/m)?.[1] || '').split('#')[0].trim();

const sha = (file) => new Promise((resolve) => {
  const h = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  stream.on('data', (c) => h.update(c));
  stream.on('end', () => resolve(h.digest('hex')));
  stream.on('error', () => resolve(''));
});

async function drillDecrypt(filePath, manifest) {
  if (!manifest.cipher?.salt || !manifest.cipher?.iv || !manifest.cipher?.tag) {
    return { ok: false, reason: 'manifest 缺少解密参数' };
  }
  if (!secret) return { ok: false, reason: '备份已加密但未配置 BACKUP_ENCRYPT_KEY' };
  try {
    const raw = fs.readFileSync(filePath);
    const body = raw.subarray(28); // 'STBF1' + salt(16) + iv(12)
    const key = crypto.scryptSync(secret, Buffer.from(manifest.cipher.salt, 'hex'), 32);
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(manifest.cipher.iv, 'hex'));
    d.setAuthTag(Buffer.from(manifest.cipher.tag, 'hex'));
    const plain = Buffer.concat([d.update(body), d.final()]);
    const hash = crypto.createHash('sha256').update(plain).digest('hex');
    if (hash !== manifest.sha256) return { ok: false, reason: '解密后明文哈希与 manifest 不一致' };
    const head = plain.subarray(0, 200).toString('utf8');
    if (!/\b(CREATE TABLE|INSERT INTO|--\s*dump)/i.test(head)) return { ok: false, reason: '解密内容不像 SQL 备份' };
    return { ok: true, bytes: plain.length };
  } catch (e) {
    return { ok: false, reason: '解密失败：' + e.message };
  }
}

if (!manifests.length) {
  add('manual', '备份目录中没有 manifest，无法演练（先运行 backup-orchestrator 生成一份）', path.relative(SERVER, backupDir));
} else {
  for (const mp of manifests) {
    const file = mp.replace(/\.manifest\.json$/, '');
    let mf;
    try { mf = JSON.parse(fs.readFileSync(mp, 'utf8')); }
    catch { add('critical', `manifest 解析失败：${path.basename(mp)}`, path.basename(mp)); continue; }
    if (!fs.existsSync(file)) {
      add('critical', `备份文件缺失：${path.basename(file)}`, path.basename(file));
      continue;
    }
    const expected = mf.encrypted ? mf.encSha256 : mf.sha256;
    const actual = await sha(file);
    if (!expected || actual !== expected) {
      add('critical', `${path.basename(file)} 完整性校验失败`, path.basename(file));
      continue;
    }
    add('pass', `${path.basename(file)} SHA-256 完整`, path.basename(file));
    if (mf.encrypted) {
      const r = await drillDecrypt(file, mf);
      if (r.ok) add('pass', `${path.basename(file)} 解密演练通过（${r.bytes} 字节）`, path.basename(file));
      else add('manual', `${path.basename(file)} 解密演练未完成：${r.reason}`, path.basename(file));
    }
    if (mf.remoteCopy?.path && fs.existsSync(mf.remoteCopy.path)) {
      add('pass', `${path.basename(file)} 异地副本存在`, path.basename(file));
    } else if (remoteDir) {
      add('warn', `已配置 BACKUP_REMOTE_DIR 但 ${path.basename(file)} 无异地副本`, path.basename(file));
    } else {
      add('manual', `${path.basename(file)} 未配置异地留存`, path.basename(file));
    }
  }
}

finish('备份可恢复性演练', {
  manifests: manifests.length,
  encryptedConfigured: !!secret,
  remoteConfigured: !!remoteDir,
  drillMode: 'integrity + decrypt（不连库）',
}, findings, args, {
  disclaimer: '验证备份文件可用（完整性/解密），不等价于真实数据库恢复；真实恢复需目标实例与窗口',
});
