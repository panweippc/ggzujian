/**
 * 文件在线预览策略测试：内联类型 / Office 转换 / 不支持类型 / 转换 URL 构造
 */
import { describe, it, expect } from 'vitest';
import { previewPolicy, buildConvertUrl } from '../services/file-preview.js';

describe('文件预览 · 策略判定', () => {
  it('图片/PDF/文本内联预览', () => {
    expect(previewPolicy('photo.png').mode).toBe('inline');
    expect(previewPolicy('doc.pdf').mode).toBe('inline');
    expect(previewPolicy('notes.md').mode).toBe('inline');
    expect(previewPolicy('data.csv').mime).toMatch(/text\/csv/);
    expect(previewPolicy('a.json').mode).toBe('inline');
  });

  it('Office 走 convert 模式，标注是否已配置', () => {
    const p = previewPolicy('合同.docx', false);
    expect(p.mode).toBe('convert');
    expect(p.configured).toBe(false);
    expect(previewPolicy('表.xlsx', true).configured).toBe(true);
  });

  it('压缩包/可执行不支持预览', () => {
    expect(previewPolicy('a.zip').mode).toBe('unsupported');
    expect(previewPolicy('a.exe').mode).toBe('unsupported');
  });

  it('大小写扩展名兼容', () => {
    expect(previewPolicy('A.PDF').mode).toBe('inline');
    expect(previewPolicy('B.DOCX').mode).toBe('convert');
  });
});

describe('文件预览 · 转换 URL', () => {
  it('未配置返回 null', () => {
    expect(buildConvertUrl('', '/api/files/x.docx')).toBeNull();
  });

  it('配置后拼出转换地址并编码文件 URL', () => {
    const url = buildConvertUrl('http://convert:8080/', '/api/files/合同.docx');
    expect(url).toMatch(/^http:\/\/convert:8080\/convert\?url=/);
    expect(url).toMatch(/format=pdf$/);
    expect(decodeURIComponent(url.split('url=')[1].split('&')[0])).toBe('/api/files/合同.docx');
  });
});
