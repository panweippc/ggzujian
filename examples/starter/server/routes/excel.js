/**
 * 通用 Excel 导入导出路由（底座能力）
 *
 * 业务接入：在 SCHEMAS 注册一张表的字段 schema，即刻获得四条接口：
 *   GET  /api/excel/template/:key   下载导入模板（.xlsx，含表头+示例）
 *   POST /api/excel/check/:key      上传校验（不入库，返回错误清单）
 *   POST /api/excel/import/:key     校验通过后事务批量入库
 *   GET  /api/excel/export/:key     导出数据（.xlsx）
 *   POST /api/excel/download-errors 下载错误行报告（带错误说明列）
 *
 * 全部 adminOnly，写操作自动走网关审计中间件。
 */
import express from 'express';
import multer from 'multer';
import { writeAudit } from '../middleware/audit.js';
import { adminOnly } from '../middleware/role.js';
import { createExcelService } from '../services/excel.js';
import { classifySchema, checkExport, stampWatermark, consume, EXPORT_MAX_ROWS } from '../services/data-export-guard.js';

const router = express.Router();
const poolOf = (req) => req.app.locals.pool;
const excel = createExcelService();
const usernameOf = (req) => req.user?.name || req.user?.username || '系统';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * schema 注册表：key → { table, fields, listSql?, columns? }
 * 演示 schema（products）——业务按此结构追加即可，无需改路由代码。
 */
export const SCHEMAS = {
  products: {
    table: 'products',
    title: '商品',
    fields: [
      { key: 'name', label: '商品名称', required: true, type: 'string' },
      { key: 'category', label: '分类', type: 'enum', options: ['电子', '日用', '食品'] },
      { key: 'price', label: '单价', type: 'number', min: 0 },
      { key: 'stock', label: '库存', type: 'integer', min: 0 },
      { key: 'status', label: '状态', type: 'enum', options: ['on', 'off'] },
      { key: 'remark', label: '备注', type: 'string' },
    ],
  },
};

const getSchema = (key) => SCHEMAS[key];

/** 模板下载 */
router.get('/excel/template/:key', adminOnly, (req, res) => {
  const schema = getSchema(req.params.key);
  if (!schema) return res.status(404).json({ success: false, message: '未注册的导入模板' });
  const buf = excel.buildTemplate(schema);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(schema.title + '_导入模板.xlsx')}`);
  res.send(buf);
});

/** 上传校验（只校验不入库，返回错误明细 + 可导入条数） */
router.post('/excel/check/:key', adminOnly, upload.single('file'), (req, res) => {
  const schema = getSchema(req.params.key);
  if (!schema) return res.status(404).json({ success: false, message: '未注册的导入模板' });
  if (!req.file) return res.status(400).json({ success: false, message: '请选择文件' });
  try {
    const result = excel.validate(req.file.buffer, schema);
    res.json({
      success: true,
      data: {
        total: result.total,
        validCount: result.valid.length,
        errorCount: result.errors.length,
        errors: result.errors.slice(0, 200),
        valid: result.valid.slice(0, 20), // 预览前 20 条
      },
    });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

/** 批量导入（事务：任一 DB 错误整体回滚） */
router.post('/excel/import/:key', adminOnly, upload.single('file'), async (req, res) => {
  const schema = getSchema(req.params.key);
  if (!schema) return res.status(404).json({ success: false, message: '未注册的导入模板' });
  if (!req.file) return res.status(400).json({ success: false, message: '请选择文件' });
  let validation;
  try {
    validation = excel.validate(req.file.buffer, schema);
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
  if (validation.errors.length) {
    return res.status(422).json({
      success: false,
      message: `存在 ${validation.errors.length} 处校验错误，请修正后重试`,
      data: { errorCount: validation.errors.length, errors: validation.errors.slice(0, 200), total: validation.total },
    });
  }
  if (!validation.valid.length) return res.status(400).json({ success: false, message: '无有效数据' });

  const pool = poolOf(req);
  const keys = Object.keys(schema.fields.reduce((a, f) => (a[f.key] = 1, a), {}));
  const cols = keys.map(k => '`' + k + '`').join(', ');
  const marks = keys.map(() => '?').join(', ');
  const sql = `INSERT INTO ${schema.table} (${cols}) VALUES (${marks})`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const row of validation.valid) {
      await conn.execute(sql, keys.map(k => row[k] ?? null));
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    return res.status(500).json({ success: false, message: '导入失败，已回滚：' + e.message });
  } finally {
    conn.release();
  }
  await writeAudit(pool, req, {
    userId: String(req.user?.id || ''), username: req.user?.name || req.user?.username || '',
    action: 'import', module: 'excel', detail: `导入${schema.title} ${validation.valid.length} 条`, ipAddress: req.ip,
  }).catch(() => {});
  res.json({ success: true, data: { imported: validation.valid.length, total: validation.total } });
});

/** 导出全部数据（分级管控：敏感模板须先申请审批，导出后一次性核销 + 水印 + 审计） */
router.get('/excel/export/:key', adminOnly, async (req, res) => {
  const schemaKey = req.params.key;
  const schema = getSchema(schemaKey);
  if (!schema) return res.status(404).json({ success: false, message: '未注册的导出模板' });
  const pool = poolOf(req);
  const info = classifySchema(schemaKey, schema);
  try {
    // 先统计行数用于上限/审批校验，避免"先导出再拦截"造成越权数据落盘
    const [cnt] = await pool.execute(`SELECT COUNT(*) AS n FROM ${schema.table}`);
    const total = Number(cnt[0]?.n || 0);
    const check = await checkExport(pool, req, {
      schemaKey, risk: info.risk, requestNo: req.query.approvalNo, requestedRows: total,
    });
    if (!check.allowed) return res.status(403).json({ success: false, message: check.reason });

    const limit = check.request ? Math.min(+check.request.rowLimit || EXPORT_MAX_ROWS, EXPORT_MAX_ROWS) : EXPORT_MAX_ROWS;
    const sql = schema.listSql || `SELECT * FROM ${schema.table} ORDER BY id DESC LIMIT ${limit}`;
    const [rows] = await pool.execute(sql);
    const raw = excel.exportRows(rows, schema);
    const buf = stampWatermark(excel.XLSX, raw, {
      username: usernameOf(req), time: new Date().toISOString().slice(0, 19).replace('T', ' '),
      schemaKey, risk: info.risk, reason: check.request?.reason,
      requestNo: check.request?.requestNo, approvedBy: check.request?.approvedBy, rows: rows.length,
    });

    await writeAudit(pool, req, {
      action: 'export', module: 'data-export', targetName: schemaKey,
      detail: `导出${schema.title} ${rows.length} 行，风险=${info.risk}，审批单=${check.request?.requestNo || '免审批'}，用途=${String(check.request?.reason || '').slice(0, 100)}`,
      ipAddress: req.ip,
    }).catch(() => {});
    if (check.request) await consume(pool, check.request.requestNo);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(schema.title + '_' + new Date().toISOString().slice(0, 10) + '.xlsx')}`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ success: false, message: '导出失败：' + e.message });
  }
});

export default router;
