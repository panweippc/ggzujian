/**
 * 通用 Excel 底座测试：模板生成 / 表头校验 / 类型·必填·枚举·范围校验 /
 * 错误行报告 / 导出。全部走内存 Buffer，不依赖 DB。
 */
import { describe, it, expect } from 'vitest';
import { createExcelService } from '../services/excel.js';

const excel = createExcelService();
const schema = {
  sheetName: '导入',
  fields: [
    { key: 'name', label: '姓名', required: true, type: 'string' },
    { key: 'age', label: '年龄', type: 'integer', min: 0, max: 120 },
    { key: 'status', label: '状态', type: 'enum', options: ['启用', '停用'] },
    { key: 'phone', label: '手机号', pattern: '^1[3-9]\\d{9}$' },
  ],
};

function makeXlsx(rows) {
  const ws = excel.XLSX.utils.aoa_to_sheet(rows);
  const wb = excel.XLSX.utils.book_new();
  excel.XLSX.utils.book_append_sheet(wb, ws, '导入');
  return excel.XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('Excel 底座 · 模板', () => {
  it('模板含表头与示例行', () => {
    const buf = excel.buildTemplate(schema);
    const wb = excel.XLSX.read(buf, { type: 'buffer' });
    const rows = excel.XLSX.utils.sheet_to_json(wb.Sheets['导入'], { header: 1 });
    expect(rows[0]).toEqual(['姓名', '年龄', '状态', '手机号']);
    expect(rows[1][2]).toBe('启用'); // enum 默认第一项
  });
});

describe('Excel 底座 · 校验', () => {
  it('合法数据全部通过并归一化类型', () => {
    const buf = makeXlsx([
      ['姓名', '年龄', '状态', '手机号'],
      ['张三', 30, '启用', '13800138000'],
      ['李四', 25, '停用', '13900139000'],
    ]);
    const r = excel.validate(buf, schema);
    expect(r.total).toBe(2);
    expect(r.errors).toHaveLength(0);
    expect(r.valid).toHaveLength(2);
    expect(r.valid[0].age).toBe(30);
  });

  it('必填/类型/枚举/范围/正则错误逐项报出，带 Excel 行号', () => {
    const buf = makeXlsx([
      ['姓名', '年龄', '状态', '手机号'],
      ['', 200, '未知', '123'], // 第2行：4处错误
    ]);
    const r = excel.validate(buf, schema);
    expect(r.valid).toHaveLength(0);
    expect(r.errors.length).toBeGreaterThanOrEqual(4);
    expect(r.errors.every(e => e.row === 2)).toBe(true);
    expect(r.errors.map(e => e.field)).toEqual(expect.arrayContaining(['name', 'age', 'status', 'phone']));
  });

  it('表头不匹配时抛出明确错误', () => {
    const buf = makeXlsx([['foo', 'bar'], ['x', 'y']]);
    expect(() => excel.validate(buf, schema)).toThrow(/表头不匹配/);
  });
});

describe('Excel 底座 · 错误回显与导出', () => {
  it('错误报告包含校验错误列', () => {
    const buf = makeXlsx([
      ['姓名', '年龄', '状态', '手机号'],
      ['', 200, '未知', '123'],
    ]);
    const v = excel.validate(buf, schema);
    const errBuf = excel.buildErrorReport(v, schema);
    const wb = excel.XLSX.read(errBuf, { type: 'buffer' });
    const rows = excel.XLSX.utils.sheet_to_json(wb.Sheets['错误明细'], { header: 1 });
    expect(rows[0][rows[0].length - 1]).toBe('校验错误');
    expect(rows[1][rows[1].length - 1]).toMatch(/姓名不能为空/);
  });

  it('导出数据含表头与行', () => {
    const buf = excel.exportRows([{ name: '张三', age: 30, status: '启用', phone: '13800138000' }], schema);
    const wb = excel.XLSX.read(buf, { type: 'buffer' });
    const rows = excel.XLSX.utils.sheet_to_json(wb.Sheets['导入'], { header: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe('张三');
  });
});
