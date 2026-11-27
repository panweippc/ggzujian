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
import { storageDriver, setRuntimeConfig, refreshRuntimeConfig } from '../services/runtime-config.js';
import { addRecycleItem } from './recycle.js';
import { previewPolicy, buildConvertUrl } from '../services/file-preview.js';
import { adminOnly } from '../middleware/role.js';

const router = express.Router();
const poolOf = (req) => req.app.locals.pool;
const DEFAULT_DRIVER = process.env.STORAGE_DRIVER || 'local';
const UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'files');
const SUPPORTED_DRIVERS = ['local', 'minio', 'oss'];
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
function publicUrl(storedName, driver) {
  if (driver === 'local') return `/uploads/files/${storedName}`;
  // minio/oss：接入 SDK 后返回预签名或公网 URL
  return `/api/files/${storedName}/download`;
}

/** 读取当前文件驱动（运行时配置，热切换） */
async function currentDriver(req) {
  return storageDriver(poolOf(req));
}

/**
 * 驱动查询（前端下拉框用）
 * current 来自运行时配置；available 标出哪些驱动已真实可用、哪些是预留。
 */
router.get('/files/driver', async (req, res) => {
  try {
    const current = await currentDriver(req);
    res.json({
      success: true,
      data: {
        current,
        available: SUPPORTED_DRIVERS.map((key) => ({
          key,
          label: { local: '本地存储', minio: 'MinIO（需接 SDK）', oss: '阿里云 OSS（需接 SDK）' }[key],
          ready: key === 'local',
        })),
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: '读取驱动失败' }); }
});

/** 切换驱动（配置入库 + 缓存刷新，立即生效，无需重启） */
router.put('/files/driver', adminOnly, async (req, res) => {
  const driver = String(req.body?.driver || '').trim().toLowerCase();
  if (!SUPPORTED_DRIVERS.includes(driver)) {
    return res.status(400).json({ success: false, message: `不支持的驱动，可用：${SUPPORTED_DRIVERS.join(', ')}` });
  }
  try {
    await setRuntimeConfig(poolOf(req), 'runtime.storage.driver', driver, getOperator(req));
    refreshRuntimeConfig('runtime.storage.driver');
    await writeAudit(poolOf(req), req, {
      action: 'switch_driver', module: 'file', targetName: driver,
      detail: `切换文件存储驱动 → ${driver}`, afterValue: { driver },
    });
    res.json({ success: true, data: { current: driver } });
  } catch (e) { res.status(500).json({ success: false, message: '切换驱动失败' }); }
});

/** 上传：支持单文件（field=file）；驱动在上传时实时读取，切换后立即生效 */
router.post('/files/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: '未收到文件' });
  const { originalname, filename, size, mimetype } = req.file;
  const driver = await currentDriver(req);
  const url = publicUrl(filename, driver);
  try {
    await poolOf(req).execute(
      `INSERT INTO ${META_TABLE} (objectKey, originalName, mimeType, size, driver, url, uploadedBy, createdAt)
       VALUES (?,?,?,?,?,?,?,NOW())`,
      [filename, originalname, mimetype, size, driver, url, getOperator(req)]
    );
    await writeAudit(poolOf(req), req, {
      action: 'file_upload', module: 'file', targetName: originalname, detail: `上传文件 ${originalname} (${size} 字节，驱动 ${driver})`
    });
  } catch { /* 元数据写入失败不影响文件本身 */ }
  res.json({ success: true, data: { objectKey: filename, originalName: originalname, url, size, mimeType: mimetype, driver } });
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

/** 预览策略查询：前端据此决定内联 <img>/<iframe>、走转换服务、还是提示下载 */
router.get('/files/:key/preview-policy', async (req, res) => {
  const key = path.basename(req.params.key);
  const policy = previewPolicy(key, !!process.env.CONVERT_URL);
  const convertUrl = policy.mode === 'convert' && process.env.CONVERT_URL
    ? buildConvertUrl(process.env.CONVERT_URL, `/api/files/${key}/preview`)
    : null;
  res.json({
    success: true,
    data: {
      ...policy,
      convertUrl,
      note: policy.mode === 'convert' && !convertUrl
        ? 'Office 预览需接入文档转换服务：在 .env 配置 CONVERT_URL（LibreOffice/OnlyOffice 等），未配置时只能下载'
        : policy.mode === 'unsupported' ? '该文件类型不支持在线预览，请下载后查看' : '',
    },
  });
});

/** 预览：图片/PDF/文本内联返回；Office 未接转换服务时明确 501 */
router.get('/files/:key/preview', async (req, res) => {
  const key = path.basename(req.params.key);
  const file = path.join(UPLOAD_ROOT, key);
  if (!fs.existsSync(file)) return res.status(404).json({ success: false, message: '文件不存在' });
  const policy = previewPolicy(key, !!process.env.CONVERT_URL);
  if (policy.mode === 'convert') {
    return res.status(501).json({
      success: false,
      message: 'Office 在线预览需接入文档转换服务（.env 配置 CONVERT_URL），当前请下载后查看',
    });
  }
  if (policy.mode === 'unsupported') {
    return res.status(415).json({ success: false, message: '该文件类型不支持在线预览，请下载后查看' });
  }
  res.setHeader('Content-Type', policy.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(file).pipe(res);
});

/** 删除（软删：物理文件移入 trash 目录 + 元数据快照入回收站，30 天后自动清除） */
router.delete('/files/:key', adminOnly, async (req, res) => {
  const key = path.basename(req.params.key);
  const file = path.join(UPLOAD_ROOT, key);
  const pool = poolOf(req);
  try {
    const [rows] = await pool.execute(`SELECT * FROM ${META_TABLE} WHERE objectKey=?`, [key]);
    const meta = rows[0];

    // 物理文件移到回收目录（而非直接删除），保证可恢复
    const trashDir = path.join(process.cwd(), 'uploads', '.trash');
    fs.mkdirSync(trashDir, { recursive: true });
    let trashPath = null;
    if (fs.existsSync(file)) {
      trashPath = path.join(trashDir, `${Date.now()}-${key}`);
      fs.renameSync(file, trashPath);
    }
    await addRecycleItem(pool, {
      module: 'file', recordId: meta?.id ?? key, title: meta?.originalName || key,
      payload: meta || null, extra: { objectKey: key, trashPath }, deletedBy: getOperator(req),
    });
    await pool.execute(`DELETE FROM ${META_TABLE} WHERE objectKey=?`, [key]);
    await writeAudit(pool, req, { action: 'file_delete', module: 'file', targetName: key, detail: `删除文件 ${key}（已入回收站）` });
    res.json({ success: true, message: '已移入回收站，30 天后自动清除' });
  } catch (e) { res.status(500).json({ success: false, message: '删除失败' }); }
});

// multer 错误处理（文件过大/类型不允许）
router.use('/files', (err, req, res, next) => {
  if (err) return res.status(400).json({ success: false, message: err.message || '上传失败' });
  next();
});

export default router;
