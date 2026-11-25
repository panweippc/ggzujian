/**
 * 业务底座补全（③档）
 *  - 字典多语言：/dict-items/:id/i18n 增删改查
 *  - 消息已读回执：/messages/:id/read、/messages/read-count
 *  - 文件分片上传：/files/upload/init|chunk|complete
 *  - 定时任务执行历史：/tasks/:id/history、/tasks/history（全部）、失败重试 /tasks/:id/retry
 *  - 数据权限规则配置化：/role-data-scopes CRUD
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { writeAudit } from '../middleware/audit.js';
import { refreshRuntimeConfig } from '../services/runtime-config.js';

const router = express.Router();
const poolOf = (req) => req.app.locals.pool;
const adminOnly = (req, res, next) => {
  const role = req.user?.role || req.user?.roleName || '';
  const name = req.user?.name || req.user?.username || '';
  return (['admin', '系统管理员', '总经理'].includes(role) || name === 'admin')
    ? next() : res.status(403).json({ success: false, message: '无权限，仅管理员可操作' });
};

// ========== 字典多语言 ==========
router.get('/dict-items/:id/i18n', async (req, res) => {
  try {
    const [rows] = await poolOf(req).execute('SELECT * FROM dict_item_i18n WHERE dictItemId=?', [req.params.id]);
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, message: '读取失败' }); }
});
router.put('/dict-items/:id/i18n', adminOnly, async (req, res) => {
  const { lang, label } = req.body || {};
  if (!lang || !label) return res.status(400).json({ success: false, message: 'lang/label 必填' });
  try {
    await poolOf(req).execute(
      'INSERT INTO dict_item_i18n (dictItemId, lang, label) VALUES (?,?,?) ON DUPLICATE KEY UPDATE label=VALUES(label)',
      [req.params.id, lang, label]
    );
    await writeAudit(poolOf(req), req, {
      action: 'update', module: 'dict', targetName: `${req.params.id}/${lang}`,
      detail: `设置字典多语言 ${req.params.id}/${lang} = ${label}`,
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '保存失败' }); }
});

// ========== 消息已读回执 ==========
router.post('/messages/:id/read', async (req, res) => {
  const username = req.user?.name || req.user?.username || '';
  try {
    await poolOf(req).execute(
      'INSERT IGNORE INTO message_read_receipts (messageId, username) VALUES (?,?)',
      [req.params.id, username]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, message: '记录失败' }); }
});
router.get('/messages/:id/read-count', async (req, res) => {
  try {
    const [[{ cnt }]] = await poolOf(req).execute(
      'SELECT COUNT(*) cnt FROM message_read_receipts WHERE messageId=?', [req.params.id]
    );
    const [rows] = await poolOf(req).execute(
      'SELECT username, readAt FROM message_read_receipts WHERE messageId=?', [req.params.id]
    );
    res.json({ success: true, data: { count: cnt, readers: rows } });
  } catch { res.status(500).json({ success: false, message: '读取失败' }); }
});

// ========== 文件分片上传（断点续传）==========
const CHUNK_ROOT = path.join(process.cwd(), 'uploads', '.chunks');
fs.mkdirSync(CHUNK_ROOT, { recursive: true });

router.post('/files/upload/init', async (req, res) => {
  const { fileName, totalChunks, chunkSize, mimeType } = req.body || {};
  if (!fileName || !totalChunks || !chunkSize) {
    return res.status(400).json({ success: false, message: 'fileName/totalChunks/chunkSize 必填' });
  }
  const uploadId = crypto.randomUUID();
  try {
    await poolOf(req).execute(
      'INSERT INTO upload_sessions (uploadId, fileName, totalChunks, chunkSize, mimeType) VALUES (?,?,?,?,?)',
      [uploadId, fileName, +totalChunks, +chunkSize, mimeType || null]
    );
    fs.mkdirSync(path.join(CHUNK_ROOT, uploadId), { recursive: true });
    res.json({ success: true, data: { uploadId } });
  } catch (e) { res.status(500).json({ success: false, message: '初始化失败' }); }
});

// 单片上传：multipart field = chunk, 参数 uploadId / index（query）
router.post('/files/upload/chunk', async (req, res) => {
  // 用内存缓存单片（骨架版）：前端以 base64 body 传 { uploadId, index, data }
  const { uploadId, index, data } = req.body || {};
  if (!uploadId || index === undefined || !data) {
    return res.status(400).json({ success: false, message: 'uploadId/index/data 必填' });
  }
  const dir = path.join(CHUNK_ROOT, path.basename(uploadId));
  if (!fs.existsSync(dir)) return res.status(404).json({ success: false, message: '会话不存在' });
  try {
    fs.writeFileSync(path.join(dir, String(index)), Buffer.from(data, 'base64'));
    await poolOf(req).execute(
      'UPDATE upload_sessions SET uploadedChunks = uploadedChunks + 1 WHERE uploadId=?', [uploadId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '分片写入失败' }); }
});

router.post('/files/upload/complete', async (req, res) => {
  const { uploadId } = req.body || {};
  try {
    const [rows] = await poolOf(req).execute('SELECT * FROM upload_sessions WHERE uploadId=?', [uploadId]);
    const s = rows[0];
    if (!s) return res.status(404).json({ success: false, message: '会话不存在' });
    const dir = path.join(CHUNK_ROOT, path.basename(uploadId));
    const ext = path.extname(s.fileName).toLowerCase();
    const finalKey = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    const dest = path.join(process.cwd(), 'uploads', 'files', finalKey);
    // 按 index 顺序拼接
    const out = fs.openSync(dest, 'w');
    for (let i = 0; i < s.totalChunks; i++) {
      const f = path.join(dir, String(i));
      if (fs.existsSync(f)) fs.writeSync(out, fs.readFileSync(f));
    }
    fs.closeSync(out);
    const size = fs.statSync(dest).size;
    const url = `/uploads/files/${finalKey}`;
    await poolOf(req).execute(
      `INSERT INTO file_objects (objectKey, originalName, mimeType, size, driver, url, uploadedBy, createdAt)
       VALUES (?,?,?,?,'local',?,?,NOW())`,
      [finalKey, s.fileName, s.mimeType, size, url, req.user?.name || '']
    );
    await poolOf(req).execute(
      "UPDATE upload_sessions SET status='merged', finalKey=? WHERE uploadId=?", [finalKey, uploadId]
    );
    fs.rmSync(dir, { recursive: true, force: true });
    await writeAudit(poolOf(req), req, {
      action: 'file_chunk_upload', module: 'file', targetName: s.fileName,
      detail: `分片上传合并 ${s.fileName} (${size} 字节)`,
    });
    res.json({ success: true, data: { objectKey: finalKey, url, size } });
  } catch (e) { res.status(500).json({ success: false, message: '合并失败：' + e.message }); }
});

// ========== 定时任务执行历史 / 失败重试 ==========
router.get('/tasks/history', async (req, res) => {
  try {
    const [rows] = await poolOf(req).execute(
      'SELECT * FROM task_execution_history ORDER BY executedAt DESC LIMIT 100'
    );
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, message: '读取失败' }); }
});
router.get('/tasks/:id/history', async (req, res) => {
  try {
    const [rows] = await poolOf(req).execute(
      'SELECT * FROM task_execution_history WHERE taskId=? ORDER BY executedAt DESC LIMIT 50', [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, message: '读取失败' }); }
});
router.post('/tasks/:id/retry', adminOnly, async (req, res) => {
  // 骨架版：重置最近一次失败记录的重试计数并标记，供执行器下次扫描（执行器为预留）
  try {
    await poolOf(req).execute(
      "UPDATE task_execution_history SET retryCount=retryCount+1 WHERE taskId=? AND status='failed' ORDER BY executedAt DESC LIMIT 1",
      [req.params.id]
    );
    await writeAudit(poolOf(req), req, {
      action: 'task_retry', module: 'task', targetName: req.params.id,
      detail: `重试定时任务 ID ${req.params.id}`,
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '重试标记失败' }); }
});

// ========== 数据权限规则配置化 ==========
router.get('/role-data-scopes', adminOnly, async (req, res) => {
  try {
    const [rows] = await poolOf(req).execute('SELECT * FROM role_data_scope_rules ORDER BY role');
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, message: '读取失败' }); }
});
router.put('/role-data-scopes/:role', adminOnly, async (req, res) => {
  const { scope, deptCodes, remark } = req.body || {};
  if (!['all', 'dept', 'self', 'custom'].includes(scope)) {
    return res.status(400).json({ success: false, message: 'scope 必须是 all/dept/self/custom' });
  }
  try {
    await poolOf(req).execute(
      `INSERT INTO role_data_scope_rules (role, scope, deptCodes, remark, updatedBy)
       VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE scope=VALUES(scope), deptCodes=VALUES(deptCodes), remark=VALUES(remark), updatedBy=VALUES(updatedBy)`,
      [req.params.role, scope, deptCodes ? JSON.stringify(deptCodes) : null, remark || null, req.user?.name || '']
    );
    await writeAudit(poolOf(req), req, {
      action: 'update', module: 'security', targetName: req.params.role,
      detail: `配置角色 ${req.params.role} 数据权限 = ${scope}`, afterValue: { scope, deptCodes },
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '保存失败' }); }
});

// ========== 配置推送（把源环境配置批量发布到目标环境）==========
router.post('/configs/push', adminOnly, async (req, res) => {
  const { from = 'dev', to = 'prod', keys = [] } = req.body || {};
  if (!Array.isArray(keys) || !keys.length) {
    return res.status(400).json({ success: false, message: 'keys 不能为空（要推送的配置键数组）' });
  }
  const pool = poolOf(req);
  try {
    await pool.query('START TRANSACTION');
    let pushed = 0;
    for (const key of keys) {
      const [[src]] = await pool.execute(
        'SELECT configValue, category, description, version FROM app_configs WHERE configKey=? AND env=?', [key, from]
      );
      if (!src) continue;
      const [[dst]] = await pool.execute(
        'SELECT version FROM app_configs WHERE configKey=? AND env=?', [key, to]
      );
      if (dst) {
        await pool.execute(
          'UPDATE app_configs SET configValue=?, description=?, version=version+1, updatedBy=? WHERE configKey=? AND env=?',
          [src.configValue, src.description, req.user?.name || '', key, to]
        );
      } else {
        await pool.execute(
          `INSERT INTO app_configs (configKey, configValue, category, env, description, version, updatedBy)
           VALUES (?,?,?,?,?,1,?)`,
          [key, src.configValue, src.category, to, src.description, req.user?.name || '']
        );
      }
      await pool.execute(
        `INSERT INTO config_history (configKey, env, version, configValue, description, operation, operator)
         VALUES (?,?,?,?,?, 'push', ?)`,
        [key, to, (dst?.version || 1) + 1, src.configValue, `从 ${from} 推送`, req.user?.name || '']
      );
      pushed += 1;
    }
    await pool.query('COMMIT');
    refreshRuntimeConfig(); // 配置推送后清空运行时缓存
    await writeAudit(pool, req, {
      action: 'config_push', module: 'config', targetName: `${from}→${to}`,
      detail: `推送 ${pushed} 项配置 ${from}→${to}`, afterValue: { from, to, keys, pushed },
    });
    res.json({ success: true, data: { pushed } });
  } catch (e) {
    await pool.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: '推送失败：' + e.message });
  }
});

export default router;
