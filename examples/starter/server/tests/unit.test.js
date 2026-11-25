/**
 * 后端单元测试（Node 内置 node:test，零第三方依赖）
 * 运行：cd server && node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowHashOf } from '../services/audit-chain.js';
import { checkFieldName, checkCode } from '../standards/index.js';

test('audit-chain: 相同输入哈希一致', () => {
  const row = { action: 'create', username: 'admin', detail: 'x', traceId: 't1', requestBody: '{}', createdAt: '2026-01-01 00:00:00' };
  assert.equal(rowHashOf('prev', row), rowHashOf('prev', row));
});

test('audit-chain: prevHash 不同则哈希不同（链式）', () => {
  const row = { action: 'create', username: 'admin' };
  assert.notEqual(rowHashOf('a', row), rowHashOf('b', row));
});

test('standards: 合法字段命名通过', () => {
  const r = checkFieldName('userName');
  assert.equal(r.ok, true);
});

test('standards: 合规编码通过', () => {
  const r = checkCode('configKey', 'security.ipWhitelistEnabled');
  assert.equal(r.ok, true);
});
