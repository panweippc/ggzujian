/**
 * 文件在线预览能力判定（纯函数，零依赖）
 *
 * 三类：
 *  - inline：图片/PDF/文本（txt/md/csv/json/log）—— 直接内联返回浏览器可渲染
 *  - convert：Office（doc/docx/xls/xlsx/ppt/pptx）—— 需外部文档转换服务（CONVERT_URL 配置位）
 *  - unsupported：压缩包等 —— 只能下载
 */
import path from 'node:path';

const INLINE_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
};
const CONVERT_EXT = new Set(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']);

/** 判定预览策略：{ mode:'inline'|'convert'|'unsupported', mime, ext } */
export function previewPolicy(filename, convertConfigured = false) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (INLINE_TYPES[ext]) return { mode: 'inline', mime: INLINE_TYPES[ext], ext };
  if (CONVERT_EXT.has(ext)) return { mode: 'convert', mime: 'application/octet-stream', ext, configured: !!convertConfigured };
  return { mode: 'unsupported', mime: 'application/octet-stream', ext };
}

/** 构造转换服务请求 URL（骨架：CONVERT_URL 占位，接入 LibreOffice/OnlyOffice 时替换） */
export function buildConvertUrl(convertBase, fileUrl) {
  if (!convertBase) return null;
  return `${String(convertBase).replace(/\/$/, '')}/convert?url=${encodeURIComponent(fileUrl)}&format=pdf`;
}

export const PREVIEW_INLINE_TYPES = INLINE_TYPES;
export default { previewPolicy, buildConvertUrl };
