/**
 * 统一文件服务（底座第 5 部分：File Service）
 * 业务系统只需调 /api/files/*，不关心底层存储。
 *
 * 存储适配层：通过 STORAGE_DRIVER 环境变量切换
 *   - local（默认）：存本地 uploads/files，走静态目录
 *   - minio / oss：预留接口，配置了对应 env 后在此接入 SDK 即可
 * 切换驱动不改任何业务接口，这就是"屏蔽存储细节"的意义。
 */
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getOperator } from '@panweippc/auth-kit';
import { writeAudit } from '../middleware/audit.js';

const router = express.Router();
const poolOf = (req) => req.app.locals.pool;
const adminOnly = (req, res, next) => {
  const role = req.user?.role || req.user?.roleName || '';
  const name = req.user?.name || req.user?.username || '';
  return (['admin', '系统管理员', '总经理'].includes(role) || name === 'admin')
    ? next() : res.status(403).json({ success: false, message: '无权限，仅管理员可操作' });
};

const DRIVER = process.env.STORAGE_DRIVER || 'local';
const UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'files');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

// 文件元数据表存在数据库里（list 可查），上传后写一行
const META_TABLE = 'file_objects';

// 允许的扩展名白名单（安全：防可执行文件上传）
const ALLOW_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv', '.md', '.json', '.zip', '.rar', '.7z',
]);
const MAX_SIZE = +(process.env.FILE_MAX_SIZE || 20 * 1024 * 1024); // 20MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_ROOT),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOW_EXT.has(ext)) return cb(new Error('不支持的文件类型: ' + ext));
    cb(null, true);
  },
});

/** 适配层：把存储 key 映射为可访问 URL（local 走 /uploads/files） */
function publicUrl(storedName) {
  if (DRIVER === 'local') return `/uploads/files/${storedName}`;
  // minio/oss：接入 SDK 后返回预签名或公网 URL
  return `/api/files/${storedName}/download`;
}

/** 上传：支持单文件（field=file） */
router.post('/files/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: '未收到文件' });
  const { originalname, filename, size, mimetype } = req.file;
  const url = publicUrl(filename);
  try {
    await poolOf(req).execute(
      `INSERT INTO ${META_TABLE} (objectKey, originalName, mimeType, size, driver, url, uploadedBy, createdAt)
       VALUES (?,?,?,?,?,?,?,NOW())`,
      [filename, originalname, mimetype, size, DRIVER, url, getOperator(req)]
    );
    await writeAudit(poolOf(req), req, {
      action: 'file_upload', module: 'file', targetName: originalname, detail: `上传文件 ${originalname} (${size} 字节)`
    });
  } catch { /* 元数据写入失败不影响文件本身 */ }
  res.json({ success: true, data: { objectKey: filename, originalName: originalname, url, size, mimeType: mimetype, driver: DRIVER } });
});

/** 列表：分页查询文件元数据 */
router.get('/files', adminOnly, async (req, res) => {
  const { page = 1, pageSize = 30 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);
  try {
    const [[{ total }]] = await poolOf(req).execute(`SELECT COUNT(*) total FROM ${META_TABLE}`);
    const [rows] = await poolOf(req).execute(
      `SELECT * FROM ${META_TABLE} ORDER BY createdAt DESC LIMIT ? OFFSET ?`, [+pageSize, offset]
    );
    res.json({ success: true, data: rows, total });
  } catch (e) { res.status(500).json({ success: false, message: '读取文件列表失败' }); }
});

/** 下载：按 objectKey 找回原文件名并设置响应头 */
router.get('/files/:key/download', async (req, res) => {
  const key = path.basename(req.params.key); // 防目录穿越
  try {
    const [rows] = await poolOf(req).execute(`SELECT originalName, mimeType FROM ${META_TABLE} WHERE objectKey=?`, [key]);
    const meta = rows[0];
    const file = path.join(UPLOAD_ROOT, key);
    if (!fs.existsSync(file)) return res.status(404).json({ success: false, message: '文件不存在' });
    res.setHeader('Content-Type', meta?.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(meta?.originalName || key)}`);
    fs.createReadStream(file).pipe(res);
  } catch (e) { res.status(500).json({ success: false, message: '下载失败' }); }
});

/** 预览：图片/PDF 内联返回 */
router.get('/files/:key/preview', async (req, res) => {
  const key = path.basename(req.params.key);
  const file = path.join(UPLOAD_ROOT, key);
  if (!fs.existsSync(file)) return res.status(404).json({ success: false, message: '文件不存在' });
  const ext = path.extname(key).toLowerCase();
  const inlineTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.svg': 'image/svg+xml' };
  res.setHeader('Content-Type', inlineTypes[ext] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

/** 删除 */
router.delete('/files/:key', adminOnly, async (req, res) => {
  const key = path.basename(req.params.key);
  const file = path.join(UPLOAD_ROOT, key);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    await poolOf(req).execute(`DELETE FROM ${META_TABLE} WHERE objectKey=?`, [key]);
    await writeAudit(poolOf(req), req, { action: 'file_delete', module: 'file', targetName: key, detail: `删除文件 ${key}` });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '删除失败' }); }
});

// multer 错误处理（文件过大/类型不允许）
router.use('/files', (err, req, res, next) => {
  if (err) return res.status(400).json({ success: false, message: err.message || '上传失败' });
  next();
});

export default router;
