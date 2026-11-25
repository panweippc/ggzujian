/**
 * 公共组件接口（骨架自带，配置驱动）
 * 覆盖：数据字典 / 配置中心 / 定时任务 / 在线会话 / IP 白名单 / 系统监控 / TOTP 二次验证
 * 全部管理员鉴权；TOTP 用 Node 内置 crypto 实现，无第三方依赖。
 */
import express from 'express';
import os from 'os';
import crypto from 'crypto';
import { getOperator, createOperationLog } from '@panweippc/auth-kit';
import { writeAudit } from '../middleware/audit.js';
import { getGatewayStats } from '../middleware/gateway.js';

const router = express.Router();
const ADMIN_ROLES = ['admin', '系统管理员', '总经理'];
const isAdmin = (req) => {
  const role = req.user?.role || req.user?.roleName || '';
  const name = req.user?.name || req.user?.username || '';
  return ADMIN_ROLES.includes(role) || name === 'admin';
};
const adminOnly = (req, res, next) => isAdmin(req) ? next() : res.status(403).json({ success: false, message: '无权限，仅管理员可操作' });
const poolOf = (req) => req.app.locals.pool;
const audit = (req, action, module, detail, targetName = '') =>
  writeAudit(poolOf(req), req, {
    userId: String(req.user?.id || ''), username: getOperator(req), ipAddress: req.ip,
    action, module, detail, targetName
  }).catch(() => {});

// ==================== 数据字典 ====================
// 进程内缓存：字典读多写少，加 TTL 缓存减少 DB 查询；任何写操作后整体失效。
const dictCache = new Map();
const DICT_TTL = +(process.env.DICT_CACHE_TTL_MS || 5 * 60 * 1000);
const dictCacheKey = (category, all) => `${category || '*'}|${all ? 'all' : 'on'}`;
function dictCacheGet(key) {
  const hit = dictCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > DICT_TTL) { dictCache.delete(key); return null; }
  return hit.rows;
}
function dictCacheSet(key, rows) { dictCache.set(key, { at: Date.now(), rows }); }
function dictCacheClear() { dictCache.clear(); }

async function queryDictItems(pool, category, all) {
  let sql = 'SELECT * FROM dict_items WHERE 1=1';
  const args = [];
  if (category) { sql += ' AND category = ?'; args.push(category); }
  if (!all) sql += ' AND status = 1';
  sql += ' ORDER BY category, sort, id';
  const [rows] = await pool.execute(sql, args);
  return rows;
}

router.get('/dict-items', adminOnly, async (req, res) => {
  try {
    const { category, all } = req.query;
    const showAll = all === '1';
    const key = dictCacheKey(category, showAll);
    const cached = dictCacheGet(key);
    if (cached) return res.json({ success: true, data: cached, cached: true });
    const rows = await queryDictItems(poolOf(req), category, showAll);
    dictCacheSet(key, rows);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: '读取字典失败' }); }
});

// 批量取字典：一次请求拿多个分类，供复杂表单/多下拉页减少往返
router.post('/dict-items/batch', adminOnly, async (req, res) => {
  try {
    const categories = Array.isArray(req.body?.categories) ? req.body.categories.filter(Boolean) : [];
    if (!categories.length) return res.status(400).json({ success: false, message: 'categories 不能为空' });
    const showAll = req.body?.all === true || req.body?.all === '1';
    const result = {};
    for (const cat of categories) {
      const key = dictCacheKey(cat, showAll);
      let rows = dictCacheGet(key);
      if (!rows) { rows = await queryDictItems(poolOf(req), cat, showAll); dictCacheSet(key, rows); }
      result[cat] = rows;
    }
    res.json({ success: true, data: result });
  } catch (e) { res.status(500).json({ success: false, message: '批量读取字典失败' }); }
});

// 同分类下 value 唯一校验（excludeId 用于更新时排除自身）
async function assertDictValueUnique(pool, category, value, excludeId = null) {
  let sql = 'SELECT id FROM dict_items WHERE category=? AND value=?';
  const args = [category, String(value)];
  if (excludeId) { sql += ' AND id<>?'; args.push(excludeId); }
  const [rows] = await pool.execute(sql, args);
  return rows.length === 0;
}

router.post('/dict-items', adminOnly, async (req, res) => {
  const { category, label, value, sort = 0, status = 1, remark = '' } = req.body || {};
  if (!category || !label || value === undefined) return res.status(400).json({ success: false, message: '分类/名称/值必填' });
  try {
    if (!await assertDictValueUnique(poolOf(req), category, value)) {
      return res.status(409).json({ success: false, message: `分类 ${category} 下已存在值 ${value}` });
    }
    const [r] = await poolOf(req).execute(
      'INSERT INTO dict_items (category,label,value,sort,status,remark) VALUES (?,?,?,?,?,?)',
      [category, label, String(value), sort, status, remark]
    );
    dictCacheClear();
    audit(req, 'create', 'dict', `新增字典项 ${category}/${label}`, label);
    res.json({ success: true, data: { id: r.insertId } });
  } catch (e) { res.status(500).json({ success: false, message: '新增失败' }); }
});
router.put('/dict-items/:id', adminOnly, async (req, res) => {
  const { category, label, value, sort = 0, status = 1, remark = '' } = req.body || {};
  try {
    if (!await assertDictValueUnique(poolOf(req), category, value, req.params.id)) {
      return res.status(409).json({ success: false, message: `分类 ${category} 下已存在值 ${value}` });
    }
    await poolOf(req).execute(
      'UPDATE dict_items SET category=?,label=?,value=?,sort=?,status=?,remark=? WHERE id=?',
      [category, label, String(value), sort, status, remark, req.params.id]
    );
    dictCacheClear();
    audit(req, 'update', 'dict', `修改字典项 ${label}`, label);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '修改失败' }); }
});
router.delete('/dict-items/:id', adminOnly, async (req, res) => {
  try {
    await poolOf(req).execute('DELETE FROM dict_items WHERE id=?', [req.params.id]);
    dictCacheClear();
    audit(req, 'delete', 'dict', `删除字典项 ID ${req.params.id}`, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '删除失败' }); }
});

// 字典分类 CRUD
router.get('/dict-categories', adminOnly, async (req, res) => {
  try {
    const [rows] = await poolOf(req).execute('SELECT * FROM dict_categories ORDER BY sort, id');
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: '读取字典分类失败' }); }
});
router.post('/dict-categories', adminOnly, async (req, res) => {
  const { code, name, description = '', sort = 0, status = 1 } = req.body || {};
  if (!code || !name) return res.status(400).json({ success: false, message: '编码/名称必填' });
  try {
    const [r] = await poolOf(req).execute(
      'INSERT INTO dict_categories (code,name,description,sort,status) VALUES (?,?,?,?,?)',
      [code, name, description, sort, status]
    );
    audit(req, 'create', 'dict', `新增字典分类 ${code}/${name}`, name);
    res.json({ success: true, data: { id: r.insertId } });
  } catch (e) {
    if (String(e?.code) === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: `分类编码 ${code} 已存在` });
    res.status(500).json({ success: false, message: '新增分类失败' });
  }
});
router.put('/dict-categories/:id', adminOnly, async (req, res) => {
  const { name, description = '', sort = 0, status = 1 } = req.body || {};
  try {
    await poolOf(req).execute('UPDATE dict_categories SET name=?,description=?,sort=?,status=? WHERE id=?',
      [name, description, sort, status, req.params.id]);
    audit(req, 'update', 'dict', `修改字典分类 ID ${req.params.id}`, name);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '修改分类失败' }); }
});
router.delete('/dict-categories/:id', adminOnly, async (req, res) => {
  try {
    const [[cat]] = await poolOf(req).execute('SELECT code FROM dict_categories WHERE id=?', [req.params.id]);
    if (!cat) return res.status(404).json({ success: false, message: '分类不存在' });
    const [[used]] = await poolOf(req).execute('SELECT COUNT(*) n FROM dict_items WHERE category=?', [cat.code]);
    if (used.n > 0) return res.status(409).json({ success: false, message: `分类 ${cat.code} 下仍有 ${used.n} 个字典项，请先删除` });
    await poolOf(req).execute('DELETE FROM dict_categories WHERE id=?', [req.params.id]);
    audit(req, 'delete', 'dict', `删除字典分类 ${cat.code}`, cat.code);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '删除分类失败' }); }
});

// ==================== 配置中心（多环境 + 版本历史 + 回滚） ====================
const curEnv = (req) => String(req.query.env || req.body?.env || process.env.NODE_ENV || 'dev');

// 写版本快照（内部工具）：把变更后的值记一条历史
async function writeConfigHistory(pool, { configKey, env, version, configValue, description, operation, operator }) {
  await pool.execute(
    'INSERT INTO config_history (configKey, env, version, configValue, description, operation, operator) VALUES (?,?,?,?,?,?,?)',
    [configKey, env, version, configValue ?? '', description ?? null, operation, operator || '']
  );
}

router.get('/configs', adminOnly, async (req, res) => {
  try {
    const { category, all } = req.query;
    // all=1 返回全部环境（兼容老调用）；否则按 env 过滤
    const env = curEnv(req);
    let sql = all === '1' ? 'SELECT * FROM app_configs WHERE 1=1' : 'SELECT * FROM app_configs WHERE env=?';
    const args = all === '1' ? [] : [env];
    if (category) { sql += ' AND category=?'; args.push(category); }
    sql += ' ORDER BY category, configKey';
    const [rows] = await poolOf(req).execute(sql, args);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: '读取配置失败' }); }
});

router.put('/configs/:key', adminOnly, async (req, res) => {
  const username = req.user?.name || req.user?.username || '';
  const { configValue, description } = req.body || {};
  const env = curEnv(req);
  const pool = poolOf(req);
  try {
    const [[old]] = await pool.execute('SELECT configValue, description, version FROM app_configs WHERE configKey=? AND env=?', [req.params.key, env]);
    if (!old) return res.status(404).json({ success: false, message: '该环境下配置不存在' });
    const nextVer = (old.version || 1) + 1;
    await pool.execute(
      'UPDATE app_configs SET configValue=?, version=?, updatedBy=?, description=COALESCE(?,description) WHERE configKey=? AND env=?',
      [configValue === undefined ? '' : String(configValue), nextVer, username, description ?? null, req.params.key, env]
    );
    await writeConfigHistory(pool, {
      configKey: req.params.key, env, version: nextVer,
      configValue: configValue === undefined ? '' : String(configValue),
      description: description ?? old.description, operation: 'update', operator: username
    });
    audit(req, 'update', 'config', `修改配置 ${req.params.key} (${env}) v${nextVer}`, req.params.key);
    res.json({ success: true, data: { version: nextVer } });
  } catch (e) { res.status(500).json({ success: false, message: '保存配置失败' }); }
});

router.post('/configs', adminOnly, async (req, res) => {
  const username = req.user?.name || req.user?.username || '';
  const { configKey, configValue, category = 'system', description = '' } = req.body || {};
  const env = curEnv(req);
  const pool = poolOf(req);
  if (!configKey) return res.status(400).json({ success: false, message: '配置键必填' });
  try {
    await pool.execute(
      'INSERT INTO app_configs (configKey,configValue,category,env,description,version,updatedBy) VALUES (?,?,?,?,?,1,?)',
      [configKey, String(configValue ?? ''), category, env, description, username]
    );
    await writeConfigHistory(pool, {
      configKey, env, version: 1, configValue: String(configValue ?? ''),
      description, operation: 'create', operator: username
    });
    audit(req, 'create', 'config', `新增配置 ${configKey} (${env})`, configKey);
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: '该环境下配置键已存在' });
    res.status(500).json({ success: false, message: '新增配置失败' });
  }
});

router.delete('/configs/:key', adminOnly, async (req, res) => {
  const username = req.user?.name || req.user?.username || '';
  const env = curEnv(req);
  const pool = poolOf(req);
  try {
    const [[old]] = await pool.execute('SELECT version, configValue, description FROM app_configs WHERE configKey=? AND env=?', [req.params.key, env]);
    if (!old) return res.status(404).json({ success: false, message: '该环境下配置不存在' });
    await pool.execute('DELETE FROM app_configs WHERE configKey=? AND env=?', [req.params.key, env]);
    await writeConfigHistory(pool, {
      configKey: req.params.key, env, version: (old.version || 1) + 1,
      configValue: old.configValue, description: old.description, operation: 'delete', operator: username
    });
    audit(req, 'delete', 'config', `删除配置 ${req.params.key} (${env})`, req.params.key);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '删除配置失败' }); }
});

// 配置变更历史
router.get('/configs/:key/history', adminOnly, async (req, res) => {
  const env = curEnv(req);
  try {
    const [rows] = await poolOf(req).execute(
      'SELECT * FROM config_history WHERE configKey=? AND env=? ORDER BY version DESC LIMIT 50',
      [req.params.key, env]
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: '读取历史失败' }); }
});

// 一键回滚：把配置恢复到指定历史版本
router.post('/configs/:key/rollback', adminOnly, async (req, res) => {
  const username = req.user?.name || req.user?.username || '';
  const env = curEnv(req);
  const version = Number(req.body?.version);
  const pool = poolOf(req);
  if (!version) return res.status(400).json({ success: false, message: '请指定回滚版本' });
  try {
    const [[snap]] = await pool.execute(
      'SELECT configValue, description, version FROM config_history WHERE configKey=? AND env=? AND version=?',
      [req.params.key, env, version]
    );
    if (!snap) return res.status(404).json({ success: false, message: '该版本不存在' });
    const [[cur]] = await pool.execute('SELECT version FROM app_configs WHERE configKey=? AND env=?', [req.params.key, env]);
    if (!cur) return res.status(404).json({ success: false, message: '该环境下配置不存在' });
    const nextVer = (cur.version || 1) + 1;
    await pool.execute(
      'UPDATE app_configs SET configValue=?, version=?, updatedBy=? WHERE configKey=? AND env=?',
      [snap.configValue, nextVer, username, req.params.key, env]
    );
    await writeConfigHistory(pool, {
      configKey: req.params.key, env, version: nextVer,
      configValue: snap.configValue, description: snap.description,
      operation: `rollback→v${snap.version}`, operator: username
    });
    audit(req, 'update', 'config', `回滚配置 ${req.params.key} 至 v${snap.version} (${env})`, req.params.key);
    res.json({ success: true, data: { version: nextVer, restoredFrom: snap.version } });
  } catch (e) { res.status(500).json({ success: false, message: '回滚失败' }); }
});

// ==================== 定时任务 ====================
router.get('/tasks', adminOnly, async (req, res) => {
  try {
    const [rows] = await poolOf(req).execute('SELECT * FROM scheduled_tasks ORDER BY id');
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: '读取任务失败' }); }
});
router.put('/tasks/:id/toggle', adminOnly, async (req, res) => {
  const { enabled } = req.body || {};
  try {
    await poolOf(req).execute('UPDATE scheduled_tasks SET enabled=? WHERE id=?', [enabled ? 1 : 0, req.params.id]);
    audit(req, 'update', 'task', `${enabled ? '启用' : '停用'}定时任务 ID ${req.params.id}`, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '操作失败' }); }
});
router.post('/tasks', adminOnly, async (req, res) => {
  const { taskName, taskKey, cron, description, enabled } = req.body || {};
  if (!taskName || !taskKey || !cron) return res.status(400).json({ success: false, message: '任务名称/标识/Cron 必填' });
  try {
    const [r] = await poolOf(req).execute(
      'INSERT INTO scheduled_tasks (taskName, taskKey, cron, description, enabled) VALUES (?,?,?,?,?)',
      [taskName, taskKey, cron, description || null, enabled ? 1 : 0]
    );
    audit(req, 'create', 'task', `新增定时任务 ${taskName} (${taskKey})`, r.insertId);
    res.json({ success: true, data: { id: r.insertId } });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: '任务标识已存在' });
    res.status(500).json({ success: false, message: '新增失败' });
  }
});
router.put('/tasks/:id', adminOnly, async (req, res) => {
  const { taskName, taskKey, cron, description } = req.body || {};
  if (!taskName || !taskKey || !cron) return res.status(400).json({ success: false, message: '任务名称/标识/Cron 必填' });
  try {
    await poolOf(req).execute(
      'UPDATE scheduled_tasks SET taskName=?, taskKey=?, cron=?, description=? WHERE id=?',
      [taskName, taskKey, cron, description || null, req.params.id]
    );
    audit(req, 'update', 'task', `编辑定时任务 ID ${req.params.id}`, req.params.id);
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: '任务标识已存在' });
    res.status(500).json({ success: false, message: '更新失败' });
  }
});
router.delete('/tasks/:id', adminOnly, async (req, res) => {
  try {
    await poolOf(req).execute('DELETE FROM scheduled_tasks WHERE id=?', [req.params.id]);
    audit(req, 'delete', 'task', `删除定时任务 ID ${req.params.id}`, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '删除失败' }); }
});

// ==================== 在线会话管理 ====================
router.get('/sessions', adminOnly, async (req, res) => {
  try {
    const [rows] = await poolOf(req).execute('SELECT * FROM user_sessions ORDER BY lastActiveAt DESC');
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: '读取会话失败' }); }
});
router.delete('/sessions/:id', adminOnly, async (req, res) => {
  try {
    const [[s]] = await poolOf(req).execute('SELECT username, tokenVersion FROM user_sessions WHERE id=?', [req.params.id]);
    if (!s) return res.status(404).json({ success: false, message: '会话不存在' });
    // 踢下线：提升该用户 token_version，使其所有旧 token 立即失效
    await poolOf(req).execute('UPDATE users SET token_version = COALESCE(token_version,0)+1 WHERE username=?', [s.username]);
    await poolOf(req).execute('DELETE FROM user_sessions WHERE id=?', [req.params.id]);
    audit(req, 'delete', 'session', `强制下线用户 ${s.username}`, s.username);
    res.json({ success: true, message: '已强制下线' });
  } catch (e) { res.status(500).json({ success: false, message: '踢下线失败' }); }
});

// ==================== IP 白名单 ====================
function ipToLong(ip) {
  return ip.split('.').reduce((acc, n) => (acc << 8) + (parseInt(n, 10) || 0), 0) >>> 0;
}
function ipInCidr(ip, cidr) {
  if (!cidr.includes('/')) return ip === cidr;
  const [base, bits] = cidr.split('/');
  const mask = (0xffffffff << (32 - parseInt(bits, 10))) >>> 0;
  return (ipToLong(ip) & mask) === (ipToLong(base) & mask);
}
router.get('/ip-whitelist', adminOnly, async (req, res) => {
  try {
    const [rows] = await poolOf(req).execute('SELECT * FROM ip_whitelist ORDER BY id');
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: '读取白名单失败' }); }
});
router.post('/ip-whitelist', adminOnly, async (req, res) => {
  const { ip, remark = '' } = req.body || {};
  if (!ip) return res.status(400).json({ success: false, message: 'IP 必填' });
  try {
    const [r] = await poolOf(req).execute('INSERT INTO ip_whitelist (ip,remark) VALUES (?,?)', [ip, remark]);
    audit(req, 'create', 'security', `新增IP白名单 ${ip}`, ip);
    res.json({ success: true, data: { id: r.insertId } });
  } catch (e) { res.status(500).json({ success: false, message: '新增失败（可能已存在）' }); }
});
router.delete('/ip-whitelist/:id', adminOnly, async (req, res) => {
  try {
    await poolOf(req).execute('DELETE FROM ip_whitelist WHERE id=?', [req.params.id]);
    audit(req, 'delete', 'security', `删除IP白名单 ID ${req.params.id}`, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '删除失败' }); }
});
// ==================== 系统监控 ====================
let bootTime = Date.now();
router.get('/monitor', adminOnly, async (req, res) => {
  try {
    const cpus = os.cpus();
    const cpuCount = cpus.length;
    const cpuModel = cpus[0]?.model || 'unknown';
    let idle = 0, total = 0;
    cpus.forEach((c) => Object.keys(c.times).forEach((k) => { total += c.times[k]; if (k === 'idle') idle += c.times[k]; }));
    const cpuUsage = total ? Math.round((1 - idle / total) * 100) : 0;
    const memTotal = os.totalmem(), memFree = os.freemem();
    const memory = {
      total: memTotal, free: memFree, used: memTotal - memFree,
      usagePercent: Math.round(((memTotal - memFree) / memTotal) * 100),
    };
    let disks = [];
    try {
      const { execFileSync } = await import('child_process');
      const out = execFileSync('wmic', ['logicaldisk', 'get', 'size,freespace,caption'], { encoding: 'utf8', timeout: 4000 });
      disks = out.split('\n').slice(1).map((line) => {
        const m = line.trim().split(/\s+/);
        if (m.length < 3 || !/^\d+$/.test(m[1]) || !/^\d+$/.test(m[2])) return null;
        const cap = m[0], free = +m[1], size = +m[2];
        if (!size) return null;
        return { caption: cap, size, free, used: size - free, usagePercent: Math.round(((size - free) / size) * 100) };
      }).filter(Boolean);
    } catch { /* wmic 不可用时跳过磁盘 */ }
    // 数据库连接池状态
    let dbStatus = 'down';
    try { await poolOf(req).execute('SELECT 1'); dbStatus = 'up'; } catch {}
    res.json({
      success: true,
      data: {
        cpu: { usagePercent: cpuUsage, count: cpuCount, model: cpuModel },
        memory, disks,
        system: { platform: os.platform(), arch: os.arch(), nodeVersion: process.version, hostname: os.hostname(), uptime: Math.floor((Date.now() - bootTime) / 1000) },
        services: { database: dbStatus, api: 'up' },
        gateway: getGatewayStats(),
        timestamp: new Date().toISOString()
      }
    });
  } catch (e) { res.status(500).json({ success: false, message: '获取监控数据失败' }); }
});

// ==================== TOTP 二次验证 ====================
// 纯 RFC 6238 实现（HMAC-SHA1 / 30s / 6 位），无需 otplib
function base32Encode(buf) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, out = [];
  for (const ch of str.toUpperCase().replace(/=+$/, '')) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpCode(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]) % 1000000;
  return String(code).padStart(6, '0');
}
function verifyTotp(secret, token, window = 1) {
  const counter = Math.floor(Date.now() / 30000);
  for (let i = -window; i <= window; i++) {
    if (totpCode(secret, counter + i) === String(token)) return true;
  }
  return false;
}
router.get('/totp/status', adminOnly, async (req, res) => {
  const username = req.user?.name || req.user?.username;
  try {
    const [[row]] = await poolOf(req).execute('SELECT enabled, enabledAt FROM user_totp WHERE username=?', [username]);
    res.json({ success: true, data: { enabled: !!row?.enabled, enabledAt: row?.enabledAt || null } });
  } catch (e) { res.json({ success: true, data: { enabled: false } }); }
});
router.post('/totp/setup', adminOnly, async (req, res) => {
  const username = req.user?.name || req.user?.username;
  const secret = base32Encode(crypto.randomBytes(20));
  try {
    await poolOf(req).execute(
      'INSERT INTO user_totp (username,secret,enabled) VALUES (?,?,0) ON DUPLICATE KEY UPDATE secret=VALUES(secret), enabled=0, enabledAt=NULL',
      [username, secret]
    );
    const issuer = 'StarterAdmin';
    const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
    res.json({ success: true, data: { secret, otpauth } });
  } catch (e) { res.status(500).json({ success: false, message: '生成密钥失败' }); }
});
router.post('/totp/enable', adminOnly, async (req, res) => {
  const username = req.user?.name || req.user?.username;
  const { token } = req.body || {};
  try {
    const [[row]] = await poolOf(req).execute('SELECT secret FROM user_totp WHERE username=?', [username]);
    if (!row) return res.status(400).json({ success: false, message: '请先获取密钥' });
    if (!verifyTotp(row.secret, token)) return res.status(400).json({ success: false, message: '验证码错误' });
    await poolOf(req).execute('UPDATE user_totp SET enabled=1, enabledAt=NOW() WHERE username=?', [username]);
    audit(req, 'update', 'security', '启用 TOTP 二次验证', username);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '启用失败' }); }
});
router.post('/totp/disable', adminOnly, async (req, res) => {
  const username = req.user?.name || req.user?.username;
  const { token } = req.body || {};
  try {
    const [[row]] = await poolOf(req).execute('SELECT secret FROM user_totp WHERE username=?', [username]);
    if (!row || !verifyTotp(row.secret, token)) return res.status(400).json({ success: false, message: '验证码错误' });
    await poolOf(req).execute('UPDATE user_totp SET enabled=0 WHERE username=?', [username]);
    audit(req, 'update', 'security', '关闭 TOTP 二次验证', username);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '关闭失败' }); }
});

export default router;
