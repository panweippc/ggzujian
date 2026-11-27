/**
 * 电子签章测试：摘要稳定性 / HMAC 验签 / 篡改检测 / 撤销检测 / 重放检测
 */
import { describe, it, expect } from 'vitest';
import { createSignatureService, docDigest } from '../services/signature.js';

const svc = createSignatureService('unit-test-signing-secret');

describe('电子签章 · 摘要', () => {
  it('相同文档摘要一致，不同文档摘要不同', () => {
    expect(docDigest('hello')).toBe(docDigest('hello'));
    expect(docDigest('hello')).not.toBe(docDigest('world'));
    expect(docDigest('hello')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('电子签章 · 签发与验签', () => {
  const doc = '合同正文：甲方向乙方采购商品，金额10000元。';
  const rec = svc.sign({ docContent: doc, signer: 'alice', sealId: 'seal-1', signedAt: '2026-11-26T10:00:00Z' });

  it('签发结果字段完整', () => {
    expect(rec.docHash).toBe(docDigest(doc));
    expect(rec.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.signer).toBe('alice');
  });

  it('原文未变 → 验签通过', () => {
    expect(svc.verify({ ...rec, docContent: doc }).valid).toBe(true);
  });

  it('文档被篡改 → 验签失败且给出明确原因', () => {
    const r = svc.verify({ ...rec, docContent: doc + '（篡改）' });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/变更/);
  });

  it('签名被篡改 → 验签失败', () => {
    const bad = rec.signature.slice(0, -1) + (rec.signature.endsWith('a') ? 'b' : 'a');
    expect(svc.verify({ ...rec, docContent: doc, signature: bad }).valid).toBe(false);
  });

  it('签署人/印章/时间任一变化 → 验签失败（防重放）', () => {
    expect(svc.verify({ ...rec, docContent: doc, signer: 'bob' }).valid).toBe(false);
    expect(svc.verify({ ...rec, docContent: doc, sealId: 'seal-2' }).valid).toBe(false);
    expect(svc.verify({ ...rec, docContent: doc, signedAt: '2026-11-26T11:00:00Z' }).valid).toBe(false);
  });

  it('已撤销签章 → 验签失败', () => {
    expect(svc.verify({ ...rec, docContent: doc }, 0).valid).toBe(false);
    expect(svc.verify({ ...rec, docContent: doc }, 0).reason).toMatch(/撤销/);
  });

  it('不同密钥签发的签名无法验过', () => {
    const other = createSignatureService('another-secret');
    expect(other.verify({ ...rec, docContent: doc }).valid).toBe(false);
  });
});
