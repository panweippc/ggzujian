/**
 * 审计扩展接口（①全留痕延伸）
 *   GET  /audit/verify-chain       哈希链完整性校验
 *   GET  /audit/archives           归档日志查询
 *   POST /audit/archive            手动归档（把 N 天前日志搬到归档表）
 *   GET  /audit/logs/enhanced      增强查询（操作人/时间区间/模块/动作组合）
 *   GET  /audit/stats              审计统计（按模块/操作人聚合）
 */
import express from 'express';
import { verifyChain } from '../services/audit-chain.js';
import { writeAudit } from '../middleware/audit.js';

const router = express.Router();
const poolOf = (req) => req.app.locals.pool;
const adminOnly = (req, res, next) => {
  const role = req.user?.role || req.user?.roleName || '';
  const name = req.user?.name || req.user?.username || '';
  return (['admin', '系统管理员', '总经理'].includes(role) || name === 'admin')
    ? next() : res.status(403).json({ success: false, message: '无权限，仅管理员可操作' });
};

/** 哈希链校验 */
router.get('/audit/verify-chain', adminOnly, async (req, res) => {
  try {
    const result = await verifyChain(poolOf(req), 'operation_logs');
    res.json({ success: true, data: result });
  } catch (e) { res.status(500).json({ success: false, message: '校验失败' }); }
});

/** 归档日志查询（复用主表字段，支持 traceId/模块筛选） */
router.get('/audit/archives', adminOnly, async (req, res) => {
  try {
    const { page = 1, pageSize = 30, module: mod = '', traceId = '' } = req.query;
    const clauses = [], args = [];
    if (mod) { clauses.push('module = ?'); args.push(String(mod)); }
    if (traceId) { clauses.push('traceId = ?'); args.push(String(traceId)); }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const offset = (Number(page) - 1) * Number(pageSize);
    const [[{ total }]] = await poolOf(req).execute(`SELECT COUNT(*) total FROM operation_logs_archive ${where}`, args);
    const [rows] = await poolOf(req).execute(
      `SELECT * FROM operation_logs_archive ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
      [...args, +pageSize, offset]
    );
    res.json({ success: true, data: rows, total });
  } catch (e) { res.status(500).json({ success: false, message: '读取归档失败' }); }
});

/** 手动归档：把 days 天前的日志从主表搬到归档表 */
router.post('/audit/archive', adminOnly, async (req, res) => {
  const days = Math.max(1, +(req.body?.days || 90));
  const pool = poolOf(req);
  try {
    const [[{ cnt }]] = await pool.execute(
      'SELECT COUNT(*) cnt FROM operation_logs WHERE createdAt < DATE_SUB(NOW(), INTERVAL ? DAY)', [days]
    );
    if (!cnt) return res.json({ success: true, data: { archived: 0 } });
    // INSERT ... SELECT 再 DELETE，保证数据不丢
    await pool.execute(
      `INSERT INTO operation_logs_archive
        SELECT * FROM operation_logs WHERE createdAt < DATE_SUB(NOW(), INTERVAL ? DAY)`, [days]
    );
    await pool.execute(
      'DELETE FROM operation_logs WHERE createdAt < DATE_SUB(NOW(), INTERVAL ? DAY)', [days]
    );
    await writeAudit(pool, req, {
      action: 'archive', module: 'audit', targetName: `${days}天前`,
      detail: `归档 ${cnt} 条日志（${days} 天前）`, afterValue: { archived: cnt, days },
    });
    res.json({ success: true, data: { archived: cnt } });
  } catch (e) { res.status(500).json({ success: false, message: '归档失败：' + e.message }); }
});

/** 增强查询：操作人 / 时间区间 / 模块 / 动作 组合筛选 */
router.get('/audit/logs/enhanced', adminOnly, async (req, res) => {
  try {
    const { page = 1, pageSize = 30, username = '', module: mod = '', action = '',
      startDate = '', endDate = '', traceId = '', keyword = '' } = req.query;
    const clauses = [], args = [];
    if (username) { clauses.push('username LIKE ?'); args.push(`%${username}%`); }
    if (mod) { clauses.push('module = ?'); args.push(String(mod)); }
    if (action) { clauses.push('action = ?'); args.push(String(action)); }
    if (traceId) { clauses.push('traceId = ?'); args.push(String(traceId)); }
    if (startDate) { clauses.push('createdAt >= ?'); args.push(String(startDate)); }
    if (endDate) { clauses.push('createdAt < DATE_ADD(?, INTERVAL 1 DAY)'); args.push(String(endDate)); }
    if (keyword) {
      clauses.push('(detail LIKE ? OR targetName LIKE ?)');
      args.push(`%${keyword}%`, `%${keyword}%`);
    }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const offset = (Number(page) - 1) * Number(pageSize);
    const [[{ total }]] = await poolOf(req).execute(`SELECT COUNT(*) total FROM operation_logs ${where}`, args);
    const [rows] = await poolOf(req).execute(
      `SELECT * FROM operation_logs ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
      [...args, +pageSize, offset]
    );
    res.json({ success: true, data: rows, total });
  } catch (e) { res.status(500).json({ success: false, message: '查询失败' }); }
});

/** 审计统计：按模块 / 操作人聚合 */
router.get('/audit/stats', adminOnly, async (req, res) => {
  try {
    const pool = poolOf(req);
    const [byModule] = await pool.execute(
      'SELECT module, COUNT(*) cnt FROM operation_logs GROUP BY module ORDER BY cnt DESC LIMIT 20'
    );
    const [byUser] = await pool.execute(
      'SELECT username, COUNT(*) cnt FROM operation_logs GROUP BY username ORDER BY cnt DESC LIMIT 20'
    );
    const [byDay] = await pool.execute(
      'SELECT DATE(createdAt) day, COUNT(*) cnt FROM operation_logs GROUP BY DATE(createdAt) ORDER BY day DESC LIMIT 30'
    );
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) total FROM operation_logs');
    res.json({ success: true, data: { total, byModule, byUser, byDay } });
  } catch (e) { res.status(500).json({ success: false, message: '统计失败' }); }
});

export default router;
