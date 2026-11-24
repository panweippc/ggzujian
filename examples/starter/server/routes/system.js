/**
 * 系统管理接口（从 qygl 迁移到 starter，作为骨架自带能力）
 * 覆盖：用户管理(employees) / 角色管理(roles) / 菜单(menus) / 部门(departments)
 *      / 数据备份(backups) / 个人中心(login-records / avatar / change-password)
 *
 * 适配点：
 * - 鉴权用 auth-kit 的 requireAuth，身份在 req.user（name/username/role）
 * - 密码用 bcrypt（auth-kit 的 verifyPassword/hashPassword），非 qygl 的明文体系
 * - 审计用 auth-kit 的 createOperationLog
 * - 高危操作保留 qygl 的二次密码验证（verifyAdminPassword）
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import {
  verifyPassword, hashPassword, validatePassword,
  generateRandomPassword, getOperator, createOperationLog
} from '@panweippc/auth-kit';

const router = express.Router();

// 管理员角色：starter 用 'admin'，兼容 qygl 的中文角色名
const ADMIN_ROLES = ['admin', '系统管理员', '总经理'];
const isAdmin = (req) => {
  const role = req.user?.role || req.user?.roleName || '';
  const name = req.user?.name || req.user?.username || '';
  return ADMIN_ROLES.includes(role) || name === 'admin';
};
const adminOnly = (req, res, next) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, message: '无权限，仅管理员可执行此操作' });
  next();
};

// 高危操作二次验证：校验当前登录用户密码（防会话劫持）
const verifyAdminPassword = async (req, res, next) => {
  const { adminPassword } = req.body || {};
  if (!adminPassword) return res.status(400).json({ success: false, message: '请提供当前登录密码进行二次验证' });
  try {
    const { pool } = req.app.locals;
    const username = req.user?.name || req.user?.username;
    const [users] = await pool.execute('SELECT password FROM users WHERE username = ?', [username]);
    if (!users.length || !verifyPassword(String(adminPassword), users[0].password)) {
      return res.status(403).json({ success: false, message: '当前登录密码错误，操作已拒绝' });
    }
    next();
  } catch (e) {
    console.error('[二次验证失败]', e);
    res.status(500).json({ success: false, message: '二次验证失败' });
  }
};

const operator = (req) => getOperator(req) || req.user?.name || req.user?.username || '';
const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const audit = (pool, req, fields) => createOperationLog(pool, {
  userId: String(req.user?.id || ''), username: operator(req), ipAddress: req.ip, ...fields
}).catch(() => {});

// 推送通知（内部工具）：异步、失败不影响主业务
// recipient 传 '*' 为全员广播；否则为指定用户名
const pushNotification = (pool, { recipient = '*', type = 'system', title, content = '', link = null }) => {
  if (!title) return Promise.resolve();
  return pool.execute(
    'INSERT INTO notifications (recipient, type, title, content, link, isRead, createdAt) VALUES (?,?,?,?,?,0,?)',
    [recipient, type, title, content || '', link || null, nowStr()]
  ).catch((e) => console.error('[推送通知失败]', e.message));
};

// ==================== 部门 ====================
router.get('/departments', async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const [rows] = await pool.execute('SELECT * FROM departments ORDER BY id');
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: '获取部门失败' }); }
});

// ==================== 角色管理 ====================
router.get('/roles', adminOnly, async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const [rows] = await pool.execute('SELECT * FROM roles ORDER BY id');
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: '获取角色列表失败' }); }
});

router.get('/roles/:id', async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const [rows] = await pool.execute('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: '角色不存在' });
    res.json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: '获取角色失败' }); }
});

router.post('/roles', adminOnly, verifyAdminPassword, async (req, res) => {
  const { pool } = req.app.locals;
  const { name, code, description, status } = req.body;
  if (!name || !code) return res.status(400).json({ success: false, message: '角色名称和编码不能为空' });
  try {
    const [exist] = await pool.execute('SELECT id FROM roles WHERE code = ?', [code]);
    if (exist.length) return res.status(400).json({ success: false, message: '角色编码已存在' });
    const [r] = await pool.execute(
      'INSERT INTO roles (name, code, description, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
      [name, code, description || '', status || '启用', nowStr(), nowStr()]
    );
    audit(pool, req, { action: 'create', module: 'system', targetId: r.insertId, targetName: name, detail: `创建角色: ${name}` });
    res.json({ success: true, message: '角色创建成功', data: { id: r.insertId } });
  } catch (e) { console.error('[创建角色失败]', e); res.status(500).json({ success: false, message: '创建角色失败' }); }
});

router.put('/roles/:id', adminOnly, async (req, res) => {
  const { pool } = req.app.locals;
  const { name, code, description, status } = req.body;
  try {
    // 角色禁用时，把该角色下用户的 token_version +1，强制下线（适配 starter 的 token_version 字段）
    const [[old]] = await pool.query('SELECT status FROM roles WHERE id = ?', [req.params.id]);
    if (old && old.status !== '禁用' && status === '禁用') {
      await pool.execute(
        `UPDATE users u JOIN employees e ON u.username = e.name
         SET u.token_version = u.token_version + 1 WHERE e.roleId = ?`,
        [req.params.id]
      );
    }
    await pool.execute(
      'UPDATE roles SET name=?, code=?, description=?, status=?, updatedAt=? WHERE id=?',
      [name, code, description || '', status || '启用', nowStr(), req.params.id]
    );
    audit(pool, req, { action: 'update', module: 'system', targetId: req.params.id, targetName: name, detail: `更新角色: ${name}` });
    res.json({ success: true, message: '角色更新成功' });
  } catch (e) { console.error('[更新角色失败]', e); res.status(500).json({ success: false, message: '更新角色失败' }); }
});

router.delete('/roles/:id', adminOnly, verifyAdminPassword, async (req, res) => {
  const { pool } = req.app.locals;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM role_permissions WHERE roleId = ?', [req.params.id]);
    await conn.execute('DELETE FROM role_button_permissions WHERE roleId = ?', [req.params.id]);
    await conn.execute('UPDATE employees SET roleId = NULL WHERE roleId = ?', [req.params.id]);
    await conn.execute('DELETE FROM roles WHERE id = ?', [req.params.id]);
    await conn.commit();
    audit(pool, req, { action: 'delete', module: 'system', targetId: req.params.id, targetName: `角色ID:${req.params.id}`, detail: '删除角色' });
    res.json({ success: true, message: '角色删除成功' });
  } catch (e) {
    await conn.rollback();
    console.error('[删除角色失败]', e);
    res.status(500).json({ success: false, message: '删除角色失败' });
  } finally { conn.release(); }
});

// 角色权限
router.get('/roles/:roleId/permissions', async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const [rows] = await pool.execute('SELECT menuId FROM role_permissions WHERE roleId = ?', [req.params.roleId]);
    res.json({ success: true, data: rows.map((r) => r.menuId) });
  } catch (e) { res.status(500).json({ success: false, message: '获取角色权限失败' }); }
});

router.post('/roles/:roleId/permissions', adminOnly, async (req, res) => {
  const { pool } = req.app.locals;
  const { menuIds } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM role_permissions WHERE roleId = ?', [req.params.roleId]);
    for (const menuId of menuIds || []) {
      await conn.execute('INSERT INTO role_permissions (roleId, menuId, createdAt) VALUES (?,?,?)', [req.params.roleId, menuId, nowStr()]);
    }
    await conn.commit();
    audit(pool, req, { action: 'update', module: 'system', targetId: req.params.roleId, detail: '分配角色权限' });
    res.json({ success: true, message: '权限分配成功' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ success: false, message: '权限分配失败' });
  } finally { conn.release(); }
});

router.get('/roles/:roleId/button-permissions', adminOnly, async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const [rows] = await pool.execute('SELECT menuId, buttonKey FROM role_button_permissions WHERE roleId = ?', [req.params.roleId]);
    const grouped = {};
    rows.forEach((p) => { (grouped[p.menuId] ||= []).push(p.buttonKey); });
    res.json({ success: true, data: grouped });
  } catch (e) { res.status(500).json({ success: false, message: '获取按钮权限失败' }); }
});

router.post('/roles/:roleId/button-permissions', adminOnly, verifyAdminPassword, async (req, res) => {
  const { pool } = req.app.locals;
  const { permissions } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM role_button_permissions WHERE roleId = ?', [req.params.roleId]);
    for (const [menuId, buttons] of Object.entries(permissions || {})) {
      for (const key of buttons || []) {
        await conn.execute('INSERT INTO role_button_permissions (roleId, menuId, buttonKey, createdAt) VALUES (?,?,?,?)', [req.params.roleId, +menuId, key, nowStr()]);
      }
    }
    await conn.commit();
    res.json({ success: true, message: '按钮权限分配成功' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ success: false, message: '按钮权限分配失败' });
  } finally { conn.release(); }
});

// ==================== 菜单 ====================
router.get('/menus', adminOnly, async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const [rows] = await pool.execute('SELECT * FROM menus ORDER BY sort, id');
    const build = (all, pid = 0) => all.filter((m) => m.parentId === pid).map((m) => ({ ...m, children: build(all, m.id) }));
    res.json({ success: true, data: build(rows) });
  } catch (e) { res.status(500).json({ success: false, message: '获取菜单失败' }); }
});

router.post('/menus', adminOnly, async (req, res) => {
  const { pool } = req.app.locals;
  const { parentId, name, path, component, icon, sort, status } = req.body;
  try {
    const [r] = await pool.execute(
      'INSERT INTO menus (parentId,name,path,component,icon,sort,status,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)',
      [parentId || 0, name, path, component || '', icon || '', sort || 0, status || '启用', nowStr(), nowStr()]
    );
    audit(pool, req, { action: 'create', module: 'system', targetId: r.insertId, targetName: name, detail: `创建菜单: ${name}` });
    res.json({ success: true, message: '菜单创建成功', data: { id: r.insertId } });
  } catch (e) { res.status(500).json({ success: false, message: '创建菜单失败' }); }
});

router.put('/menus/:id', adminOnly, async (req, res) => {
  const { pool } = req.app.locals;
  const { parentId, name, path, component, icon, sort, status } = req.body;
  try {
    await pool.execute(
      'UPDATE menus SET parentId=?,name=?,path=?,component=?,icon=?,sort=?,status=?,updatedAt=? WHERE id=?',
      [parentId || 0, name, path, component || '', icon || '', sort || 0, status || '启用', nowStr(), req.params.id]
    );
    audit(pool, req, { action: 'update', module: 'system', targetId: req.params.id, targetName: name, detail: `更新菜单: ${name}` });
    res.json({ success: true, message: '菜单更新成功' });
  } catch (e) { res.status(500).json({ success: false, message: '更新菜单失败' }); }
});

router.delete('/menus/:id', adminOnly, verifyAdminPassword, async (req, res) => {
  const { pool } = req.app.locals;
  try {
    await pool.execute('DELETE FROM menus WHERE parentId = ?', [req.params.id]);
    await pool.execute('DELETE FROM menus WHERE id = ?', [req.params.id]);
    audit(pool, req, { action: 'delete', module: 'system', targetId: req.params.id, detail: '删除菜单' });
    res.json({ success: true, message: '菜单删除成功' });
  } catch (e) { res.status(500).json({ success: false, message: '删除菜单失败' }); }
});

// ==================== 用户管理（employees）====================
router.get('/employees', async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const [rows] = await pool.execute('SELECT * FROM employees ORDER BY id');
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: '获取用户列表失败' }); }
});

router.post('/employees', adminOnly, verifyAdminPassword, async (req, res) => {
  const { pool } = req.app.locals;
  const { name, department, position, email, phone, entryDate, password, roleId, status, employeeType, education, birthDate, idCard, address, emergencyContact, emergencyPhone } = req.body;
  if (!name || !department) return res.status(400).json({ success: false, message: '姓名和部门不能为空' });
  try {
    let initPwd = password;
    let autoGen = false;
    if (!initPwd) { initPwd = generateRandomPassword(14); autoGen = true; }
    else {
      const err = validatePassword(initPwd, name);
      if (err) return res.status(400).json({ success: false, message: err });
    }
    const [r] = await pool.execute(
      `INSERT INTO employees (name,department,position,email,phone,entryDate,roleId,status,employeeType,education,birthDate,idCard,address,emergencyContact,emergencyPhone,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [name, department, position || '', email || '', phone || '', entryDate || nowStr(), roleId || null,
       status || '在职', employeeType || '正式员工', education || '', birthDate || null, idCard || '',
       address || '', emergencyContact || '', emergencyPhone || '', nowStr()]
    );
    // 同步创建登录账号（bcrypt 哈希 + token_version）
    const [exist] = await pool.execute('SELECT id FROM users WHERE username = ?', [name]);
    if (!exist.length) {
      await pool.execute('INSERT INTO users (username,password,role,token_version) VALUES (?,?,?,0)', [name, hashPassword(String(initPwd)), 'user']);
    } else if (!autoGen) {
      await pool.execute('UPDATE users SET password = ? WHERE username = ?', [hashPassword(String(initPwd)), name]);
    }
    audit(pool, req, { action: 'create', module: 'employee', targetId: r.insertId, targetName: name, detail: `添加用户: ${name}` });
    pushNotification(pool, { recipient: '*', type: 'user', title: '新增用户', content: `${operator(req)} 添加了用户「${name}」`, link: '/system' });
    res.json({ success: true, message: '用户添加成功', data: { id: r.insertId }, initialPassword: autoGen ? initPwd : undefined });
  } catch (e) {
    console.error('[添加用户失败]', e);
    res.status(500).json({ success: false, message: '添加用户失败（姓名可能重复）' });
  }
});

router.put('/employees/:name', adminOnly, verifyAdminPassword, async (req, res) => {
  const { pool } = req.app.locals;
  const { department, position, email, phone, roleId, status, employeeType, education, birthDate, idCard, address, emergencyContact, emergencyPhone, password } = req.body;
  try {
    await pool.execute(
      `UPDATE employees SET department=?,position=?,email=?,phone=?,roleId=?,status=?,employeeType=?,education=?,birthDate=?,idCard=?,address=?,emergencyContact=?,emergencyPhone=? WHERE name=?`,
      [department, position || '', email || '', phone || '', roleId || null, status || '在职', employeeType || '正式员工',
       education || '', birthDate || null, idCard || '', address || '', emergencyContact || '', emergencyPhone || '', req.params.name]
    );
    if (password) {
      const err = validatePassword(password, req.params.name);
      if (err) return res.status(400).json({ success: false, message: err });
      await pool.execute('UPDATE users SET password = ?, token_version = token_version + 1 WHERE username = ?', [hashPassword(String(password)), req.params.name]);
    }
    audit(pool, req, { action: 'update', module: 'employee', targetName: req.params.name, detail: `更新用户: ${req.params.name}` });
    res.json({ success: true, message: '用户更新成功' });
  } catch (e) { console.error('[更新用户失败]', e); res.status(500).json({ success: false, message: '更新用户失败' }); }
});

router.delete('/employees/:name', adminOnly, verifyAdminPassword, async (req, res) => {
  const { pool } = req.app.locals;
  const opName = req.user?.name || req.user?.username;
  if (req.params.name === opName) return res.status(403).json({ success: false, message: '不能删除当前登录账号' });
  if (req.params.name === 'admin') return res.status(403).json({ success: false, message: '不能删除系统管理员' });
  try {
    await pool.execute('DELETE FROM users WHERE username = ?', [req.params.name]);
    await pool.execute('DELETE FROM employees WHERE name = ?', [req.params.name]);
    audit(pool, req, { action: 'delete', module: 'employee', targetName: req.params.name, detail: `删除用户: ${req.params.name}` });
    res.json({ success: true, message: '用户删除成功' });
  } catch (e) { res.status(500).json({ success: false, message: '删除用户失败' }); }
});

// 重置用户密码
router.post('/employees/:name/reset-password', adminOnly, verifyAdminPassword, async (req, res) => {
  const { pool } = req.app.locals;
  try {
    const newPwd = generateRandomPassword(14);
    const [exist] = await pool.execute('SELECT id FROM users WHERE username = ?', [req.params.name]);
    if (!exist.length) return res.status(404).json({ success: false, message: '登录账号不存在' });
    await pool.execute('UPDATE users SET password = ?, token_version = token_version + 1 WHERE username = ?', [hashPassword(newPwd), req.params.name]);
    audit(pool, req, { action: 'reset_password', module: 'employee', targetName: req.params.name, detail: `重置用户密码: ${req.params.name}` });
    res.json({ success: true, message: '密码重置成功', password: newPwd });
  } catch (e) { res.status(500).json({ success: false, message: '重置密码失败' }); }
});

// ==================== 数据备份 ====================
const BACKUP_DIR = path.join(process.cwd(), 'backups', 'manual');
const SAFE_NAME = /^[A-Za-z0-9_\-]+\.sql$/;
const safeResolve = (f) => (SAFE_NAME.test(f) ? path.join(BACKUP_DIR, f) : null);

router.get('/backups', adminOnly, async (req, res) => {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => SAFE_NAME.test(f)).map((name) => {
      const st = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, size: st.size, sizeText: st.size < 1048576 ? `${(st.size / 1024).toFixed(1)} KB` : `${(st.size / 1048576).toFixed(2)} MB`, createdAt: st.mtime };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, data: files });
  } catch (e) { res.status(500).json({ success: false, message: '列出备份失败' }); }
});

router.post('/backups', adminOnly, async (req, res) => {
  const { pool } = req.app.locals;
  const conn = await pool.getConnection();
  const filename = `${process.env.DB_NAME || 'my_project'}_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.sql`;
  const full = path.join(BACKUP_DIR, filename);
  let tables = 0, rows = 0;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    await conn.query('SET SESSION group_concat_max_len = 1073741824');
    const [tr] = await conn.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME');
    tables = tr.length;
    const out = fs.createWriteStream(full, { encoding: 'utf8' });
    out.write(`-- starter 数据库备份\n-- 数据库: ${process.env.DB_NAME || 'my_project'}\n-- 备份时间: ${nowStr()}\n-- 表数量: ${tables}\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n`);
    for (const t of tr.map((x) => x.TABLE_NAME)) {
      const [cr] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
      out.write(`DROP TABLE IF EXISTS \`${t}\`;\n${cr[0]['Create Table']};\n\n`);
      let offset = 0;
      while (true) {
        const [batch] = await conn.query(`SELECT * FROM \`${t}\` LIMIT 2000 OFFSET ${offset}`);
        if (!batch.length) break;
        rows += batch.length;
        for (const r of batch) {
          const cols = Object.keys(r).map((c) => `\`${c}\``).join(', ');
          const vals = Object.keys(r).map((c) => conn.escape(r[c])).join(', ');
          out.write(`INSERT INTO \`${t}\` (${cols}) VALUES (${vals});\n`);
        }
        offset += batch.length;
      }
      out.write('\n');
    }
    out.write('SET FOREIGN_KEY_CHECKS = 1;\n');
    await new Promise((resolve, reject) => { out.end(resolve); out.on('error', reject); });
    audit(pool, req, { action: 'backup_create', module: 'system', targetName: filename, detail: `创建备份，${tables} 张表 ${rows} 行` });
    pushNotification(pool, { recipient: '*', type: 'backup', title: '数据备份完成', content: `${operator(req)} 创建了备份 ${filename}（${tables} 表 ${rows} 行）`, link: '/system' });
    const st = fs.statSync(full);
    res.json({ success: true, message: `备份成功：${tables} 张表、${rows} 行数据`, data: { name: filename, size: st.size, sizeText: `${(st.size / 1024).toFixed(1)} KB`, createdAt: st.mtime } });
  } catch (e) {
    console.error('[备份失败]', e);
    try { fs.unlinkSync(full); } catch {}
    res.status(500).json({ success: false, message: '创建备份失败' });
  } finally { conn.release(); }
});

router.get('/backups/:file/download', adminOnly, async (req, res) => {
  const full = safeResolve(req.params.file);
  if (!full || !fs.existsSync(full)) return res.status(404).json({ success: false, message: '备份文件不存在' });
  audit(req.app.locals.pool, req, { action: 'backup_download', module: 'system', targetName: req.params.file, detail: '下载备份文件' });
  res.download(full, req.params.file);
});

router.delete('/backups/:file', adminOnly, verifyAdminPassword, async (req, res) => {
  const full = safeResolve(req.params.file);
  if (!full || !fs.existsSync(full)) return res.status(404).json({ success: false, message: '备份文件不存在' });
  try {
    fs.unlinkSync(full);
    audit(req.app.locals.pool, req, { action: 'backup_delete', module: 'system', targetName: req.params.file, detail: '删除备份文件' });
    res.json({ success: true, message: '备份文件已删除' });
  } catch (e) { res.status(500).json({ success: false, message: '删除备份失败' }); }
});

router.post('/backups/:file/restore', adminOnly, async (req, res) => {
  const { createConnection } = await import('mysql2/promise');
  if (req.body.confirm !== 'RESTORE') return res.status(400).json({ success: false, message: '请先确认恢复操作（confirm=RESTORE）' });
  const full = safeResolve(req.params.file);
  if (!full || !fs.existsSync(full)) return res.status(404).json({ success: false, message: '备份文件不存在' });
  const dbCfg = { host: process.env.DB_HOST || '127.0.0.1', port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD, database: process.env.DB_NAME, multipleStatements: true };
  const conn = await createConnection(dbCfg);
  try {
    const sql = fs.readFileSync(full, 'utf8');
    await conn.query("SET SESSION sql_mode = ''");
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query(sql);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    audit(req.app.locals.pool, req, { action: 'backup_restore', module: 'system', targetName: req.params.file, detail: '从备份恢复数据库' });
    pushNotification(req.app.locals.pool, { recipient: '*', type: 'backup', title: '数据库已恢复', content: `${operator(req)} 从备份 ${req.params.file} 恢复了数据库`, link: '/system' });
    res.json({ success: true, message: '恢复成功' });
  } catch (e) {
    console.error('[恢复失败]', e);
    res.status(500).json({ success: false, message: '恢复备份失败' });
  } finally { try { await conn.end(); } catch {} }
});

// ==================== 个人中心 / 账号 ====================
// 最近登录记录（从 operation_logs 读）
router.get('/user/login-records', async (req, res) => {
  const username = req.user?.name || req.user?.username;
  if (!username) return res.status(401).json({ success: false, message: '未登录' });
  try {
    const { pool } = req.app.locals;
    const [rows] = await pool.execute(
      "SELECT id, action, ipAddress, detail, createdAt FROM operation_logs WHERE username = ? AND action IN ('login','login_fail') ORDER BY id DESC LIMIT 20",
      [username]
    );
    res.json({ success: true, data: rows.map((r) => ({ id: r.id, success: r.action === 'login', ip: r.ipAddress || '未知', time: r.createdAt, detail: r.detail || '' })) });
  } catch (e) { res.status(500).json({ success: false, message: '获取登录记录失败' }); }
});

// 改密（限流 + 旧密码校验 + token_version+1 强制下线）
const pwdLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { success: false, message: '密码修改尝试过于频繁，请15分钟后再试' } });
router.post('/user/change-password', pwdLimiter, async (req, res) => {
  const username = req.user?.name || req.user?.username;
  const { oldPassword, newPassword } = req.body;
  if (!username) return res.status(401).json({ success: false, message: '未登录' });
  if (!oldPassword || !newPassword) return res.json({ success: false, message: '参数不完整' });
  const err = validatePassword(newPassword, username);
  if (err) return res.json({ success: false, message: err });
  try {
    const { pool } = req.app.locals;
    const [users] = await pool.execute('SELECT password FROM users WHERE username = ?', [username]);
    if (!users.length) return res.json({ success: false, message: '用户不存在' });
    if (!verifyPassword(oldPassword, users[0].password)) return res.json({ success: false, message: '旧密码错误' });
    if (verifyPassword(newPassword, users[0].password)) return res.json({ success: false, message: '新密码不能与旧密码相同' });
    await pool.execute('UPDATE users SET password = ?, token_version = token_version + 1 WHERE username = ?', [hashPassword(String(newPassword)), username]);
    audit(pool, req, { action: 'change_password', module: 'auth', targetName: username, detail: `用户修改密码: ${username}` });
    pushNotification(pool, { recipient: username, type: 'security', title: '密码已修改', content: '您的账号密码刚刚被修改。若非本人操作，请立即联系管理员。', link: '/change-password' });
    res.json({ success: true, message: '密码修改成功，请使用新密码重新登录' });
  } catch (e) { console.error('[改密失败]', e); res.status(500).json({ success: false, message: '修改密码失败' }); }
});

// ==================== 安全事件监控 ====================
// 读 auth-kit 写入的 logs/security-alert.log（JSON 行），管理员可见
router.get('/security-alerts', adminOnly, async (req, res) => {
  const limit = Math.min(+req.query.limit || 200, 1000);
  const level = req.query.level || '';
  const type = req.query.type || '';
  const logFile = path.join(process.cwd(), 'logs', 'security-alert.log');
  try {
    let alerts = [];
    if (fs.existsSync(logFile)) {
      const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
      alerts = lines.slice(-limit).reverse().map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
    }
    if (level) alerts = alerts.filter((a) => a.level === level);
    if (type) alerts = alerts.filter((a) => a.type === type);
    const stats = {
      total: alerts.length,
      high: alerts.filter((a) => a.level === 'HIGH' || a.level === 'CRITICAL').length,
      brute_force: alerts.filter((a) => a.type === 'login_brute_force' || a.type === 'login_locked').length,
      login_fail: alerts.filter((a) => a.type === 'login_fail').length,
      other: alerts.filter((a) => !['login_brute_force', 'login_locked', 'login_fail'].includes(a.type)).length,
    };
    res.json({ success: true, data: { list: alerts, stats } });
  } catch (e) { console.error('[读取安全告警失败]', e); res.status(500).json({ success: false, message: '读取安全告警失败' }); }
});

// ==================== 消息通知中心 ====================
// 列表：当前用户专属 + 全员广播（广播的已读状态从 notifications_reads 按人读）
router.get('/notifications', async (req, res) => {
  const username = req.user?.name || req.user?.username;
  if (!username) return res.status(401).json({ success: false, message: '未登录' });
  const { pool } = req.app.locals;
  const limit = Math.min(+req.query.limit || 50, 200);
  try {
    const [rows] = await pool.execute(
      `SELECT n.id, n.recipient, n.type, n.title, n.content, n.link,
              CASE WHEN n.recipient = '*' THEN COALESCE(r.readAt IS NOT NULL, 0) ELSE n.isRead END AS isRead,
              n.createdAt
       FROM notifications n
       LEFT JOIN notifications_reads r ON r.notificationId = n.id AND r.username = ?
       WHERE (n.recipient = ? OR n.recipient = '*') AND COALESCE(r.hidden, 0) = 0
       ORDER BY n.createdAt DESC, n.id DESC LIMIT ${limit}`,
      [username, username]
    );
    res.json({ success: true, data: rows });
  } catch (e) { console.error('[获取通知失败]', e); res.status(500).json({ success: false, message: '获取通知失败' }); }
});

// 未读数
router.get('/notifications/unread-count', async (req, res) => {
  const username = req.user?.name || req.user?.username;
  if (!username) return res.status(401).json({ success: false, message: '未登录' });
  const { pool } = req.app.locals;
  try {
    const [[row]] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM notifications n
       LEFT JOIN notifications_reads r ON r.notificationId = n.id AND r.username = ?
       WHERE (n.recipient = ? OR n.recipient = '*') AND COALESCE(r.hidden, 0) = 0
         AND (CASE WHEN n.recipient = '*' THEN (r.readAt IS NULL) ELSE n.isRead = 0 END)`,
      [username, username]
    );
    res.json({ success: true, data: { count: row.cnt } });
  } catch (e) { console.error('[获取未读数失败]', e); res.json({ success: true, data: { count: 0 } }); }
});

// 标记单条已读
router.post('/notifications/:id/read', async (req, res) => {
  const username = req.user?.name || req.user?.username;
  if (!username) return res.status(401).json({ success: false, message: '未登录' });
  const { pool } = req.app.locals;
  const id = req.params.id;
  try {
    const [[n]] = await pool.execute('SELECT recipient FROM notifications WHERE id = ?', [id]);
    if (!n) return res.status(404).json({ success: false, message: '通知不存在' });
    if (n.recipient !== '*' && n.recipient !== username) return res.status(403).json({ success: false, message: '无权操作此通知' });
    if (n.recipient === '*') {
      await pool.execute('INSERT IGNORE INTO notifications_reads (notificationId, username, readAt) VALUES (?,?,?)', [id, username, nowStr()]);
    } else {
      await pool.execute('UPDATE notifications SET isRead = 1 WHERE id = ?', [id]);
    }
    res.json({ success: true, message: '已标记为已读' });
  } catch (e) { console.error('[标记已读失败]', e); res.status(500).json({ success: false, message: '标记已读失败' }); }
});

// 全部已读
router.post('/notifications/read-all', async (req, res) => {
  const username = req.user?.name || req.user?.username;
  if (!username) return res.status(401).json({ success: false, message: '未登录' });
  const { pool } = req.app.locals;
  try {
    await pool.execute('UPDATE notifications SET isRead = 1 WHERE recipient = ? AND isRead = 0', [username]);
    await pool.execute(
      `INSERT IGNORE INTO notifications_reads (notificationId, username, readAt)
       SELECT id, ?, ? FROM notifications WHERE recipient = '*'
         AND id NOT IN (SELECT notificationId FROM notifications_reads WHERE username = ?)`,
      [username, nowStr(), username]
    );
    res.json({ success: true, message: '已全部标记为已读' });
  } catch (e) { console.error('[全部已读失败]', e); res.status(500).json({ success: false, message: '操作失败' }); }
});

// 删除通知：专属通知物理删除；广播通知按人隐藏（插入/更新 notifications_reads.hidden=1），不影响他人
router.delete('/notifications/:id', async (req, res) => {
  const username = req.user?.name || req.user?.username;
  if (!username) return res.status(401).json({ success: false, message: '未登录' });
  const { pool } = req.app.locals;
  const id = req.params.id;
  try {
    const [[n]] = await pool.execute('SELECT recipient FROM notifications WHERE id = ?', [id]);
    if (!n) return res.status(404).json({ success: false, message: '通知不存在' });
    if (n.recipient !== '*' && n.recipient !== username) return res.status(403).json({ success: false, message: '无权操作此通知' });
    if (n.recipient === '*') {
      await pool.execute(
        `INSERT INTO notifications_reads (notificationId, username, readAt, hidden) VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE hidden = 1`,
        [id, username, nowStr()]
      );
    } else {
      await pool.execute('DELETE FROM notifications WHERE id = ?', [id]);
    }
    res.json({ success: true, message: '通知已删除' });
  } catch (e) { console.error('[删除通知失败]', e); res.status(500).json({ success: false, message: '删除失败' }); }
});

// 头像上传/读取（存本地 uploads/avatars）
const avatarDir = path.join(process.cwd(), 'uploads', 'avatars');
fs.mkdirSync(avatarDir, { recursive: true });
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname || '.jpg').toLowerCase())
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持 JPG/PNG/GIF/WebP 格式的头像'));
  }
});
router.post('/user/avatar', avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '请选择头像文件' });
    const avatarUrl = '/uploads/avatars/' + req.file.filename;
    const { pool } = req.app.locals;
    const username = req.user?.name || req.user?.username || req.body.username;
    await pool.execute('UPDATE employees SET avatar = ? WHERE name = ?', [avatarUrl, username]);
    res.json({ success: true, data: { avatar: avatarUrl }, message: '头像更新成功' });
  } catch (e) { res.status(500).json({ success: false, message: '上传头像失败' }); }
});
router.get('/user/avatar/:username', async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const [rows] = await pool.execute('SELECT avatar FROM employees WHERE name = ?', [req.params.username]);
    res.json({ success: true, data: { avatar: rows[0]?.avatar || '' } });
  } catch (e) { res.json({ success: true, data: { avatar: '' } }); }
});

// multer 错误处理
router.use((err, req, res, next) => {
  if (err?.message?.includes('仅支持')) return res.status(400).json({ success: false, message: err.message });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ success: false, message: '头像文件不能超过2MB' });
  next(err);
});

export default router;
