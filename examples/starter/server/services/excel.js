/**
 * 通用 Excel 导入导出底座（基于 xlsx）
 *
 * 目标：业务系统不再重复写「模板下载 + 字段校验 + 错误行回显 + 事务导入」。
 * 用法：
 *   const excel = createExcelService();
 *   const schema = { fields: [
 *     { key:'name', label:'姓名', required:true, type:'string' },
 *     { key:'age', label:'年龄', type:'number', min:0, max:120 },
 *     { key:'status', label:'状态', type:'enum', options:['启用','停用'] },
 *     { key:'phone', label:'手机号', pattern:'^1[3-9]\\d{9}$' },
 *   ]};
 *   // 模板下载
 *   const buf = excel.buildTemplate(schema);
 *   // 导入校验
 *   const { valid, errors, total } = excel.validate(buffer, schema);
 *   // 错误行回显 xlsx
 *   const errBuf = excel.buildErrorReport(errors, schema);
 *   // 事务导入由路由层用 pool.transaction 调 valid 行
 */
import * as XLSX from 'xlsx';

/** 字段类型校验器 */
const validators = {
  string: (v) => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number',
  number: (v) => v !== '' && v != null && Number.isFinite(Number(v)),
  integer: (v) => v !== '' && v != null && Number.isInteger(Number(v)),
  enum: (v, f) => f.options?.map(String).includes(String(v)),
  date: (v) => {
    if (v instanceof Date) return !isNaN(v.getTime());
    const d = new Date(v);
    return !isNaN(d.getTime());
  },
  boolean: (v) => [true, false, 'true', 'false', '是', '否', 1, 0, '1', '0'].includes(v),
};

/** 值归一化 */
function normalizeValue(v, f) {
  if (v == null) return '';
  if (f.type === 'number' || f.type === 'integer') return Number(v);
  if (f.type === 'boolean') return ['true', '是', '1', 1, true].includes(v);
  if (f.type === 'date' && !(v instanceof Date)) return new Date(v);
  return typeof v === 'string' ? v.trim() : v;
}

export function createExcelService() {
  /** 校验一行，返回 { row, errors:[{field,label,message}] } */
  function validateRow(raw, schema, rowNo) {
    const row = {};
    const errors = [];
    for (const f of schema.fields) {
      let v = raw[f.key];
      if (v === undefined || v === null || String(v).trim() === '') {
        if (f.required) errors.push({ row: rowNo, field: f.key, label: f.label, message: `${f.label}不能为空` });
        row[f.key] = '';
        continue;
      }
      const check = validators[f.type || 'string'];
      if (check && !check(v, f)) {
        errors.push({ row: rowNo, field: f.key, label: f.label, message: `${f.label}格式不正确（期望${f.type}）` });
        continue;
      }
      if (f.pattern && !new RegExp(f.pattern).test(String(v))) {
        errors.push({ row: rowNo, field: f.key, label: f.label, message: `${f.label}格式不匹配` });
      }
      if ((f.type === 'number' || f.type === 'integer') && f.min !== undefined && Number(v) < f.min) {
        errors.push({ row: rowNo, field: f.key, label: f.label, message: `${f.label}不能小于${f.min}` });
      }
      if ((f.type === 'number' || f.type === 'integer') && f.max !== undefined && Number(v) > f.max) {
        errors.push({ row: rowNo, field: f.key, label: f.label, message: `${f.label}不能大于${f.max}` });
      }
      row[f.key] = normalizeValue(v, f);
    }
    return { row, errors };
  }

  /**
   * 从 Buffer 解析并校验
   * @returns { valid: any[], errors: [{row,field,label,message}], total:number, headers:string[] }
   */
  function validate(buffer, schema, opts = {}) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = opts.sheet || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    if (!ws) throw new Error(`工作表 ${sheetName} 不存在`);
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!matrix.length) throw new Error('Excel 为空');

    // 表头行（默认第 1 行）
    const headerRow = matrix[opts.headerRow ?? 0].map(h => String(h).trim());
    const labels = schema.fields.map(f => f.label);
    const keyByCol = {};
    schema.fields.forEach(f => {
      const idx = headerRow.indexOf(f.label);
      if (idx >= 0) keyByCol[idx] = f;
    });
    if (!Object.keys(keyByCol).length) {
      throw new Error(`表头不匹配，期望包含：${labels.join('、')}`);
    }

    const valid = [];
    const allRows = [];
    const errors = [];
    const dataRows = matrix.slice((opts.headerRow ?? 0) + 1).filter(r => r.some(c => String(c).trim() !== ''));
    for (let i = 0; i < dataRows.length; i++) {
      const raw = {};
      for (let c = 0; c < headerRow.length; c++) {
        const f = keyByCol[c];
        if (f) raw[f.key] = dataRows[i][c];
      }
      const { row, errors: rowErrors } = validateRow(raw, schema, i + 2); // Excel 行号从 2 起（1 是表头）
      errors.push(...rowErrors);
      allRows.push(row);
      if (!rowErrors.length) valid.push(row);
    }
    return { valid, rows: allRows, errors, total: dataRows.length, headers: headerRow };
  }

  /** 生成模板 xlsx Buffer（含表头 + 示例行 + 枚举列的 dataValidation 提示） */
  function buildTemplate(schema) {
    const headers = schema.fields.map(f => f.label);
    const example = schema.fields.map(f => {
      if (f.example !== undefined) return f.example;
      if (f.type === 'enum') return f.options?.[0] ?? '';
      if (f.type === 'number' || f.type === 'integer') return 0;
      return '';
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    ws['!cols'] = schema.fields.map(f => ({ wch: Math.max(12, (f.label?.length || 0) * 2 + 4) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, schema.sheetName || '导入模板');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /** 生成错误行报告 xlsx Buffer：原数据 + 「校验错误」列逐行标注 */
  function buildErrorReport(validation, schema) {
    const headers = [...schema.fields.map(f => f.label), '校验错误'];
    const errByRow = new Map();
    for (const e of validation.errors || []) {
      if (!errByRow.has(e.row)) errByRow.set(e.row, []);
      errByRow.get(e.row).push(`第${e.row}行 ${e.message}`);
    }
    const rows = (validation.rows || validation._rawRows || []);
    const body = rows.map((r, i) => {
      const excelRow = i + 2;
      return [...schema.fields.map(f => r[f.key] ?? ''), errByRow.get(excelRow)?.join('；') || ''];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
    ws['!cols'] = schema.fields.map(() => ({ wch: 18 })).concat([{ wch: 40 }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '错误明细');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /** 导出数据 xlsx Buffer */
  function exportRows(rows, schema) {
    const headers = schema.fields.map(f => f.label);
    const body = rows.map(r => schema.fields.map(f => r[f.key] ?? ''));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
    ws['!cols'] = schema.fields.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, schema.sheetName || '数据');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  return { validate, validateRow, buildTemplate, buildErrorReport, exportRows, XLSX };
}

export default { createExcelService };
