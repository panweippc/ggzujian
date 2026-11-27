/**
 * 后端单元测试（Vitest）
 * 运行：cd server && npm test
 */
import { describe, it, expect } from 'vitest';
import { rowHashOf } from '../services/audit-chain.js';
import { checkFieldName, checkCode } from '../standards/index.js';

describe('audit-chain 哈希链', () => {
  it('相同输入哈希一致', () => {
    const row = { action: 'create', username: 'admin', detail: 'x', traceId: 't1', requestBody: '{}', createdAt: '2026-01-01 00:00:00' };
    expect(rowHashOf('prev', row)).toBe(rowHashOf('prev', row));
  });

  it('prevHash 不同则哈希不同（链式）', () => {
    const row = { action: 'create', username: 'admin' };
    expect(rowHashOf('a', row)).not.toBe(rowHashOf('b', row));
  });
});

describe('standards 规范校验', () => {
  it('合法字段命名通过', () => {
    expect(checkFieldName('userName').ok).toBe(true);
  });

  it('合规编码通过', () => {
    expect(checkCode('configKey', 'security.ipWhitelistEnabled').ok).toBe(true);
  });
});
