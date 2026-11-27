/**
 * 电子签章服务（纯函数，零 DB 耦合）
 *
 * 安全模型：
 *  - 文档摘要：SHA-256(docContent) → 64 hex，避免存储原文
 *  - 签章：HMAC-SHA256(secret, docHash|signer|sealId|signedAt) → 64 hex
 *  - 验签：重算 HMAC 并常量时间比较（timingSafeEqual），同时校验文档摘要未被篡改
 *  - 撤销：业务层把 status 置 0，验签时检查 status
 *
 * 说明：这是「完整性 + 抗抵赖（基于服务端密钥）」的实现，不等同于 PDF 数字证书（PKI/CA）。
 * 需要 CA 级电子签名时接入 KMS/CA 适配器（.env 的 KMS_URL 预留位）。
 */
import crypto from 'node:crypto';

export function docDigest(content) {
  return crypto.createHash('sha256').update(String(content ?? ''), 'utf8').digest('hex');
}

function signPayload({ docHash, signer, sealId, signedAt }) {
  return `${docHash}|${signer}|${sealId}|${signedAt}`;
}

export function createSignatureService(secret) {
  // 安全：签章密钥独立于 JWT 密钥；未配置 SIGN_SECRET 时兼容回退 JWT_SECRET 并在生产告警。
  const key = secret || process.env.SIGN_SECRET || process.env.JWT_SECRET || 'dev-only-signing-secret';
  if (!secret && !process.env.SIGN_SECRET && process.env.NODE_ENV === 'production') {
    console.warn('[signature] 未配置 SIGN_SECRET，已回退使用 JWT_SECRET；生产环境请独立配置签章密钥。');
  }

  /** 生成签章记录（不含 id/status，由路由层落库） */
  function sign({ docContent, signer, signerName = '', sealId = 'default', signedAt = new Date().toISOString() }) {
    const docHash = docDigest(docContent);
    const signature = crypto.createHmac('sha256', key).update(signPayload({ docHash, signer, sealId, signedAt })).digest('hex');
    return { docHash, signer, signerName, sealId, signedAt, signature };
  }

  /** 验签：常量时间比较 + 文档摘要一致性 */
  function verify({ docContent, docHash, signer, sealId, signedAt, signature }, status = 1) {
    if (status !== 1) return { valid: false, reason: '签章已撤销' };
    const actualHash = docDigest(docContent ?? '');
    if (actualHash !== docHash) return { valid: false, reason: '文档内容已变更（摘要不匹配）' };
    const expected = crypto.createHmac('sha256', key).update(signPayload({ docHash, signer, sealId, signedAt })).digest('hex');
    const a = Buffer.from(String(signature || ''), 'hex');
    const b = Buffer.from(expected, 'hex');
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { valid: ok, reason: ok ? '验签通过' : '签名不匹配' };
  }

  return { sign, verify, docDigest };
}

export default { createSignatureService, docDigest };
