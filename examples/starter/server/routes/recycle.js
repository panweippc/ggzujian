/**
 * 回收站接口（全局软删除中心）
 * 契约对应前端 web/src/composables/useRecycleBin.ts：
 *   GET    /api/recycle-bin           列表（page/pageSize/keyword/module）→ { list, total, keepDays }
 *   GET    /api/recycle-bin/modules   模块下拉 → [{ key, label }]
 *   POST   /api/recycle-bin           写入软删记录（内部/其他路由调用）
 *   POST   /api/recycle-bin/:id/restore  恢复
 *   DELETE /api/recycle-bin/:id       彻底清除（purge）
 *   DELETE /api/recycle-bin/expired   清理过期项（定时任务调用）
 *
 * 保留天数由 KEEP_DAYS 配置（默认 30），写入时固化 expire_at，前端按此显示倒计时。
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { getOperator } from '@panweippc/auth-kit';
import { writeAudit } from '../middleware/audit.js';

const router = express.Router();
const poolOf = (req) => req.app.locals.pool;
const KEEP_DAYS = +(process.env.RECYCLE_KEEP_DAYS || 30);
const UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'files');

// 模块中文名映射（前端抽屉用）
const MODULE_LABELS = {
  file: '文件', dict: '数据字典', dict_category: '字典分类', base_data: '基础数据',
  user: '用户', role: '角色', menu: '菜单', employee: '员工', config: '配置', task: '定时任务',
};
const labelOf = (m) => MODULE_LABELS[m] || m || '其他';

/** 写软删记录（导出给其他路由复用） */
export async function addRecycleItem(pool, { module, recordId, title, payload, extra, deletedBy }) {
  const expireAt = new Date(Date.now() + KEEP_DAYS * 86400000);
  const [r] = await pool.execute(
    `INSERT INTO recycle_bin (module, module_label, record_id, title, payload, extra, deleted_by, deleted_at, expire_at)
     VALUES (?,?,?,?,?,?,?,NOW(),?)`,
    [
      module, labelOf(module), String(recordId ?? ''), title ?? null,
      payload ? JSON.stringify(payload) : null,
      extra ? JSON.stringify(extra) : null,
      deletedBy || '', expireAt,
    ]
  );
  return r.insertId;
}

/** 列表 */
router.get('/recycle-bin', async (req, res) => {
  try {
    const { page = 1, pageSize = 20, keyword = '', module: mod = '' } = req.query;
    const clauses = ['expire_at >= NOW()'];
    const args = [];
    if (mod) { clauses.push('module = ?'); args.push(String(mod)); }
    if (keyword) {
      clauses.push('(title LIKE ? OR deleted_by LIKE ?)');
      const kw = `%${String(keyword)}%`;
      args.push(kw, kw);
    }
    const where = 'WHERE ' + clauses.join(' AND ');
    const offset = (Number(page) - 1) * Number(pageSize);
    const [[{ total }]] = await poolOf(req).execute(`SELECT COUNT(*) total FROM recycle_bin ${where}`, args);
    const [rows] = await poolOf(req).execute(
      `SELECT id, record_id, module, module_label, title, deleted_by, deleted_at, expire_at
       FROM recycle_bin ${where} ORDER BY deleted_at DESC LIMIT ? OFFSET ?`,
      [...args, +pageSize, offset]
    );
    res.json({
      success: true,
      data: {
        list: rows.map((r) => ({
          ...r,
          deleted_at: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
          expire_at: r.expire_at ? new Date(r.expire_at).toISOString() : null,
        })),
        total, keepDays: KEEP_DAYS,
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: '读取回收站失败' }); }
});

/** 模块下拉 */
router.get('/recycle-bin/modules', async (req, res) => {
  try {
    const [rows] = await poolOf(req).execute(
      'SELECT DISTINCT module FROM recycle_bin ORDER BY module'
    );
    res.json({ success: true, data: rows.map((r) => ({ key: r.module, label: labelOf(r.module) })) });
  } catch { res.json({ success: true, data: [] }); }
});

/** 手动写入（其他服务/前端可调用；一般走各路由的软删逻辑） */
router.post('/recycle-bin', async (req, res) => {
  const { module, recordId, title, payload, extra } = req.body || {};
  if (!module || recordId === undefined) {
    return res.status(400).json({ success: false, message: 'module/recordId 必填' });
  }
  try {
    const id = await addRecycleItem(poolOf(req), {
      module, recordId, title, payload, extra, deletedBy: getOperator(req),
    });
    res.json({ success: true, data: { id } });
  } catch (e) { res.status(500).json({ success: false, message: '写入回收站失败' }); }
});

/** 通用恢复：把 payload 快照还原回原表（按 module → table 映射） */
const RESTORE_TABLE = {
  file: 'file_objects', dict: 'dict_items', dict_category: 'dict_categories',
  base_data: 'base_data', user: 'users', role: 'roles', menu: 'menus',
  employee: 'employees', config: 'app_configs', task: 'scheduled_tasks',
};

function buildInsert(table, payload) {
  const keys = Object.keys(payload).filter((k) => !['id'].includes(k));
  if (!keys.length) return null;
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  const vals = keys.map((k) => {
    const v = payload[k];
    if (v && typeof v === 'object') return JSON.stringify(v);
    return v ?? null;
  });
  return { sql, vals };
}

router.post('/recycle-bin/:id/restore', async (req, res) => {
  const pool = poolOf(req);
  try {
    const [[item]] = await pool.execute('SELECT * FROM recycle_bin WHERE id=?', [req.params.id]);
    if (!item) return res.status(404).json({ success: false, message: '回收站记录不存在' });

    const table = RESTORE_TABLE[item.module];
    const payload = item.payload ? (typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload) : null;
    if (table && payload) {
      const built = buildInsert(table, payload);
      if (built) {
        try {
          await pool.execute(built.sql, built.vals);
        } catch (e) {
          // 主键/唯一键冲突视为已恢复，不重复插入
          if (e.code !== 'ER_DUP_ENTRY') throw e;
        }
      }
    }
    // 文件类：尝试把物理文件从回收目录搬回 uploads/files
    const extra = item.extra ? (typeof item.extra === 'string' ? JSON.parse(item.extra) : item.extra) : null;
    if (extra?.trashPath) {
      try {
        const dest = path.join(UPLOAD_ROOT, path.basename(extra.trashPath));
        if (fs.existsSync(extra.trashPath) && !fs.existsSync(dest)) fs.renameSync(extra.trashPath, dest);
      } catch { /* 物理恢复失败不影响元数据恢复 */ }
    }

    await pool.execute('DELETE FROM recycle_bin WHERE id=?', [req.params.id]);
    await writeAudit(pool, req, {
      action: 'recycle_restore', module: 'recycle', targetName: item.title || String(item.record_id),
      detail: `从回收站恢复 ${labelOf(item.module)}：${item.title || item.record_id}`,
      afterValue: payload || undefined,
    });
    res.json({ success: true, message: '已恢复' });
  } catch (e) { res.status(500).json({ success: false, message: '恢复失败：' + e.message }); }
});

/** 彻底清除（purge）：删除回收站记录（文件物理文件已在软删时移入 trash，这里可彻底删除） */
router.delete('/recycle-bin/:id', async (req, res) => {
  const pool = poolOf(req);
  try {
    const [[item]] = await pool.execute('SELECT * FROM recycle_bin WHERE id=?', [req.params.id]);
    if (!item) return res.status(404).json({ success: false, message: '回收站记录不存在' });
    const extra = item.extra ? (typeof item.extra === 'string' ? JSON.parse(item.extra) : item.extra) : null;
    if (extra?.trashPath) {
      try { if (fs.existsSync(extra.trashPath)) fs.unlinkSync(extra.trashPath); } catch { /* 忽略 */ }
    }
    await pool.execute('DELETE FROM recycle_bin WHERE id=?', [req.params.id]);
    await writeAudit(pool, req, {
      action: 'recycle_purge', module: 'recycle', targetName: item.title || String(item.record_id),
      detail: `彻底清除 ${labelOf(item.module)}：${item.title || item.record_id}`,
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '清除失败' }); }
});

/** 清理过期项（定时任务调用）：删除 expire_at < NOW() 的记录及其物理文件 */
export async function purgeExpired(pool) {
  const [rows] = await pool.execute('SELECT id, extra FROM recycle_bin WHERE expire_at < NOW()');
  let removed = 0;
  for (const r of rows) {
    const extra = r.extra ? (typeof r.extra === 'string' ? JSON.parse(r.extra) : r.extra) : null;
    if (extra?.trashPath) {
      try { if (fs.existsSync(extra.trashPath)) fs.unlinkSync(extra.trashPath); } catch { /* 忽略 */ }
    }
    await pool.execute('DELETE FROM recycle_bin WHERE id=?', [r.id]);
    removed += 1;
  }
  return removed;
}

router.delete('/recycle-bin/expired', async (req, res) => {
  try {
    const removed = await purgeExpired(poolOf(req));
    res.json({ success: true, data: { removed } });
  } catch (e) { res.status(500).json({ success: false, message: '清理过期项失败' }); }
});

export { KEEP_DAYS, MODULE_LABELS };
export default router;
