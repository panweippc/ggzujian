/**
 * 【生成文件】商品 CRUD —— 由 scripts/generate-crud.mjs 生成，可自由修改
 * 路由前缀：/api/products（需在 server.js 用 app.use('/api', productRouter) 注册）
 */
import express from 'express';
import { getOperator } from '@panweippc/auth-kit';
import { writeAudit } from '../middleware/audit.js';
import { adminOnly } from '../middleware/role.js';

const router = express.Router();
const poolOf = (req) => req.app.locals.pool;
const TABLE = 'products';
const FIELDS = [
    { name: 'name', label: '商品名称' },
    { name: 'category', label: '分类' },
    { name: 'price', label: '单价' },
    { name: 'stock', label: '库存' },
    { name: 'status', label: '状态' },
    { name: 'remark', label: '备注' }
];
const EDITABLE = FIELDS.map(f => f.name);
const audit = (req, action, detail, targetName = '') =>
  writeAudit(poolOf(req), req, {
    userId: String(req.user?.id || ''), username: getOperator(req), ip: req.ip,
    action, module: 'product', detail, targetName
  }).catch(() => {});

// 列表（分页 + 关键词模糊搜索）
router.get('/products', adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
    const q = String(req.query.q || '').trim();
    const where = q ? 'WHERE ' + FIELDS.map(f => '`'+f.name+'` LIKE ?').join(' OR ') : '';
    const args = q ? FIELDS.map(() => '%' + q + '%') : [];
    const [count] = await poolOf(req).execute('SELECT COUNT(*) AS total FROM ' + TABLE + ' ' + where, args);
    const [rows] = await poolOf(req).execute(
      'SELECT * FROM ' + TABLE + ' ' + where + ' ORDER BY id DESC LIMIT ? OFFSET ?',
      [...args, pageSize, (page - 1) * pageSize]
    );
    res.json({ success: true, data: rows, total: count[0].total });
  } catch (e) { res.status(500).json({ success: false, message: '读取商品失败' }); }
});

// 详情
router.get('/products/:id', adminOnly, async (req, res) => {
  try {
    const [rows] = await poolOf(req).execute('SELECT * FROM ' + TABLE + ' WHERE id=?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: '记录不存在' });
    res.json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: '读取详情失败' }); }
});

// 新增
router.post('/products', adminOnly, async (req, res) => {
  const body = {};
  for (const k of EDITABLE) if (req.body[k] !== undefined) body[k] = req.body[k];
  const keys = Object.keys(body);
  if (!keys.length) return res.status(400).json({ success: false, message: '无有效字段' });
  try {
    const cols = keys.map(k => '`' + k + '`').join(', ');
    const marks = keys.map(() => '?').join(', ');
    const [r] = await poolOf(req).execute(
      'INSERT INTO ' + TABLE + ' (' + cols + ') VALUES (' + marks + ')',
      keys.map(k => body[k])
    );
    await audit(req, 'create', '新增商品 id=' + r.insertId, String(body[EDITABLE[0]] || ''));
    res.json({ success: true, data: { id: r.insertId } });
  } catch (e) { res.status(500).json({ success: false, message: '新增失败' }); }
});

// 更新
router.put('/products/:id', adminOnly, async (req, res) => {
  const body = {};
  for (const k of EDITABLE) if (req.body[k] !== undefined) body[k] = req.body[k];
  const keys = Object.keys(body);
  if (!keys.length) return res.status(400).json({ success: false, message: '无有效字段' });
  try {
    const sets = keys.map(k => '`' + k + '`=?').join(', ');
    await poolOf(req).execute('UPDATE ' + TABLE + ' SET ' + sets + ' WHERE id=?', [...keys.map(k => body[k]), req.params.id]);
    await audit(req, 'update', '更新商品 id=' + req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '更新失败' }); }
});

// 删除
router.delete('/products/:id', adminOnly, async (req, res) => {
  try {
    await poolOf(req).execute('DELETE FROM ' + TABLE + ' WHERE id=?', [req.params.id]);
    await audit(req, 'delete', '删除商品 id=' + req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '删除失败' }); }
});

export default router;
