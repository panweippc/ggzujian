/**
 * 数据安全 C2：查询出口分级管控（审批 + 水印 + 一次性核销）
 */
import { describe, it, expect } from 'vitest';
import {
  needsApproval, classifySchema, makeRequestNo, checkExport, consume, stampWatermark,
} from '../services/data-export-guard.js';
import { createExcelService } from '../services/excel.js';

const alice = { user: { name: 'alice', username: 'alice' } };
const mockPool = (row = null, affectedRows = 1) => ({
  execute: async (sql) => {
    if (sql.startsWith('SELECT * FROM data_export_approvals')) return [row ? [row] : [], []];
    if (sql.startsWith('UPDATE data_export_approvals')) return [{ affectedRows }, []];
    return [[], []];
  },
});
const approvedRow = (over = {}) => ({
  requestNo: 'EXP1770000000000ABCDEF', schemaKey: 'employees', tableName: 'employees',
  riskLevel: 'high', requestedBy: 'alice', status: 'approved', rowLimit: 500,
  reason: '月度报表', approvedBy: 'admin', expiresAt: new Date(Date.now() + 600000), ...over,
});

describe('导出风险分级', () => {
  it('默认策略 medium：low 免审批，medium/high 需审批', () => {
    expect(needsApproval('low')).toBe(false);
    expect(needsApproval('medium')).toBe(true);
    expect(needsApproval('high')).toBe(true);
  });

  it('按 schema 字段自动判定风险，不依赖声明', () => {
    const low = classifySchema('products', { table: 'products', fields: [{ key: 'name' }, { key: 'price' }] });
    expect(low.risk).toBe('low');
    const high = classifySchema('employees', { table: 'employees', fields: [{ key: 'name' }, { key: 'idCard' }] });
    expect(high.risk).toBe('high');
  });

  it('申请单号格式', () => {
    expect(makeRequestNo()).toMatch(/^EXP\d{13,}[0-9A-F]{6}$/);
  });
});

describe('导出审批校验', () => {
  it('低风险免审批直接放行', async () => {
    const r = await checkExport(mockPool(), alice, { schemaKey: 'products', risk: 'low', requestedRows: 10 });
    expect(r.allowed).toBe(true);
    expect(r.request).toBe(null);
  });

  it('高风险无审批单被拒绝', async () => {
    const r = await checkExport(mockPool(), alice, { schemaKey: 'employees', risk: 'high', requestedRows: 10 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/先申请审批/);
  });

  it('审批通过且申请人/模板匹配则放行', async () => {
    const r = await checkExport(mockPool(approvedRow()), alice, {
      schemaKey: 'employees', risk: 'high', requestNo: approvedRow().requestNo, requestedRows: 100,
    });
    expect(r.allowed).toBe(true);
    expect(r.request.requestedBy).toBe('alice');
  });

  it('申请人不一致 / 模板不匹配 / 状态非 approved / 超行数上限均拒绝', async () => {
    const no = approvedRow().requestNo;
    const base = { schemaKey: 'employees', risk: 'high', requestNo: no, requestedRows: 10 };
    expect((await checkExport(mockPool(approvedRow({ requestedBy: 'bob' })), alice, base)).allowed).toBe(false);
    expect((await checkExport(mockPool(approvedRow({ schemaKey: 'other' })), alice, base)).allowed).toBe(false);
    expect((await checkExport(mockPool(approvedRow({ status: 'used' })), alice, base)).allowed).toBe(false);
    expect((await checkExport(mockPool(approvedRow({ expiresAt: new Date(Date.now() - 1000) })), alice, base)).allowed).toBe(false);
    expect((await checkExport(mockPool(approvedRow()), alice, { ...base, requestedRows: 9999 })).allowed).toBe(false);
  });

  it('审批单一次性核销：UPDATE 影响行数为 0 时消费失败', async () => {
    expect(await consume(mockPool(approvedRow(), 1), 'EXP123')).toBe(true);
    expect(await consume(mockPool(approvedRow(), 0), 'EXP123')).toBe(false);
  });
});

describe('导出水印', () => {
  it('追加「导出信息」sheet 且不破坏数据 sheet', () => {
    const excel = createExcelService();
    const schema = { fields: [{ key: 'name', label: '姓名' }] };
    const raw = excel.exportRows([{ name: '张三' }], schema);
    const out = stampWatermark(excel.XLSX, raw, {
      username: 'alice', schemaKey: 'employees', risk: 'high',
      requestNo: 'EXP123', rows: 1,
    });
    const wb = excel.XLSX.read(out, { type: 'buffer' });
    expect(wb.SheetNames).toContain('导出信息');
    expect(wb.SheetNames).toContain('数据');
    const matrix = excel.XLSX.utils.sheet_to_json(wb.Sheets['导出信息'], { header: 1 });
    expect(matrix.flat().join(' ')).toContain('alice');
    expect(matrix.flat().join(' ')).toContain('EXP123');
  });
});
