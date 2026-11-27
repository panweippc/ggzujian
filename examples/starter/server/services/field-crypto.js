/**
 * 字段级加解密（AES-256-GCM 认证加密 + 密钥轮换）
 *
 * 密文格式：enc:v1:<saltB64>:<ivB64>:<tagB64>:<cipherB64>
 *   - salt：scrypt 派生密钥用，每次加密随机 → 相同明文密文不同
 *   - iv：GCM  nonce，12 字节随机
 *   - tag：GCM 认证标签，篡改后解密必然失败（不会返回错误明文）
 *
 * 密钥来源优先级：DATA_ENCRYPT_KEY > SECRETS_MASTER_KEY > JWT_SECRET（回退时会在启动时告警）。
 * 轮换：DATA_ENCRYPT_KEY_PREVIOUS（逗号分隔多个旧密钥）解密时逐个尝试；
 *       rotate() 可把旧密钥加密的字段迁到当前主密钥。
 *
 * 注意：本模块只做纯字符串加解密，不碰 SQL。字段注册表见 sensitive-fields.js。
 */
import crypto from 'node:crypto';

const MAGIC = 'enc:v1';
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const derivedCache = new Map(); // saltB64 → key，避免每行每字段重复 scrypt

function deriveKey(secret, salt) {
  const cacheKey = `${secret.length}:${salt.toString('base64')}`;
  // 用密钥长度做缓存前缀并非安全边界，仅避免同 salt 重复派生；密钥内容变了长度相同会命中旧值。
  // 因此缓存键带上密钥的短摘要：
  const digest = crypto.createHash('sha256').update(String(secret)).digest('hex').slice(0, 16);
  const ck = `${digest}:${cacheKey}`;
  if (derivedCache.has(ck)) return derivedCache.get(ck);
  const key = crypto.scryptSync(String(secret), salt, KEY_LEN);
  if (derivedCache.size > 512) derivedCache.clear();
  derivedCache.set(ck, key);
  return key;
}

/** 判断是否为本模块产生的密文 */
export function isEncrypted(v) {
  return typeof v === 'string' && v.startsWith(`${MAGIC}:`);
}

/** 加密单个值；null/undefined/空串/已加密值原样返回 */
export function encryptField(value, secret) {
  if (value === null || value === undefined || value === '') return value;
  if (isEncrypted(value)) return value;
  if (!secret) throw new Error('加密密钥缺失');
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  const enc = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [MAGIC, salt.toString('base64'), iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

/**
 * 解密单个值。
 * @param {*} value 密文或明文（明文原样返回，兼容迁移前的存量数据）
 * @param {string[]} secrets 候选密钥列表（主密钥在前）
 * @param {*} fallback 解密失败时的返回值；默认 null（绝不把密文当明文展示）
 */
export function decryptField(value, secrets = [], fallback = null) {
  if (!isEncrypted(value)) return value;
  const parts = String(value).split(':');
  if (parts.length !== 6) return fallback;
  const [, , saltB64, ivB64, tagB64, encB64] = parts;
  let salt, iv, tag, enc;
  try {
    salt = Buffer.from(saltB64, 'base64');
    iv = Buffer.from(ivB64, 'base64');
    tag = Buffer.from(tagB64, 'base64');
    enc = Buffer.from(encB64, 'base64');
    if (salt.length !== SALT_LEN || iv.length !== IV_LEN || tag.length !== 16) return fallback;
  } catch { return fallback; }
  for (const secret of secrets) {
    if (!secret) continue;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    } catch { /* 换下一个候选密钥 */ }
  }
  return fallback;
}

/** 把旧密钥加密的值迁到当前主密钥；本来就是明文或无法解密则原样返回 */
export function rotateField(value, secrets = [], newSecret) {
  const plain = decryptField(value, secrets, null);
  if (plain === null) return value;
  if (!isEncrypted(value)) return value; // 存量明文交由迁移脚本处理，避免误把明文全量重加密
  return encryptField(plain, newSecret);
}

/**
 * 工厂：从环境/显式配置解析密钥集合。
 * 未配置任何密钥时抛错（不静默降级），避免"以为加密了其实存明文"。
 */
export function createFieldCrypto({ secret, previousSecrets } = {}) {
  const master = secret || process.env.DATA_ENCRYPT_KEY || process.env.SECRETS_MASTER_KEY || process.env.JWT_SECRET;
  if (!master) throw new Error('字段加密密钥缺失：请配置 DATA_ENCRYPT_KEY（或 SECRETS_MASTER_KEY / JWT_SECRET）');
  const raw = previousSecrets ?? process.env.DATA_ENCRYPT_KEY_PREVIOUS ?? '';
  const prev = (Array.isArray(raw) ? raw : String(raw).split(',')).map((s) => String(s).trim()).filter(Boolean);
  const keys = [...new Set([master, ...prev])];
  return {
    master,
    keys,
    encrypt: (v) => encryptField(v, master),
    decrypt: (v, fallback = null) => decryptField(v, keys, fallback),
    rotate: (v) => rotateField(v, keys, master),
    isEncrypted,
  };
}

export default createFieldCrypto;
