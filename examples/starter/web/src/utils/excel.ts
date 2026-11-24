/**
 * 全局 Excel 导入导出工具（基于 xlsx，骨架自带）。
 * 导出：数组 → .xlsx，支持自定义表头映射；导入：File → 数组。
 */
import * as XLSX from 'xlsx';

export interface ExcelColumn { key: string; label: string; width?: number }

/** 导出数组为 Excel 文件 */
export function exportExcel<T extends Record<string, any>>(
  rows: T[],
  columns: ExcelColumn[],
  filename = '导出数据',
  sheetName = 'Sheet1'
) {
  if (!rows.length) throw new Error('没有可导出的数据');
  const header = columns.map((c) => c.label);
  const body = rows.map((row) => columns.map((c) => row[c.key] ?? ''));
  const aoa = [header, ...body];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = columns.map((c) => ({ wch: c.width || Math.max(12, c.label.length * 2 + 2) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  XLSX.writeFile(book, `${filename}_${formatDate(new Date())}.xlsx`);
}

/** 导入 Excel 文件为对象数组（首行作为表头） */
export function importExcel<T = Record<string, any>>(file: File): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const book = XLSX.read(data, { type: 'array' });
        const sheet = book.Sheets[book.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<T>(sheet, { defval: '' });
        resolve(rows);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsArrayBuffer(file);
  });
}

/** 导出模板（只有表头，供用户填写） */
export function exportTemplate(columns: ExcelColumn[], filename = '导入模板') {
  const sheet = XLSX.utils.aoa_to_sheet([columns.map((c) => c.label)]);
  sheet['!cols'] = columns.map((c) => ({ wch: c.width || Math.max(12, c.label.length * 2 + 2) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Template');
  XLSX.writeFile(book, `${filename}.xlsx`);
}

function formatDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
