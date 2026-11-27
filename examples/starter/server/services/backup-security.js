/**
 * 备份安全封装（数据安全 C1）
 *
 * 对现有 SQL 备份额外提供：
 *   - sealBackup    生成 .manifest.json（SHA-256 + 表数/行数/时间/驱动）
 *   - 可选 AES-256-GCM 加密落盘（BACKUP_ENCRYPT_KEY，缺省回退 JWT_SECRET 并告警）
 *   - verifyBackup  校验落盘哈希 + 解密后内容哈希 + SQL 干跑（不执行）
 *   - openBackup    下载/恢复前透明解密，closeBackup 清理临时文件
 *   - 异地留存复制（BACKUP_REMOTE_DIR）+ 过期清理（BACKUP_RETENTION_DAYS）
 *
 * 密文文件格式：'STBF1' + salt(16) + iv(12) + ciphertext；GCM tag 存 manifest.cipher.tag。
 * 这样可流式加解密大文件，不必把整份备份读进内存。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('STBF1');
const SALT_LEN = 16;
const IV_LEN = 12;
const MANIFEST_SUFFIX = '.manifest.json';
export const manifestPath = (filePath) => `${filePath}${MANIFEST_SUFFIX}`;

function secretOf() {
  const s = process.env.BACKUP_ENCRYPT_KEY || process.env.SECRETS_MASTER_KEY || process.env.JWT_SECRET;
  if (s && !process.env.BACKUP_ENCRYPT_KEY && !process.env.SECRETS_MASTER_KEY) {
    console.warn('[backup-security] BACKUP_ENCRYPT_KEY 未配置，回退 JWT_SECRET，建议配置独立密钥');
  }
  return s;
}
const deriveKey = (secret, salt) => crypto.scryptSync(String(secret), salt, 32);

/** 流式计算文件 SHA-256 */
export function computeHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export async function readManifest(filePath) {
  const mp = manifestPath(filePath);
  if (!fs.existsSync(mp)) return null;
  try { return JSON.parse(fs.readFileSync(mp, 'utf8')); } catch { return null; }
}

async function encryptFile(src, dst, secret) {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  const out = fs.createWriteStream(dst);
  const headerWritten = new Promise((resolve, reject) => {
    out.write(Buffer.concat([MAGIC, salt, iv]), (err) => (err ? reject(err) : resolve()));
  });
  await headerWritten;
  await pipeline(fs.createReadStream(src), cipher, out, { end: true });
  return { alg: 'aes-256-gcm', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

async function decryptFile(src, dst, secret, cipherMeta) {
  if (!cipherMeta?.salt || !cipherMeta?.iv || !cipherMeta?.tag) throw new Error('备份 manifest 缺少解密参数');
  const salt = Buffer.from(cipherMeta.salt, 'base64');
  const iv = Buffer.from(cipherMeta.iv, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  decipher.setAuthTag(Buffer.from(cipherMeta.tag, 'base64'));
  const fd = fs.openSync(src, 'r');
  const header = Buffer.alloc(MAGIC.length + SALT_LEN + IV_LEN);
  try {
    fs.readSync(fd, header, 0, header.length, 0);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('备份文件格式不是 STBF1 密文');
  } finally { fs.closeSync(fd); }
  await pipeline(fs.createReadStream(src, { start: header.length }), decipher, fs.createWriteStream(dst));
}

/** SQL 备份干跑：只解析文本，不连库不执行；返回表数/INSERT 数/可疑高危语句 */
export function dryRunBackup(sqlText) {
  const text = String(sqlText || '');
  const tables = [...text.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?"?[\w]+`?"?/gi)].length;
  const rows = [...text.matchAll(/INSERT\s+INTO/gi)].length;
  const issues = [];
  if (/DROP\s+DATABASE|TRUNCATE\s+(?:TABLE\s+)?[\w`]+/i.test(text)) issues.push('包含 DROP DATABASE / TRUNCATE 高危语句');
  if (/\bDELETE\s+FROM\s+[\w.`]+\s*;/i.test(text)) issues.push('存在无 WHERE 条件的 DELETE');
  return { ok: issues.length === 0, tables, rows, issues };
}

function replicate(filePath, dir) {
  if (!dir) return { enabled: false };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, path.basename(filePath));
    fs.copyFileSync(filePath, dest);
    return { enabled: true, ok: true, path: dest };
  } catch (e) {
    return { enabled: true, ok: false, error: e.message };
  }
}

function prune(dir) {
  const days = +(process.env.BACKUP_RETENTION_DAYS || 0);
  if (!days || !fs.existsSync(dir)) return 0;
  const cutoff = Date.now() - days * 86400000;
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!/\.sql$/.test(name) && !name.endsWith(MANIFEST_SUFFIX)) continue;
    const full = path.join(dir, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); removed += 1; }
    } catch { /* 单个文件清理失败不影响主流程 */ }
  }
  return removed;
}

/**
 * 封存备份：算明文哈希 → 可选加密 → 写 manifest → 异地复制 → 过期清理。
 * 顺序保证：manifest 先落盘再原子替换文件；替换失败时回滚 manifest，避免"密文裸奔"。
 */
export async function sealBackup(filePath, meta = {}) {
  const secret = secretOf();
  const doEncrypt = process.env.BACKUP_ENCRYPT !== 'false' && !!secret;
  const sha256 = await computeHash(filePath);
  const stat = fs.statSync(filePath);
  const manifest = {
    version: 1,
    name: path.basename(filePath),
    createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    driver: meta.driver || process.env.DB_DRIVER || 'mysql',
    dbName: meta.dbName || process.env.DB_NAME || '',
    tables: meta.tables ?? null,
    rows: meta.rows ?? null,
    sha256,
    size: stat.size,
    encrypted: false,
  };

  if (doEncrypt) {
    const tmpFile = `${filePath}.enc.tmp`;
    try {
      const cipher = await encryptFile(filePath, tmpFile, secret);
      manifest.encrypted = true;
      manifest.cipher = cipher;
      manifest.encSha256 = await computeHash(tmpFile);
      manifest.size = fs.statSync(tmpFile).size;
      fs.writeFileSync(manifestPath(filePath), JSON.stringify(manifest, null, 2));
      fs.renameSync(tmpFile, filePath); // 原子覆盖明文
    } catch (e) {
      try { fs.unlinkSync(tmpFile); } catch {}
      try { fs.unlinkSync(manifestPath(filePath)); } catch {}
      throw new Error('备份加密失败，已保留原明文文件：' + e.message);
    }
  }

  const remote = replicate(filePath, process.env.BACKUP_REMOTE_DIR);
  manifest.remoteCopy = remote;
  fs.writeFileSync(manifestPath(filePath), JSON.stringify(manifest, null, 2));
  if (remote.ok) {
    try { fs.writeFileSync(manifestPath(remote.path), JSON.stringify(manifest, null, 2)); } catch {}
  }
  manifest.pruned = prune(path.dirname(filePath));
  return manifest;
}

/** 完整校验：落盘哈希 → 解密后内容哈希 → SQL 干跑 */
export async function verifyBackup(filePath) {
  const manifest = await readManifest(filePath);
  if (!manifest) return { ok: false, reason: '缺少 .manifest.json（该备份可能早于校验体系）' };
  if (!fs.existsSync(filePath)) return { ok: false, reason: '备份文件不存在', manifest };

  const actual = await computeHash(filePath);
  const expected = manifest.encrypted ? manifest.encSha256 : manifest.sha256;
  if (!expected || actual !== expected) {
    return { ok: false, reason: '落盘文件校验和不匹配，可能已被篡改或损坏', manifest, actual };
  }

  let readablePath = filePath;
  let temp = null;
  try {
    if (manifest.encrypted) {
      const secret = secretOf();
      if (!secret) return { ok: false, reason: '备份已加密但未配置解密密钥', manifest };
      temp = path.join(os.tmpdir(), `starter-verify-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.sql`);
      await decryptFile(filePath, temp, secret, manifest.cipher);
      const plainHash = await computeHash(temp);
      if (plainHash !== manifest.sha256) {
        return { ok: false, reason: '解密后内容校验和不匹配', manifest };
      }
      readablePath = temp;
    }
    const sqlText = fs.readFileSync(readablePath, 'utf8');
    const dryRun = dryRunBackup(sqlText);
    return { ok: dryRun.ok, manifest, dryRun, reason: dryRun.ok ? undefined : dryRun.issues.join('；') };
  } catch (e) {
    return { ok: false, reason: '校验失败：' + e.message, manifest };
  } finally {
    if (temp) { try { fs.unlinkSync(temp); } catch {} }
  }
}

/** 下载/恢复前打开备份（透明解密），用完必须 closeBackup */
export async function openBackup(filePath) {
  const manifest = await readManifest(filePath);
  if (!manifest?.encrypted) return { path: filePath, temp: null, manifest };
  const secret = secretOf();
  if (!secret) throw new Error('备份已加密，请配置 BACKUP_ENCRYPT_KEY');
  const temp = path.join(os.tmpdir(), `starter-restore-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.sql`);
  try {
    await decryptFile(filePath, temp, secret, manifest.cipher);
  } catch (e) {
    try { fs.unlinkSync(temp); } catch {}
    throw new Error('备份解密失败：' + e.message);
  }
  return { path: temp, temp, manifest };
}

export function closeBackup(opened) {
  if (opened?.temp) { try { fs.unlinkSync(opened.temp); } catch {} }
}
