/**
 * 公共基础数据（底座第 6 部分：Dictionary & Metadata）
 * 组织机构 / 行政区划 / 行业分类统一模型，parentCode 构成树。
 * 提供列表、树形装配、CRUD；全部管理员鉴权，写操作记审计。
 */
import express from 'express';
import { getOperator } from '@panweippc/auth-kit';
import { writeAudit } from '../middleware/audit.js';

const router = express.Router();
const poolOf = (req) => req.app.locals.pool;
const ADMIN_ROLES = ['admin', '系统管理员', '总经理'];
const adminOnly = (req, res, next) => {
  const role = req.user?.role || req.user?.roleName || '';
  const name = req.user?.name || req.user?.username || '';
  return (ADMIN_ROLES.includes(role) || name === 'admin')
    ? next() : res.status(403).json({ success: false, message: '无权限，仅管理员可操作' });
};
const audit = (req, action, detail, targetName = '') =>
  writeAudit(poolOf(req), req, {
    userId: String(req.user?.id || ''), username: getOperator(req), ip: req.ip,
    action, module: 'base_data', detail, targetName
  }).catch(() => {});

const ALLOWED_TYPES = new Set(['organization', 'region', 'industry']);

// 列表：可按 type / parentCode 过滤，status=1 默认只取启用
router.get('/base-data', adminOnly, async (req, res) => {
  try {
    const { type, parentCode, all } = req.query;
    let sql = 'SELECT * FROM base_data WHERE 1=1';
    const args = [];
    if (type) { sql += ' AND type = ?'; args.push(type); }
    if (parentCode !== undefined && parentCode !== '') { sql += ' AND parentCode = ?'; args.push(parentCode); }
    if (all !== '1') sql += ' AND status = 1';
    sql += ' ORDER BY type, sort, id';
    const [rows] = await poolOf(req).execute(sql, args);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: '读取基础数据失败' }); }
});

// 树形：按 type 取全部后装配成 children 树
router.get('/base-data/tree', adminOnly, async (req, res) => {
  try {
    const { type } = req.query;
    if (!type) return res.status(400).json({ success: false, message: 'type 必填' });
    const [rows] = await poolOf(req).execute(
      'SELECT * FROM base_data WHERE type=? ORDER BY sort, id', [type]
    );
    const map = new Map(rows.map((r) => [r.code, { ...r, children: [] }]));
    const roots = [];
    for (const node of map.values()) {
      if (node.parentCode && map.has(node.parentCode)) map.get(node.parentCode).children.push(node);
      else roots.push(node);
    }
    res.json({ success: true, data: roots });
  } catch (e) { res.status(500).json({ success: false, message: '装配基础数据树失败' }); }
});

router.post('/base-data', adminOnly, async (req, res) => {
  const { type, code, name, parentCode = null, sort = 0, status = 1, remark = '' } = req.body || {};
  if (!ALLOWED_TYPES.has(type)) return res.status(400).json({ success: false, message: 'type 必须是 organization/region/industry' });
  if (!code || !name) return res.status(400).json({ success: false, message: '编码/名称必填' });
  try {
    if (parentCode) {
      const [[p]] = await poolOf(req).execute('SELECT id FROM base_data WHERE type=? AND code=?', [type, parentCode]);
      if (!p) return res.status(400).json({ success: false, message: `上级编码 ${parentCode} 不存在` });
    }
    const [r] = await poolOf(req).execute(
      'INSERT INTO base_data (type,code,name,parentCode,sort,status,remark) VALUES (?,?,?,?,?,?,?)',
      [type, code, name, parentCode || null, sort, status, remark]
    );
    audit(req, 'create', `新增基础数据 ${type}/${code}`, name);
    res.json({ success: true, data: { id: r.insertId } });
  } catch (e) {
    if (String(e?.code) === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: `编码 ${code} 在该类型下已存在` });
    res.status(500).json({ success: false, message: '新增失败' });
  }
});

router.put('/base-data/:id', adminOnly, async (req, res) => {
  const { type, name, parentCode = null, sort = 0, status = 1, remark = '' } = req.body || {};
  try {
    const [[old]] = await poolOf(req).execute('SELECT * FROM base_data WHERE id=?', [req.params.id]);
    if (!old) return res.status(404).json({ success: false, message: '记录不存在' });
    if (parentCode === old.code) return res.status(400).json({ success: false, message: '上级不能是自己' });
    await poolOf(req).execute(
      'UPDATE base_data SET name=?,parentCode=?,sort=?,status=?,remark=? WHERE id=?',
      [name, parentCode || null, sort, status, remark, req.params.id]
    );
    audit(req, 'update', `修改基础数据 ${type}/${old.code}`, name);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '修改失败' }); }
});

router.delete('/base-data/:id', adminOnly, async (req, res) => {
  try {
    const [[old]] = await poolOf(req).execute('SELECT * FROM base_data WHERE id=?', [req.params.id]);
    if (!old) return res.status(404).json({ success: false, message: '记录不存在' });
    const [[child]] = await poolOf(req).execute('SELECT COUNT(*) n FROM base_data WHERE type=? AND parentCode=?', [old.type, old.code]);
    if (child.n > 0) return res.status(409).json({ success: false, message: `仍有 ${child.n} 个下级，请先删除子节点` });
    await poolOf(req).execute('DELETE FROM base_data WHERE id=?', [req.params.id]);
    audit(req, 'delete', `删除基础数据 ${old.type}/${old.code}`, old.code);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '删除失败' }); }
});

export default router;
